// ── HrHubComposer ───────────────────────────────────────────────────────────
// Slack-style comment input for the HR Hub detail panel.
//
//   • ≥14 px font (rule 11)
//   • @-mention autocomplete from the team roster — typing `@` opens a
//     popup of matching members; arrow keys + Enter or click to insert
//   • Emoji picker (a small curated grid; no external dep so the bundle
//     stays small and the picker shows up instantly)
//   • Drag/drop + paste attachments using the same shape as the Feedback
//     and the create-modal flows
//   • Cmd/Ctrl+Enter submits; Esc clears the draft
//
// Optimistic UX: the parent appends the returned comment to the thread
// when our `onSubmit` resolves; we clear local state on success.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MEMBERS } from '../../../src/data/members';

const QUICK_EMOJIS = [
  '👍','👎','✅','❌','🎉','🙏','💡','🔥','⚠️','🚨',
  '👀','✋','🙌','🤝','💬','📌','🛠️','🚀','📝','📎',
  '😀','😅','🤔','😬','😮','😎','🥳','😢','😡','❤️',
];

const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function compressImage(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onerror = () => resolve(null);
    r.onload = ev => {
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
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const isPng = /^data:image\/png/i.test(original);
          const out = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
          resolve(out.length < original.length ? out : original);
        } catch { resolve(original); }
      };
      img.src = original;
    };
    r.readAsDataURL(file);
  });
}

export default function HrHubComposer({ onSubmit }) {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionState, setMentionState] = useState(null);   // { query, anchor, options, highlighted }
  const taRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Mention autocomplete ─────────────────────────────────────────────────
  // Triggered by typing `@` after a whitespace boundary (or at line start).
  // Tracks the cursor position so we can replace the partial token cleanly.
  const updateMentionFromCursor = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const slice = body.slice(0, cursor);
    const m = /(^|\s)@([a-zA-Z0-9._-]{0,80})$/.exec(slice);
    if (!m) { setMentionState(null); return; }
    const query = m[2].toLowerCase();
    const anchor = cursor - m[0].length + (m[1] ? m[1].length : 0);    // index of '@'
    const options = MEMBERS
      .filter(mem => {
        if (!query) return true;
        const lc = mem.name.toLowerCase();
        const local = mem.email.split('@')[0];
        return lc.includes(query) || local.includes(query);
      })
      .slice(0, 6);
    setMentionState({ query, anchor, options, highlighted: 0 });
  }, [body]);

  useEffect(() => { updateMentionFromCursor(); }, [body, updateMentionFromCursor]);

  const insertMention = useCallback((member) => {
    if (!mentionState) return;
    const before = body.slice(0, mentionState.anchor);
    const after = body.slice(taRef.current?.selectionStart ?? body.length);
    const localpart = (member.email || '').split('@')[0];
    const next = `${before}@${localpart} ${after}`;
    setBody(next);
    setMentionState(null);
    requestAnimationFrame(() => {
      const newCursor = (before + '@' + localpart + ' ').length;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(newCursor, newCursor);
    });
  }, [body, mentionState]);

  // ── Attachments ──────────────────────────────────────────────────────────
  const addFiles = useCallback(async (files) => {
    setError(null);
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    const additions = [];
    let total = attachments.reduce((acc, a) => acc + (a.dataUri?.length || 0), 0);
    for (const f of incoming) {
      if (attachments.length + additions.length >= MAX_ATTACHMENTS) {
        setError(`Up to ${MAX_ATTACHMENTS} attachments.`);
        break;
      }
      const isImage = f.type?.startsWith('image/');
      const isVideo = ACCEPTED_VIDEO_TYPES.has(f.type) || f.type?.startsWith('video/');
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      if (!isImage && !isVideo && !isPdf) continue;
      if (isImage && f.size > MAX_IMAGE_BYTES * 4) { setError(`"${f.name}" too large`); continue; }
      if (isVideo && f.size > MAX_VIDEO_BYTES) { setError(`"${f.name}" exceeds video limit`); continue; }
      if (isPdf && f.size > MAX_PDF_BYTES) { setError(`"${f.name}" exceeds PDF limit (${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB)`); continue; }
      const dataUri = isImage ? (await compressImage(f)) || (await fileToDataUri(f)) : await fileToDataUri(f);
      total += dataUri.length;
      if (total > MAX_TOTAL_PAYLOAD_BYTES) { setError('Total payload too large'); break; }
      const kind = isImage ? 'image' : isVideo ? 'video' : 'pdf';
      additions.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, dataUri, name: f.name });
    }
    if (additions.length) setAttachments(prev => [...prev, ...additions]);
  }, [attachments]);

  // Document-level paste while composer is mounted.
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    const text = body.trim();
    if (!text && attachments.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        body: text,
        attachments: attachments.map(a => ({ kind: a.kind, dataUri: a.dataUri, name: a.name })),
      });
      setBody('');
      setAttachments([]);
      setShowEmoji(false);
    } catch (err) {
      setError(err?.message || 'Could not post comment');
    } finally {
      setSubmitting(false);
    }
  }, [body, attachments, onSubmit]);

  const onKey = (e) => {
    if (mentionState && mentionState.options.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionState(s => ({ ...s, highlighted: Math.min(s.highlighted + 1, s.options.length - 1) })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionState(s => ({ ...s, highlighted: Math.max(s.highlighted - 1, 0) })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionState.options[mentionState.highlighted]); return; }
      if (e.key === 'Escape')   { e.preventDefault(); setMentionState(null); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { setBody(''); setAttachments([]); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={onKey}
        rows={2}
        placeholder="Add a comment… use @first.last to tag someone (they'll start following)."
        style={{
          width: '100%', minHeight: 64, padding: '10px 12px',
          fontSize: 14, lineHeight: 1.55,
          border: '1px solid var(--border)', borderRadius: 12,
          outline: 'none', resize: 'vertical', fontFamily: 'inherit',
          background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box',
        }}
      />

      {/* Mention popup */}
      {mentionState && mentionState.options.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
          minWidth: 240, padding: 4, zIndex: 50,
        }}>
          {mentionState.options.map((m, idx) => (
            <button
              key={m.email}
              onMouseDown={e => { e.preventDefault(); insertMention(m); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 8px',
                border: 'none', background: idx === mentionState.highlighted ? '#f3f3f3' : 'transparent',
                borderRadius: 6, textAlign: 'left', cursor: 'pointer', fontSize: 13,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: '#6b3fa0', color: 'white', fontSize: 10, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{(m.name || '').split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}</span>
              <span style={{ fontWeight: 600 }}>{m.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{m.email}</span>
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div style={{
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
          gap: 6,
        }}>
          {attachments.map(a => (
            <div key={a.id} style={{
              position: 'relative', aspectRatio: '4 / 3',
              borderRadius: 6, overflow: 'hidden',
              border: '1px solid var(--border)', background: 'var(--surface-2)',
            }}>
              {a.kind === 'image' ? (
                <img src={a.dataUri} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : a.kind === 'video' ? (
                <video src={a.dataUri} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: 4, gap: 2,
                  color: '#b91c1c',
                  textAlign: 'center',
                }}>
                  <i className="bi bi-filetype-pdf" style={{ fontSize: 22 }} />
                  <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={a.name}>{a.name || 'document.pdf'}</span>
                </div>
              )}
              <button
                onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                aria-label="Remove"
                style={{
                  position: 'absolute', top: 2, right: 2,
                  width: 18, height: 18, borderRadius: '50%',
                  border: 'none', background: 'rgba(0,0,0,0.55)',
                  color: 'white', fontSize: 10, cursor: 'pointer',
                }}
              ><i className="bi bi-x" /></button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 6, padding: '6px 10px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>{error}</div>
      )}

      <div style={{
        marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach"
          style={iconBtnStyle}
          title="Attach (or drag/paste)"
        ><i className="bi bi-paperclip" /></button>
        <button
          type="button"
          onClick={() => setShowEmoji(p => !p)}
          aria-label="Emoji"
          style={iconBtnStyle}
          title="Insert emoji"
        ><i className="bi bi-emoji-smile" /></button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => addFiles(e.target.files)}
        />
        <div style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>
          {body && /\@/.test(body) ? 'Mentioned users will be added as followers.' : 'Cmd/Ctrl + Enter to send'}
        </div>
        <button
          onClick={submit}
          disabled={submitting || (!body.trim() && attachments.length === 0)}
          style={{
            padding: '7px 16px', borderRadius: 999,
            border: 'none',
            background: (submitting || (!body.trim() && attachments.length === 0)) ? '#9e9e9e' : '#1b1b1b',
            color: 'white', fontSize: 13, fontWeight: 600,
            cursor: (submitting || (!body.trim() && attachments.length === 0)) ? 'not-allowed' : 'pointer',
          }}
        >{submitting ? 'Sending…' : 'Send'}</button>
      </div>

      {showEmoji && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', right: 60,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
          padding: 8, zIndex: 50,
          width: 220,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
            {QUICK_EMOJIS.map(em => (
              <button
                key={em}
                onClick={() => {
                  const ta = taRef.current;
                  const cursor = ta?.selectionStart ?? body.length;
                  setBody(body.slice(0, cursor) + em + body.slice(cursor));
                  setShowEmoji(false);
                  requestAnimationFrame(() => {
                    ta?.focus();
                    const c = cursor + em.length;
                    ta?.setSelectionRange(c, c);
                  });
                }}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 18, padding: 4, borderRadius: 4,
                }}
              >{em}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtnStyle = {
  border: '1px solid var(--border)', background: 'var(--surface)',
  width: 32, height: 32, borderRadius: 8,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14,
};
