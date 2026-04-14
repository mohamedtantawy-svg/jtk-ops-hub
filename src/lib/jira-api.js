// ── Jira / Atlassian API client ──────────────────────────────────────────────
// Server-side only. Proxies calls to the Atlassian REST API.
// Uses API token auth (email + token) for Jira Cloud.

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || ''; // e.g. https://deel.atlassian.net
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL || '';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';

export function isJiraConfigured() {
  return !!(JIRA_BASE_URL && JIRA_USER_EMAIL && JIRA_API_TOKEN);
}

/**
 * Generic fetch wrapper for Jira REST API v3.
 */
export async function jiraFetch(endpoint, options = {}) {
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
    signal: options.signal || AbortSignal.timeout(15000),
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

// ── Search (JQL) ─────────────────────────────────────────────────────────────

export async function searchIssues(jql, params = {}) {
  const fields = params.fields || [
    'summary', 'status', 'assignee', 'reporter', 'priority',
    'created', 'updated', 'issuetype', 'project', 'labels',
    'comment', 'description',
  ];
  const maxResults = params.maxResults || 50;

  // Jira Cloud has migrated to /search/jql (GET) — use query params
  const qs = new URLSearchParams();
  qs.set('jql', jql);
  qs.set('maxResults', String(maxResults));
  qs.set('fields', fields.join(','));
  if (params.startAt) qs.set('startAt', String(params.startAt));

  try {
    return await jiraFetch(`/search/jql?${qs.toString()}`);
  } catch (err) {
    // Fall back to legacy POST /search if new endpoint fails
    if (err.status === 404 || err.status === 405) {
      const body = { jql, maxResults, startAt: params.startAt || 0, fields };
      return jiraFetch('/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
    throw err;
  }
}

// ── Single Issue ─────────────────────────────────────────────────────────────

export async function getIssue(issueKey) {
  return jiraFetch(`/issue/${issueKey}`);
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

// ── Projects ─────────────────────────────────────────────────────────────────

export async function listProjects(params = {}) {
  const qs = new URLSearchParams();
  if (params.maxResults) qs.set('maxResults', String(params.maxResults));
  if (params.startAt) qs.set('startAt', String(params.startAt));
  const q = qs.toString();
  return jiraFetch(`/project/search${q ? `?${q}` : ''}`);
}
