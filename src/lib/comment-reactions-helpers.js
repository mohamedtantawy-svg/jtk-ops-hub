// ── Comment Reactions — server-side helpers ─────────────────────────────
// Polymorphic emoji-reaction store shared across HR Hub, Feedback,
// Announcements, and Approval-Queue comment surfaces (Sarah Suge
// feedback 2026-05-14). Leader Alert reactions live in their own
// `leader_alert_comment_reaction` table — not migrated to keep the
// blast radius small.

import { query } from './db.js';

// Allowed comment types — keep tight so a bad caller can't write rows
// against a non-existent surface and break audit queries.
export const ALLOWED_COMMENT_TYPES = new Set([
  'hr_hub',
  'feedback',
  'announcement',
  'announcement_request',
]);

const EMOJI_MAX_LEN = 64;
function lc(s) { return typeof s === 'string' ? s.toLowerCase() : s; }

export function isValidCommentType(t) {
  return typeof t === 'string' && ALLOWED_COMMENT_TYPES.has(t);
}

export function isValidEmoji(e) {
  if (typeof e !== 'string') return false;
  const t = e.trim();
  return t.length > 0 && t.length <= EMOJI_MAX_LEN;
}

/**
 * Add a reaction. Idempotent on (type, id, email-lower, emoji) — ON
 * CONFLICT DO NOTHING returns no rows when the row already exists.
 * Returns the inserted (or pre-existing) row in `{id, ...}` shape.
 */
export async function addReaction({ commentType, commentId, emoji, userEmail, userName }) {
  if (!isValidCommentType(commentType)) throw new Error('Invalid commentType');
  if (!commentId) throw new Error('commentId is required');
  if (!isValidEmoji(emoji)) throw new Error('Invalid emoji');
  if (!userEmail) throw new Error('userEmail is required');
  const { rows } = await query(
    `INSERT INTO comment_reactions
       (comment_type, comment_id, emoji, user_email, user_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (comment_type, comment_id, LOWER(user_email), emoji) DO NOTHING
     RETURNING id, comment_type, comment_id, emoji, user_email, user_name, created_at`,
    [commentType, String(commentId), emoji.trim(), userEmail, userName || null],
  );
  return rows[0] || null;
}

/**
 * Remove a reaction. Returns the deleted count (0 or 1). Email match is
 * case-insensitive to keep parity with addReaction's unique index.
 */
export async function removeReaction({ commentType, commentId, emoji, userEmail }) {
  if (!isValidCommentType(commentType)) throw new Error('Invalid commentType');
  if (!commentId) throw new Error('commentId is required');
  if (!isValidEmoji(emoji)) throw new Error('Invalid emoji');
  if (!userEmail) throw new Error('userEmail is required');
  const { rowCount } = await query(
    `DELETE FROM comment_reactions
      WHERE comment_type = $1
        AND comment_id   = $2
        AND emoji        = $3
        AND LOWER(user_email) = LOWER($4)`,
    [commentType, String(commentId), emoji.trim(), userEmail],
  );
  return rowCount || 0;
}

/**
 * Fetch reactions for many comments at once. Returns a Map<commentId, rows[]>
 * keyed on the STRING form of comment id. Callers project the rows into
 * the same shape the FE consumer expects (see CommentReactions
 * component): { emoji, email, name }.
 */
export async function fetchReactionsForComments(commentType, commentIds) {
  if (!isValidCommentType(commentType)) return new Map();
  if (!Array.isArray(commentIds) || commentIds.length === 0) return new Map();
  const ids = commentIds.map(id => String(id)).filter(Boolean);
  if (ids.length === 0) return new Map();
  const { rows } = await query(
    `SELECT comment_id, emoji, user_email, user_name, created_at
       FROM comment_reactions
      WHERE comment_type = $1
        AND comment_id = ANY($2::text[])
      ORDER BY created_at ASC`,
    [commentType, ids],
  );
  const map = new Map();
  for (const r of rows) {
    const key = String(r.comment_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      emoji: r.emoji,
      email: lc(r.user_email),
      name: r.user_name,
    });
  }
  return map;
}

/**
 * Convenience: shape a list of comments by splicing in `reactions`
 * arrays. Each comment must carry an `id` field. Returns a new array.
 */
export async function attachReactionsToComments(commentType, comments, { idField = 'id' } = {}) {
  if (!Array.isArray(comments) || comments.length === 0) return comments || [];
  const ids = comments.map(c => c?.[idField]).filter(Boolean);
  const map = await fetchReactionsForComments(commentType, ids);
  return comments.map(c => {
    const key = c?.[idField] != null ? String(c[idField]) : null;
    return { ...c, reactions: key ? (map.get(key) || []) : [] };
  });
}
