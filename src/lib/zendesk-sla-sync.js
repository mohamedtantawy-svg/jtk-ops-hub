// ── Zendesk SLA background sync ──────────────────────────────────────────
// Pulls Zendesk's per-ticket policy_metrics (the actual FRT / NRT breach
// times the policy engine computes — factoring in business hours, paused
// time, on-hold time, and the SLA policy attached to each ticket) and
// caches them in `zendesk_ticket_sla`. The queue route does a single SELECT
// against this table to merge real breach_at values into the per-row
// pills, replacing the local "anchor + 24h default" that produced the
// "-3mo / -6w / -4w" overflows on tickets that had legitimately reset
// their SLA via agent activity but whose anchor we couldn't see.
//
// Why a background sync (vs inline in the queue route):
//   • PR #477 fetched policy_metrics inline via Promise.all → 21 batches
//     of 1-5 MB held in V8 simultaneously → OOM at 2 GB heap.
//   • Inline cost also added 30s+ to the queue's response time, which the
//     FE polls every 30s — visible UX regression.
// This sync runs sequentially (one show_many batch in memory at a time)
// and well off the queue's hot path. The queue's only added cost is a
// single SELECT keyed on ticket_id.

import { query } from './db';
import { searchTickets, iterateTicketsWithSlas, isZendeskConfigured } from './zendesk-api';

const ZD_GROUP_NAME = process.env.ZENDESK_HR_GROUP || 'HR Experience';

// Multi-pod coordination — one sync at a time across the cluster. Lock
// acquired via INSERT ... ON CONFLICT DO UPDATE WHERE …; if another pod
// holds the lock and it's not stale, we no-op. Stale = older than
// LOCK_STALE_AFTER_MS (handles a crashed pod that never released).
const LOCK_KEY            = 'zendesk_sla_sync_lock';
const LAST_RUN_KEY        = 'zendesk_sla_sync_last_run';
const LOCK_STALE_AFTER_MS = 15 * 60 * 1000;        // 15 min — well above any normal sync runtime
const SEARCH_PAGE_SIZE    = 100;                    // ZD search cap
const SEARCH_MAX_PAGES    = 10;                     // 1k tickets per status — same as queue route
const SHOW_MANY_CHUNK     = 100;                    // ZD show_many cap
const ACTIVE_STATUSES     = ['new', 'open', 'pending', 'hold'];
// Soft TTL to skip work when a recent sync is already on disk. The cron
// trigger AND the in-process scheduler both honour this so a manual hit
// during a healthy cycle doesn't pile on. Set lower than the scheduler
// interval (10 min) so the scheduler always wins; manual hits earlier
// just no-op cleanly.
const MIN_RESYNC_GAP_MS   = 5 * 60 * 1000;

// Acquire the lock. Returns true if we got it, false if another pod has
// a fresh one. Implemented via app_settings — one row per lock key. The
// lock value carries the holder pod's "id" (just a random + pid combo)
// and the acquired_at ISO; both pods then read them to settle ties.
async function acquireLock(holderId) {
  const now = new Date();
  // Upsert: if no row, insert; if row exists and is stale, take it; if
  // row exists and is fresh, do nothing. Returns 1 if we now hold it.
  const { rows } = await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()
       WHERE (app_settings.value->>'acquired_at')::timestamptz < NOW() - ($3 || ' milliseconds')::interval
          OR app_settings.value->>'holder' IS NULL
     RETURNING value->>'holder' AS holder`,
    [LOCK_KEY, JSON.stringify({ holder: holderId, acquired_at: now.toISOString() }), String(LOCK_STALE_AFTER_MS)],
  );
  return rows.length > 0 && rows[0].holder === holderId;
}

async function releaseLock(holderId) {
  // Only release if we still own it (don't stomp another pod that took
  // over after we went stale).
  await query(
    `DELETE FROM app_settings
       WHERE key = $1 AND value->>'holder' = $2`,
    [LOCK_KEY, holderId],
  );
}

async function getLastRunMs() {
  try {
    const { rows } = await query(
      `SELECT value->>'at' AS at FROM app_settings WHERE key = $1`,
      [LAST_RUN_KEY],
    );
    const at = rows[0]?.at;
    if (!at) return 0;
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? ms : 0;
  } catch { return 0; }
}

async function setLastRun(summary) {
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [LAST_RUN_KEY, JSON.stringify({ at: new Date().toISOString(), ...summary })],
    );
  } catch (err) {
    console.warn('[zd-sla-sync] failed to record last_run:', err?.message);
  }
}

// ── policy_metrics → per-ticket SLA row ────────────────────────────────
// Zendesk attaches `slas.policy_metrics` to each ticket when we sideload
// `slas`. Shape (per Zendesk docs):
//   metric:  'reply_time' | 'next_reply_time' | 'agent_work_time'
//            | 'requester_wait_time' | 'periodic_update_time' |
//              'pausable_update_time'
//   stage:   'activated' | 'paused' | 'breached' | 'fulfilled'
//   breach_at: ISO timestamp (when SLA will be / was breached)
//   minutes:  target window in minutes
//   business_hours: bool — if true, breach_at honours business calendar
// We map ZD's reply_time → FRT and next_reply_time → NRT. The "active"
// stage is whichever entry is currently 'activated' (clock running). If
// neither is active, the assignee has caught up — pill renders OK.
function extractSlaForTicket(t) {
  const pm = Array.isArray(t?.slas?.policy_metrics) ? t.slas.policy_metrics : [];
  let frt = null;
  let nrt = null;
  let active_stage = null;
  let active_breach_at = null;
  for (const m of pm) {
    if (!m || typeof m !== 'object') continue;
    if (m.metric === 'reply_time') {
      frt = m;
      if (m.stage === 'activated') {
        active_stage = 'frt';
        active_breach_at = m.breach_at || null;
      }
    } else if (m.metric === 'next_reply_time') {
      nrt = m;
      if (m.stage === 'activated' && !active_stage) {
        active_stage = 'nrt';
        active_breach_at = m.breach_at || null;
      }
    }
  }
  // policy_id may be a number or string depending on tenant; coerce safely.
  const policyId = Number.isFinite(t?.sla_policy_id) ? t.sla_policy_id
                 : (frt?.policy?.id ?? nrt?.policy?.id ?? null);
  return {
    ticket_id:        Number(t?.id),
    active_stage,
    active_breach_at,
    frt_breach_at:    frt?.breach_at || null,
    frt_minutes:      Number.isFinite(frt?.minutes) ? frt.minutes : null,
    nrt_breach_at:    nrt?.breach_at || null,
    nrt_minutes:      Number.isFinite(nrt?.minutes) ? nrt.minutes : null,
    policy_id:        Number.isFinite(policyId) ? policyId : null,
  };
}

// Bulk UPSERT a batch of SLA rows. Single round-trip per batch.
async function upsertSlaBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  // Build a single VALUES (...) (...) ... insert with $N positional params.
  // Caller chunks at SHOW_MANY_CHUNK (100), well below the ~65k positional
  // param limit (8 cols × 100 rows = 800 params).
  const values = [];
  const params = [];
  let p = 1;
  for (const r of rows) {
    if (!Number.isFinite(r.ticket_id)) continue;
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, NOW(), NOW())`);
    params.push(
      r.ticket_id,
      r.active_stage,
      r.active_breach_at,
      r.frt_breach_at,
      r.frt_minutes,
      r.nrt_breach_at,
      r.nrt_minutes,
      r.policy_id,
    );
  }
  if (values.length === 0) return 0;
  const sql = `
    INSERT INTO zendesk_ticket_sla
      (ticket_id, active_stage, active_breach_at, frt_breach_at, frt_minutes,
       nrt_breach_at, nrt_minutes, policy_id, fetched_at, updated_at)
    VALUES ${values.join(', ')}
    ON CONFLICT (ticket_id) DO UPDATE SET
      active_stage     = EXCLUDED.active_stage,
      active_breach_at = EXCLUDED.active_breach_at,
      frt_breach_at    = EXCLUDED.frt_breach_at,
      frt_minutes      = EXCLUDED.frt_minutes,
      nrt_breach_at    = EXCLUDED.nrt_breach_at,
      nrt_minutes      = EXCLUDED.nrt_minutes,
      policy_id        = EXCLUDED.policy_id,
      fetched_at       = NOW(),
      updated_at       = NOW()
  `;
  const res = await query(sql, params);
  return res?.rowCount || 0;
}

// Enumerate the set of currently-actionable Zendesk ticket IDs by mirror-
// querying the same `group:X status:<state>` searches the queue route uses.
// We only retain `id` from each result so the enumeration step stays
// memory-cheap regardless of ticket count.
async function listActiveTicketIds() {
  const seen = new Set();
  for (const status of ACTIVE_STATUSES) {
    const q = `group:"${ZD_GROUP_NAME}" status:${status}`;
    let page = 1;
    while (page <= SEARCH_MAX_PAGES) {
      let res;
      try {
        res = await searchTickets(q, {
          per_page: SEARCH_PAGE_SIZE,
          page,
          sort_by: 'updated_at',
          sort_order: 'desc',
        });
      } catch (err) {
        console.warn(`[zd-sla-sync] search failed (status=${status}, page=${page}):`, err?.message);
        break;
      }
      const results = Array.isArray(res?.results) ? res.results : [];
      for (const t of results) if (t?.id != null) seen.add(Number(t.id));
      if (results.length < SEARCH_PAGE_SIZE || !res?.next_page) break;
      page++;
    }
  }
  return Array.from(seen);
}

// Public entry point. Returns a summary { ran, reason?, durationMs?,
// ticketsSeen?, batches?, upserted?, errors? }. Never throws — always
// returns a structured result so callers (cron route + scheduler) can log.
export async function runZendeskSlaSync({ force = false } = {}) {
  if (!isZendeskConfigured()) {
    return { ran: false, reason: 'zendesk_not_configured' };
  }
  if (!process.env.DATABASE_URL) {
    return { ran: false, reason: 'database_not_configured' };
  }

  if (!force) {
    const lastRunMs = await getLastRunMs();
    if (lastRunMs && (Date.now() - lastRunMs) < MIN_RESYNC_GAP_MS) {
      return { ran: false, reason: 'recent_sync', skippedAt: new Date(lastRunMs).toISOString() };
    }
  }

  const holderId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const got = await acquireLock(holderId).catch(err => {
    console.warn('[zd-sla-sync] acquireLock error:', err?.message);
    return false;
  });
  if (!got) return { ran: false, reason: 'lock_held' };

  const startedAt = Date.now();
  let ticketsSeen = 0;
  let batches = 0;
  let upserted = 0;
  let errors = 0;
  try {
    const ids = await listActiveTicketIds();
    ticketsSeen = ids.length;
    if (ids.length === 0) {
      await setLastRun({ ticketsSeen: 0, batches: 0, upserted: 0, durationMs: Date.now() - startedAt });
      return { ran: true, ticketsSeen: 0, batches: 0, upserted: 0, durationMs: Date.now() - startedAt };
    }
    for await (const { tickets } of iterateTicketsWithSlas(ids, { chunkSize: SHOW_MANY_CHUNK })) {
      batches++;
      const rows = [];
      for (const t of tickets) rows.push(extractSlaForTicket(t));
      try {
        upserted += await upsertSlaBatch(rows);
      } catch (err) {
        errors++;
        console.warn(`[zd-sla-sync] upsert batch ${batches} failed:`, err?.message);
      }
    }
  } catch (err) {
    errors++;
    console.error('[zd-sla-sync] sync error:', err?.message);
  } finally {
    await releaseLock(holderId).catch(err => {
      console.warn('[zd-sla-sync] releaseLock error:', err?.message);
    });
  }

  const durationMs = Date.now() - startedAt;
  const summary = { ticketsSeen, batches, upserted, errors, durationMs };
  await setLastRun(summary);
  console.log(`[zd-sla-sync] done: ${upserted} rows in ${durationMs}ms across ${batches} batch(es), ${errors} error(s)`);
  return { ran: true, ...summary };
}

// Read helper used by the queue route to merge SLA rows in one round-trip.
// Returns a Map<ticket_id_number, row>. Returns an empty Map if the table
// is missing (brand-new env, migration hasn't run yet) or DB is unreachable
// — the queue route then falls back to its existing local FRT/NRT logic
// rather than 500ing the whole queue.
export async function loadSlaRowsForTicketIds(ticketIds) {
  const out = new Map();
  if (!Array.isArray(ticketIds) || ticketIds.length === 0) return out;
  if (!process.env.DATABASE_URL) return out;
  const ids = ticketIds.map(n => Number(n)).filter(n => Number.isFinite(n));
  if (ids.length === 0) return out;
  try {
    const { rows } = await query(
      `SELECT ticket_id, active_stage, active_breach_at,
              frt_breach_at, frt_minutes,
              nrt_breach_at, nrt_minutes,
              policy_id, fetched_at
         FROM zendesk_ticket_sla
        WHERE ticket_id = ANY($1::bigint[])`,
      [ids],
    );
    for (const r of rows) {
      out.set(Number(r.ticket_id), {
        activeStage:    r.active_stage || null,
        activeBreachAt: r.active_breach_at ? new Date(r.active_breach_at).toISOString() : null,
        frtBreachAt:    r.frt_breach_at ? new Date(r.frt_breach_at).toISOString() : null,
        frtMinutes:     Number.isFinite(r.frt_minutes) ? r.frt_minutes : null,
        nrtBreachAt:    r.nrt_breach_at ? new Date(r.nrt_breach_at).toISOString() : null,
        nrtMinutes:     Number.isFinite(r.nrt_minutes) ? r.nrt_minutes : null,
        policyId:       r.policy_id != null ? Number(r.policy_id) : null,
        fetchedAt:      r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
      });
    }
  } catch (err) {
    console.warn('[zd-sla-sync] loadSlaRowsForTicketIds failed (queue falls back to local SLA logic):', err?.message);
  }
  return out;
}
