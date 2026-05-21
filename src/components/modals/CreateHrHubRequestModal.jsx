// ── CreateHrHubRequestModal ─────────────────────────────────────────────
// Two-pane composer for the HR Hub:
//   1. Flow picker — 2 large cards (HR Request, HR Reporting). The user
//      picks one to start. Escalation Zero + Ops Hub Feedback moved out
//      to the Feedback board 2026-05-21 — they share a kind+extras
//      partition there. The HR Hub now strictly hosts HR-ops flows.
//   2. Per-flow form — fields are rendered from the flow's settings (the
//      same JSON the Settings panel edits in Stage 6). Cascading
//      dropdowns (HR Request: Function → Type) work out of the box.
//
// Open with `flow={null}` to show the picker; pass `flow="hr_request"`
// or `flow="hr_reporting"` to skip the picker and land directly on the
// form. Legacy `flow="escalation_zero"` / `flow="feedback"` no longer
// open the matching form — the FE callers were updated alongside this
// change; any orphan caller falls back to the picker.
//
// Attachments use the same paste/drag/drop/picker pattern as the
// Feedback modal so muscle memory is preserved.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getHrHubSettings, createHrHubRequest } from '../../services/hrHubApi';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_PAYLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

// 2026-05-21 split: Escalation Zero + Ops Hub Feedback live on the
// Feedback board now (with a kind+extras partition), so the HR Hub picker
// is back down to its two original ops flows. Callers that still pass
// `initialFlow="escalation_zero"` or `"feedback"` land on the picker —
// the UI nudges them to the Feedback board's Submit Feedback flow.
const FLOW_CARDS = [
  {
    id: 'hr_request',
    label: 'HR Request',
    desc: 'Operational request that needs GM/MOC actioning (countersign, deposit, cancel offboarding, etc.)',
    icon: 'bi-send',
    accent: '#1f74b3',
    bg: '#e0f2fe',
  },
  {
    id: 'hr_reporting',
    label: 'HR Reporting',
    desc: 'Report a bug, escalation, mass event, or quality issue. Auto-cc your manager.',
    icon: 'bi-megaphone',
    accent: '#dc2626',
    bg: '#fef2f2',
  },
];

// Flow ids that used to open here but now live on the Feedback board.
// Used to surface a "Use Submit Feedback instead" hint if a stale caller
// still passes one of these as initialFlow.
const RETIRED_FLOWS = new Set(['escalation_zero', 'feedback']);

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

// ── Field renderers ─────────────────────────────────────────────────────────
// Settings define each flow's fields as { id, label, kind, required, source,
// dependsOn? }. The form below switches on `kind` to render the right input.
// New `kind` values added by an HR Hub Admin from Stage 6 only need a new
// case here.
function FieldInput({ field, settings, value, onChange, autofocus }) {
  const ref = useRef(null);
  useEffect(() => { if (autofocus) ref.current?.focus(); }, [autofocus]);

  const labelStyle = {
    fontSize: 12, fontWeight: 600, color: 'var(--text)',
    display: 'block', marginBottom: 6,
  };
  const inputStyle = {
    width: '100%', padding: '9px 12px', fontSize: 14, lineHeight: 1.45,
    border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)',
    color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const labelEl = (
    <label style={labelStyle}>
      {field.label}
      {field.required && <span style={{ color: '#d42d35' }}> *</span>}
    </label>
  );

  if (field.kind === 'rich_text' || field.kind === 'text') {
    const isMulti = field.kind === 'rich_text';
    return (
      <div style={{ marginBottom: 16 }}>
        {labelEl}
        {isMulti ? (
          <textarea
            ref={ref}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            rows={field.id === 'summary' || field.id === 'idealSolution' ? 5 : 3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
            placeholder={`Add the ${field.label.toLowerCase()}…`}
          />
        ) : (
          <input
            ref={ref}
            type="text"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            style={inputStyle}
            placeholder={`Add a ${field.label.toLowerCase()}…`}
          />
        )}
      </div>
    );
  }

  if (field.kind === 'dropdown' || field.kind === 'dropdown_dependent') {
    // Resolve the option list. Dependent dropdowns key off another field's
    // current value.
    let options = [];
    const sourcePath = field.source || '';   // e.g. "dropdowns.function_area"
    const sourceKey = sourcePath.split('.')[1];
    const dropdownTree = settings?.dropdowns?.value || settings?.dropdowns;
    if (field.kind === 'dropdown_dependent' && field.dependsOn) {
      // value of the parent field selects which sub-list to render.
      const parentVal = value?.__parent || null;
      // The "parent value" actually lives on the form state, not on this
      // field's own value — so we expect the parent to be passed via
      // `field._dependentParent` (set by the form below).
      const parentResolved = field._dependentParent || parentVal;
      if (parentResolved && dropdownTree?.[sourceKey]) {
        options = dropdownTree[sourceKey][parentResolved] || [];
      }
    } else if (dropdownTree?.[sourceKey]) {
      const raw = dropdownTree[sourceKey];
      options = Array.isArray(raw) ? raw : [];
    }

    // 2026-05-21 audit F14: dependent dropdowns (Request Type depends on
    // Related Function) used to render an empty "— Select —" option list
    // until the parent was chosen, which looked broken to first-time
    // openers. Now we disable + change the placeholder so the dependency
    // is obvious without breaking the field for users who already have a
    // parent selected.
    const isDependentBlocked = field.kind === 'dropdown_dependent' && field.dependsOn && !(field._dependentParent || (value?.__parent ?? null));
    const placeholder = isDependentBlocked
      ? `— Choose ${field.dependsOnLabel || (field.dependsOn || '').replace(/_/g, ' ') || 'the previous field'} first —`
      : '— Select —';
    return (
      <div style={{ marginBottom: 16 }}>
        {labelEl}
        <select
          ref={ref}
          value={value || ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={isDependentBlocked}
          title={isDependentBlocked ? placeholder : undefined}
          style={{ ...inputStyle, cursor: isDependentBlocked ? 'not-allowed' : 'pointer', appearance: 'auto', opacity: isDependentBlocked ? 0.6 : 1 }}
        >
          <option value="">{placeholder}</option>
          {options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === 'url_list') {
    const list = Array.isArray(value) ? value : [];
    return (
      <div style={{ marginBottom: 16 }}>
        {labelEl}
        <UrlListEditor list={list} onChange={onChange} />
      </div>
    );
  }

  if (field.kind === 'auto_manager') {
    // Manager email is auto-populated server-side. Just show a hint here.
    return (
      <div style={{ marginBottom: 16 }}>
        {labelEl}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          Auto-populated from your team directory at submit time.
        </div>
      </div>
    );
  }

  // Attachments rendered separately by the parent form so paste/drop work.
  if (field.kind === 'attachments') return null;

  return null;
}

function UrlListEditor({ list, onChange }) {
  const [draft, setDraft] = useState('');
  const inputStyle = {
    flex: 1, padding: '8px 10px', fontSize: 13, border: '1px solid var(--border)',
    borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const add = () => {
    let t = draft.trim();
    if (!t) return;
    // Auto-prefix bare URLs (e.g. "jtk.dp.com/…") instead of bouncing the
    // user back to fix it manually. The previous `setDraft + return`
    // prefixed but never called onChange — typing a bare URL + Enter
    // silently dropped the entry, which was the "links provided don't
    // show" report on 2026-05-05.
    if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
    onChange([...list, t]);
    setDraft('');
  };
  // Heuristic for the blur-flush: looks-like-URL accepts already-prefixed
  // URLs OR bare domains with at least one dot and no whitespace. Stops
  // accidental partial typing ("abc") from being banked as "https://abc".
  const looksLikeUrl = (s) => {
    const t = (s || '').trim();
    if (!t) return false;
    if (/^https?:\/\//i.test(t)) return true;
    return /^[^\s]+\.[^\s]{2,}/.test(t);
  };
  const handleBlur = () => {
    if (looksLikeUrl(draft)) add();
  };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={handleBlur}
          placeholder="Paste a URL and press Enter…"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={add}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >Add</button>
      </div>
      {list.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((u, idx) => (
            <div key={`${u}-${idx}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12,
            }}>
              <i className="bi bi-link-45deg" style={{ color: 'var(--text-muted)' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</span>
              <button
                type="button"
                onClick={() => onChange(list.filter((_, i) => i !== idx))}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 0 }}
                aria-label="Remove URL"
              ><i className="bi bi-x" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Attachment input — paste / drop / pick ─────────────────────────────────
function AttachmentField({ attachments, setAttachments, error, setError }) {
  const fileInputRef = useRef(null);
  const [dropActive, setDropActive] = useState(false);

  const addFiles = useCallback(async (files) => {
    setError(null);
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    const additions = [];
    let total = attachments.reduce((acc, a) => acc + (a.dataUri?.length || 0), 0);
    for (const file of incoming) {
      if (attachments.length + additions.length >= MAX_ATTACHMENTS) {
        setError(`Up to ${MAX_ATTACHMENTS} attachments per request.`);
        break;
      }
      const isImage = file.type?.startsWith('image/');
      const isVideo = ACCEPTED_VIDEO_TYPES.has(file.type) || file.type?.startsWith('video/');
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      if (!isImage && !isVideo && !isPdf) continue;
      if (isImage && file.size > MAX_IMAGE_BYTES * 4) {
        setError(`"${file.name}" is too large to attach.`);
        continue;
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        setError(`"${file.name}" exceeds the ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB video limit.`);
        continue;
      }
      if (isPdf && file.size > MAX_PDF_BYTES) {
        setError(`"${file.name}" exceeds the ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB PDF limit.`);
        continue;
      }
      const dataUri = isImage
        ? (await compressImageFile(file)) || (await fileToDataUri(file))
        : await fileToDataUri(file);
      total += dataUri.length;
      if (total > MAX_TOTAL_PAYLOAD_BYTES) {
        setError('Total attachment payload would exceed the limit. Drop one and try again.');
        break;
      }
      const kind = isImage ? 'image' : isVideo ? 'video' : 'pdf';
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        dataUri,
        name: file.name || kind,
      });
    }
    if (additions.length) setAttachments(prev => [...prev, ...additions]);
  }, [attachments, setAttachments, setError]);

  // Document-level paste while modal is open.
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

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
        Attachments <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional, max {MAX_ATTACHMENTS})</span>
      </label>
      <div
        onDragOver={e => { e.preventDefault(); setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        onDrop={e => { e.preventDefault(); setDropActive(false); addFiles(e.dataTransfer?.files); }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `1.5px dashed ${dropActive ? '#1f74b3' : '#d8d8d8'}`,
          borderRadius: 10,
          padding: '14px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dropActive ? '#e0f2fe' : '#f9f9f7',
          fontSize: 12,
          color: 'var(--text-secondary)',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <i className="bi bi-cloud-arrow-up" style={{ fontSize: 18, marginRight: 6 }} />
        Drop, paste (Cmd/Ctrl+V), or click to attach screenshots, PDFs, or short clips.
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={e => addFiles(e.target.files)}
      />
      {attachments.length > 0 && (
        <div style={{
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 8,
        }}>
          {attachments.map(a => (
            <div key={a.id} style={{
              position: 'relative',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              aspectRatio: '4 / 3',
            }}>
              {a.kind === 'image' ? (
                <img src={a.dataUri} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : a.kind === 'video' ? (
                <video src={a.dataUri} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: 6, gap: 4,
                  color: '#b91c1c',
                  textAlign: 'center',
                }}>
                  <i className="bi bi-filetype-pdf" style={{ fontSize: 28 }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={a.name}>{a.name || 'document.pdf'}</span>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setAttachments(prev => prev.filter(x => x.id !== a.id)); }}
                aria-label="Remove attachment"
                style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 22, height: 22, borderRadius: '50%',
                  border: 'none', background: 'rgba(0,0,0,0.55)',
                  color: 'white', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><i className="bi bi-x" /></button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Main modal component ────────────────────────────────────────────────────
/**
 * @param {Object}    props
 * @param {?string}   props.initialFlow  — preselected flow id; null → user picks
 * @param {?Object}   props.prefill      — values seeded into the form on open.
 *   Shape:
 *     {
 *       links?: string[],         // injected into values.links so url_list
 *                                 // fields render with the task URL pre-filled
 *       title?: string,           // pre-fills values.title
 *       summary?: string,         // pre-fills values.summary
 *       assigneeEmail?: string,   // routes the new request to a specific
 *                                 // person at create time (e.g. requester's
 *                                 // direct manager when escalating from queue)
 *       assigneeName?: string,    // optional display name for the assignee
 *       banner?: { title: string, subtitle?: string, color?: string, bg?: string, icon?: string }
 *                                 // inline banner that explains why the
 *                                 // modal was pre-populated (Queue → HR Hub
 *                                 // escalation context)
 *     }
 *   Used by the Queue → HR Hub Escalate flow to seed the new request with the
 *   task link, the requester's manager, and an "Escalating from queue" banner.
 */
export default function CreateHrHubRequestModal({ initialFlow = null, prefill = null, onClose, onCreated }) {
  // 2026-05-21: legacy callers may still pass `escalation_zero` or
  // `feedback` as initialFlow. Those flows moved to the Feedback board;
  // we clear them so the picker shows instead of trying to mount a form
  // for a flow that no longer has settings here.
  const initial = initialFlow && !RETIRED_FLOWS.has(initialFlow) ? initialFlow : null;
  const [flow, setFlow] = useState(initial);
  const [settings, setSettings] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  // Seed `values` from `prefill` on first render so the FE inputs already
  // carry the task link / suggested title before settings load. We only
  // populate keys the prefill sets so a downstream field with the same id
  // still wins from its `default` if the prefill doesn't override it.
  const [values, setValues] = useState(() => {
    if (!prefill) return {};
    const out = {};
    if (Array.isArray(prefill.links) && prefill.links.length) out.links = [...prefill.links];
    if (prefill.title) out.title = prefill.title;
    if (prefill.summary) out.summary = prefill.summary;
    return out;
  });
  // Lock the assignee for the lifetime of the modal — the spec for the
  // Queue → HR Hub escalation says "default to the team member's manager",
  // so we hold it here and surface it in the payload at submit time. Not a
  // form field today (auto_manager is read-only); could become editable in
  // a follow-up if the team needs to retarget.
  const [assigneeEmail] = useState(prefill?.assigneeEmail || null);
  const [assigneeName] = useState(prefill?.assigneeName || null);
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [attachmentError, setAttachmentError] = useState(null);

  // Tracks whether the user has touched the form since the modal opened (or
  // since they last bounced back to the picker). Prefill values don't count
  // — `setVal` and `handleAttachmentsChange` only fire on user interaction.
  // Used by `attemptDiscard` to decide if an accidental close should prompt
  // for confirmation.
  const [userTouched, setUserTouched] = useState(false);
  // When non-null, holds the action to run if the user confirms discard.
  // Renders an inline confirmation panel covering the modal.
  const [pendingDiscard, setPendingDiscard] = useState(null);

  const hasUnsavedWork = userTouched || attachments.length > 0;

  // Funnel every close/back path through this so the user gets a confirm
  // prompt before losing what they've typed. `action` is the work to do if
  // they confirm; if the form is clean, run it immediately.
  const attemptDiscard = useCallback((action) => {
    if (submitting) return;
    if (hasUnsavedWork) {
      setPendingDiscard(() => action);
    } else {
      action();
    }
  }, [submitting, hasUnsavedWork]);

  // Esc to close (when not submitting). onClose ref so changes to the
  // parent's identity don't rebind the listener on every render. When the
  // discard-confirm panel is open, Esc dismisses THAT instead of the modal.
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  const attemptDiscardRef = useRef(attemptDiscard);
  const pendingDiscardRef = useRef(pendingDiscard);
  useEffect(() => {
    onCloseRef.current = onClose;
    submittingRef.current = submitting;
    attemptDiscardRef.current = attemptDiscard;
    pendingDiscardRef.current = pendingDiscard;
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || submittingRef.current) return;
      if (pendingDiscardRef.current) { setPendingDiscard(null); return; }
      attemptDiscardRef.current?.(() => onCloseRef.current?.());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Load the picked flow's settings (fields + dropdowns).
  useEffect(() => {
    if (!flow) { setSettings(null); return; }
    let cancelled = false;
    setLoadingSettings(true);
    setError(null);
    getHrHubSettings(flow)
      .then(res => { if (!cancelled) setSettings(res?.settings || {}); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Could not load form'); })
      .finally(() => { if (!cancelled) setLoadingSettings(false); });
    return () => { cancelled = true; };
  }, [flow]);

  const fields = useMemo(() => {
    const raw = settings?.fields?.value || settings?.fields || [];
    const arr = Array.isArray(raw) ? raw : [];
    // Product rule: HR Request flow must always carry a Relevant Link.
    // 2026-05-21 audit F15: relevant-links field is no longer forced-
    // required on hr_request. The previous override produced placeholder
    // URLs (mailto:, n/a, the user's own email) on every request that
    // genuinely didn't have a system link to attach. The flow's settings
    // schema still surfaces the field; the requester decides whether to
    // populate it.
    return arr;
  }, [settings, flow]);

  // The form's current value for a field id (uniform shape: string,
  // string-array, etc.) — defaults from settings if present. Marks the
  // form as user-touched so `attemptDiscard` knows to confirm before close.
  const setVal = (id, v) => {
    if (!userTouched) setUserTouched(true);
    setValues(prev => ({ ...prev, [id]: v }));
  };

  // Wrapped setter for the AttachmentField. Same touch-tracking as setVal
  // so dropping a screenshot before closing still triggers the prompt.
  // Accepts either a value or the React-setter functional form.
  const handleAttachmentsChange = (next) => {
    if (!userTouched) setUserTouched(true);
    setAttachments(next);
  };

  const card = FLOW_CARDS.find(c => c.id === flow);

  const submit = async () => {
    if (!flow) return;
    setSubmitting(true);
    setError(null);
    try {
      // Map FE field ids → API request shape. Most pass through 1:1; a
      // few (links) are JSON arrays; attachments mirror the feedback shape.
      const payload = {
        flow,
        title: values.title || null,
        summary: values.summary || '',
        idealSolution: values.idealSolution || null,
        functionArea: values.function_area || null,
        requestType: values.request_type || null,
        reportType: values.report_type || null,
        priority: values.priority || 'medium',
        links: Array.isArray(values.links) ? values.links : [],
        attachments: attachments.map(a => ({ kind: a.kind, dataUri: a.dataUri, name: a.name })),
        // Optional create-time assignee — populated by the Queue→HR Hub
        // escalation flow which routes to the requester's manager. Backend
        // ignores when null.
        assigneeEmail: assigneeEmail || null,
        assigneeName: assigneeName || null,
      };
      const res = await createHrHubRequest(payload);
      onCreated?.(res?.id || null, flow);
    } catch (err) {
      setError(err?.message || 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────
  const requiredFields = fields.filter(f => f.required && f.kind !== 'attachments' && f.kind !== 'auto_manager');
  const allRequiredSatisfied = requiredFields.every(f => {
    const v = values[f.id];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' ? v.trim().length > 0 : !!v;
  });

  // All non-Submit close paths route through this so dirty forms prompt
  // for confirmation before discarding. Submitting is left as the only
  // unguarded exit.
  const closeIfClean = () => attemptDiscard(() => onClose?.());
  const goBackToPicker = () => attemptDiscard(() => {
    setFlow(null); setValues({}); setAttachments([]); setError(null);
    setUserTouched(false);
  });

  return (
    <div
      onClick={closeIfClean}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 64, zIndex: 1500,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hrhub-create-title"
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(720px, 92vw)', maxHeight: '85vh',
          background: 'var(--surface)', borderRadius: 16,
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {flow && (
            <button
              onClick={goBackToPicker}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, marginLeft: -4, color: 'var(--text-secondary)' }}
              aria-label="Back to picker"
            ><i className="bi bi-arrow-left" style={{ fontSize: 16 }} /></button>
          )}
          <div style={{ flex: 1 }}>
            <div id="hrhub-create-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {flow ? card?.label || 'New request' : 'Submit to HR Hub'}
            </div>
            {!flow && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                Choose what you'd like to raise.
              </div>
            )}
          </div>
          <button
            onClick={closeIfClean}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}
            aria-label="Close"
          ><i className="bi bi-x-lg" style={{ fontSize: 14 }} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Prefill banner — surfaces the queue task we're escalating
              from so the user knows the link/title/manager are already
              wired up. Renders on both the picker and the form. */}
          {prefill?.banner && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', borderRadius: 10, marginBottom: 16,
              background: prefill.banner.bg || '#eff6ff',
              border: `1px solid ${prefill.banner.color || '#1d4ed8'}30`,
            }}>
              <i className={prefill.banner.icon || 'bi-arrow-up-right-circle-fill'} style={{ fontSize: 14, color: prefill.banner.color || '#1d4ed8', marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: prefill.banner.color || '#1d4ed8' }}>{prefill.banner.title}</div>
                {prefill.banner.subtitle && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {prefill.banner.subtitle}
                  </div>
                )}
                {assigneeName ? (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    <i className="bi-person-fill" style={{ fontSize: 10, marginRight: 4 }} />
                    Assignee: <strong style={{ color: 'var(--text)' }}>{assigneeName}</strong>
                  </div>
                ) : prefill?.banner?.title === 'Escalating from queue' ? (
                  // No manager in the requester's roster chain — surface this
                  // explicitly so the user knows the request will land
                  // unassigned (not silently empty). Audit F1.
                  <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
                    <i className="bi-exclamation-circle" style={{ fontSize: 10, marginRight: 4 }} />
                    No manager set in your roster chain — the request will land unassigned. Add an assignee in the form below.
                  </div>
                ) : null}
              </div>
            </div>
          )}
          {!flow && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}>
              {FLOW_CARDS.map(c => (
                <button
                  key={c.id}
                  onClick={() => setFlow(c.id)}
                  style={{
                    textAlign: 'left',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    padding: 16,
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 10,
                    transition: 'border-color .15s, transform .1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = c.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8'; }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: c.bg, color: c.accent,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18,
                  }}>
                    <i className={`bi ${c.icon}`} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{c.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{c.desc}</div>
                </button>
              ))}
            </div>
          )}

          {flow && loadingSettings && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading form…
            </div>
          )}

          {flow && !loadingSettings && fields.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              This flow has no editable fields configured. Contact an HR Hub Admin.
            </div>
          )}

          {flow && !loadingSettings && fields.length > 0 && (
            <div>
              {fields.map((f, idx) => {
                if (f.kind === 'attachments') {
                  return (
                    <AttachmentField
                      key={f.id}
                      attachments={attachments}
                      setAttachments={handleAttachmentsChange}
                      error={attachmentError}
                      setError={setAttachmentError}
                    />
                  );
                }
                // Pass through the cascading-parent's value so dependent
                // dropdowns can render the right sub-list.
                let fieldWithParent = f;
                if (f.kind === 'dropdown_dependent' && f.dependsOn) {
                  fieldWithParent = { ...f, _dependentParent: values[f.dependsOn] || null };
                }
                return (
                  <FieldInput
                    key={f.id}
                    field={fieldWithParent}
                    settings={settings}
                    value={values[f.id]}
                    onChange={(v) => setVal(f.id, v)}
                    autofocus={idx === 0}
                  />
                );
              })}
            </div>
          )}

          {error && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)', flexShrink: 0,
        }}>
          {flow && (
            <>
              <button
                onClick={closeIfClean}
                disabled={submitting}
                style={{
                  padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 500,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={submit}
                disabled={submitting || !allRequiredSatisfied}
                style={{
                  padding: '8px 18px', borderRadius: 10, border: 'none',
                  background: (submitting || !allRequiredSatisfied) ? '#9e9e9e' : '#1b1b1b',
                  color: 'white', fontSize: 13, fontWeight: 600,
                  cursor: (submitting || !allRequiredSatisfied) ? 'not-allowed' : 'pointer',
                }}
              >{submitting ? 'Submitting…' : 'Submit'}</button>
            </>
          )}
          {!flow && (
            <button
              onClick={closeIfClean}
              style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >Close</button>
          )}
        </div>

        {/* Discard-confirmation overlay — rendered inside the dialog so it
            traps the click; backdrop click here only dismisses the
            confirmation, never the parent modal. Esc handler at the modal
            level closes this overlay first (one layer at a time). */}
        {pendingDiscard && (
          <div
            onClick={(e) => { e.stopPropagation(); setPendingDiscard(null); }}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(15, 15, 15, 0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24, borderRadius: 'inherit', zIndex: 1,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="hrhub-discard-title"
              style={{
                width: 'min(420px, 100%)', background: 'var(--surface)', color: 'var(--text)',
                borderRadius: 14, border: '1px solid var(--border)',
                boxShadow: '0 20px 60px rgba(0,0,0,.25)',
                padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: '#fef3c7', color: '#b45309', flexShrink: 0 }}>
                  <i className="bi-exclamation-triangle-fill" style={{ fontSize: 14 }} />
                </span>
                <div id="hrhub-discard-title" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  Discard your request?
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                You'll lose what you've typed so far. This can't be undone.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setPendingDiscard(null)}
                  autoFocus
                  style={{
                    padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => { const action = pendingDiscard; setPendingDiscard(null); action?.(); }}
                  style={{
                    padding: '8px 16px', borderRadius: 10, border: 'none',
                    background: '#d42d35', color: 'white', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
