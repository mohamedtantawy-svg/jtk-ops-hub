// ── Offboarding workflow-change notifier ────────────────────────────────────
// Carolina Ferreira 2026-06-03: HRX stopped getting notified when a
// termination/resignation workflow advances (client signs off, employee signs
// the termination doc, etc.) once the old Jira/Slack pings went away.
//
// `terminations_v3` already exposes the full 9-step workflow, and the
// offboarding build (app/api/v1/integrations/deel/offboarding/route.js) already
// classifies each case into a `primaryBucket` step + resolves its assignee. So
// we detect change cheaply, right where the rows are built: snapshot every
// case's step in `offboarding_task_state`, and on each shared cache rebuild
// diff the new step against the stored one. Every step change drops a bell
// notification on the assignee (link_view='queue' → opens their queue on the
// row). Returns the set of recently-changed ids so the build can flag an
// "Updated" pill on those rows.
//
// Safety:
//   • First time we see a case (no prior row) → record baseline, DO NOT notify
//     (otherwise the first run after deploy would flood every assignee with a
//     notification for every in-flight termination).
//   • Multi-pod / repeated rebuilds → the INSERT relies on the partial unique
//     index `uniq_offboarding_update_notif` (migrate.js) so a given transition
//     notifies at most once, even if two pods build concurrently.
//   • Best-effort — any failure is logged and swallowed; it must never break
//     the queue response.

import { query } from './db';

// MUST match the partial unique index predicate in migrate.js.
const SOURCE_TYPE = 'offboarding_update';
// A case whose step changed within this window still shows the "Updated" pill.
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function clip(str, max) {
  const s = String(str == null ? '' : str);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Diff the freshly built offboarding `items` against the stored per-case
 * workflow step, notify assignees of every step change, and persist the new
 * steps. Returns a Set<terminationId> of cases changed within the recent
 * window (for the row "Updated" pill). Never throws.
 *
 * @param {Array<{id:string,name?:string,primaryBucket?:string,status?:{label?:string},assigneeEmail?:string}>} items
 * @returns {Promise<Set<string>>}
 */
export async function detectAndNotifyOffboardingChanges(items) {
  const recentlyUpdated = new Set();
  if (!Array.isArray(items) || items.length === 0) return recentlyUpdated;

  try {
    const ids = [];
    for (const it of items) {
      const id = String(it?.id || '');
      if (id) ids.push(id);
    }
    if (ids.length === 0) return recentlyUpdated;

    // 1. Prior snapshot for these cases.
    const { rows: prior } = await query(
      `SELECT termination_id, last_step, last_change_at
         FROM offboarding_task_state
        WHERE termination_id = ANY($1::text[])`,
      [ids],
    );
    const priorMap = new Map(prior.map(r => [r.termination_id, r]));
    const nowMs = Date.now();

    // 2. Compute transitions (for notifications + pill) and the upsert payload.
    const upIds = [], upNames = [], upSteps = [], upAssignees = [];
    const nRecip = [], nTitle = [], nBody = [], nLinkId = [], nSrcId = [];

    for (const it of items) {
      const id = String(it?.id || '');
      if (!id) continue;
      const step = it.primaryBucket || it.status?.label || '';
      const assignee = String(it.assigneeEmail || '').toLowerCase();
      const name = it.name || '';

      const prev = priorMap.get(id);
      const isChange = !!prev && prev.last_step != null && prev.last_step !== step;

      if (isChange) {
        recentlyUpdated.add(id);
        // Only assigned cases have someone to notify.
        if (assignee) {
          nRecip.push(assignee);
          nTitle.push(clip(`Termination update — ${name || 'case'}`, 500));
          nBody.push(clip(`${prev.last_step} → ${step}`, 1000));
          nLinkId.push(clip(id, 255));
          // Encode the specific transition so the unique index dedups exactly
          // this change (a different change later gets its own notification).
          nSrcId.push(clip(`${id}:${prev.last_step}→${step}`, 255));
        }
      } else if (prev && prev.last_change_at &&
                 (nowMs - new Date(prev.last_change_at).getTime()) < RECENT_WINDOW_MS) {
        // No change this cycle, but changed within the window → keep the pill.
        recentlyUpdated.add(id);
      }

      upIds.push(id);
      upNames.push(name || null);
      upSteps.push(step || null);
      upAssignees.push(assignee || null);
    }

    // 3. Notify assignees (deduped by the partial unique index).
    if (nRecip.length > 0) {
      await query(
        `INSERT INTO user_notifications
           (recipient_email, type, title, body, link_view, link_id, source_type, source_id)
         SELECT u.recip, 'status_change', u.title, u.body, 'queue', u.link_id, $6, u.src_id
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
                AS u(recip, title, body, link_id, src_id)
         ON CONFLICT (recipient_email, source_type, source_id)
           WHERE source_type = 'offboarding_update'
           DO NOTHING`,
        [nRecip, nTitle, nBody, nLinkId, nSrcId, SOURCE_TYPE],
      );
    }

    // 4. Persist the new step for every case. last_change_at bumps only on a
    //    real step change (IS DISTINCT FROM); new rows start with NULL (the
    //    baseline that suppresses a first-seen notification next cycle).
    await query(
      `INSERT INTO offboarding_task_state
         (termination_id, employee_name, last_step, assignee_email, first_seen_at, last_change_at, updated_at)
       SELECT u.id, u.name, u.step, u.assignee, NOW(), NULL::timestamptz, NOW()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
              AS u(id, name, step, assignee)
       ON CONFLICT (termination_id) DO UPDATE
         SET employee_name  = EXCLUDED.employee_name,
             assignee_email = EXCLUDED.assignee_email,
             last_step      = EXCLUDED.last_step,
             last_change_at = CASE
                                WHEN offboarding_task_state.last_step IS DISTINCT FROM EXCLUDED.last_step
                                THEN NOW()
                                ELSE offboarding_task_state.last_change_at
                              END,
             updated_at     = NOW()`,
      [upIds, upNames, upSteps, upAssignees],
    );
  } catch (err) {
    console.warn('[offboarding-update] detect/notify failed:', err?.message);
  }

  return recentlyUpdated;
}
