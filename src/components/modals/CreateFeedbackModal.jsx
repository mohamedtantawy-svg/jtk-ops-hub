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

  // ── Focus + Esc-to-close ────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => titleInputRef.current?.focus(), 30);
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [onClose, submitting]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      style={overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <form onSubmit={handleSubmit} style={modal}>
        {/* Header */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f3eff8', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi-megaphone-fill" style={{ fontSize: 17 }} />
            </div>
            <div>
              <div id="feedback-modal-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Report an issue or idea</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tell us what's broken or what would make ops-hub better</div>
            </div>
          </div>
          <button type="button" onClick={() => !submitting && onClose?.()} aria-label="Close" style={iconBtn}>
            <i className="bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        {/* Body — scrolls when content overflows */}
        <div style={body}>
          {/* Type + priority + category — three pills inline */}
          <div style={fieldRow}>
            <div style={{ ...fieldCol, flex: '1 1 200px' }}>
              <label style={fieldLabel}>Type</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TYPES.map(t => {
                  const active = type === t.value;
                  return (
                    <button key={t.value} type="button" onClick={() => setType(t.value)}
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
            <div style={{ ...fieldCol, flex: '1 1 200px' }}>
              <label style={fieldLabel}>Priority</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PRIORITIES.map(p => {
                  const active = priority === p.value;
                  return (
                    <button key={p.value} type="button" onClick={() => setPriority(p.value)}
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
            <div style={{ ...fieldCol, flex: '1 1 160px' }}>
              <label style={fieldLabel}>Area</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={selectInput}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div style={fieldCol}>
            <label style={fieldLabel}>Title <span style={req}>*</span></label>
            <input
              ref={titleInputRef}
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 200))}
              placeholder="Short summary — e.g. 'Queue counts wrong on TL view'"
              maxLength={200}
              style={textInput}
              disabled={submitting}
            />
            <div style={charCount}>{title.length} / 200</div>
          </div>

          {/* Issue */}
          <div style={fieldCol}>
            <label style={fieldLabel}>What's the issue? <span style={req}>*</span></label>
            <textarea
              value={issue}
              onChange={e => setIssue(e.target.value)}
              placeholder="Describe what you saw, what you expected, and how to reproduce it."
              rows={5}
              style={textArea}
              disabled={submitting}
            />
          </div>

          {/* Proposed resolution */}
          <div style={fieldCol}>
            <label style={fieldLabel}>Proposed resolution <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              value={proposedResolution}
              onChange={e => setProposedResolution(e.target.value)}
              placeholder="If you have an idea for the fix or improvement, share it here."
              rows={3}
              style={textArea}
              disabled={submitting}
            />
          </div>

          {/* Screenshot */}
          <div style={fieldCol}>
            <label style={fieldLabel}>Screenshot <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional · paste, drop, or pick a file)</span></label>
            {screenshot ? (
              <div style={screenshotPreview}>
                <img src={screenshot} alt={screenshotName || 'Screenshot'} style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid var(--border)' }}/>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                    {screenshotName || 'Pasted image'}
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
                  background: dropActive ? '#f3eff8' : 'var(--surface-2)',
                  borderColor: dropActive ? '#7c3aed' : 'var(--border)',
                }}
              >
                <i className="bi-cloud-upload" style={{ fontSize: 24, color: 'var(--text-muted)' }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  Paste, drop, or click to attach a screenshot
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PNG, JPG, GIF · up to 2 MB</div>
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
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Submitted by <strong style={{ color: 'var(--text)' }}>{currentUser?.name || currentUser?.email || 'you'}</strong>
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
  backdropFilter: 'blur(2px)',
};
const modal = {
  width: 'min(720px, 100%)', maxHeight: '92vh',
  background: 'var(--surface)', color: 'var(--text)',
  borderRadius: 16, boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid var(--border)',
};
const header = { padding: '14px 18px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 };
const body   = { padding: '18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 };
const footer = { padding: '12px 18px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--surface-2)', flexShrink: 0 };
const fieldRow = { display: 'flex', flexWrap: 'wrap', gap: 12 };
const fieldCol = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 };
const fieldLabel = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const req = { color: '#dc2626', fontWeight: 700 };
const charCount = { fontSize: 10, color: 'var(--text-muted)', alignSelf: 'flex-end' };
const textInput = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--surface)', color: 'var(--text)', outline: 'none', transition: 'border-color .12s' };
const textArea  = { ...textInput, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, minHeight: 80 };
const selectInput = { ...textInput, cursor: 'pointer', height: 36 };
const pillBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 128, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid', transition: 'all .12s' };
const dropZone = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '22px 14px', border: '2px dashed', borderRadius: 12, cursor: 'pointer', textAlign: 'center', transition: 'all .12s' };
const screenshotPreview = { padding: 10, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' };
const removeBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer' };
const errorBanner = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 500, border: '1px solid #fca5a5' };
const iconBtn = { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const ghostBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', fontSize: 12, fontWeight: 700 };
