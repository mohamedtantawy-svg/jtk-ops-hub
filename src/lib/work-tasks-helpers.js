// ── work-tasks-helpers (Phase 1, 2026-05-25) ───────────────────────────────
// Server-side helpers shared by every /api/v1/work-tasks route:
//   • Row → response shape mapping
//   • Priority-based SLA defaults (when due_date is null)
//   • Mention email validation against the live roster
//   • Notification fan-out (assigned / mentioned / status / commented)
//   • OOO lookup for the FE "On leave" badge on assignees
//   • Activity log helpers

import { query } from './db';

export const VALID_STATUSES = new Set(['todo', 'in_progress', 'blocked', 'done', 'archived']);
export const VALID_PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);

// SLA defaults (in milliseconds) when a task is created without a due_date.
// Aligned with PersonalChecklist's priority taxonomy so legacy users see
// the same urgency ordering. Editable from Settings later (Phase 3).
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
export const PRIORITY_SLA_MS = {
  urgent: 4 * ONE_HOUR,
  high:   1 * ONE_DAY,
  normal: 3 * ONE_DAY,
  low:    7 * ONE_DAY,
};

export const TASK_NAME_MAX = 500;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_COMMENT_MAX = 10_000;
export const MAX_ASSIGNEES = 24;
export const MAX_FOLLOWERS = 50;
export const MAX_TAGS = 24;
export const TAG_MAX_LEN = 40;

export function computeDueDateFromPriority(createdAtMs, priority) {
  const slaMs = PRIORITY_SLA_MS[priority] || PRIORITY_SLA_MS.normal;
  return new Date(createdAtMs + slaMs);
}

export function rowToTask(r) {
  if (!r) return null;
  return {
    id: r.id,
    orgNodeId: r.org_node_id,
    title: r.title,
    description: r.description || '',
    status: r.status,
    priority: r.priority,
    creator: { email: r.creator_email, name: r.creator_name || null },
    assignees: r.assignee_emails || [],
    followers: r.follower_emails || [],
    projectId: r.project_id || null,
    parentTaskId: r.parent_task_id || null,
    dueDate: r.due_date,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    tags: r.tags || [],
    source: r.source || 'manual',
    sourceId: r.source_id || null,
    externalUrl: r.external_url || null,
    isArchived: r.is_archived === true,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // List-level convenience counters; the detail endpoint hydrates the
    // actual rows on open.
    commentCount: Number.isFinite(Number(r.comment_count)) ? Number(r.comment_count) : 0,
    activityCount: Number.isFinite(Number(r.activity_count)) ? Number(r.activity_count) : 0,
  };
}

export function rowToComment(r) {
  if (!r) return null;
  return {
    id: r.id,
    taskId: r.task_id,
    author: { email: r.author_email, name: r.author_name || null },
    body: r.body,
    mentions: r.mention_emails || [],
    createdAt: r.created_at,
    editedAt: r.edited_at,
  };
}

// ── Email normalisation + validation ────────────────────────────────────
// Structural check (no overlapping-quantifier regex) so CodeQL's js/redos
// rule stays clean on uncontrolled JSON body input. Length-bounded at
// RFC 5321's 254 char ceiling; one and only one '@'; whitespace-free
// local + domain; domain has a TLD dot in a non-leading / non-trailing
// position. Each individual regex used below is anchored, has no nested
// quantifiers, and runs in linear time.
export function normaliseEmail(e) {
  if (typeof e !== 'string') return null;
  const lc = e.trim().toLowerCase();
  if (!lc || lc.length > 254) return null;
  const at = lc.indexOf('@');
  if (at <= 0 || at !== lc.lastIndexOf('@')) return null;
  const local = lc.slice(0, at);
  const domain = lc.slice(at + 1);
  if (!local || !domain || local.length > 64 || domain.length > 253) return null;
  // Whitespace-free check: simple character-class regex, linear.
  if (/\s/.test(local) || /\s/.test(domain)) return null;
  // Domain must contain a dot with non-empty labels on both sides.
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || dot === domain.length - 1) return null;
  return lc;
}

// Validate a list of emails: dedup, lowercase, and drop any that don't
// resolve to a known member or override row. Mirrors the announcement-
// comments pattern so a malicious client can't fan out notifications to
// arbitrary external addresses.
export async function validateRosterEmails(rawList, { max = MAX_ASSIGNEES, label = 'emails' } = {}) {
  if (rawList == null) return [];
  if (!Array.isArray(rawList)) {
    const err = new Error(`${label} must be an array of email strings`);
    err.status = 400;
    throw err;
  }
  const cleaned = [];
  const seen = new Set();
  for (const raw of rawList) {
    const lc = normaliseEmail(raw);
    if (!lc || seen.has(lc)) continue;
    seen.add(lc);
    cleaned.push(lc);
    if (cleaned.length > max) {
      const err = new Error(`${label} cannot exceed ${max} entries`);
      err.status = 400;
      throw err;
    }
  }
  if (cleaned.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT LOWER(email) AS email FROM members WHERE LOWER(email) = ANY($1::text[])
       UNION
       SELECT LOWER(email) AS email FROM team_member_overrides WHERE LOWER(email) = ANY($1::text[])`,
      [cleaned],
    );
    const allowed = new Set(rows.map(r => r.email));
    return cleaned.filter(e => allowed.has(e));
  } catch (err) {
    console.warn('[work-tasks] validateRosterEmails failed:', err?.message);
    // Fall back to the syntactically-valid list rather than dropping every
    // email on a transient DB blip — the foreign-key implications are
    // minimal because work_tasks doesn't FK the email arrays to members.
    return cleaned;
  }
}

// Tag normalisation: lowercase, trim, dedupe, cap length + count.
export function normaliseTags(rawList) {
  if (rawList == null) return [];
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of rawList) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase().slice(0, TAG_MAX_LEN);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// ── OOO lookup for the "On leave" badge ─────────────────────────────────
// Returns a Set of lowercased emails that are currently on approved leave
// (server clock, date-only). Used by the list endpoint to decorate
// assignees without a second roundtrip from the FE.
export async function fetchOooEmails(emails) {
  if (!emails || emails.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT DISTINCT LOWER(work_email) AS email
         FROM time_off_events
        WHERE LOWER(work_email) = ANY($1::text[])
          AND status = 'approved'
          AND start_date <= CURRENT_DATE
          AND end_date   >= CURRENT_DATE`,
      [emails],
    );
    return rows.map(r => r.email);
  } catch (err) {
    console.warn('[work-tasks] OOO lookup failed:', err?.message);
    return [];
  }
}

// ── Notification fan-out ────────────────────────────────────────────────
// Single multi-row INSERT into user_notifications with ON CONFLICT DO
// NOTHING so re-broadcasts (e.g. cron retries) don't dupe.
//
// Args:
//   recipients      string[]   lowercased emails
//   excludeEmail    string     skip this email in the fan-out (typically the actor)
//   type            string     'task_assigned' | 'task_mentioned' | 'task_status_change' | 'task_commented' | 'task_due_soon' | 'task_overdue' | 'task_unassigned'
//   title, body     string     bell display text
//   taskId          uuid       work_tasks.id
//   sourceType      string     'work_task' | 'work_task_comment'
//   sourceId        string     comment.id when type=task_commented; otherwise task.id
//   actor           { email, name } | null
//
// Returns number of rows actually inserted.
export async function fanOutTaskNotifications({
  recipients,
  excludeEmail,
  type,
  title,
  body = '',
  taskId,
  sourceType = 'work_task',
  sourceId,
  actor = null,
}) {
  const exclude = (excludeEmail || '').toLowerCase();
  const dedupedRecipients = Array.from(new Set(
    (recipients || []).map(e => String(e || '').toLowerCase()).filter(Boolean),
  )).filter(e => e && e !== exclude);
  if (dedupedRecipients.length === 0) return 0;

  const values = [];
  const placeholders = [];
  let p = 1;
  for (const r of dedupedRecipients) {
    placeholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, 'tasks', $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    values.push(
      r,
      type,
      String(title || '').slice(0, 500),
      String(body || ''),
      String(taskId),
      sourceType,
      String(sourceId || taskId),
      actor?.email || null,
      actor?.name || null,
    );
  }
  try {
    const result = await query(
      `INSERT INTO user_notifications
         (recipient_email, type, title, body, link_view, link_id, source_type, source_id, actor_email, actor_name)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT DO NOTHING`,
      values,
    );
    return result.rowCount;
  } catch (err) {
    console.warn('[work-tasks] notification fan-out failed:', err?.message);
    return 0;
  }
}

// ── Activity log helper ─────────────────────────────────────────────────
export async function recordTaskActivity({ taskId, actor, eventType, payload }) {
  try {
    await query(
      `INSERT INTO work_task_activity (task_id, actor_email, actor_name, event_type, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        taskId,
        (actor?.email || '').toLowerCase(),
        actor?.name || null,
        eventType,
        payload ? JSON.stringify(payload) : null,
      ],
    );
  } catch (err) {
    console.warn('[work-tasks] activity insert failed:', err?.message);
  }
}

// ── Recipients resolver ─────────────────────────────────────────────────
// Returns the union of assignees + followers + creator for a task, used
// as the broad notification cohort for status changes + comments. The
// caller excludes the actor in fanOutTaskNotifications so a self-action
// doesn't notify the actor.
export function taskStakeholders(task) {
  if (!task) return [];
  const out = new Set();
  if (task.creator?.email) out.add(task.creator.email.toLowerCase());
  for (const e of (task.assignees || [])) {
    if (e) out.add(String(e).toLowerCase());
  }
  for (const e of (task.followers || [])) {
    if (e) out.add(String(e).toLowerCase());
  }
  return Array.from(out);
}

// ── Permission helpers ──────────────────────────────────────────────────
// Edit semantics: creator, current assignees, current followers, OR a
// dept admin (per canManageOrgNode) can edit a task. Anyone authed can
// READ a task in their dept (matches the rest of the multi-tenant rule).
export function canEditWorkTask(user, task, { isDeptAdmin = false } = {}) {
  if (!user?.email || !task) return false;
  if (isDeptAdmin) return true;
  const lc = user.email.toLowerCase();
  if (task.creator?.email?.toLowerCase() === lc) return true;
  if ((task.assignees || []).some(e => String(e).toLowerCase() === lc)) return true;
  if ((task.followers || []).some(e => String(e).toLowerCase() === lc)) return true;
  return false;
}
