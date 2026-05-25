// ── work-tasks-sla-sync (Phase 3, 2026-05-25) ──────────────────────────────
// Hourly background sync that fires due_soon + overdue notifications for
// open work_tasks. Idempotency via work_task_sla_notifications -- a row
// per (task, kind) ledger entry means a multi-pod cluster never double-
// fires; the same hour's run on a second pod sees the ON CONFLICT and
// skips.
//
// What counts as a breach:
//   • due_soon -- due_date is between NOW() and NOW()+24h, status in
//                 (todo, in_progress, blocked), kind 'due_soon' not yet
//                 recorded.
//   • overdue  -- due_date < NOW(), status in (todo, in_progress, blocked),
//                 kind 'overdue' not yet recorded.
//
// Two pods running at the same minute can both pick up the same task;
// the ledger INSERT ... ON CONFLICT DO NOTHING resolves the race. We
// also gate the whole pass with a soft TTL (`tasks_sla_sync_last_run`)
// in app_settings so the second pod no-ops within the cooldown.

import { query } from './db';
import { fanOutTaskNotifications, taskStakeholders, rowToTask } from './work-tasks-helpers';

const SOFT_TTL_MS = 30 * 60 * 1000; // 30 min — half the hourly cadence
const SENTINEL_KEY = 'tasks_sla_sync_last_run';

async function withSoftGate({ force }) {
  if (force) return { proceed: true };
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      [SENTINEL_KEY],
    );
    const last = rows[0]?.value;
    const lastTs = last && Number.isFinite(Number(last.at)) ? Number(last.at) : 0;
    if (lastTs && Date.now() - lastTs < SOFT_TTL_MS) {
      return { proceed: false, reason: 'recent_sync', lastTs };
    }
  } catch (err) {
    console.warn('[tasks-sla-sync] sentinel read failed:', err?.message);
  }
  return { proceed: true };
}

async function stampSentinel(result) {
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        SENTINEL_KEY,
        JSON.stringify({ at: Date.now(), ...result }),
        'tasks-sla-sync',
      ],
    );
  } catch (err) {
    console.warn('[tasks-sla-sync] sentinel write failed:', err?.message);
  }
}

// Fetch + claim the next batch of tasks needing notification of a given
// kind. Uses a single SQL pass: insert into the ledger and join back to
// the task row in one round-trip. Only tasks that successfully WROTE a
// new ledger row come back -- contention with another pod resolves
// cleanly via ON CONFLICT DO NOTHING.
async function claimAndFan(kind) {
  const dueExpr = kind === 'due_soon'
    ? `t.due_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'`
    : `t.due_date < NOW()`;
  // Subquery + INSERT ... SELECT prevents double-claims across pods.
  let claimed = [];
  try {
    const { rows } = await query(
      `WITH candidates AS (
         SELECT t.id
           FROM work_tasks t
          WHERE t.due_date IS NOT NULL
            AND t.is_archived = false
            AND t.status IN ('todo','in_progress','blocked')
            AND ${dueExpr}
          ORDER BY t.due_date ASC
          LIMIT 500
       ),
       inserted AS (
         INSERT INTO work_task_sla_notifications (task_id, kind)
         SELECT id, $1::varchar FROM candidates
         ON CONFLICT (task_id, kind) DO NOTHING
         RETURNING task_id
       )
       SELECT t.id, t.org_node_id, t.title, t.description, t.status, t.priority,
              t.creator_email, t.assignee_emails, t.follower_emails,
              t.project_id, t.parent_task_id, t.due_date, t.started_at,
              t.completed_at, t.tags, t.source, t.source_id, t.external_url,
              t.is_archived, t.created_at, t.updated_at
         FROM inserted i
         JOIN work_tasks t ON t.id = i.task_id`,
      [kind],
    );
    claimed = rows.map(rowToTask);
  } catch (err) {
    console.warn(`[tasks-sla-sync] claim ${kind} failed:`, err?.message);
    return { kind, claimed: 0, notified: 0, error: err?.message };
  }

  let totalNotified = 0;
  for (const task of claimed) {
    const stakeholders = taskStakeholders(task);
    if (stakeholders.length === 0) continue;
    const title = kind === 'due_soon'
      ? `Task due in less than 24 hours`
      : `Task is overdue`;
    const body = `${task.title}${task.dueDate ? ` (due ${new Date(task.dueDate).toLocaleString()})` : ''}`;
    try {
      const sent = await fanOutTaskNotifications({
        recipients: stakeholders,
        excludeEmail: null,
        type: kind === 'due_soon' ? 'task_due_soon' : 'task_overdue',
        title,
        body,
        taskId: task.id,
        sourceType: 'work_task',
        sourceId: task.id,
        actor: { email: 'tasks-sla-sync@deel.com', name: 'Tasks SLA Sync' },
      });
      totalNotified += sent;
    } catch (err) {
      console.warn(`[tasks-sla-sync] fan-out failed for task ${task.id}:`, err?.message);
    }
  }

  return { kind, claimed: claimed.length, notified: totalNotified };
}

export async function runTasksSlaSync({ force = false } = {}) {
  const gate = await withSoftGate({ force });
  if (!gate.proceed) {
    return { ran: false, reason: gate.reason, lastTs: gate.lastTs };
  }
  const startedAt = Date.now();
  const dueSoon = await claimAndFan('due_soon');
  const overdue = await claimAndFan('overdue');
  const result = {
    ran: true,
    durationMs: Date.now() - startedAt,
    dueSoon,
    overdue,
  };
  await stampSentinel(result);
  if (dueSoon.claimed + overdue.claimed > 0) {
    console.log(
      `[tasks-sla-sync] done: due_soon ${dueSoon.claimed} tasks → ${dueSoon.notified} notifs; overdue ${overdue.claimed} tasks → ${overdue.notified} notifs (${result.durationMs}ms)`,
    );
  }
  return result;
}
