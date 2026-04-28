// ── CreateFeedbackModal ─────────────────────────────────────────────────
// New-feedback composer. Title + issue (required), proposed resolution
// (optional), priority + type + category, and a screenshot field that
// supports three input methods:
//   • paste from clipboard (Cmd/Ctrl+V anywhere in the modal)
//   • drag-and-drop onto the screenshot zone
//   • click the zone to open a file picker
//
// Screenshot is converted to a base64 data URI client-side and posted
// inline with the request body. Hard-capped at 2 MB raw (≈ 2.7 MB after
// base64 encoding) to keep DB writes snappy and matches the server's
// MAX_SCREENSHOT_BYTES.
// ────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_RAW_BYTES = 2 * 1024 * 1024; // 2 MB before base64 encoding

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

export default function CreateFeedbackModal({ onClose, onSubmit, currentUser }) {
  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');
  const [proposedResolution, setProposedResolution] = useState('');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('bug');
  const [category, setCategory] = useState('Queue');
  const [screenshot, setScreenshot] = useState(null);   // data URI
  const [screenshotName, setScreenshotName] = useState(null);
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

  // ── Paste image from clipboard ─────────────────────────────────────────
  // Listens at document level when the modal is open so the user can paste
  // without focusing the screenshot zone first. Stops at the first image
  // item found.
  useEffect(() => {
    const onPaste = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            await ingestFile(file);
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingestFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported');
      return;
    }
    if (file.size > MAX_RAW_BYTES) {
      setError(`Screenshot too large (max ${(MAX_RAW_BYTES / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    try {
      const dataUri = await fileToDataUri(file);
      setScreenshot(dataUri);
      setScreenshotName(file.name || 'pasted-image');
    } catch (err) {
      setError(err?.message || 'Could not read image');
    }
  }, []);

  const onFilePicked = (e) => {
    const f = e.target.files?.[0];
    if (f) ingestFile(f);
    e.target.value = ''; // allow re-selecting the same file
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDropActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) ingestFile(f);
  };
  const onDragOver = (e) => { e.preventDefault(); setDropActive(true); };
  const onDragLeave = () => setDropActive(false);

  const removeScreenshot = () => { setScreenshot(null); setScreenshotName(null); };

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
        screenshot,
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

          {/* Screenshot zone — same dropzone but with preview-or-empty
              swap, gradient hover, and clearer copy. */}
          <div style={fieldCol}>
            <label style={fieldLabel}>
              Screenshot{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                — paste from clipboard, drag a file, or click to pick
              </span>
            </label>
            {screenshot ? (
              <div style={screenshotPreview}>
                <img src={screenshot} alt={screenshotName || 'Screenshot'} style={{ display: 'block', maxWidth: '100%', maxHeight: 240, borderRadius: 8, border: '1px solid var(--border)' }}/>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <i className="bi-image" style={{ fontSize: 12, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{screenshotName || 'Pasted image'}</span>
                  </span>
                  <button type="button" onClick={removeScreenshot} disabled={submitting} style={removeBtn}>
                    <i className="bi-trash" style={{ fontSize: 11 }} /> Remove
                  </button>
                </div>
              </div>
            ) : (
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
                  background: dropActive
                    ? 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)'
                    : 'var(--surface-2)',
                  borderColor: dropActive ? '#7c3aed' : 'var(--border)',
                  borderStyle: dropActive ? 'solid' : 'dashed',
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: dropActive ? '#7c3aed' : 'var(--surface)',
                  color: dropActive ? 'white' : '#7c3aed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: dropActive ? 'none' : '1px solid var(--border)',
                  transition: 'all .12s',
                }}>
                  <i className={dropActive ? 'bi-check-lg' : 'bi-clipboard-plus'} style={{ fontSize: 17 }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
                  {dropActive ? 'Drop to attach' : 'Paste, drop, or click to attach a screenshot'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PNG · JPG · GIF — up to 2 MB</div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onFilePicked} style={{ display: 'none' }} />
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
const screenshotPreview = { padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' };
const removeBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all .12s' };
const errorBanner = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 600, border: '1px solid #fca5a5' };
const iconBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'all .12s' };
const ghostBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', fontSize: 12, fontWeight: 800, boxShadow: '0 2px 8px rgba(124,58,237,0.25)' };
