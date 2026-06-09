// ── Performance cycle sync (Phase F, 2026-06-09) ────────────────────────────
// Monthly heartbeat for the Performance tab. Once per UTC day (soft-TTL gate)
// it:
//   1. Opens a perf_cycle for the current month for every dept that has a
//      role template (idempotent via the UNIQUE(org_node,month,year)).
//   2. Sends ONE bell notification per (kind, member, period):
//        • managers → "You have N performance reviews to complete for <Month>"
//          (when any DIRECT report lacks a finalized/acknowledged review).
//        • members  → "Add your reflection" (review awaiting member_input) or
//          "Acknowledge your review" (review finalized, not yet acknowledged).
// Idempotency keys on user_notifications(source_type='perf_cycle',
// source_id='<kind>|<email>|<YYYY-MM>') so nobody is nudged twice for the same
// month. Multi-pod safe via the app_settings soft-TTL gate — the first pod to
// claim the day wins; the rest no-op. Never throws into the scheduler.
import { query } from './db';
import { ensureRosterHydrated } from './roster-server';
import { MEMBERS_BY_EMAIL, ALL_EMAILS, getDirectReports } from '../data/members';
import { MONTH_LABELS } from './performance-constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const GATE_MS = 20 * 60 * 60 * 1000; // ~daily; tolerant of pod restarts

function periodKey(month, year) { return `${year}-${String(month).padStart(2, '0')}`; }

// Insert a notification only if one with the same (source_type, source_id)
// doesn't already exist. Returns 1 if inserted, 0 otherwise.
async function maybeNotify({ email, kind, period, title, body, linkId }) {
  const sourceId = `${kind}|${email}|${period}`;
  try {
    const { rows } = await query(
      `SELECT 1 FROM user_notifications WHERE source_type = 'perf_cycle' AND source_id = $1 LIMIT 1`,
      [sourceId]);
    if (rows.length) return 0;
    await query(
      `INSERT INTO user_notifications
         (recipient_email, type, title, body, link_view, link_id, source_type, source_id, actor_email, actor_name)
       VALUES ($1, 'performance', $2, $3, 'performance', $4, 'perf_cycle', $5, NULL, 'Performance')`,
      [email, title, body || '', linkId || period, sourceId]);
    return 1;
  } catch (err) {
    console.warn('[perf-cycle] notify failed:', err?.message);
    return 0;
  }
}

export async function runPerformanceCycleSync({ force = false } = {}) {
  // ── Soft-TTL gate (multi-pod safe; ~once per day) ──
  if (!force) {
    try {
      const { rows } = await query(`SELECT value FROM app_settings WHERE key = 'perf_cycle_sync_last' LIMIT 1`);
      const ts = rows[0]?.value?.ts ? Date.parse(rows[0].value.ts) : 0;
      if (ts && (Date.now() - ts) < GATE_MS) return { skipped: 'recent', lastRun: rows[0].value.ts };
    } catch { /* app_settings not ready — proceed */ }
  }

  await ensureRosterHydrated();
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const period = periodKey(month, year);
  const monthLabel = `${MONTH_LABELS[month - 1] || ''} ${year}`.trim();

  // 1) Open cycles for every dept that adopted a template.
  let cyclesOpened = 0;
  try {
    const { rows: depts } = await query(
      `SELECT DISTINCT org_node_id FROM perf_templates WHERE org_node_id IS NOT NULL AND is_archived = false`);
    for (const d of depts) {
      const r = await query(
        `INSERT INTO perf_cycles (org_node_id, period_month, period_year)
         VALUES ($1, $2, $3) ON CONFLICT (org_node_id, period_month, period_year) DO NOTHING RETURNING id`,
        [d.org_node_id, month, year]);
      if (r.rows[0]) cyclesOpened += 1;
    }
  } catch (err) { console.warn('[perf-cycle] cycle open failed:', err?.message); }

  // 2) Load this period's reviews → status by member email.
  const statusByEmail = new Map();
  try {
    const { rows } = await query(
      `SELECT LOWER(member_email) AS email, status FROM perf_reviews WHERE period_month = $1 AND period_year = $2`,
      [month, year]);
    for (const r of rows) statusByEmail.set(r.email, r.status);
  } catch (err) { console.warn('[perf-cycle] review load failed:', err?.message); }

  let managerNudges = 0, memberNudges = 0;
  const emails = Array.isArray(ALL_EMAILS) ? ALL_EMAILS : [];
  for (const raw of emails) {
    const email = String(raw || '').toLowerCase();
    if (!email) continue;

    // Manager nudge — any direct report without a finalized/acknowledged review.
    let reports = [];
    try { reports = getDirectReports(email).map(r => (r.email || '').toLowerCase()).filter(Boolean); } catch { reports = []; }
    if (reports.length) {
      const pending = reports.filter(r => {
        const s = statusByEmail.get(r);
        return s !== 'finalized' && s !== 'acknowledged';
      }).length;
      if (pending > 0) {
        managerNudges += await maybeNotify({
          email, kind: 'manager_due', period,
          title: `${pending} performance review${pending === 1 ? '' : 's'} to complete`,
          body: `Your team's ${monthLabel} reviews are open. ${pending} still need${pending === 1 ? 's' : ''} your evaluation.`,
        });
      }
    }

    // Member nudge — their own review needs input or acknowledgment.
    const ms = statusByEmail.get(email);
    if (ms === 'member_input') {
      memberNudges += await maybeNotify({
        email, kind: 'member_input', period,
        title: `Your ${monthLabel} check-in is open`,
        body: 'Add your monthly reflection so your manager can complete your review.',
      });
    } else if (ms === 'finalized') {
      memberNudges += await maybeNotify({
        email, kind: 'member_ack', period,
        title: `Your ${monthLabel} review is ready`,
        body: 'Your manager finalized your performance review — open it to read and acknowledge.',
      });
    }
  }

  // Record last-run stamp.
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('perf_cycle_sync_last', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ ts: now.toISOString(), period, cyclesOpened, managerNudges, memberNudges })]);
  } catch (err) { console.warn('[perf-cycle] stamp failed:', err?.message); }

  const result = { period, cyclesOpened, managerNudges, memberNudges };
  console.log('[perf-cycle] sync done:', JSON.stringify(result));
  return result;
}
