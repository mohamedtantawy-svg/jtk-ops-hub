// ── Comment Reactions API client ────────────────────────────────────────
// Single endpoint, idempotent on both verbs. Surfaces consume this
// through the shared `<CommentReactions />` component, which handles
// optimistic updates + the toggle UX.

import { apiFetch } from './api';

export async function addCommentReaction({ commentType, commentId, emoji }) {
  return apiFetch('/comment-reactions', {
    method: 'POST',
    body: JSON.stringify({ commentType, commentId, emoji }),
  });
}

export async function removeCommentReaction({ commentType, commentId, emoji }) {
  return apiFetch('/comment-reactions', {
    method: 'DELETE',
    body: JSON.stringify({ commentType, commentId, emoji }),
  });
}
