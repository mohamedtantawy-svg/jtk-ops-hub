// ── CreateLeaderAlertModal ──────────────────────────────────────────────
// Single-flow composer for the Leaders Alerts tab. Fields:
//   • Title           — text (300 chars)
//   • Body            — textarea (rich enough for Stage 2; emoji + image
//                       paste supported, full rich-text editor deferred)
//   • Severity        — 4-radio (Critical / High / Medium / Low)
//   • Category        — dropdown from settings (admin-editable)
//   • Impact          — multi-select picker: Global, Team, ISO countries
//                       (searchable, A–Z sorted, multi-select chips)
//   • Links           — one URL per line
//   • Attachments     — paste / drag / click; same shape as feedback_requests
//
// On submit POSTs to /api/v1/leader-alerts/alerts. Success calls onCreated.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createLeaderAlert, getLeaderAlertsSettings } from '../../services/leaderAlertsApi';
import { COUNTRY_OWNERS } from '../../data/countryOwners';
import { FLAGS, getCountryName } from '../../data/constants';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_PAYLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

const SEVERITY_OPTIONS = [
  { id: 'critical', label: 'Critical', color: '#dc2626', bg: '#fef2f2', icon: 'bi-exclamation-octagon-fill', desc: 'Immediate revenue / legal / people-safety impact' },
  { id: 'high',     label: 'High',     color: '#d97706', bg: '#fff8e6', icon: 'bi-exclamation-triangle-fill', desc: 'Multi-region or recurring issue' },
  { id: 'medium',   label: 'Medium',   color: '#0369a1', bg: '#e0f2fe', icon: 'bi-info-circle-fill',          desc: 'General operational alert' },
  { id: 'low',      label: 'Low',      color: '#15803d', bg: '#f0fdf4', icon: 'bi-check-circle',              desc: 'FYI / nice to know' },
];

// Pinned tags shown above the country list in the Impact picker.
const PINNED_TAGS = [
  { id: 'Global', label: 'Global', icon: 'bi-globe2',     accent: '#7c3aed', desc: 'Affects every region' },
  { id: 'Team',   label: 'Team',   icon: 'bi-people-fill', accent: '#0369a1', desc: 'Affects only your direct team' },
];

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

const CreateLeaderAlertModal = ({ onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [category, setCategory] = useState(null);
  const [impactTags, setImpactTags] = useState([]);
  const [linksText, setLinksText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState(null);

  const bodyRef = useRef(null);

  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Load settings (categories list + status colors).
  useEffect(() => {
    let cancelled = false;
    getLeaderAlertsSettings()
      .then(d => {
        if (cancelled) return;
        const s = d?.settings || {};
        setSettings(s);
        const cats = Array.isArray(s.categories) ? s.categories : [];
        if (cats.length && !category) setCategory(cats[0].label);
      })
      .catch(e => { if (!cancelled) setSettingsError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const categories = Array.isArray(settings?.categories) ? settings.categories : [];

  // Derived: list of countries from the live binding.
  const allCountries = useMemo(() => {
    return Object.keys(COUNTRY_OWNERS || {})
      .map(code => ({ id: code, label: getCountryName(code) || code, flag: FLAGS[code] || '' }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  // ── Attachments helpers ──────────────────────────────────────────────────
  const totalAttachmentBytes = attachments.reduce((acc, a) => acc + (a.dataUri?.length || 0), 0);

  const addAttachment = useCallback(async (file) => {
    if (!file) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      setSubmitError(`Max ${MAX_ATTACHMENTS} attachments per alert`);
      return;
    }
    const isImage = file.type?.startsWith('image/');
    const isVideo = ACCEPTED_VIDEO_TYPES.has(file.type);
    if (!isImage && !isVideo) {
      setSubmitError('Only images and short videos are supported');
      return;
    }
    if (isImage && file.size > MAX_IMAGE_BYTES) {
      setSubmitError(`Image "${file.name}" too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
      return;
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      setSubmitError(`Video "${file.name}" too large (max ${MAX_VIDEO_BYTES / 1024 / 1024} MB)`);
      return;
    }
    let dataUri;
    try {
      dataUri = isImage ? await compressImageFile(file) : await fileToDataUri(file);
    } catch {
      setSubmitError('Could not read file');
      return;
    }
    if (!dataUri) { setSubmitError('Could not read file'); return; }
    if (totalAttachmentBytes + dataUri.length > MAX_TOTAL_PAYLOAD_BYTES) {
      setSubmitError(`Total attachment payload too large (max ${MAX_TOTAL_PAYLOAD_BYTES / 1024 / 1024} MB)`);
      return;
    }
    setSubmitError(null);
    setAttachments(prev => [...prev, { kind: isImage ? 'image' : 'video', dataUri, name: file.name }]);
  }, [attachments.length, totalAttachmentBytes]);

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  // Paste-from-clipboard handler — works anywhere inside the modal body.
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await addAttachment(file);
          return;
        }
      }
    }
  }, [addAttachment]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) await addAttachment(f);
  }, [addAttachment]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const canSubmit = title.trim() && body.trim() && category && severity && impactTags.length > 0 && !submitting;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const links = linksText
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      const payload = {
        title: title.trim(),
        body: body.trim(),
        severity,
        category,
        impact_tags: impactTags,
        links,
        attachments,
      };
      const res = await createLeaderAlert(payload);
      onCreated?.(res?.alert);
    } catch (err) {
      setSubmitError(err?.message || 'Could not create alert');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leader-alert-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <div
        onPaste={handlePaste}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          width: 'min(720px, 100%)', maxHeight: '92vh',
          background: 'var(--surface)', borderRadius: 18,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: '#fff1f2', color: '#dc2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi-broadcast-pin" style={{ fontSize: 18 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="leader-alert-modal-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              New Leaders Alert
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Visible to every manager. Posted alerts can be edited until resolved.
            </div>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose?.()}
            disabled={submitting}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className="bi-x-lg" style={{ fontSize: 13 }} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Title */}
          <Field label="Title" hint="A short headline. Other leaders see this in the list.">
            <input
              type="text"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kazakhstan — support signed amendment on EE's behalf"
              style={inputStyle}
            />
          </Field>

          {/* Body */}
          <Field label="Details" hint="Markdown welcome. @mention people to bring them in. Emoji 👌 and image paste both work.">
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="What's happening, why it matters, and any action needed."
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: 120 }}
            />
          </Field>

          {/* Severity */}
          <Field label="Severity" hint="Drives notification fan-out. Critical pings every manager — use sparingly.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {SEVERITY_OPTIONS.map(opt => {
                const active = severity === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSeverity(opt.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 12,
                      border: `1.5px solid ${active ? opt.color : 'var(--border)'}`,
                      background: active ? opt.bg : 'var(--surface)',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all .12s',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: opt.bg, color: opt.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <i className={opt.icon} style={{ fontSize: 14 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: active ? opt.color : 'var(--text)' }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Category */}
          <Field label="Category" hint="Categories are admin-editable from Settings.">
            {settingsError && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 6 }}>
                Could not load categories — {settingsError}. Defaulting to "Others".
              </div>
            )}
            <select
              value={category || ''}
              onChange={(e) => setCategory(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {categories.length === 0 && <option value="">Loading…</option>}
              {categories.map(c => (
                <option key={c.id || c.label} value={c.label}>{c.label}</option>
              ))}
            </select>
          </Field>

          {/* Impact picker */}
          <Field label="Impact" hint="Pick Global, Team, or one or more countries. Searchable. Multi-select.">
            <ImpactPicker
              allCountries={allCountries}
              value={impactTags}
              onChange={setImpactTags}
            />
          </Field>

          {/* Links */}
          <Field label="Relevant links" hint="One URL per line. Optional.">
            <textarea
              value={linksText}
              onChange={(e) => setLinksText(e.target.value)}
              rows={2}
              placeholder="https://admin.deel.com/…&#10;https://deel.atlassian.net/browse/…"
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
            />
          </Field>

          {/* Attachments */}
          <Field label="Attachments" hint={`Drop, paste, or click to add up to ${MAX_ATTACHMENTS} images / short videos.`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: attachments.length ? 8 : 0 }}>
              {attachments.map((a, idx) => (
                <div key={idx} style={{
                  position: 'relative', width: 96, height: 64, borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--surface-2)',
                  overflow: 'hidden',
                }}>
                  {a.kind === 'image'
                    ? <img src={a.dataUri} alt={a.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--text-muted)' }}>
                        <i className="bi-camera-video" style={{ fontSize: 22 }} />
                      </div>}
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    aria-label={`Remove attachment ${idx + 1}`}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 11,
                      background: 'rgba(15, 23, 42, 0.7)', border: 'none', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <i className="bi-x-lg" style={{ fontSize: 10 }} />
                  </button>
                </div>
              ))}
            </div>
            <label
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 16px', borderRadius: 12,
                border: '1.5px dashed var(--border)', background: 'var(--surface-2)',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
              }}
            >
              <i className="bi-paperclip" style={{ fontSize: 14 }} />
              Click, drag, or paste images / videos here
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
          </Field>
        </form>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}>
          <div style={{ fontSize: 12, color: submitError ? '#b91c1c' : 'var(--text-muted)' }}>
            {submitError || (severity === 'critical' ? 'Critical alerts notify every manager immediately.' : 'You and tagged users will be subscribed automatically.')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                height: 36, padding: '0 16px', borderRadius: 128,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              style={{
                height: 36, padding: '0 18px', borderRadius: 128,
                border: 'none', background: canSubmit ? '#7c3aed' : '#cbd5e1',
                color: 'white', fontSize: 13, fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                boxShadow: canSubmit ? '0 4px 12px rgba(124, 58, 237, 0.3)' : 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {submitting && <i className="bi-arrow-repeat" style={{ fontSize: 14, animation: 'spin 1s linear infinite' }} />}
              {submitting ? 'Posting…' : 'Post Alert'}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { from{transform:rotate(0)}to{transform:rotate(360deg)} }`}</style>
    </div>
  );
};

// ── Subcomponents ──────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
  transition: 'border-color .12s, box-shadow .12s',
  boxSizing: 'border-box',
};

const Field = ({ label, hint, children }) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</label>
      {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12 }}>{hint}</span>}
    </div>
    {children}
  </div>
);

// Multi-select picker for Impact: Global / Team pinned, then countries.
const ImpactPicker = ({ allCountries, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id) => {
    if (value.includes(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  };

  const visiblePinned = PINNED_TAGS.filter(p =>
    !search || p.label.toLowerCase().includes(search.toLowerCase())
  );
  const visibleCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter(c =>
      c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }, [allCountries, search]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Selected chips + open trigger */}
      <div
        onClick={() => setOpen(true)}
        style={{
          minHeight: 40, padding: '6px 8px', borderRadius: 10,
          border: `1px solid ${open ? '#7c3aed' : 'var(--border)'}`,
          background: 'var(--surface)',
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          cursor: 'text',
          boxShadow: open ? '0 0 0 3px rgba(124, 58, 237, 0.12)' : 'none',
          transition: 'all .12s',
        }}
      >
        {value.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13, padding: '2px 6px' }}>Select Global, Team, or one or more countries…</span>}
        {value.map(tag => {
          const isSpecial = tag === 'Global' || tag === 'Team';
          const flag = isSpecial ? null : (FLAGS[tag] || '');
          const label = isSpecial ? tag : (getCountryName(tag) || tag);
          return (
            <span key={tag} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 128,
              background: '#f3eff8', color: '#5b21b6',
              fontSize: 12, fontWeight: 600,
            }}>
              {flag && <span>{flag}</span>}
              {!flag && isSpecial && <i className={tag === 'Global' ? 'bi-globe2' : 'bi-people-fill'} style={{ fontSize: 11 }} />}
              {label}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(tag); }}
                aria-label={`Remove ${label}`}
                style={{
                  border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
                  color: '#5b21b6', display: 'flex', alignItems: 'center',
                }}
              >
                <i className="bi-x" style={{ fontSize: 14 }} />
              </button>
            </span>
          );
        })}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)',
          zIndex: 100,
          maxHeight: 320, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-light)' }}>
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search countries…"
              style={{ ...inputStyle, padding: '8px 10px', fontSize: 13 }}
            />
          </div>
          <div style={{ overflowY: 'auto', padding: '6px 0' }}>
            {visiblePinned.length > 0 && (
              <div>
                <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Quick scope</div>
                {visiblePinned.map(p => (
                  <PickerRow
                    key={p.id}
                    leftIcon={p.icon}
                    iconColor={p.accent}
                    label={p.label}
                    sub={p.desc}
                    selected={value.includes(p.id)}
                    onClick={() => toggle(p.id)}
                  />
                ))}
              </div>
            )}
            {visibleCountries.length > 0 && (
              <div>
                <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Countries</div>
                {visibleCountries.map(c => (
                  <PickerRow
                    key={c.id}
                    flag={c.flag}
                    label={c.label}
                    sub={c.label !== c.id ? c.id : null}
                    selected={value.includes(c.id)}
                    onClick={() => toggle(c.id)}
                  />
                ))}
              </div>
            )}
            {visiblePinned.length === 0 && visibleCountries.length === 0 && (
              <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                No matches for "{search}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const PickerRow = ({ flag, leftIcon, iconColor, label, sub, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', border: 'none',
      background: selected ? '#f3eff8' : 'transparent',
      cursor: 'pointer', textAlign: 'left',
      transition: 'background .1s',
    }}
    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--surface-2)'; }}
    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
  >
    {flag && <span style={{ fontSize: 18 }}>{flag}</span>}
    {leftIcon && (
      <div style={{
        width: 24, height: 24, borderRadius: 8,
        background: '#f3eff8', color: iconColor || '#7c3aed',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <i className={leftIcon} style={{ fontSize: 12 }} />
      </div>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
    {selected && <i className="bi-check2" style={{ fontSize: 16, color: '#7c3aed' }} />}
  </button>
);

export default CreateLeaderAlertModal;
