// ── Productivity aggregator (2026-06-01) ──────────────────────────────────
// Backs the Leaders Hub → Reports → Productivity report. Answers Sarah
// Suge's ask (Bug → Productivity Report, 2026-05): "no centralized way
// to track team productivity — view tasks solved per team per category
// over a selected time period (weekly, monthly, or custom)".
//
// Data sources counted as "tasks solved":
//   • HR Hub             — hr_hub_request.resolved_at
//   • Urgent Assist      — urgent_assist_request.resolved_at
//   • Work Tasks         — work_tasks.completed_at
//   • Feedback           — feedback_requests.resolved_at (cross-dept; scoped
//                          by the assignee's resolved dept so a Director's
//                          feedback queue still attributes correctly)
//
// All four tables carry a clear resolution timestamp + an assignee email
// (feedback resolves to email via the members table). Three of four also
// carry org_node_id from Phase 11+ so the dept filter is a single
// indexed WHERE; feedback uses the assignee-based dept lookup.
//
// Future categories (out of scope for v1):
//   • Zendesk + Jira     — needs the queue route's per-dept fetchers to
//                          be lifted into a shared helper. Same blocker
//                          as capacity Phase 1B.
//   • Workbench, Onb,
//     Offb, Amendments,
//     Redlines, Incentive — needs a daily snapshot table to capture
//                          historical resolutions (the upstream Deel
//                          admin endpoints only expose current state).
//
// Cache: 5-minute in-process Map keyed by `${deptId}:${start}:${end}`.
// Productivity numbers are slowly moving over a week / month, but a
// short TTL keeps the manual refresh button responsive without making
// every back-to-back load wait on 4 fresh SQL queries.

import { query } from './db';

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

// Categories — keep keys, labels, colours, accent BGs in one place so the
// FE can mirror without re-defining.
export const CATEGORIES = [
  { key: 'hr_hub',         label: 'HR Hub',         color: '#7c3aed', bg: '#f3eff8' },
  { key: 'urgent_assist',  label: 'Urgent Assist',  color: '#ea580c', bg: '#fff7ed' },
  { key: 'work_tasks',     label: 'Work Tasks',     color: '#2563eb', bg: '#eff6ff' },
  { key: 'feedback',       label: 'Feedback',       color: '#0d9488', bg: '#ecfdf5' },
];
const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

function emptyCategoryMap() {
  const out = {};
  for (const k of CATEGORY_KEYS) out[k] = 0;
  return out;
}

// Format a JS Date as YYYY-MM-DD for the trend bucket key.
function dayKey(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(startIso, endIso) {
  const start = new Date(startIso + 'T00:00:00Z');
  const end   = new Date(endIso   + 'T00:00:00Z');
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// Member identity helpers. The per-row owner email is normalised to lower
// before bucket assignment so case-drift between upstream sources can't
// fragment one person into two leaderboard rows.
function lcEmail(s) { return String(s || '').trim().toLowerCase(); }

// ── Per-source resolved-row loaders ───────────────────────────────────────
// Each returns a flat array of { assigneeEmail, resolvedAt, dayKey }.
// All scope to the dept sub-tree, except feedback which scopes via the
// member's resolved dept (feedback rows are cross-dept by design).

async function loadHrHubResolved(deptSubtreeIds, startIso, endIso) {
  if (!deptSubtreeIds || deptSubtreeIds.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT LOWER(COALESCE(assignee_email, ''))    AS assignee_email,
              resolved_at
         FROM hr_hub_request
        WHERE org_node_id = ANY($1::uuid[])
          AND resolved_at IS NOT NULL
          AND resolved_at >= $2::timestamptz
          AND resolved_at <  $3::timestamptz`,
      [deptSubtreeIds, startIso, endIso],
    );
    return rows.map(r => ({
      assigneeEmail: r.assignee_email,
      resolvedAt: r.resolved_at,
      dayKey: dayKey(new Date(r.resolved_at)),
    }));
  } catch (err) {
    console.warn('[productivity] hr_hub load failed:', err?.message);
    return [];
  }
}

async function loadUrgentAssistResolved(deptSubtreeIds, startIso, endIso) {
  if (!deptSubtreeIds || deptSubtreeIds.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT LOWER(COALESCE(assignee_email, ''))    AS assignee_email,
              resolved_at
         FROM urgent_assist_request
        WHERE org_node_id = ANY($1::uuid[])
          AND resolved_at IS NOT NULL
          AND resolved_at >= $2::timestamptz
          AND resolved_at <  $3::timestamptz`,
      [deptSubtreeIds, startIso, endIso],
    );
    return rows.map(r => ({
      assigneeEmail: r.assignee_email,
      resolvedAt: r.resolved_at,
      dayKey: dayKey(new Date(r.resolved_at)),
    }));
  } catch (err) {
    console.warn('[productivity] urgent_assist load failed:', err?.message);
    return [];
  }
}

async function loadWorkTasksResolved(deptSubtreeIds, startIso, endIso) {
  if (!deptSubtreeIds || deptSubtreeIds.length === 0) return [];
  // work_tasks.assignee_emails is TEXT[]; UNNEST to one row per assignee
  // so each owner gets credit. If a task has 3 assignees, it counts 3x —
  // matches the audit's "credit who actually did the work" pattern.
  try {
    const { rows } = await query(
      `SELECT LOWER(assignee) AS assignee_email,
              completed_at    AS resolved_at
         FROM work_tasks,
              LATERAL UNNEST(CASE
                               WHEN assignee_emails IS NULL OR array_length(assignee_emails, 1) IS NULL
                                 THEN ARRAY[creator_email]
                               ELSE assignee_emails
                             END) AS assignee
        WHERE org_node_id = ANY($1::uuid[])
          AND status = 'done'
          AND completed_at IS NOT NULL
          AND completed_at >= $2::timestamptz
          AND completed_at <  $3::timestamptz
          AND is_archived = false`,
      [deptSubtreeIds, startIso, endIso],
    );
    return rows.map(r => ({
      assigneeEmail: r.assignee_email,
      resolvedAt: r.resolved_at,
      dayKey: dayKey(new Date(r.resolved_at)),
    }));
  } catch (err) {
    console.warn('[productivity] work_tasks load failed:', err?.message);
    return [];
  }
}

async function loadFeedbackResolved(deptMemberEmails, startIso, endIso) {
  // feedback_requests carries no org_node_id (cross-dept by locked
  // multi-tenant rules), but the assignee belongs to a dept — scope the
  // count to assignees in the caller's dept sub-tree by joining against
  // the pre-resolved member-email list.
  if (!deptMemberEmails || deptMemberEmails.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT LOWER(m.email) AS assignee_email,
              fr.resolved_at
         FROM feedback_requests fr
         JOIN members m ON m.id = fr.assignee_id
        WHERE LOWER(m.email) = ANY($1::text[])
          AND fr.resolved_at IS NOT NULL
          AND fr.resolved_at >= $2::timestamptz
          AND fr.resolved_at <  $3::timestamptz`,
      [deptMemberEmails, startIso, endIso],
    );
    return rows.map(r => ({
      assigneeEmail: r.assignee_email,
      resolvedAt: r.resolved_at,
      dayKey: dayKey(new Date(r.resolved_at)),
    }));
  } catch (err) {
    console.warn('[productivity] feedback load failed:', err?.message);
    return [];
  }
}

// ── Dept member + team-lead resolution ────────────────────────────────────
// Returns the dept's full member roster (one row per member, latest
// override) so we can: filter feedback by email, group rows by team lead,
// resolve names, and surface members with zero resolutions in the
// leaderboard's "no contributions" tail (Phase 1 ships the top N only —
// the tail is a future enhancement).

async function loadDeptMembers(deptSubtreeIds) {
  if (!deptSubtreeIds || deptSubtreeIds.length === 0) return [];
  const { rows } = await query(
    `SELECT LOWER(tmo.email)                       AS email,
            tmo.name                               AS name,
            COALESCE(tmo.title, '')                AS title,
            COALESCE(tmo.access, 'agent')          AS access,
            LOWER(COALESCE(tmo.manager_email, '')) AS manager_email,
            COALESCE(tmo.is_deleted, false)        AS is_deleted,
            COALESCE(tmo.on_leave, false)          AS on_leave,
            tmo.avatar_url                         AS avatar_url
       FROM team_member_overrides tmo
      WHERE tmo.org_node_id = ANY($1::uuid[])
        AND tmo.is_deleted = false`,
    [deptSubtreeIds],
  );
  return rows;
}

// In-memory walker that returns the first ancestor whose access is
// manager-tier. Capped at 6 hops to defend against malformed cycles.
function buildLeadResolver(members) {
  const byEmail = new Map();
  for (const m of members) byEmail.set(m.email, m);
  return function findLead(startEmail) {
    let cursor = startEmail;
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      if (!cursor || seen.has(cursor)) return '';
      seen.add(cursor);
      const m = byEmail.get(cursor);
      if (!m) return '';
      if (m.access === 'team_lead' || m.access === 'regional_manager'
          || m.access === 'manager' || m.access === 'admin') {
        return cursor;
      }
      cursor = m.manager_email || '';
    }
    return '';
  };
}

async function loadDeptSubtreeIds(deptId) {
  if (!deptId) return [];
  try {
    const { rows } = await query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM org_nodes WHERE id = $1 AND is_archived = false
         UNION ALL
         SELECT n.id FROM org_nodes n
           JOIN subtree s ON n.parent_id = s.id
          WHERE n.is_archived = false
       )
       SELECT id FROM subtree`,
      [deptId],
    );
    return rows.map(r => r.id);
  } catch (err) {
    console.warn('[productivity] subtree resolve failed:', err?.message);
    return [];
  }
}

// ── Main aggregate ────────────────────────────────────────────────────────
// Public entry point. Returns the full payload the FE renders.
//
// `start` / `end` are ISO date strings (`YYYY-MM-DD`). The range is
// inclusive of start, exclusive of end — daily buckets are aligned to UTC
// midnight. A 7-day "last week" pull therefore covers exactly 7 buckets.
//
// The "previous period" comparison uses the same span size immediately
// before the current range — e.g. last-7-days vs the 7 days before that.

export async function aggregateProductivity({ deptId, start, end, bustCache = false }) {
  if (!deptId || !start || !end) {
    return _emptyResult(start, end);
  }
  const cacheKey = `${deptId}:${start}:${end}`;
  if (!bustCache) {
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;
  }

  const startIso = start + 'T00:00:00Z';
  const endIso   = end   + 'T00:00:00Z';
  const span = daysBetween(start, end);
  // Previous period — same span immediately before `start`.
  const prevStart = new Date(start + 'T00:00:00Z');
  prevStart.setUTCDate(prevStart.getUTCDate() - span);
  const prevEnd = new Date(start + 'T00:00:00Z');
  const prevStartIso = prevStart.toISOString();
  const prevEndIso   = prevEnd.toISOString();

  const subtreeIds = await loadDeptSubtreeIds(deptId);
  if (subtreeIds.length === 0) {
    const value = _emptyResult(start, end);
    _cache.set(cacheKey, { ts: Date.now(), value });
    return value;
  }
  const members = await loadDeptMembers(subtreeIds);
  const memberEmails = members.map(m => m.email);

  // Fan out — current + previous period in parallel. Per-source failures
  // are swallowed inside each loader so one slow query can't stall the
  // whole report.
  const [
    curHrHub, curUrgent, curWork, curFeedback,
    prevHrHub, prevUrgent, prevWork, prevFeedback,
  ] = await Promise.all([
    loadHrHubResolved(subtreeIds, startIso, endIso),
    loadUrgentAssistResolved(subtreeIds, startIso, endIso),
    loadWorkTasksResolved(subtreeIds, startIso, endIso),
    loadFeedbackResolved(memberEmails, startIso, endIso),
    loadHrHubResolved(subtreeIds, prevStartIso, prevEndIso),
    loadUrgentAssistResolved(subtreeIds, prevStartIso, prevEndIso),
    loadWorkTasksResolved(subtreeIds, prevStartIso, prevEndIso),
    loadFeedbackResolved(memberEmails, prevStartIso, prevEndIso),
  ]);

  const sourcedRows = [
    ...curHrHub.map(r    => ({ ...r, category: 'hr_hub' })),
    ...curUrgent.map(r   => ({ ...r, category: 'urgent_assist' })),
    ...curWork.map(r     => ({ ...r, category: 'work_tasks' })),
    ...curFeedback.map(r => ({ ...r, category: 'feedback' })),
  ];
  const prevTotalsByCategory = emptyCategoryMap();
  for (const r of prevHrHub)    prevTotalsByCategory.hr_hub        += 1;
  for (const r of prevUrgent)   prevTotalsByCategory.urgent_assist += 1;
  for (const r of prevWork)     prevTotalsByCategory.work_tasks    += 1;
  for (const r of prevFeedback) prevTotalsByCategory.feedback      += 1;

  const findLead = buildLeadResolver(members);
  const memberByEmail = new Map(members.map(m => [m.email, m]));

  // ── byMember (leaderboard source of truth) ────────────────────────────
  // Bucket every row under the assignee's email; if the assignee isn't in
  // the dept (rare — feedback edge case post-move), they're dropped
  // rather than surfacing as a phantom contributor.
  const memberAgg = new Map(); // email -> { email, name, title, teamLeadEmail, total, byCategory }
  for (const r of sourcedRows) {
    const email = lcEmail(r.assigneeEmail);
    if (!email) continue;
    if (!memberByEmail.has(email)) continue;
    let entry = memberAgg.get(email);
    if (!entry) {
      const m = memberByEmail.get(email);
      const leadEmail = findLead(m.manager_email);
      const lead = memberByEmail.get(leadEmail);
      entry = {
        email,
        name: m.name,
        title: m.title,
        avatarUrl: m.avatar_url || null,
        teamLeadEmail: leadEmail,
        teamLeadName: lead?.name || (leadEmail ? leadEmail : 'Unassigned'),
        total: 0,
        byCategory: emptyCategoryMap(),
      };
      memberAgg.set(email, entry);
    }
    entry.total += 1;
    entry.byCategory[r.category] = (entry.byCategory[r.category] || 0) + 1;
  }
  const byMember = Array.from(memberAgg.values()).sort((a, b) => b.total - a.total);

  // ── byTeam ─────────────────────────────────────────────────────────────
  const teamAgg = new Map(); // leadEmail -> { teamLeadEmail, teamLeadName, ... }
  for (const m of byMember) {
    const k = m.teamLeadEmail || '';
    let entry = teamAgg.get(k);
    if (!entry) {
      const lead = memberByEmail.get(k);
      entry = {
        teamLeadEmail: k,
        teamLeadName: m.teamLeadName,
        teamLeadRole: lead?.access || 'unassigned',
        memberCount: 0,
        total: 0,
        byCategory: emptyCategoryMap(),
      };
      teamAgg.set(k, entry);
    }
    entry.memberCount += 1;
    entry.total += m.total;
    for (const ck of CATEGORY_KEYS) {
      entry.byCategory[ck] += m.byCategory[ck] || 0;
    }
  }
  const byTeam = Array.from(teamAgg.values()).sort((a, b) => b.total - a.total);

  // ── byCategory (totals + previous-period deltas) ───────────────────────
  const byCategory = CATEGORIES.map(cat => {
    let total = 0;
    for (const r of sourcedRows) if (r.category === cat.key) total += 1;
    const prev = prevTotalsByCategory[cat.key] || 0;
    const delta = prev > 0 ? ((total - prev) / prev) * 100 : (total > 0 ? 100 : 0);
    return {
      key: cat.key,
      label: cat.label,
      color: cat.color,
      bg: cat.bg,
      total,
      prevTotal: prev,
      deltaPercent: +delta.toFixed(1),
    };
  });

  // ── Trend (daily counts) ───────────────────────────────────────────────
  // Pre-fill every day in the range with zero so the FE can render a
  // continuous timeline without gap-filling.
  const trend = [];
  const cursor = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cursor.getTime() < endDate.getTime()) {
    trend.push({ date: dayKey(cursor), total: 0, byCategory: emptyCategoryMap() });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const trendByDay = new Map(trend.map(t => [t.date, t]));
  for (const r of sourcedRows) {
    const bucket = trendByDay.get(r.dayKey);
    if (!bucket) continue;
    bucket.total += 1;
    bucket.byCategory[r.category] = (bucket.byCategory[r.category] || 0) + 1;
  }

  // ── Summary KPIs ───────────────────────────────────────────────────────
  const totalResolved = sourcedRows.length;
  const prevTotalResolved =
    Object.values(prevTotalsByCategory).reduce((s, n) => s + n, 0);
  const deltaPercent = prevTotalResolved > 0
    ? ((totalResolved - prevTotalResolved) / prevTotalResolved) * 100
    : (totalResolved > 0 ? 100 : 0);

  const topCategory = byCategory.slice().sort((a, b) => b.total - a.total)[0] || null;
  const topTeam     = byTeam.length > 0 ? byTeam[0] : null;
  const topMember   = byMember.length > 0 ? byMember[0] : null;

  const summary = {
    totalResolved,
    prevPeriodTotal: prevTotalResolved,
    deltaPercent: +deltaPercent.toFixed(1),
    activeContributors: byMember.length,
    totalMembers: members.filter(m => m.access === 'agent').length,
    topCategory: topCategory ? { key: topCategory.key, label: topCategory.label, total: topCategory.total } : null,
    topTeam: topTeam ? { teamLeadEmail: topTeam.teamLeadEmail, teamLeadName: topTeam.teamLeadName, total: topTeam.total } : null,
    topMember: topMember ? { email: topMember.email, name: topMember.name, total: topMember.total } : null,
  };

  const value = {
    range: { start, end, prevStart: prevStartIso.slice(0, 10), prevEnd: prevEndIso.slice(0, 10) },
    summary,
    byTeam,
    byCategory,
    byMember,
    trend,
    cachedAt: new Date().toISOString(),
  };
  _cache.set(cacheKey, { ts: Date.now(), value });
  return value;
}

function _emptyResult(start, end) {
  return {
    range: { start, end, prevStart: null, prevEnd: null },
    summary: {
      totalResolved: 0,
      prevPeriodTotal: 0,
      deltaPercent: 0,
      activeContributors: 0,
      totalMembers: 0,
      topCategory: null,
      topTeam: null,
      topMember: null,
    },
    byTeam: [],
    byCategory: CATEGORIES.map(c => ({
      key: c.key, label: c.label, color: c.color, bg: c.bg,
      total: 0, prevTotal: 0, deltaPercent: 0,
    })),
    byMember: [],
    trend: [],
    cachedAt: null,
  };
}

export function clearProductivityCache(deptId) {
  if (!deptId) { _cache.clear(); return; }
  for (const key of _cache.keys()) {
    if (key.startsWith(`${deptId}:`)) _cache.delete(key);
  }
}
