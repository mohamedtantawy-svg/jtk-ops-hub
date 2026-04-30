// ── CreateFeedbackModal ─────────────────────────────────────────────────
// New-feedback composer. Title + issue (required), proposed resolution
// (optional), priority + type + category, and an attachments field that
// accepts MULTIPLE screenshots and/or short video clips via:
//   • paste from clipboard (Cmd/Ctrl+V anywhere in the modal)
//   • drag-and-drop onto the attachments zone (multiple files at once)
//   • click the zone to open a file picker (multi-select)
//
// Each attachment is converted to a base64 data URI and posted inline as
// `{ kind: 'image' | 'video', dataUri, name }`. Images are compressed in
// the browser (max 1600px, JPEG q=0.85) so most screenshots end up well
// under 1 MB. Videos pass through unmodified — capped at 10 MB raw so
// short repro clips fit but long recordings get rejected client-side
// rather than failing on the server's 12 MB hard cap.
// ────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;     // 5 MB raw before compression
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;    // 10 MB raw — short clip ceiling
const MAX_ATTACHMENTS = 5;
// Total post-compression payload guard so a submission never exceeds the
// server's 30 MB cap. Roughly base64-overhead aware (4/3).
const MAX_TOTAL_PAYLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

const PRIORITIES = [
  { value: 'low',      label: 'Low',      color: '#9b928a', bg: '#f7f5f2' },
  { value: 'medium',   label: 'Medium',   color: '#0369a1', bg: '#e0f2fe' },
  { value: 'high',     label: 'High',     color: '#d97706', bg: '#fff8e6' },
  { value: 'critical', label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
];

const TYPES = [
  { value: 'bug',         label: 'Bug',         icon: 'bi-bug',          color: '#dc2626', bg: '#fef2f2' },
  { value: 'improvement', label: 'Improvement', icon: 'bi-stars',        color: '#7c3aed', bg: '#f3eff8' },
  { value: 'question',    label: 'Question',    icon: 'bi-question-circle',color: '#0369a1', bg: '#e0f2fe' },
];

const CATEGORIES = ['Queue', 'Briefing', 'Team', 'Announcements', 'Calendar', 'Settings', 'Auth', 'Performance', 'Other'];

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

// Resize + re-encode an image so heavy screenshots (Retina captures, photos)
// don't blow past the per-attachment cap. Falls back to the raw data URI on
// any error so we never block the user from submitting.
function compressImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = (ev) => {
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
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const isPng = /^data:image\/png/i.test(original);
          const out = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
          resolve(out.length < original.length ? out : original);
        } catch (_) {
          resolve(original);
        }
      };
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}

export default function CreateFeedbackModal({ onClose, onSubmit, currentUser }) {
  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');
  const [proposedResolution, setProposedResolution] = useState('');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('bug');
  const [category, setCategory] = useState('Queue');
  // Each attachment: { id, kind: 'image' | 'video', dataUri, name }
  // The id is a client-only nonce so the gallery's keyed map stays stable
  // when the user removes one.
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef(null);
  const titleInputRef = useRef(null);

  // ── Focus on mount ──────────────────────────────────────────────────────
  // Bug fix 2026-04-28: this used to live in the same effect as the Esc
  // handler with deps [onClose, submitting]. Every time the parent
  // re-rendered (e.g. useFeedback's 30s poll, an optimistic vote landing
  // elsewhere) the `onClose` arrow function reference changed, the effect
  // re-ran, the setTimeout re-fired, and titleInputRef.focus() yanked
  // focus away from whatever field the user was typing in. Split into a
  // single mount-time autofocus + a separate Esc handler that uses a ref
  // so onClose changes don't re-bind the listener.
  useEffect(() => {
    const t = setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // ── Esc-to-close ────────────────────────────────────────────────────────
  // Latest-onClose stays available via a ref so the keydown listener never
  // needs to be torn down + rebound on parent re-renders.
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  useEffect(() => { onCloseRef.current = onClose; submittingRef.current = submitting; });
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !submittingRef.current) onCloseRef.current?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Paste image / video from clipboard ────────────────────────────────
  // Listens at document level when the modal is open so the user can paste
  // without focusing the attachments zone first. Iterates every paste item
  // (clipboard can carry several at once on macOS) so a single Cmd+V can
  // drop multiple screenshots.
  useEffect(() => {
    const onPaste = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const it of items) {
        if (it.kind === 'file' && it.type && (it.type.startsWith('image/') || it.type.startsWith('video/'))) {
          const file = it.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        await ingestFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ingest a single file. Returns the new attachment object, or null if it
  // was rejected (with `error` already set so the caller knows to bail).
  const ingestOne = useCallback(async (file) => {
    if (!file) return null;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      setError(`"${file.name || 'attachment'}" — only images or short video clips are supported`);
      return null;
    }
    if (isImage && file.size > MAX_IMAGE_BYTES) {
      setError(`Image "${file.name || 'pasted'}" too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB before compression)`);
      return null;
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      setError(`Video "${file.name || 'clip'}" too large (max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB)`);
      return null;
    }
    if (isVideo && !ACCEPTED_VIDEO_TYPES.has(file.type)) {
      setError(`Video format "${file.type}" not supported — please use MP4 or WebM`);
      return null;
    }
    try {
      const dataUri = isImage
        ? (await compressImageFile(file)) || (await fileToDataUri(file))
        : await fileToDataUri(file);
      return {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: isImage ? 'image' : 'video',
        dataUri,
        name: file.name || (isVideo ? 'clip' : 'image'),
      };
    } catch (err) {
      setError(err?.message || 'Could not read attachment');
      return null;
    }
  }, []);

  const ingestFiles = useCallback(async (files) => {
    setError(null);
    if (!files || files.length === 0) return;
    // Compute remaining slots up-front so we can short-circuit the user
    // before chewing through compression on files that wouldn't fit.
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_ATTACHMENTS} attachments — remove one before adding more`);
      return;
    }
    const slice = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      setError(`Only added the first ${remaining} — limit is ${MAX_ATTACHMENTS} attachments per submission`);
    }
    const next = [];
    let runningSize = attachments.reduce((s, a) => s + (a.dataUri?.length || 0), 0);
    for (const f of slice) {
      const att = await ingestOne(f);
      if (!att) return;
      runningSize += att.dataUri.length;
      if (runningSize > MAX_TOTAL_PAYLOAD_BYTES) {
        setError(`Total attachment size exceeds ${Math.round(MAX_TOTAL_PAYLOAD_BYTES / 1024 / 1024)} MB — remove or shorten an attachment`);
        return;
      }
      next.push(att);
    }
    setAttachments(prev => [...prev, ...next]);
  }, [attachments, ingestOne]);

  const onFilePicked = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) ingestFiles(files);
    e.target.value = ''; // allow re-selecting the same file
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) ingestFiles(files);
  };
  const onDragOver = (e) => { e.preventDefault(); setDropActive(true); };
  const onDragLeave = () => setDropActive(false);

  const removeAttachment = (id) => setAttachments(prev => prev.filter(a => a.id !== id));

  // ── Submit ─────────────────────────────────────────────────────────────
  const canSubmit = title.trim().length > 0 && issue.trim().length > 0 && !submitting;
  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit?.({
        title: title.trim(),
        issue: issue.trim(),
        proposedResolution: proposedResolution.trim() || null,
        priority,
        type,
        category,
        // Strip the client-only `id` before posting; the server only persists
        // kind / dataUri / name. Keep `screenshot` populated with the first
        // image (if any) so legacy renderers — old client builds mid-deploy,
        // anything still reading the screenshot column — show something.
        screenshot: attachments.find(a => a.kind === 'image')?.dataUri || null,
        attachments: attachments.map(({ kind, dataUri, name }) => ({ kind, dataUri, name })),
      });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not submit');
      setSubmitting(false);
    }
  };

  const typeMeta = TYPES.find(t => t.value === type) || TYPES[0];
  const priorityMeta = PRIORITIES.find(p => p.value === priority) || PRIORITIES[1];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      style={overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <form onSubmit={handleSubmit} style={modal}>
        {/* Inline responsive style — the side-by-side issue/proposed grid
            collapses to a single column under 700px. */}
        <style>{`
          .feedback-grid-2 { display: grid; grid-template-columns: 1.05fr 1fr; gap: 14px; align-items: start; }
          @media (max-width: 720px) { .feedback-grid-2 { grid-template-columns: 1fr; } }
          .feedback-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
          .feedback-input:focus { border-color: #7c3aed !important; box-shadow: 0 0 0 3px rgba(124,58,237,0.15); }
          .feedback-textarea:focus { border-color: #7c3aed !important; box-shadow: 0 0 0 3px rgba(124,58,237,0.12); }
          .feedback-pill-btn:hover:not(.active) { background: var(--surface-2) !important; }
          .feedback-section-card { padding: 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border-light); }
        `}</style>

        {/* Header — gradient accent strip + denser pill row beneath */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
              color: '#7c3aed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <i className="bi-lightbulb-fill" style={{ fontSize: 19 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div id="feedback-modal-title" style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>Report an issue or idea</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                <span style={{ color: typeMeta.color, fontWeight: 600 }}>{typeMeta.label}</span>
                <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: priorityMeta.color, fontWeight: 600 }}>{priorityMeta.label} priority</span>
                <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{category}</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => !submitting && onClose?.()} aria-label="Close" style={iconBtn}>
            <i className="bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        {/* Body */}
        <div style={body}>
          {/* Pill controls — tighter, single row when there's space */}
          <div style={pillCard}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <label style={fieldLabel}>Type</label>
                <div className="feedback-pill-row" style={{ marginTop: 4 }}>
                  {TYPES.map(t => {
                    const active = type === t.value;
                    return (
                      <button key={t.value} type="button"
                        className={`feedback-pill-btn${active ? ' active' : ''}`}
                        onClick={() => setType(t.value)}
                        style={{
                          ...pillBtn,
                          background: active ? t.bg : 'var(--surface)',
                          color: active ? t.color : 'var(--text-muted)',
                          borderColor: active ? t.color : 'var(--border)',
                        }}
                      >
                        <i className={t.icon} style={{ fontSize: 11 }} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ flex: '1 1 230px', minWidth: 200 }}>
                <label style={fieldLabel}>Priority</label>
                <div className="feedback-pill-row" style={{ marginTop: 4 }}>
                  {PRIORITIES.map(p => {
                    const active = priority === p.value;
                    return (
                      <button key={p.value} type="button"
                        className={`feedback-pill-btn${active ? ' active' : ''}`}
                        onClick={() => setPriority(p.value)}
                        style={{
                          ...pillBtn,
                          background: active ? p.bg : 'var(--surface)',
                          color: active ? p.color : 'var(--text-muted)',
                          borderColor: active ? p.color : 'var(--border)',
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ flex: '0 0 170px', minWidth: 160 }}>
                <label style={fieldLabel}>Area</label>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...selectInput, marginTop: 4 }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Title — label + counter on the same line */}
          <div style={fieldCol}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <label style={fieldLabel}>Title <span style={req}>*</span></label>
              <span style={charCount}>{title.length} / 200</span>
            </div>
            <input
              ref={titleInputRef}
              className="feedback-input"
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 200))}
              placeholder="Short summary — e.g. 'Queue counts wrong on TL view'"
              maxLength={200}
              style={textInput}
              disabled={submitting}
            />
          </div>

          {/* Issue + proposed resolution side by side at width >= 720px */}
          <div className="feedback-grid-2">
            <div style={fieldCol}>
              <label style={fieldLabel}>What's the issue? <span style={req}>*</span></label>
              <textarea
                className="feedback-textarea"
                value={issue}
                onChange={e => setIssue(e.target.value)}
                placeholder="What did you see, what did you expect, how do I reproduce it?"
                rows={6}
                style={textArea}
                disabled={submitting}
              />
            </div>
            <div style={fieldCol}>
              <label style={fieldLabel}>
                Proposed resolution{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea
                className="feedback-textarea"
                value={proposedResolution}
                onChange={e => setProposedResolution(e.target.value)}
                placeholder="If you've got an idea for the fix or improvement, share it here."
                rows={6}
                style={textArea}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Attachments zone — paste / drop / pick multiple screenshots
              and short video clips. Images are compressed in the browser
              before upload; videos pass through unmodified. */}
          <div style={fieldCol}>
            <label style={fieldLabel}>
              Screenshots &amp; clips{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                — paste, drag, or click to attach{attachments.length > 0 ? ` · ${attachments.length} of ${MAX_ATTACHMENTS}` : ` · up to ${MAX_ATTACHMENTS}`}
              </span>
            </label>
            {attachments.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 8 }}>
                {attachments.map((a, idx) => (
                  <div key={a.id} style={attachmentTile}>
                    {a.kind === 'image' ? (
                      <img src={a.dataUri} alt={a.name || `Attachment ${idx + 1}`}
                        style={{ display: 'block', width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    ) : (
                      <video src={a.dataUri} controls preload="metadata"
                        style={{ display: 'block', width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', background: '#000' }} />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', minWidth: 0 }}>
                        <i className={a.kind === 'video' ? 'bi-camera-video' : 'bi-image'} style={{ fontSize: 11, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || (a.kind === 'video' ? 'clip' : 'image')}</span>
                      </span>
                      <button type="button" onClick={() => removeAttachment(a.id)} disabled={submitting}
                        title="Remove"
                        style={{ ...removeBtn, padding: '3px 7px', fontSize: 10 }}>
                        <i className="bi-x-lg" style={{ fontSize: 9 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {attachments.length < MAX_ATTACHMENTS && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                style={{
                  ...dropZone,
                  padding: attachments.length > 0 ? '12px 14px' : '20px 14px',
                  background: dropActive
                    ? 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)'
                    : 'var(--surface-2)',
                  borderColor: dropActive ? '#7c3aed' : 'var(--border)',
                  borderStyle: dropActive ? 'solid' : 'dashed',
                }}
              >
                <div style={{
                  width: attachments.length > 0 ? 30 : 40, height: attachments.length > 0 ? 30 : 40, borderRadius: '50%',
                  background: dropActive ? '#7c3aed' : 'var(--surface)',
                  color: dropActive ? 'white' : '#7c3aed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: dropActive ? 'none' : '1px solid var(--border)',
                  transition: 'all .12s',
                }}>
                  <i className={dropActive ? 'bi-check-lg' : (attachments.length > 0 ? 'bi-plus-lg' : 'bi-clipboard-plus')} style={{ fontSize: attachments.length > 0 ? 13 : 17 }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
                  {dropActive
                    ? 'Drop to attach'
                    : (attachments.length > 0 ? 'Add another screenshot or clip' : 'Paste, drop, or click to attach screenshots / clips')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  PNG · JPG · GIF (up to {Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB) · MP4 · WebM (up to {Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB)
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={onFilePicked} style={{ display: 'none' }} />
          </div>

          {error && (
            <div style={errorBanner}>
              <i className="bi-exclamation-triangle-fill" style={{ fontSize: 12 }} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footer}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <i className="bi-person" style={{ fontSize: 12 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Submitting as{' '}<strong style={{ color: 'var(--text)' }}>{currentUser?.name || currentUser?.email || 'you'}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => !submitting && onClose?.()} disabled={submitting} style={ghostBtn}>Cancel</button>
            <button type="submit" disabled={!canSubmit} style={{
              ...primaryBtn,
              opacity: canSubmit ? 1 : 0.55,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}>
              <i className={submitting ? 'bi-arrow-clockwise spin' : 'bi-send-fill'} style={{ fontSize: 12 }} />
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Styles (kept inline to match the rest of the modals — same layout
// language as CreateRequestModal / CreateProjectModal) ─────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(28, 25, 23, 0.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  backdropFilter: 'blur(4px)',
};
const modal = {
  width: 'min(820px, 100%)', maxHeight: '92vh',
  background: 'var(--surface)', color: 'var(--text)',
  borderRadius: 18, boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid var(--border)',
};
const header = { padding: '14px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)' };
const body   = { padding: '18px 20px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 };
const footer = { padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--surface-2)', flexShrink: 0 };
const fieldCol = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 };
const fieldLabel = { fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' };
const req = { color: '#dc2626', fontWeight: 800 };
const charCount = { fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' };
const textInput = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--surface)', color: 'var(--text)', outline: 'none', transition: 'border-color .12s, box-shadow .12s' };
const textArea  = { ...textInput, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55, minHeight: 110 };
const selectInput = { ...textInput, cursor: 'pointer', height: 38 };
const pillBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 128, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid', transition: 'all .12s', whiteSpace: 'nowrap' };
const pillCard = { padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-light)' };
const dropZone = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '20px 14px', border: '2px dashed', borderRadius: 12, cursor: 'pointer', textAlign: 'center', transition: 'all .12s' };
const attachmentTile = { padding: 8, border: '1px solid var(--border-light)', borderRadius: 10, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', minWidth: 0 };
const removeBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all .12s' };
const errorBanner = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 600, border: '1px solid #fca5a5' };
const iconBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'all .12s' };
const ghostBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', fontSize: 12, fontWeight: 800, boxShadow: '0 2px 8px rgba(124,58,237,0.25)' };
