// ── GET /api/v1/queue ────────────────────────────────────────────────────────
// Unified queue: pulls active tickets from Zendesk + Jira, normalizes to a
// single shape, and returns a merged list. This is the single source of truth.
//
// Zendesk: HR Experience group, statuses new/open/pending/hold
// Jira:    HR Experience project (HROP), statuses not Done/Closed/Resolved
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { searchTickets, showManyUsers, isZendeskConfigured } from '../../../../src/lib/zendesk-api';
import { searchIssues, isJiraConfigured } from '../../../../src/lib/jira-api';

// ── Config (overridable via env vars) ────────────────────────────────────────
const ZD_GROUP_NAME = process.env.ZENDESK_HR_GROUP || 'HR Experience';
const JIRA_PROJECT  = process.env.JIRA_HR_PROJECT  || 'HROP';
const JIRA_BASE     = process.env.JIRA_BASE_URL    || '';
const ZD_SUBDOMAIN  = process.env.ZENDESK_SUBDOMAIN || '';

// ── Simple in-memory cache (30s TTL) ─────────────────────────────────────────
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

// ── Zendesk status → app status ──────────────────────────────────────────────
const ZD_STATUS_MAP = {
  new:      'new',
  open:     'in_progress',
  pending:  'waiting',
  hold:     'waiting',
  solved:   'resolved',
  closed:   'resolved',
};

// ── Zendesk priority → app priority ──────────────────────────────────────────
const ZD_PRIORITY_MAP = {
  urgent: 'critical',
  high:   'high',
  normal: 'medium',
  low:    'low',
};

// ── Jira status → app status (case-insensitive lookup) ───────────────────────
const JIRA_STATUS_MAP = {
  'to do':               'new',
  'open':                'new',
  'backlog':             'new',
  'new':                 'new',
  'in progress':         'in_progress',
  'in review':           'in_progress',
  'in development':      'in_progress',
  'code review':         'in_progress',
  'under review':        'in_progress',
  'blocked':             'waiting',
  'waiting for support': 'waiting',
  'on hold':             'waiting',
  'pending':             'waiting',
  'done':                'resolved',
  'closed':              'resolved',
  'resolved':            'resolved',
  'completed':           'resolved',
  'cancelled':           'resolved',
};

// ── Jira priority → app priority ─────────────────────────────────────────────
const JIRA_PRIORITY_MAP = {
  highest:  'critical',
  blocker:  'critical',
  critical: 'critical',
  high:     'high',
  medium:   'medium',
  low:      'low',
  lowest:   'low',
};

// ── Tag / label → function type mapping ──────────────────────────────────────
const TYPE_KEYWORDS = {
  onboarding:    'Onboarding',
  offboarding:   'Offboarding',
  benefits:      'Benefits',
  leave:         'Leave Request',
  pto:           'Leave Request',
  'time off':    'Leave Request',
  'time-off':    'Leave Request',
  document:      'Document Request',
  payroll:       'Payment Issue',
  payment:       'Payment Issue',
  salary:        'Payment Issue',
  payslip:       'Payment Issue',
  immigration:   'Immigration',
  visa:          'Immigration',
  'work permit': 'Immigration',
  access:        'Access Issue',
  login:         'Access Issue',
  password:      'Access Issue',
  policy:        'Policy Query',
  expense:       'Expenses',
  reimbursement: 'Expenses',
  schedule:      'Scheduling',
  calendar:      'Scheduling',
  compensation:  'Compensation',
  promotion:     'Promotion',
  recruitment:   'Recruitment',
  hiring:        'Recruitment',
  record:        'Record Update',
  'name change': 'Record Update',
  equipment:     'Equipment',
  laptop:        'Equipment',
  hardware:      'Equipment',
  amendment:     'Amendment',
  contract:      'Amendment',
  compliance:    'Compliance',
  training:      'Compliance',
  gdpr:          'Compliance',
};

function detectType(subject, tags = [], labels = []) {
  // Check tags/labels first (most reliable)
  const allTags = [...tags, ...labels].map(t => t.toLowerCase());
  for (const tag of allTags) {
    for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
      if (tag.includes(keyword)) return type;
    }
  }
  // Fall back to subject keyword matching
  const subjectLower = (subject || '').toLowerCase();
  for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
    if (subjectLower.includes(keyword)) return type;
  }
  return 'Policy Query'; // generic default
}

// ── Extract plain text from Jira ADF ─────────────────────────────────────────
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
  return '';
}

// ── Fetch Zendesk tickets ────────────────────────────────────────────────────
async function fetchZendeskQueue() {
  if (!isZendeskConfigured()) return { items: [], status: 'skipped', error: null };

  try {
    // Active tickets in HR Experience group
    const activeQuery = `group:"${ZD_GROUP_NAME}" status<solved`;
    // Recently solved (last 4 hours) — so the app can show transitions
    const solvedQuery = `group:"${ZD_GROUP_NAME}" status:solved updated<4hours`;

    const [activeRes, solvedRes] = await Promise.allSettled([
      searchTickets(activeQuery, { per_page: 100, sort_by: 'updated_at', sort_order: 'desc' }),
      searchTickets(solvedQuery, { per_page: 50, sort_by: 'updated_at', sort_order: 'desc' }),
    ]);

    const activeTickets = activeRes.status === 'fulfilled' ? (activeRes.value?.results || []) : [];
    const solvedTickets = solvedRes.status === 'fulfilled' ? (solvedRes.value?.results || []) : [];
    const allTickets = [...activeTickets, ...solvedTickets];

    if (allTickets.length === 0) return { items: [], status: 'ok', error: null };

    // Collect unique user IDs (assignees + requesters) for batch lookup
    const userIds = new Set();
    for (const t of allTickets) {
      if (t.assignee_id) userIds.add(t.assignee_id);
      if (t.requester_id) userIds.add(t.requester_id);
    }

    // Batch-fetch user details
    const userMap = {};
    if (userIds.size > 0) {
      try {
        const usersRes = await showManyUsers([...userIds]);
        for (const u of (usersRes?.users || [])) {
          userMap[u.id] = { name: u.name, email: u.email };
        }
      } catch (err) {
        console.warn('[queue] Zendesk user lookup failed:', err.message);
      }
    }

    // Normalize tickets
    const items = allTickets.map(t => {
      const assignee = userMap[t.assignee_id] || {};
      const requester = userMap[t.requester_id] || {};

      return {
        id: `ZD-${t.id}`,
        source: 'zendesk',
        externalId: String(t.id),
        subject: t.subject || '(no subject)',
        description: (t.description || '').substring(0, 1000),
        status: ZD_STATUS_MAP[t.status] || 'new',
        priority: ZD_PRIORITY_MAP[t.priority] || 'medium',
        type: detectType(t.subject, t.tags || []),
        assigneeEmail: assignee.email || null,
        assigneeName: assignee.name || null,
        requesterName: requester.name || 'Unknown',
        requesterEmail: requester.email || null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        externalUrl: ZD_SUBDOMAIN
          ? `https://${ZD_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`
          : '',
        tags: t.tags || [],
      };
    });

    return {
      items,
      status: 'ok',
      count: items.length,
      error: null,
    };
  } catch (err) {
    console.error('[queue] Zendesk fetch error:', err.message);
    return { items: [], status: 'error', error: err.message };
  }
}

// ── Fetch Jira issues ────────────────────────────────────────────────────────
async function fetchJiraQueue() {
  if (!isJiraConfigured()) return { items: [], status: 'skipped', error: null };

  try {
    // Active issues + recently resolved (last 4 hours)
    const jql = `project = ${JIRA_PROJECT} AND (status NOT IN (Done, Closed, Resolved, Cancelled) OR (status IN (Done, Closed, Resolved) AND updated >= -4h)) ORDER BY updated DESC`;

    const result = await searchIssues(jql, {
      maxResults: 100,
      fields: [
        'summary', 'status', 'assignee', 'reporter', 'priority',
        'created', 'updated', 'issuetype', 'project', 'labels',
        'description',
      ],
    });

    const issues = result?.issues || [];

    const items = issues.map(issue => {
      const f = issue.fields || {};
      const statusName = f.status?.name || '';
      const priorityName = f.priority?.name || '';
      const assignee = f.assignee || {};
      const reporter = f.reporter || {};

      return {
        id: issue.key,
        source: 'jira',
        externalId: issue.key,
        subject: f.summary || '(no summary)',
        description: adfToText(f.description).substring(0, 1000),
        status: JIRA_STATUS_MAP[statusName.toLowerCase()] || 'in_progress',
        priority: JIRA_PRIORITY_MAP[priorityName.toLowerCase()] || 'medium',
        type: detectType(f.summary, [], f.labels || []),
        assigneeEmail: assignee.emailAddress || null,
        assigneeName: assignee.displayName || null,
        requesterName: reporter.displayName || 'System',
        requesterEmail: reporter.emailAddress || null,
        createdAt: f.created,
        updatedAt: f.updated,
        externalUrl: JIRA_BASE ? `${JIRA_BASE}/browse/${issue.key}` : '',
        tags: f.labels || [],
        jiraStatus: statusName, // preserve original for debugging
        jiraType: f.issuetype?.name || null,
      };
    });

    return {
      items,
      status: 'ok',
      count: items.length,
      error: null,
    };
  } catch (err) {
    console.error('[queue] Jira fetch error:', err.message);
    return { items: [], status: 'error', error: err.message };
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check cache
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) {
    return NextResponse.json(_cache);
  }

  // Fetch from both systems in parallel
  const [zendesk, jira] = await Promise.all([
    fetchZendeskQueue(),
    fetchJiraQueue(),
  ]);

  // Merge and deduplicate by id
  const seen = new Set();
  const items = [];
  for (const item of [...zendesk.items, ...jira.items]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }

  const response = {
    items,
    meta: {
      zendesk: { count: zendesk.count || 0, status: zendesk.status, error: zendesk.error },
      jira:    { count: jira.count || 0,    status: jira.status,    error: jira.error },
      syncedAt: new Date().toISOString(),
      totalActive: items.filter(i => i.status !== 'resolved').length,
      totalResolved: items.filter(i => i.status === 'resolved').length,
    },
  };

  // Cache
  _cache = response;
  _cacheTime = now;

  return NextResponse.json(response);
}
