// ── Jira / Atlassian API client ──────────────────────────────────────────────
// Server-side only. Proxies calls to the Atlassian REST API.
// Includes automatic retry with exponential backoff on transient failures.
// Uses API token auth (email + token) for Jira Cloud.

import { withRetry } from './retry';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || ''; // e.g. https://deel.atlassian.net
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL || '';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';

export function isJiraConfigured() {
  return !!(JIRA_BASE_URL && JIRA_USER_EMAIL && JIRA_API_TOKEN);
}

/**
 * Raw fetch wrapper — no retry.
 */
async function _jiraFetch(endpoint, options = {}) {
  if (!isJiraConfigured()) {
    throw new Error('Jira API is not configured (JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN)');
  }

  const auth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const url = `${JIRA_BASE_URL}/rest/api/3${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Jira API ${res.status}: ${body.substring(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Jira API fetch with automatic retry (3 attempts, exponential backoff).
 */
export async function jiraFetch(endpoint, options = {}) {
  return withRetry(() => _jiraFetch(endpoint, options), { label: 'Jira', maxRetries: 2 });
}

// ── Custom field discovery ──────────────────────────────────────────────────
// HRX managers can be set on an issue via several user-valued custom fields
// (Country Owner, Task Owner, Process Owner, Team Responsible, etc) in
// addition to the built-in `assignee`. Those fields have instance-specific
// IDs like `customfield_12345`. We discover them by display name once per
// hour and cache the mapping so the queue route doesn't re-fetch on every
// request.

const FIELD_CACHE_TTL_MS = 60 * 60 * 1000;
let _fieldCache = null;
let _fieldCacheTs = 0;

export async function listJiraFields() {
  const now = Date.now();
  if (_fieldCache && now - _fieldCacheTs < FIELD_CACHE_TTL_MS) return _fieldCache;
  try {
    const fields = await jiraFetch('/field');
    _fieldCache = Array.isArray(fields) ? fields : [];
    _fieldCacheTs = now;
  } catch (e) {
    console.warn('[jira] listJiraFields failed:', e.message);
    if (!_fieldCache) _fieldCache = [];
  }
  return _fieldCache;
}

/**
 * Given a list of display-name substrings (case-insensitive), return a map
 * from the substring → customfield_id for the first field whose name matches.
 * Unmatched substrings are omitted.
 *
 * Example: resolveHrxOwnerFields(['country owner', 'task owner'])
 *   → { 'country owner': 'customfield_10234', 'task owner': 'customfield_10567' }
 */
export async function resolveHrxOwnerFields(substrings) {
  const fields = await listJiraFields();
  const out = {};
  const remaining = new Set(substrings.map(s => s.toLowerCase()));
  for (const f of fields) {
    if (remaining.size === 0) break;
    const name = (f?.name || '').toLowerCase();
    for (const needle of remaining) {
      if (name.includes(needle)) {
        out[needle] = f.id;
        remaining.delete(needle);
        break;
      }
    }
  }
  return out;
}

/**
 * Pulls every user-like email out of a raw Jira custom-field value.
 * Handles:
 *   - single user object { emailAddress, accountId, ... }
 *   - array of user objects
 *   - raw email strings (text fields)
 *   - array of strings
 * Returns a lower-cased email array (deduped).
 */
export function emailsFromJiraFieldValue(value) {
  if (!value) return [];
  const out = new Set();
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') {
      const match = v.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
      if (match) for (const m of match) out.add(m.toLowerCase());
    } else if (typeof v === 'object') {
      if (typeof v.emailAddress === 'string') out.add(v.emailAddress.toLowerCase());
    }
  };
  if (Array.isArray(value)) for (const v of value) push(v); else push(value);
  return [...out];
}

// ── Search (JQL) ─────────────────────────────────────────────────────────────
//
// Jira Cloud migrated `/rest/api/3/search/jql` in 2024:
//   - Body must be POSTed (GET querystring overflows the 8KB request-line cap
//     on any non-trivial JQL → HTTP 414).
//   - Pagination switched from offset-based (`startAt`) to token-based
//     (`nextPageToken`). Sending `startAt` in the body is a schema violation
//     → HTTP 400 "Invalid request payload".
//   - The response no longer includes `total`; loops must stop on `isLast`
//     or a missing `nextPageToken`.
// We always POST and always use `nextPageToken` — simplest, and immune to
// JQL size growth (since nothing sits in the URL).
//
// Response shape: { issues: [...], nextPageToken?: "...", isLast: boolean }

export async function searchIssues(jql, params = {}) {
  const fields = params.fields || [
    'summary', 'status', 'assignee', 'reporter', 'priority',
    'created', 'updated', 'issuetype', 'project', 'labels',
    'comment', 'description',
  ];
  const maxResults = params.maxResults || 50;

  const body = { jql, maxResults, fields };
  if (params.nextPageToken) body.nextPageToken = params.nextPageToken;

  return jiraFetch('/search/jql', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Single Issue ─────────────────────────────────────────────────────────────

export async function getIssue(issueKey) {
  return jiraFetch(`/issue/${issueKey}`);
}

// ── Bulk fetch descriptions for a list of issue keys ────────────────────────
// Used to enrich non-Jira records (e.g. offboarding cases) with data that
// lives inside the linked Jira ticket — currently the Zendesk URL.
//
// Batches keys into JQL `issuekey in (...)` queries (Jira's JQL `in` clause
// handles ~100 keys comfortably). Returns a Map<issueKey, rawDescription>.
// `rawDescription` is the serialized text of the ADF description so callers
// can run simple regex matching without walking the tree.
export async function getIssueDescriptionsByKeys(keys) {
  const out = new Map();
  if (!Array.isArray(keys) || keys.length === 0) return out;

  const unique = Array.from(new Set(keys.filter(k => typeof k === 'string' && k.trim()))).map(k => k.trim());
  if (unique.length === 0) return out;

  const BATCH_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    chunks.push(unique.slice(i, i + BATCH_SIZE));
  }

  // Batches are independent — fire them in parallel so a 12-batch job
  // (≈1200 keys) finishes in one round-trip instead of twelve.
  await Promise.all(chunks.map(async (chunk, idx) => {
    const jql = `issuekey in (${chunk.join(',')})`;
    try {
      const res = await searchIssues(jql, { fields: ['description'], maxResults: chunk.length });
      for (const issue of res?.issues || []) {
        out.set(issue.key, adfToPlainText(issue.fields?.description));
      }
    } catch (err) {
      console.warn(`[jira] getIssueDescriptionsByKeys batch ${idx} failed: ${err.message}`);
    }
  }));
  return out;
}

// ── ADF (Atlassian Document Format) → plain text ────────────────────────────
// The description from /rest/api/3 is a doc tree. We don't care about
// formatting — just need every text and link-href string so a regex can
// pull out embedded URLs.
function adfToPlainText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  let out = '';
  if (typeof node.text === 'string') out += ` ${node.text}`;
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      const href = mark?.attrs?.href;
      if (href) out += ` ${href}`;
    }
  }
  if (node.attrs) {
    if (typeof node.attrs.url === 'string') out += ` ${node.attrs.url}`;
    if (typeof node.attrs.href === 'string') out += ` ${node.attrs.href}`;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) out += ` ${adfToPlainText(child)}`;
  }
  return out;
}

// ── Create Issue ─────────────────────────────────────────────────────────────

export async function createIssue(projectKey, summary, description, issueType = 'Task', extra = {}) {
  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
      },
      issuetype: { name: issueType },
      ...extra,
    },
  };
  return jiraFetch('/issue', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Add Comment ──────────────────────────────────────────────────────────────

export async function addComment(issueKey, commentText) {
  const body = {
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }],
    },
  };
  return jiraFetch(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Transition Issue ─────────────────────────────────────────────────────────

export async function transitionIssue(issueKey, transitionId) {
  return jiraFetch(`/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

// ── Get Transitions ──────────────────────────────────────────────────────────

export async function getTransitions(issueKey) {
  return jiraFetch(`/issue/${issueKey}/transitions`);
}

// ── Reassign Issue ──────────────────────────────────────────────────────

export async function reassignIssue(issueKey, assigneeEmail) {
  // Look up Jira account by email
  const users = await jiraFetch(`/user/search?query=${encodeURIComponent(assigneeEmail)}`);
  const user = users?.[0];
  if (!user) throw new Error(`Jira user not found for email: ${assigneeEmail}`);

  // Update the issue's assignee
  return jiraFetch(`/issue/${issueKey}/assignee`, {
    method: 'PUT',
    body: JSON.stringify({ accountId: user.accountId }),
  });
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function listProjects(params = {}) {
  const qs = new URLSearchParams();
  if (params.maxResults) qs.set('maxResults', String(params.maxResults));
  if (params.startAt) qs.set('startAt', String(params.startAt));
  const q = qs.toString();
  return jiraFetch(`/project/search${q ? `?${q}` : ''}`);
}
