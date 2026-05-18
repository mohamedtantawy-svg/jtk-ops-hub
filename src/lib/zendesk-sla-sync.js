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
// Why the dedicated per-ticket endpoint (not show_many?include=slas):
//   • Per-ticket payload is ~600 bytes vs 1-5 MB for show_many, so the
//     OOM that killed PR #477 (21 batches × 1-5 MB held in V8 via
//     Promise.all → 2 GB heap) cannot recur regardless of concurrency.
//   • Trade-off is one HTTP call per ticket; sequential pacing keeps us
//     comfortably under Zendesk's 700 req/min Enterprise limit (~7 req/s
//     observed → 420/min). ~2 k tickets sync in ~5 min, fits the 10-min
//     cron window.
// The queue's only added cost is a single SELECT keyed on ticket_id; the
// sync runs entirely off its hot path.

import { query } from './db';
import { searchTickets, fetchTicketSlaPolicyMetrics, isZendeskConfigured } from './zendesk-api';

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
const ACTIVE_STATUSES     = ['new', 'open', 'pending', 'hold'];
// Sequential pacing for the per-ticket SLA fetch. Zendesk Enterprise's
// rate limit is 700 req/min; the dedicated endpoint runs ~70 ms upstream
// + network → ~150 ms wall clock per call → naturally caps at ~7 req/s
// = 420 req/min. That's fine when the sync runs alone, but the queue
// route ALSO calls Zendesk on every agent's queue refresh — and the
// 2026-05-08 logs show the combined traffic regularly tripped the 700/min
// limit, losing 164/1585 tickets per sync run to 429s. Adding 80 ms of
// artificial delay drops the sync's contribution to ~4 req/s = ~240
// req/min, leaving ~460 req/min headroom for queue + reply + user-search
// callers. Sync wall time goes from ~3.5 min to ~5 min on 1.6k tickets,
// still well inside the 10-min cron window. (The Retry-After-aware
// retry in src/lib/retry.js mops up any 429s that still slip through.)
const PER_TICKET_DELAY_MS = 80;
// How often the cache UPSERT batches flush to the DB. Keeps the SQL
// round-trips bounded without holding all rows in memory first.
const UPSERT_BATCH_SIZE   = 50;
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
// Verified live response (ticket 5871989, 2026-05-07):
//   {
//     "policy_metrics": [
//       { "breach_at": "2026-05-08T14:29:34Z", "stage": "active",
//         "metric": "next_reply_time",     "hours": 21 },
//       { "breach_at": "2025-12-18T03:07:32Z", "stage": "achieved",
//         "metric": "first_reply_time",    "days": -141 },
//       { "breach_at": "2026-05-14T09:03:29Z", "stage": "active",
//         "metric": "periodic_update_time", "days": 7 },
//       ...
//     ]
//   }
//
// Stages we observe:
//   • "active"   — clock currently running; breach_at is the deadline
//   • "achieved" — SLA met within target; clock no longer running
//   • "paused"   — ticket on-hold/pending; clock paused (not surfaced
//                  here — the queue's paused-window logic owns this)
//   • "breached" — past breach_at and still uncompleted (rare in
//                  practice; Zendesk usually keeps "active" past breach
//                  with breach_at in the past, which the FE pill renders
//                  as breached anyway)
//
// Metrics: only first_reply_time + next_reply_time are user-facing in
// our pills. periodic_update_time / requester_wait_time / agent_work_time
// are tracked but not surfaced.
//
// Duration: the per-metric `hours` or `days` field is a HUMAN-readable
// summary of the policy target — convert to minutes for our cache so
// slaInfo's at-risk-band math has a consistent unit. When a row carries
// neither field (rare), we fall back to a 0 minutes record and slaInfo
// uses the default 6h at-risk window.
function _toMinutes(m) {
  if (Number.isFinite(m?.minutes)) return Math.round(m.minutes);
  if (Number.isFinite(m?.hours))   return Math.round(m.hours * 60);
  if (Number.isFinite(m?.days))    return Math.round(m.days * 24 * 60);
  return null;
}

function extractSlaFromPolicyMetricsResponse(ticketId, response) {
  const pm = Array.isArray(response?.policy_metrics) ? response.policy_metrics : [];
  let frt = null;
  let nrt = null;
  let active_stage = null;
  let active_breach_at = null;
  for (const m of pm) {
    if (!m || typeof m !== 'object') continue;
    if (m.metric === 'first_reply_time') {
      frt = m;
      if (m.stage === 'active' && !active_stage) {
        active_stage = 'frt';
        active_breach_at = m.breach_at || null;
      }
    } else if (m.metric === 'next_reply_time') {
      nrt = m;
      // FRT takes precedence over NRT — once first reply is done, NRT
      // takes over and FRT is "achieved", so they shouldn't both be
      // active. The `!active_stage` guard handles the rare overlap
      // gracefully.
      if (m.stage === 'active' && !active_stage) {
        active_stage = 'nrt';
        active_breach_at = m.breach_at || null;
      }
    }
  }
  return {
    ticket_id:        Number(ticketId),
    active_stage,
    active_breach_at,
    frt_breach_at:    frt?.breach_at || null,
    frt_minutes:      frt ? _toMinutes(frt) : null,
    nrt_breach_at:    nrt?.breach_at || null,
    nrt_minutes:      nrt ? _toMinutes(nrt) : null,
    // Per-ticket endpoint doesn't return policy_id. Leave null; the
    // schema column is nullable and no consumer reads it yet.
    policy_id:        null,
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
  let fetched = 0;
  let upserted = 0;
  let errors = 0;
  let notFound = 0;
  try {
    const ids = await listActiveTicketIds();
    ticketsSeen = ids.length;
    if (ids.length === 0) {
      await setLastRun({ ticketsSeen: 0, fetched: 0, upserted: 0, durationMs: Date.now() - startedAt });
      return { ran: true, ticketsSeen: 0, fetched: 0, upserted: 0, durationMs: Date.now() - startedAt };
    }

    // Sequential per-ticket fetch + buffered UPSERT every UPSERT_BATCH_SIZE
    // rows. Memory peak: one ~600 byte response + UPSERT_BATCH_SIZE rows
    // (≈8 fields × 50 rows ≈ a few KB). Constant regardless of total
    // ticket count.
    let buffer = [];
    const flushBuffer = async () => {
      if (buffer.length === 0) return;
      try {
        upserted += await upsertSlaBatch(buffer);
      } catch (err) {
        errors++;
        console.warn(`[zd-sla-sync] upsert flush of ${buffer.length} rows failed:`, err?.message);
      }
      buffer = [];
    };

    for (const id of ids) {
      let res = null;
      try {
        res = await fetchTicketSlaPolicyMetrics(id);
        fetched++;
      } catch (err) {
        errors++;
        // Soft-fail per ticket — a Zendesk hiccup on one ticket should
        // not abort the whole sync. The previous cached row stays valid
        // (we only overwrite on successful UPSERT).
        console.warn(`[zd-sla-sync] fetch ticket ${id} failed:`, err?.message);
        continue;
      }
      if (!res) {
        // 404 → ticket has no SLA policy or was deleted. Skip without
        // upserting so we don't blank out a row that was valid before
        // the policy got removed mid-cycle.
        notFound++;
        continue;
      }
      buffer.push(extractSlaFromPolicyMetricsResponse(id, res));
      if (buffer.length >= UPSERT_BATCH_SIZE) await flushBuffer();
      if (PER_TICKET_DELAY_MS > 0) {
        await new Promise(r => setTimeout(r, PER_TICKET_DELAY_MS));
      }
    }
    await flushBuffer();
  } catch (err) {
    errors++;
    console.error('[zd-sla-sync] sync error:', err?.message);
  } finally {
    await releaseLock(holderId).catch(err => {
      console.warn('[zd-sla-sync] releaseLock error:', err?.message);
    });
  }

  const durationMs = Date.now() - startedAt;
  // Coverage % = how much of the actionable set this run actually
  // refreshed. Drops when Zendesk 429s or 500s; staying low across
  // multiple cycles is the signal that the hot-warm path is going to
  // be doing most of the work. Logged at INFO so it's graphable in
  // log aggregators without parsing the success-message string.
  const coveragePct = ticketsSeen > 0 ? Math.round((upserted / ticketsSeen) * 100) : 100;
  const summary = { ticketsSeen, fetched, upserted, errors, notFound, durationMs, coveragePct };
  await setLastRun(summary);
  console.log(`[zd-sla-sync] done: ${upserted}/${ticketsSeen} cached (${coveragePct}% coverage) in ${durationMs}ms (${notFound} no-policy, ${errors} error(s))`);
  return { ran: true, ...summary };
}

// In-flight dedupe for the hot-warm path. The queue route fires this
// fire-and-forget on every request that has cache-miss tickets — without
// dedupe, two simultaneous queue refreshes would issue overlapping warm
// loops for the same IDs and overspend Zendesk's rate limit. Cleared
// automatically when the loop settles.
const _warmInflight = new Set();

// ── Hot-path warm helper ───────────────────────────────────────────────
// Called by the queue route fire-and-forget for IDs that came back from
// `loadSlaRowsForTicketIds` empty. Runs the same per-ticket fetch + UPSERT
// loop as the main sync, but capped tight so it can't overspend Zendesk's
// rate limit during a hot path: only the first WARM_BATCH_MAX IDs are
// fetched, with the same PER_TICKET_DELAY_MS pacing. Subsequent queue
// refreshes pick up the enriched rows.
//
// Why this matters: without warm, a ticket the main sync hasn't reached
// yet falls through `slaInfo` to the local biz-day math which used to
// produce false-positive breach pills (2026-05-18 audit). The 2026-05-18
// FE fix in helpers.js now renders "SLA syncing" instead — warm makes
// that transient label resolve to real policy data within one refresh.
const WARM_BATCH_MAX = 25;

export async function warmSlaCacheForTicketIds(ticketIds) {
  if (!isZendeskConfigured()) return { ran: false, reason: 'zendesk_not_configured' };
  if (!process.env.DATABASE_URL) return { ran: false, reason: 'database_not_configured' };
  if (!Array.isArray(ticketIds) || ticketIds.length === 0) return { ran: false, reason: 'no_ids' };

  const ids = Array.from(new Set(
    ticketIds.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
  )).slice(0, WARM_BATCH_MAX);
  if (ids.length === 0) return { ran: false, reason: 'no_valid_ids' };

  // Skip IDs already being warmed by another in-flight call.
  const todo = ids.filter(id => !_warmInflight.has(id));
  if (todo.length === 0) return { ran: false, reason: 'all_inflight' };
  for (const id of todo) _warmInflight.add(id);

  let fetched = 0, upserted = 0, errors = 0, notFound = 0;
  const buffer = [];
  const startedAt = Date.now();
  try {
    for (const id of todo) {
      let res = null;
      try {
        res = await fetchTicketSlaPolicyMetrics(id);
        fetched++;
      } catch (err) {
        errors++;
        // Don't log every warm error — they're expected during upstream
        // hiccups and would flood the pod logs. Aggregate count is logged
        // at the end.
        continue;
      }
      if (!res) { notFound++; continue; }
      buffer.push(extractSlaFromPolicyMetricsResponse(id, res));
      if (PER_TICKET_DELAY_MS > 0) {
        await new Promise(r => setTimeout(r, PER_TICKET_DELAY_MS));
      }
    }
    if (buffer.length > 0) {
      try {
        upserted = await upsertSlaBatch(buffer);
      } catch (err) {
        console.warn(`[zd-sla-warm] upsert of ${buffer.length} rows failed:`, err?.message);
      }
    }
  } finally {
    for (const id of todo) _warmInflight.delete(id);
  }
  const durationMs = Date.now() - startedAt;
  if (fetched > 0 || errors > 0) {
    console.log(`[zd-sla-warm] ${upserted}/${todo.length} warmed in ${durationMs}ms (${notFound} no-policy, ${errors} error(s))`);
  }
  return { ran: true, requested: ids.length, attempted: todo.length, fetched, upserted, errors, notFound, durationMs };
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
