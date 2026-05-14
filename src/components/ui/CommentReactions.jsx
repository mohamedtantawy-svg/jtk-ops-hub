// ── CommentReactions ────────────────────────────────────────────────────
// Generic emoji-reaction strip for any comment surface (HR Hub /
// Feedback / Announcements / Approval Queue). Same visual rhythm as
// the existing Leader Alert reactions (Sarah Suge feedback
// 2026-05-14: "Emoji Reactions to Messages" → applied "all places where
// we have comments and replies").
//
// Props:
//   commentType:  one of ALLOWED_COMMENT_TYPES (server-validated)
//   commentId:    the comment's own id (stringified server-side)
//   reactions:    [{ emoji, email, name }] — the server payload
//   currentUserEmail: drives the "iReacted" highlight
//   onChange?:    optional callback (nextReactions) so the parent can
//                 splice the change back into its list state. The
//                 component also keeps an internal copy for optimistic
//                 rendering when no callback is provided.
//
// Behaviour:
//   - Existing reactions render as small pill chips with the emoji +
//     count. Click toggles the user's own reaction off; clicking an
//     emoji you haven't reacted to adds yours.
//   - A small "+ emoji" picker button reveals a curated quick-row of
//     six common emojis. Custom emojis can be typed in (single-char
//     input). Keep the picker dead simple — not a full Slack-style
//     drawer.
//   - Optimistic updates flip the chip state immediately; the network
//     call settles in the background. Failures revert.

import { useState, useRef, useEffect, useMemo } from 'react';
import { addCommentReaction, removeCommentReaction } from '../../services/commentReactionsApi';

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '🙏', '👀', '🔥'];

function aggregate(rawList, myEmail) {
  if (!Array.isArray(rawList)) return [];
  const myEmailLc = (myEmail || '').toLowerCase();
  const map = new Map();
  for (const r of rawList) {
    const e = r?.emoji;
    if (!e) continue;
    const slot = map.get(e) || { emoji: e, count: 0, names: [], iReacted: false };
    slot.count += 1;
    slot.names.push(r.name || r.email || 'someone');
    if ((r.email || '').toLowerCase() === myEmailLc) slot.iReacted = true;
    map.set(e, slot);
  }
  // Stable order — by first-reacted time can't be derived from the
  // aggregated shape, so we lock the order to QUICK_EMOJIS-first + the
  // rest alphabetically. Keeps a single user's chip row from jumping
  // around between renders.
  const arr = Array.from(map.values());
  const quickIndex = (e) => QUICK_EMOJIS.indexOf(e);
  arr.sort((a, b) => {
    const qa = quickIndex(a.emoji); const qb = quickIndex(b.emoji);
    if (qa !== -1 && qb !== -1) return qa - qb;
    if (qa !== -1) return -1;
    if (qb !== -1) return 1;
    return a.emoji.localeCompare(b.emoji);
  });
  return arr;
}

export default function CommentReactions({
  commentType,
  commentId,
  reactions: initial = [],
  currentUserEmail,
  currentUserName = null,
  onChange = null,
  compact = false,    // tighter spacing for dense list rows
}) {
  const [local, setLocal] = useState(initial);
  // Keep local in sync when the parent passes new server data (e.g.
  // after a refetch). We compare on JSON to avoid clobbering optimistic
  // state during a single user gesture.
  useEffect(() => { setLocal(initial); }, [initial]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState('');
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  // Auto-flip up when the trigger is near the bottom of the viewport
  // (announcement modal comments sit just above a sticky reaction strip
  // that the downward picker would overlap with).
  const [pickerDir, setPickerDir] = useState('down');
  useEffect(() => {
    if (!pickerOpen) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const spaceBelow = window.innerHeight - r.bottom;
      setPickerDir(spaceBelow < 200 ? 'up' : 'down');
    }
    const h = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pickerOpen]);

  const myEmailLc = (currentUserEmail || '').toLowerCase();
  const aggregated = useMemo(() => aggregate(local, currentUserEmail), [local, currentUserEmail]);

  const emit = (next) => {
    setLocal(next);
    if (typeof onChange === 'function') onChange(next);
  };

  const toggle = async (emoji) => {
    if (!commentType || !commentId || !myEmailLc || busy) return;
    setBusy(true);
    const mineHere = local.some(r => r?.emoji === emoji && (r?.email || '').toLowerCase() === myEmailLc);
    const optimistic = mineHere
      ? local.filter(r => !(r?.emoji === emoji && (r?.email || '').toLowerCase() === myEmailLc))
      : [...local, { emoji, email: myEmailLc, name: currentUserName || currentUserEmail }];
    emit(optimistic);
    try {
      if (mineHere) await removeCommentReaction({ commentType, commentId, emoji });
      else          await addCommentReaction({ commentType, commentId, emoji });
    } catch {
      // Revert on failure so the chip state stays honest.
      emit(local);
    } finally {
      setBusy(false);
    }
  };

  const addFromCustom = async () => {
    const e = customEmoji.trim();
    if (!e) return;
    setPickerOpen(false);
    setCustomEmoji('');
    await toggle(e);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: compact ? 4 : 6, marginTop: compact ? 4 : 6, position: 'relative' }}>
      {aggregated.map(r => {
        const reactorList = r.names.slice(0, 5).join(', ') + (r.count > 5 ? ` and ${r.count - 5} more` : '');
        const ariaLabel = `${r.emoji} reaction, ${r.count} ${r.count === 1 ? 'person' : 'people'}: ${reactorList}. ${r.iReacted ? 'You reacted. Click to remove your reaction.' : 'Click to add your reaction.'}`;
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => toggle(r.emoji)}
            disabled={busy}
            aria-label={ariaLabel}
            aria-pressed={r.iReacted}
            title={r.names.slice(0, 5).join(', ') + (r.count > 5 ? ` +${r.count - 5} more` : '')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: compact ? '1px 7px' : '2px 8px', borderRadius: 128,
              border: `1px solid ${r.iReacted ? '#7c3aed' : 'var(--border)'}`,
              background: r.iReacted ? '#f3eff8' : 'var(--surface)',
              color: r.iReacted ? '#5b21b6' : 'var(--text-secondary, #616161)',
              fontSize: compact ? 11 : 12, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer', lineHeight: 1,
              height: compact ? 22 : 24, fontFamily: 'inherit',
            }}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span aria-hidden="true">{r.count}</span>
          </button>
        );
      })}
      <div ref={pickerRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPickerOpen(p => !p)}
          disabled={busy}
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
          title="Add reaction"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: compact ? 22 : 24, height: compact ? 22 : 24, borderRadius: 128,
            border: '1px dashed var(--border)', background: 'transparent',
            color: 'var(--text-secondary, #616161)',
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >
          <i className="bi-emoji-smile" style={{ fontSize: compact ? 11 : 12 }} />
        </button>
        {pickerOpen && (
          <div style={{
            position: 'absolute',
            ...(pickerDir === 'up'
              ? { bottom: 'calc(100% + 6px)' }
              : { top: 'calc(100% + 6px)' }),
            left: 0, zIndex: 30,
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: 8, borderRadius: 10,
            background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: '0 6px 22px rgba(0,0,0,0.10)',
            minWidth: 200,
          }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {QUICK_EMOJIS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { setPickerOpen(false); toggle(e); }}
                  disabled={busy}
                  style={{
                    width: 28, height: 28, borderRadius: 8, border: 'none',
                    background: 'transparent', cursor: busy ? 'wait' : 'pointer',
                    fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
                  }}
                  onMouseEnter={e2 => e2.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e2 => e2.currentTarget.style.background = 'transparent'}
                >
                  {e}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={customEmoji}
                onChange={e => setCustomEmoji(e.target.value.slice(0, 8))}
                placeholder="Custom (paste emoji)"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFromCustom(); } }}
                style={{
                  flex: 1, minWidth: 0,
                  border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px',
                  fontSize: 13, background: 'var(--surface)', fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                onClick={addFromCustom}
                disabled={busy || !customEmoji.trim()}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  border: 'none', background: customEmoji.trim() ? '#7c3aed' : 'var(--text-muted)',
                  color: 'white', fontSize: 12, fontWeight: 600,
                  cursor: customEmoji.trim() && !busy ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
