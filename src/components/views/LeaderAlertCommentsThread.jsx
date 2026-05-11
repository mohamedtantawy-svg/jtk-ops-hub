// ── Leaders Alerts: comments thread ───────────────────────────────────────
// Slack-style discussion under each alert. Renders the comment list + the
// composer + reactions. Polls every 5 s using the ref pattern (skill §3.11)
// so we don't tear down the interval on every keystroke.
//
// Composer features:
//   • textarea with emoji picker (curated grid, no external dep)
//   • image / video paste-drop-pick attachments (same shape as feedback)
//   • @first.last autocomplete from the team roster (Enter to insert)
//
// Each comment shows:
//   • avatar + name + relative time
//   • body (preserving line breaks; @mentions get highlighted)
//   • emoji-reaction chips with counts; click a chip to toggle your own;
//     hover the comment to reveal the "+ reaction" emoji picker
//   • inline edit + soft-delete for the author / Alerts Admin

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  listLeaderAlertComments, postLeaderAlertComment,
  patchLeaderAlertComment, deleteLeaderAlertComment,
  reactToComment, unreactComment,
} from '../../services/leaderAlertsApi';
import { MEMBERS } from '../../data/members';
import ImageLightbox from '../ui/ImageLightbox';

// ── Constants ─────────────────────────────────────────────────────────────

const POLL_MS = 5000;

const EMOJI_GRID = [
  '👍', '👀', '🎉', '✅', '❤️', '🙏', '🚀', '🔥',
  '😂', '😅', '😢', '😡', '🤔', '🤯', '👏', '💯',
  '🟢', '🟡', '🔴', '⚠️', '🆘', '📌', '🛠️', '🐛',
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const ACCEPTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

// ── Helpers ───────────────────────────────────────────────────────────────

// Defensive ISO parse — see audit L2 in LEADER_ALERTS_PLAN.md.
function ensureIsoZ(s) {
  if (!s) return s;
  const str = String(s);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) return str;
  if (/T\d{2}:\d{2}/.test(str)) return str + 'Z';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)) return str.replace(' ', 'T') + 'Z';
  return str;
}

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(ensureIsoZ(iso)).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  return new Date(ensureIsoZ(iso)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

function compressImageFile(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onerror = () => resolve(null);
    r.onload = (ev) => {
      const original = ev.target.result;
      const img = new Image();
      img.onerror = () => resolve(original);
      img.onload = () => {
        try {
          const MAX = 1600;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width >= height) { height = Math.round((height / width) * MAX); width = MAX; }
            else { width = Math.round((width / height) * MAX); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const isPng = /^data:image\/png/i.test(original);
          const out = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
          resolve(out.length < original.length ? out : original);
        } catch (_) { resolve(original); }
      };
      img.src = original;
    };
    r.readAsDataURL(file);
  });
}

// Build avatar initials + a stable color per email.
function avatarFor(name, email) {
  const initials = (name || email || '').split(/\s+/).map(s => s.charAt(0).toUpperCase()).slice(0, 2).join('') || '?';
  const palette = ['#7c3aed', '#dc2626', '#0369a1', '#15803d', '#d97706', '#0891b2'];
  const seed = (email || name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return { initials, color: palette[seed % palette.length] };
}

// Highlight @first.last tokens in body text.
function renderBody(body) {
  if (!body) return null;
  const parts = String(body).split(/(@[a-z][a-z0-9._-]{1,80})/gi);
  return parts.map((p, i) => {
    if (p.startsWith('@')) {
      return (
        <span key={i} style={{
          padding: '0 4px', borderRadius: 4,
          background: '#ede9fe', color: '#5b21b6',
          fontWeight: 600,
        }}>{p}</span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

// Aggregate raw reactions [{emoji,email}] into [{emoji,count,emails,iReacted}].
function aggregateReactions(rawList, myEmail) {
  if (!Array.isArray(rawList)) return [];
  const myEmailLc = (myEmail || '').toLowerCase();
  const map = new Map();
  for (const r of rawList) {
    const e = r?.emoji;
    if (!e) continue;
    const slot = map.get(e) || { emoji: e, count: 0, emails: [], iReacted: false };
    slot.count += 1;
    slot.emails.push(r.email);
    if ((r.email || '').toLowerCase() === myEmailLc) slot.iReacted = true;
    map.set(e, slot);
  }
  return Array.from(map.values());
}

// ── Component ─────────────────────────────────────────────────────────────

const LeaderAlertCommentsThread = ({ alertId, initialComments, currentUser, perms, onCountChange, pollEnabled = true }) => {
  const [comments, setComments] = useState(() => Array.isArray(initialComments) ? initialComments : []);
  const [error, setError] = useState(null);

  // Ref pattern for polling — see skill §3.11. The interval reads
  // `commentsRef.current` so it doesn't need `comments` in its dep array.
  const commentsRef = useRef(comments);
  useEffect(() => { commentsRef.current = comments; }, [comments]);

  // Notify parent of comment count changes (so the alert row footer updates).
  useEffect(() => {
    onCountChange?.(comments.filter(c => !c.deleted_at).length);
  }, [comments, onCountChange]);

  // Initial fetch + 5 s polling. Tail-timestamp cursor + dedup-by-id.
  // Error display is debounced behind a 3-strike consecutive-failure
  // threshold so a single transient nginx 503 (deploy pod-warm tail-end,
  // skill §6.6) doesn't surface "Polling stalled" — the next tick
  // recovers and the banner never appears. Stage F audit caught this:
  // the original code also never cleared `error` on success, so a single
  // transient hit would leave the banner stuck forever. Now `error` is
  // cleared on every successful response and only set after 3 in a row.
  //
  // pollEnabled gate: skip polling for resolved alerts. The 2026-05-03
  // live audit (F17) caught a red "Polling stalled — API 503" banner
  // showing up under Resolved alerts whose discussion was already final
  // — there's nothing actionable to fetch on a resolved alert, so the
  // poll loop only had downside.
  useEffect(() => {
    if (!pollEnabled) {
      // Make sure a stale banner from a previous mount doesn't linger.
      setError(null);
      return undefined;
    }
    let cancelled = false;
    let consecutiveFailures = 0;
    const tick = async () => {
      const cur = commentsRef.current;
      const lastTs = cur.length ? cur[cur.length - 1].created_at : null;
      try {
        const d = await listLeaderAlertComments(alertId, lastTs ? { since: lastTs } : { limit: 100 });
        if (cancelled) return;
        // Clear any prior stall banner the moment polling recovers.
        consecutiveFailures = 0;
        setError(null);
        const fresh = Array.isArray(d?.comments) ? d.comments : [];
        if (!fresh.length) return;
        setComments(prev => {
          const seen = new Set(prev.map(c => c.id));
          const merged = [...prev];
          for (const c of fresh) if (!seen.has(c.id)) merged.push(c);
          return merged;
        });
      } catch (e) {
        if (cancelled) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) setError(e?.message || 'Polling failed');
      }
    };

    // Skip initial tick if we already have comments (passed in from the
    // detail GET); otherwise fetch immediately.
    if (commentsRef.current.length === 0) tick();

    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [alertId, pollEnabled]);

  // Patch a single comment in-place after edit / delete / reaction.
  const updateComment = useCallback((updated) => {
    setComments(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
  }, []);

  const handlePosted = (comment) => {
    setComments(prev => {
      // Append, but de-dup against the next poll.
      if (prev.some(c => c.id === comment.id)) return prev;
      return [...prev, comment];
    });
  };

  const visible = comments.filter(c => !c.deleted_at);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: '#fef2f2', color: '#b91c1c', fontSize: 12,
        }}>
          Polling stalled — {error}
        </div>
      )}

      {visible.length === 0 && (
        <div style={{
          padding: '24px 18px', borderRadius: 12,
          border: '1px dashed var(--border)', background: 'var(--surface-2)',
          textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
        }}>
          <i className="bi-chat-square-text" style={{ fontSize: 18, display: 'block', marginBottom: 6 }} />
          No comments yet — start the discussion.
        </div>
      )}

      {visible.map(c => (
        <CommentRow
          key={c.id}
          comment={c}
          currentUser={currentUser}
          perms={perms}
          onUpdate={updateComment}
        />
      ))}

      <CommentComposer
        alertId={alertId}
        currentUser={currentUser}
        onPosted={handlePosted}
      />
    </div>
  );
};

// ── Comment row ───────────────────────────────────────────────────────────

const CommentRow = ({ comment, currentUser, perms, onUpdate }) => {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const myEmailLc = (currentUser?.email || '').toLowerCase();
  const isAuthor = (comment.author_email || '').toLowerCase() === myEmailLc;
  const canEdit = isAuthor || !!perms?.canManageLeaderAlerts;
  const reactions = useMemo(() => aggregateReactions(comment.reactions, currentUser?.email), [comment.reactions, currentUser?.email]);
  const av = avatarFor(comment.author_name, comment.author_email);

  const toggleReaction = async (emoji) => {
    if (busy) return;
    setBusy(true);
    const existing = reactions.find(r => r.emoji === emoji);
    // Optimistic update — flip iReacted then refetch single comment via the parent.
    try {
      if (existing?.iReacted) {
        await unreactComment(comment.id, emoji);
        const nextRaw = (comment.reactions || []).filter(r => !(r.emoji === emoji && (r.email || '').toLowerCase() === myEmailLc));
        onUpdate({ id: comment.id, reactions: nextRaw });
      } else {
        await reactToComment(comment.id, emoji);
        const nextRaw = [...(comment.reactions || []), { emoji, email: myEmailLc }];
        onUpdate({ id: comment.id, reactions: nextRaw });
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    const body = editBody.trim();
    if (!body || body === comment.body || busy) { setEditing(false); return; }
    setBusy(true);
    try {
      const r = await patchLeaderAlertComment(comment.id, body);
      onUpdate(r?.comment || { ...comment, body, edited_at: new Date().toISOString() });
      setEditing(false);
    } catch (e) {
      // Surface inline — keep the editor open so the user can retry.
      console.warn('Edit failed', e?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this comment?')) return;
    setBusy(true);
    try {
      await deleteLeaderAlertComment(comment.id);
      onUpdate({ id: comment.id, deleted_at: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setShowPicker(false); }}
      style={{
        display: 'flex', gap: 10, padding: '8px 8px',
        borderRadius: 10,
        background: hover ? 'var(--surface-2)' : 'transparent',
        transition: 'background .12s',
        position: 'relative',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 16,
        background: av.color, color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0,
      }}>
        {av.initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{comment.author_name || comment.author_email}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{formatRelative(comment.created_at)}{comment.edited_at ? ' · edited' : ''}</span>
        </div>

        {!editing && (
          <div style={{
            fontSize: 14, lineHeight: 1.6, color: 'var(--text)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {renderBody(comment.body)}
          </div>
        )}
        {editing && (
          <div>
            <textarea
              value={editBody}
              autoFocus
              onChange={(e) => setEditBody(e.target.value)}
              rows={3}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 13, outline: 'none',
                fontFamily: 'inherit', resize: 'vertical', minHeight: 60,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                style={{
                  padding: '4px 12px', borderRadius: 128, border: 'none',
                  background: '#7c3aed', color: 'white',
                  fontSize: 12, fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >Save</button>
              <button
                type="button"
                onClick={() => { setEditing(false); setEditBody(comment.body); }}
                disabled={busy}
                style={{
                  padding: '4px 12px', borderRadius: 128,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >Cancel</button>
            </div>
          </div>
        )}

        {/* Attachments */}
        {!editing && Array.isArray(comment.attachments) && comment.attachments.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {comment.attachments.map((a, i) => (
              a.kind === 'image' ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightbox({ src: a.dataUri, name: a.name })}
                  title="Open"
                  style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'zoom-in' }}
                >
                  <img src={a.dataUri} alt={a.name || ''} style={{ display: 'block', maxWidth: 180, maxHeight: 120, borderRadius: 8, border: '1px solid var(--border)' }} />
                </button>
              ) : (
                <div key={i} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12 }}>
                  <i className="bi-camera-video" style={{ marginRight: 4 }} />
                  {a.name || 'Video'}
                </div>
              )
            ))}
          </div>
        )}
        <ImageLightbox
          src={lightbox?.src}
          name={lightbox?.name}
          onClose={() => setLightbox(null)}
        />

        {/* Reaction chips */}
        {!editing && reactions.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {reactions.map(r => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => toggleReaction(r.emoji)}
                title={r.emails.slice(0, 5).join(', ') + (r.count > 5 ? ` +${r.count - 5} more` : '')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 128,
                  border: `1px solid ${r.iReacted ? '#7c3aed' : 'var(--border)'}`,
                  background: r.iReacted ? '#f3eff8' : 'var(--surface)',
                  color: r.iReacted ? '#5b21b6' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', height: 24, lineHeight: 1,
                }}
              >
                <span>{r.emoji}</span>
                {r.count}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover toolbar */}
      {hover && !editing && (
        <div style={{
          position: 'absolute', top: 4, right: 8,
          display: 'flex', gap: 4,
          padding: 2, borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <button
            type="button"
            onClick={() => setShowPicker(s => !s)}
            title="Add reaction"
            style={{
              width: 26, height: 26, borderRadius: 6, border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <i className="bi-emoji-smile" style={{ fontSize: 13 }} />
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Edit"
                style={{
                  width: 26, height: 26, borderRadius: 6, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <i className="bi-pencil" style={{ fontSize: 12 }} />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                title="Delete"
                style={{
                  width: 26, height: 26, borderRadius: 6, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  color: '#b91c1c',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <i className="bi-trash" style={{ fontSize: 12 }} />
              </button>
            </>
          )}
        </div>
      )}

      {showPicker && (
        <div style={{
          position: 'absolute', top: 36, right: 8, zIndex: 50,
          padding: 8, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 28px)', gap: 4 }}>
            {EMOJI_GRID.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => { toggleReaction(e); setShowPicker(false); }}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none',
                  background: 'transparent', fontSize: 16,
                  cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Composer ──────────────────────────────────────────────────────────────

const CommentComposer = ({ alertId, currentUser, onPosted }) => {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [mentionState, setMentionState] = useState(null); // { query, anchorPos }

  const textRef = useRef(null);

  const canSubmit = body.trim().length > 0 && !submitting;

  // Build mention candidates from MEMBERS. Earlier this filtered by
  // `m.access` against the four tier strings — silently a no-op (every
  // tier was allowed) AND broken: `_buildMembers` in src/data/members.js
  // exports rows with `role` instead of `access`, so `m.access` was
  // undefined for every row → filter excluded EVERYTHING → picker
  // popover never rendered. Same data-shape gotcha is annotated in
  // LeaderAlertDetailPanel.jsx (which already does `m.access || m.role`).
  // Drop the filter — every roster row is a valid mention target. Match
  // HrHubComposer's pattern (which doesn't pre-filter and works fine).
  const mentionCandidates = useMemo(() => MEMBERS.filter(m => m && m.email && m.name), []);

  const filteredMentions = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    if (!q) return mentionCandidates.slice(0, 6);
    return mentionCandidates.filter(m =>
      (m.email || '').toLowerCase().startsWith(q)
      || (m.name || '').toLowerCase().includes(q)
    ).slice(0, 6);
  }, [mentionState, mentionCandidates]);

  // Detect @ token immediately before the cursor.
  const checkMentionTrigger = (val, caret) => {
    const head = val.slice(0, caret);
    const m = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(head);
    if (m) setMentionState({ query: m[1], anchorPos: caret - m[1].length - 1 });
    else setMentionState(null);
  };

  const onChangeBody = (e) => {
    const v = e.target.value;
    setBody(v);
    checkMentionTrigger(v, e.target.selectionStart || v.length);
  };

  const insertMention = (member) => {
    if (!mentionState) return;
    const localpart = (member.email || '').split('@')[0];
    if (!localpart) return;
    // Replace from anchorPos through current caret.
    const ta = textRef.current;
    const caret = ta?.selectionStart ?? body.length;
    const pre = body.slice(0, mentionState.anchorPos);
    const post = body.slice(caret);
    const insertion = `@${localpart} `;
    const next = pre + insertion + post;
    setBody(next);
    setMentionState(null);
    requestAnimationFrame(() => {
      const newCaret = (pre + insertion).length;
      ta?.focus();
      ta?.setSelectionRange(newCaret, newCaret);
    });
  };

  // Attachments — same shape as the create-modal (capped slightly tighter
  // for the per-comment surface).
  const addAttachment = useCallback(async (file) => {
    if (!file) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(`Max ${MAX_ATTACHMENTS} attachments per comment`);
      return;
    }
    const isImage = file.type?.startsWith('image/');
    const isVideo = ACCEPTED_VIDEO_TYPES.has(file.type);
    if (!isImage && !isVideo) { setError('Only images and short videos are supported'); return; }
    if (isImage && file.size > MAX_IMAGE_BYTES) { setError(`Image "${file.name}" too large`); return; }
    if (isVideo && file.size > MAX_VIDEO_BYTES) { setError(`Video "${file.name}" too large`); return; }
    try {
      const dataUri = isImage ? await compressImageFile(file) : await fileToDataUri(file);
      if (!dataUri) { setError('Could not read file'); return; }
      setError(null);
      setAttachments(prev => [...prev, { kind: isImage ? 'image' : 'video', dataUri, name: file.name }]);
    } catch {
      setError('Could not read file');
    }
  }, [attachments.length]);

  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) { e.preventDefault(); await addAttachment(f); return; }
      }
    }
  }, [addAttachment]);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await postLeaderAlertComment(alertId, {
        body: body.trim(),
        attachments,
      });
      setBody('');
      setAttachments([]);
      onPosted?.(r?.comment);
    } catch (e) {
      setError(e?.message || 'Could not post comment');
    } finally {
      setSubmitting(false);
    }
  };

  // Enter to submit, Shift+Enter for newline.
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !mentionState) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div style={{ marginTop: 12, position: 'relative' }}>
      {/* Mention popover */}
      {mentionState && filteredMentions.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
          minWidth: 240, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: 'var(--shadow-lg)', padding: '4px 0',
          zIndex: 80, maxHeight: 240, overflowY: 'auto',
        }}>
          {filteredMentions.map(m => {
            const av = avatarFor(m.name, m.email);
            return (
              <button
                key={m.email}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', border: 'none',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 12,
                  background: av.color, color: 'white',
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{av.initials}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{m.name || m.email}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>@{m.email.split('@')[0]}{m.team ? ` · ${m.team}` : ''}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {attachments.map((a, i) => (
            <div key={i} style={{
              position: 'relative', width: 64, height: 48, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              overflow: 'hidden',
            }}>
              {a.kind === 'image'
                ? <img src={a.dataUri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                    <i className="bi-camera-video" style={{ fontSize: 16, color: 'var(--text-muted)' }} />
                  </div>}
              <button
                type="button"
                onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove attachment"
                style={{
                  position: 'absolute', top: 2, right: 2,
                  width: 18, height: 18, borderRadius: 9,
                  background: 'rgba(15, 23, 42, 0.8)', border: 'none', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <i className="bi-x-lg" style={{ fontSize: 9 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        padding: 6, borderRadius: 12,
        border: '1px solid var(--border)', background: 'var(--surface)',
        transition: 'border-color .12s',
      }}>
        <textarea
          ref={textRef}
          value={body}
          onChange={onChangeBody}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          rows={2}
          placeholder="Reply to this alert · @ to mention · paste a screenshot"
          style={{
            flex: 1, minHeight: 56, maxHeight: 260, resize: 'vertical',
            padding: '10px 12px', border: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 14, lineHeight: 1.5, outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowEmoji(s => !s)}
            title="Emoji"
            style={iconBtnStyle}
          >
            <i className="bi-emoji-smile" style={{ fontSize: 14 }} />
          </button>
          <label style={{ ...iconBtnStyle, cursor: 'pointer' }}>
            <i className="bi-paperclip" style={{ fontSize: 14 }} />
            <input
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              multiple
              style={{ display: 'none' }}
              onChange={async (e) => {
                for (const f of Array.from(e.target.files || [])) await addAttachment(f);
                e.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            title="Send (⏎)"
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: canSubmit ? '#7c3aed' : 'var(--surface-3)',
              color: canSubmit ? 'white' : 'var(--text-muted)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className={submitting ? 'bi-arrow-repeat' : 'bi-send-fill'} style={{ fontSize: 13, animation: submitting ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {showEmoji && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', right: 8, zIndex: 80,
            padding: 8, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 28px)', gap: 4 }}>
              {EMOJI_GRID.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setBody(prev => prev + e);
                    setShowEmoji(false);
                    requestAnimationFrame(() => textRef.current?.focus());
                  }}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none',
                    background: 'transparent', fontSize: 16, cursor: 'pointer',
                    padding: 0,
                  }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
                >{e}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c' }}>{error}</div>
      )}
    </div>
  );
};

const iconBtnStyle = {
  width: 32, height: 32, borderRadius: 8, border: 'none',
  background: 'transparent', color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export default LeaderAlertCommentsThread;
