// ── MentionTextarea ─────────────────────────────────────────────────────────
// A drop-in textarea that adds `@` autocomplete against the live team roster.
//
//   • Props mirror a normal <textarea> (value, onChange, placeholder, etc.)
//   • Pass `members` — an array of { email, name, initials, avatarUrl }
//     (e.g. the merged roster from useTeamMembers).
//   • Pass `onMentionsChange` to receive the resolved list of emails on every
//     change — the caller persists this alongside `value` when posting.
//
// Mention syntax follows the email-prefix style (`@firstname.lastname`) so
// it round-trips with what users type in chat. The picker matches against
// the email prefix AND the display name so users can search for either.
// On selection, the typed `@query` is replaced with `@<email-prefix>` and
// the email is added to the resolved set.
//
// Email resolution is re-run on EVERY change (not just on selection) so:
//   • If the user types a full `@firstname.lastname` without the picker,
//     the email is still resolved.
//   • If the user deletes their mention with backspace, the email drops out
//     of the resolved set automatically.
// This keeps `mentionEmails` always in sync with what's visible in `value`.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Avatar from './Avatar';

// Email prefix accepts letters, digits, dots, dashes, underscores. Stops at
// whitespace or punctuation that's clearly outside an email-like token.
// Example match: "@laura.llopislopez" → group[1] = "laura.llopislopez"
const MENTION_TOKEN_RE = /(^|\s)@([a-z0-9._-]+)/gi;

function emailPrefix(email) {
  const e = String(email || '');
  const at = e.indexOf('@');
  return (at > 0 ? e.slice(0, at) : e).toLowerCase();
}

// Resolve all `@token` occurrences in `text` against the roster, returning
// the deduped set of matching emails. Uses prefix-match against the email
// (case-insensitive). Falls through silently for unknown handles.
export function resolveMentionEmails(text, members) {
  if (!text || !Array.isArray(members) || members.length === 0) return [];
  const byPrefix = new Map();
  for (const m of members) {
    const e = String(m?.email || '').toLowerCase();
    if (!e) continue;
    byPrefix.set(emailPrefix(e), e);
  }
  const found = new Set();
  let match;
  MENTION_TOKEN_RE.lastIndex = 0;
  while ((match = MENTION_TOKEN_RE.exec(text)) !== null) {
    const handle = String(match[2] || '').toLowerCase();
    if (!handle) continue;
    if (byPrefix.has(handle)) found.add(byPrefix.get(handle));
  }
  return [...found];
}

// Find the active `@query` token under the caret. Returns the start index in
// `text`, the typed query (without the @), or null if the caret isn't inside
// a mention-eligible token.
function getActiveQuery(text, caretIndex) {
  if (caretIndex === 0) return null;
  // Walk back from the caret to find an `@` not preceded by alphanumeric.
  let i = caretIndex - 1;
  while (i >= 0) {
    const ch = text.charAt(i);
    if (ch === '@') {
      // Validate the char before is whitespace, start, or punctuation.
      const before = i === 0 ? '' : text.charAt(i - 1);
      if (i === 0 || /\s/.test(before) || /[.,;:!?()[\]{}<>]/.test(before)) {
        return { start: i, query: text.slice(i + 1, caretIndex) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    // Cap the search distance — picker queries above 30 chars are clearly
    // not what the user is doing.
    if (caretIndex - i > 30) return null;
    i -= 1;
  }
  return null;
}

const MentionTextarea = ({
  value,
  onChange,
  onMentionsChange,
  members = [],
  placeholder,
  rows = 1,
  minHeight = 30,
  maxHeight = 80,
  style,
  onKeyDown: onKeyDownProp,
  disabled,
  ...rest
}) => {
  const textareaRef = useRef(null);
  const wrapperRef = useRef(null);
  const [activeQuery, setActiveQuery] = useState(null); // { start, query }
  const [hoverIdx, setHoverIdx] = useState(0);

  // Re-derive mentions on every value change so the resolved set always
  // matches what's actually in the textarea.
  useEffect(() => {
    if (typeof onMentionsChange !== 'function') return;
    const next = resolveMentionEmails(value || '', members);
    onMentionsChange(next);
    // We intentionally depend on value only — `members` is stable from the
    // hook and re-running on its identity change would just churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Filter the roster against the active query. Match either the email
  // prefix OR the display name so "lau" surfaces "Laura Llopis" and
  // "laura.llopis" alike. Cap the dropdown to 8 hits to keep the popup tight.
  const matches = useMemo(() => {
    if (!activeQuery) return [];
    const q = String(activeQuery.query || '').toLowerCase();
    if (!q) {
      // Show top 8 by name as a starter list when the user just typed `@`.
      return members.slice(0, 8);
    }
    const out = [];
    for (const m of members) {
      const e = String(m?.email || '').toLowerCase();
      if (!e) continue;
      const prefix = emailPrefix(e);
      const name = String(m?.name || '').toLowerCase();
      if (prefix.startsWith(q) || prefix.includes(q) || name.includes(q)) {
        out.push(m);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [activeQuery, members]);

  // Reset hover index whenever the match list changes shape.
  useEffect(() => { setHoverIdx(0); }, [matches.length, activeQuery?.query]);

  const closePicker = useCallback(() => setActiveQuery(null), []);

  const handleChange = useCallback((e) => {
    onChange?.(e);
    const ta = e.target;
    const caret = ta.selectionStart || 0;
    const next = getActiveQuery(ta.value, caret);
    setActiveQuery(next);
  }, [onChange]);

  const handleSelectionChange = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart || 0;
    const next = getActiveQuery(ta.value, caret);
    setActiveQuery(next);
  }, []);

  const insertMention = useCallback((member) => {
    const ta = textareaRef.current;
    if (!ta || !activeQuery) return;
    const prefix = emailPrefix(member.email);
    const before = (value || '').slice(0, activeQuery.start);
    const afterStart = activeQuery.start + 1 + activeQuery.query.length;
    const after = (value || '').slice(afterStart);
    // Add a trailing space so the next keystroke isn't part of the token.
    const inserted = `@${prefix} `;
    const nextValue = `${before}${inserted}${after}`;
    // Synthesise an event so the caller's onChange receives a real-shaped
    // payload (some listeners read e.target.value).
    const fakeEvent = { target: { value: nextValue }, currentTarget: { value: nextValue } };
    onChange?.(fakeEvent);
    closePicker();
    // Move caret to just after the inserted mention.
    requestAnimationFrame(() => {
      const newCaret = before.length + inserted.length;
      try { ta.focus(); ta.setSelectionRange(newCaret, newCaret); } catch {}
    });
  }, [activeQuery, value, onChange, closePicker]);

  const handleKeyDown = useCallback((e) => {
    if (activeQuery && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHoverIdx(i => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHoverIdx(i => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // Take the highlighted match. Block the default so the caller's
        // submit-on-enter handler doesn't fire while we're picking.
        e.preventDefault();
        e.stopPropagation();
        insertMention(matches[hoverIdx] || matches[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
        return;
      }
    }
    if (typeof onKeyDownProp === 'function') onKeyDownProp(e);
  }, [activeQuery, matches, hoverIdx, insertMention, closePicker, onKeyDownProp]);

  // Close on outside click.
  useEffect(() => {
    if (!activeQuery) return;
    const onDoc = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) closePicker();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [activeQuery, closePicker]);

  const taStyle = {
    flex: 1, minHeight, maxHeight, borderRadius: 10,
    border: '1px solid var(--border, #e8e8e8)', padding: '6px 10px',
    fontSize: 11, outline: 'none', resize: 'vertical',
    fontFamily: 'inherit', lineHeight: 1.4,
    background: 'var(--surface, white)',
    color: 'var(--text, #1b1b1b)',
    ...style,
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <textarea
        ref={textareaRef}
        value={value || ''}
        onChange={handleChange}
        onKeyUp={handleSelectionChange}
        onClick={handleSelectionChange}
        onBlur={() => { /* leave activeQuery alone — outside-click handler closes */ }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        style={taStyle}
        {...rest}
      />
      {activeQuery && matches.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention suggestions"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            zIndex: 1200,
            minWidth: 240,
            maxWidth: 320,
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--surface, white)',
            border: '1px solid var(--border, #e8e8e8)',
            borderRadius: 10,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            padding: 4,
          }}
        >
          {matches.map((m, idx) => {
            const active = idx === hoverIdx;
            return (
              <button
                key={m.email}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                onMouseEnter={() => setHoverIdx(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: 'none',
                  background: active ? 'var(--surface-2, #f7f5f2)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text, #1b1b1b)',
                  transition: 'background .12s',
                }}
              >
                <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {m.name || emailPrefix(m.email)}
                  </div>
                  <div style={{
                    fontSize: 10, color: 'var(--text-muted, #9e9e9e)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    @{emailPrefix(m.email)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MentionTextarea;
