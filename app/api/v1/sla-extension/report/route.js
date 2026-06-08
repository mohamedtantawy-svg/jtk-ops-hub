// ── GET /api/v1/sla-extension/report ───────────────────────────────────
// Analytics for the SLA Extension workflow, scoped to the caller's dept
// (Phase 11 multi-tenant) + role gate (TL or higher — agents don't get
// to see team analytics). Built for Leaders Hub → Reports → SLA Extension.
//
// Origin: Jose Ruales feedback (Improvement / Managers only) 2026-05-30,
// asking for a report covering:
//   • How often 7 days is requested?
//   • Which days option is most often requested?
//   • Which agents request most/least?
//   • How often is the note left empty?
//   • Which category is most often requested to extend?
//   • Number denied?
//   • Accepted-but-days-changed vs submitted?
//
// Data source: `hr_hub_request` rows where `flow = 'sla_extension_request'`.
// Status semantics mirror the rest of HR Hub:
//   • 'resolved'         → manager approved (sla_ext_approved_days set)
//   • 'rejected'         → manager denied
//   • new/in_progress/on_hold/pending_requester → still under review
//
// "Modified" decision = resolved AND approved_days IS NOT NULL AND
// approved_days != requested_days.
//
// Query params:
//   from        — ISO date (YYYY-MM-DD) inclusive. Default: now − 30d.
//   to          — ISO date inclusive. Default: today.
//   (range is interpreted UTC; created_at >= from AND created_at < (to + 1 day)
//   so a single-day range like from=2026-06-01&to=2026-06-01 covers the
//   full UTC day).

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getEffectiveDeptIdsForUser } from '../../../../../src/lib/dept-scope';

const REASON_LABELS = {
  immigration: 'Immigration',
  client_unresponsive: 'Client unresponsive',
  employee_unresponsive: 'Employee unresponsive',
  long_process: 'Long process',
};

const SOURCE_LABELS = {
  zendesk: 'Zendesk',
  jira: 'Jira',
  workbench: 'Workbench',
  onboarding: 'Onboarding',
  offboarding: 'Offboarding',
  amendments: 'Amendments',
  redlines: 'Redlines',
  incentive_plans: 'Incentive Plans',
};

const PENDING_STATUSES = new Set(['new', 'in_progress', 'on_hold', 'pending_requester']);

// Manager+ gate. Mirrors the dataScope tiers used elsewhere — agents get
// 'own_tasks_only' and never see analytics; TLs/RMs/Admins get team-wide
// visibility within their dept.
function isManagerOrHigher(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'team_lead' || role === 'regional_manager' || role === 'admin';
}

// Parse a YYYY-MM-DD string into a Date at UTC midnight. Returns null on
// invalid input so the caller can fall back to defaults.
function parseDay(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isFinite(d.getTime()) ? d : null;
}

function isoDay(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isManagerOrHigher(user)) {
    return NextResponse.json({ error: 'Forbidden — manager access required' }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  // Default window: last 30 days inclusive.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29); // 30 days inclusive

  let from = parseDay(fromParam) || defaultFrom;
  let to = parseDay(toParam) || today;
  if (to < from) {
    // Swap rather than error — operator UX over strict validation.
    const tmp = from;
    from = to;
    to = tmp;
  }
  // Inclusive upper bound: walk to start-of-next-day.
  const toExclusive = new Date(to);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  // Dept scope — mirrors hr-hub/requests/route.js. Empty array → fail
  // closed to zero rows (caller has no org placement).
  const effectiveDeptIds = await getEffectiveDeptIdsForUser(user, req);
  if (effectiveDeptIds.length === 0) {
    return NextResponse.json({
      rangeStart: isoDay(from), rangeEnd: isoDay(to),
      totals: { submitted: 0, approved: 0, approvedSameDays: 0, approvedModifiedDays: 0, rejected: 0, pending: 0 },
      byRequestedDays: [],
      byApprovedDays: [],
      byReason: [],
      bySource: [],
      byAgent: [],
      noteStats: { total: 0, withNote: 0, emptyNote: 0 },
      modifiedDecisions: [],
    });
  }

  const WHERE = `
    WHERE flow = 'sla_extension_request'
      AND org_node_id = ANY($1::uuid[])
      AND created_at >= $2
      AND created_at <  $3
  `;
  const params = [effectiveDeptIds, from.toISOString(), toExclusive.toISOString()];

  try {
    // One pull, one query — postgres can fan into separate aggregations
    // cheaply. Bumping to multiple round-trips would also be fine, but a
    // single SELECT keeps the route deterministic and avoids race-ish
    // skew between aggregates.
    const { rows } = await query(
      `SELECT id, status, created_at,
              created_by_email, created_by_name,
              summary, task_source, task_subject, task_url,
              sla_ext_requested_days, sla_ext_approved_days, sla_ext_reason_code
         FROM hr_hub_request
         ${WHERE}
        ORDER BY created_at DESC
        LIMIT 5000`,
      params,
    );

    // ── Aggregations ───────────────────────────────────────────────────
    let submitted = 0;
    let approved = 0;
    let approvedSameDays = 0;
    let approvedModifiedDays = 0;
    let rejected = 0;
    let pending = 0;
    let withNote = 0;
    let emptyNote = 0;

    const byRequestedDays = new Map();   // days → count
    const byApprovedDays = new Map();    // days → count
    const byReason = new Map();          // code → count
    const bySource = new Map();          // source → count
    const byAgent = new Map();           // email → { name, submitted, approved, rejected, pending }
    const modifiedDecisions = [];

    for (const r of rows) {
      submitted++;

      // Note compliance — note is the `summary` column. The 2026-05-28
      // mandatory-note rule (PR #868) enforces ≥20 chars on new
      // submissions; historical rows can still be empty so we measure
      // both buckets explicitly.
      const noteLen = r.summary == null ? 0 : String(r.summary).trim().length;
      if (noteLen > 0) withNote++;
      else emptyNote++;

      // Requested days
      const reqDays = Number(r.sla_ext_requested_days);
      const reqDaysValid = Number.isInteger(reqDays) && reqDays >= 1 && reqDays <= 7;
      if (reqDaysValid) {
        byRequestedDays.set(reqDays, (byRequestedDays.get(reqDays) || 0) + 1);
      }

      // Reason
      const reason = r.sla_ext_reason_code;
      if (reason) byReason.set(reason, (byReason.get(reason) || 0) + 1);

      // Source / category
      const src = r.task_source;
      if (src) bySource.set(src, (bySource.get(src) || 0) + 1);

      // Per-agent rollup
      const email = (r.created_by_email || '').toLowerCase();
      if (email) {
        let entry = byAgent.get(email);
        if (!entry) {
          entry = {
            email,
            name: r.created_by_name || email,
            submitted: 0, approved: 0, rejected: 0, pending: 0,
            // Per-agent requested-days behaviour (Jose Ruales 2026-06-05):
            // surfaces who leans on the 7-day max vs the 1-day minimum.
            daysSum: 0, daysCount: 0, maxDaysCount: 0, minDaysCount: 0,
          };
          byAgent.set(email, entry);
        } else if (!entry.name && r.created_by_name) {
          entry.name = r.created_by_name;
        }
        entry.submitted++;
        if (reqDaysValid) {
          entry.daysSum += reqDays;
          entry.daysCount++;
          if (reqDays === 7) entry.maxDaysCount++;
          else if (reqDays === 1) entry.minDaysCount++;
        }
      }

      // Decision buckets
      const status = String(r.status || '').toLowerCase();
      const approvedDays = Number(r.sla_ext_approved_days);
      const hasApprovedDays = Number.isInteger(approvedDays) && approvedDays >= 1 && approvedDays <= 7;

      if (status === 'resolved') {
        approved++;
        if (hasApprovedDays) {
          byApprovedDays.set(approvedDays, (byApprovedDays.get(approvedDays) || 0) + 1);
          if (Number.isInteger(reqDays) && reqDays !== approvedDays) {
            approvedModifiedDays++;
            // Surface for the operator: who, what, requested → approved
            if (modifiedDecisions.length < 50) {
              modifiedDecisions.push({
                id: r.id,
                createdAt: r.created_at,
                agentEmail: email,
                agentName: r.created_by_name || email,
                source: src || null,
                sourceLabel: src ? (SOURCE_LABELS[src] || src) : null,
                subject: r.task_subject || null,
                taskUrl: r.task_url || null,
                requestedDays: reqDays || null,
                approvedDays,
              });
            }
          } else {
            approvedSameDays++;
          }
        } else {
          // Resolved without approved_days — counted as approved (status
          // is the source of truth) but doesn't contribute to the
          // same/modified split.
          approvedSameDays++;
        }
        if (email) byAgent.get(email).approved++;
      } else if (status === 'rejected') {
        rejected++;
        if (email) byAgent.get(email).rejected++;
      } else if (PENDING_STATUSES.has(status)) {
        pending++;
        if (email) byAgent.get(email).pending++;
      }
    }

    // ── Reshape for FE consumption ────────────────────────────────────
    // Days distribution always covers 1..7 even when a value has 0 — the
    // chart needs a stable axis. Total is `submitted` so percentages
    // reconcile with the KPI tile.
    const byRequestedDaysArr = [];
    for (let d = 1; d <= 7; d++) {
      const n = byRequestedDays.get(d) || 0;
      byRequestedDaysArr.push({
        days: d,
        n,
        pct: submitted > 0 ? Math.round((n / submitted) * 1000) / 10 : 0,
      });
    }
    const byApprovedDaysArr = [];
    for (let d = 1; d <= 7; d++) {
      const n = byApprovedDays.get(d) || 0;
      byApprovedDaysArr.push({ days: d, n });
    }

    const byReasonArr = [...byReason.entries()]
      .map(([code, n]) => ({ code, label: REASON_LABELS[code] || code, n }))
      .sort((a, b) => b.n - a.n);

    const bySourceArr = [...bySource.entries()]
      .map(([source, n]) => ({ source, label: SOURCE_LABELS[source] || source, n }))
      .sort((a, b) => b.n - a.n);

    // Enrich each agent with requested-days behaviour and strip the raw
    // accumulators. avgRequestedDays + maxDaysPct answer Jose Ruales' ask:
    // who disproportionately requests the 7-day max vs the 1-day minimum
    // (coaching signal). Sorted by volume; the FE colour-codes the outliers.
    const byAgentArr = [...byAgent.values()]
      .map(a => ({
        email: a.email,
        name: a.name,
        submitted: a.submitted,
        approved: a.approved,
        rejected: a.rejected,
        pending: a.pending,
        avgRequestedDays: a.daysCount > 0 ? Math.round((a.daysSum / a.daysCount) * 10) / 10 : null,
        maxDaysCount: a.maxDaysCount,
        maxDaysPct: a.daysCount > 0 ? Math.round((a.maxDaysCount / a.daysCount) * 100) : 0,
        minDaysCount: a.minDaysCount,
        minDaysPct: a.daysCount > 0 ? Math.round((a.minDaysCount / a.daysCount) * 100) : 0,
      }))
      .sort((a, b) => b.submitted - a.submitted);

    return NextResponse.json({
      rangeStart: isoDay(from),
      rangeEnd: isoDay(to),
      totals: {
        submitted,
        approved,
        approvedSameDays,
        approvedModifiedDays,
        rejected,
        pending,
      },
      byRequestedDays: byRequestedDaysArr,
      byApprovedDays: byApprovedDaysArr,
      byReason: byReasonArr,
      bySource: bySourceArr,
      byAgent: byAgentArr,
      noteStats: {
        total: submitted,
        withNote,
        emptyNote,
        emptyPct: submitted > 0 ? Math.round((emptyNote / submitted) * 1000) / 10 : 0,
      },
      modifiedDecisions,
    });
  } catch (err) {
    console.error('[sla-extension/report]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
