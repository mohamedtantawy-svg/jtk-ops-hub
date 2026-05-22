// ── CreateUrgentAssistModal ──────────────────────────────────────────────
// Captures every column the Urgent Assist table renders so the manual row
// drops in fully-formed:
//   • Subject
//   • Type (defaults to "Expedite Request (HRX)"; editable)
//   • Country (ISO-2 code; uses the existing FLAGS map for the picker)
//   • Assignee (email + display name resolved from the roster)
//   • Status (defaults to New)
//   • Priority
//   • Link URL (the user-supplied "Link to task" — required when source isn't
//               an internal task; we keep it optional but validate the format
//               so the table's "Open" button always lands somewhere real)
//   • Description (optional context)
//
// On submit → POST /api/v1/urgent-assist. Backend computes team_lead_email
// and writes the audit log; we just hand back the created row to the parent
// so it can refresh the list.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MEMBERS, MEMBERS_BY_EMAIL } from '../../data/members';
import { FLAGS, getFlag, getCountryName } from '../../data/constants';
import { createUrgentAssist } from '../../services/urgentAssistApi';

// Match the canonical workbench task-type labels surfaced on the Urgent
// Assist tab (`src/utils/normalizeSourceRows.js` recogniser, fixed
// 2026-05-02 in `fix(urgent-assist): match the real workbench task types`).
// The 2026-05-03 live audit (F24) caught the manual-entry dropdown
// offering `HRX Urgent Assist Request` / `HRX Urgent Assist` while every
// imported row read `Expedite Request (HRX)` — taxonomy drift between
// sources of the same tab. Aligning the manual options keeps the Type
// column consistent regardless of where the row originated.
const REQUEST_TYPES = [
  'Expedite Request (HRX)',
  'Urgent Assist',
];

const STATUSES = [
  { value: 'new',         label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold',     label: 'On Hold' },
  { value: 'resolved',    label: 'Resolved' },
];

const PRIORITIES = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10,
  fontSize: 13, color: 'var(--text)', background: 'var(--surface)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 6, display: 'block',
};

function isValidUrl(value) {
  if (!value) return true; // optional
  if (value.length > 2000) return false;
  return /^https?:\/\/\S+$/i.test(value.trim());
}

// 2026-05-22 — Case Monitoring is a different flow from a regular
// urgent assist: the requester asks the Manager On Call to WATCH a
// specific Deel task after hours and take a defined action if it
// triggers. Visual treatment is purple/eye-tinted instead of the
// regular red exclamation so the MOC can spot monitoring rows at a
// glance on the unified queue.
const KIND_META = {
  urgent_assist: {
    icon: 'bi-exclamation-octagon-fill',
    iconBg: '#fef2f2',
    iconColor: '#d42d35',
    titleText: 'New Urgent Assist',
    subText: 'Logs a manual urgent-assist request — 6h SLA from now.',
    submitLabel: 'Create Urgent Assist',
    defaultPriority: 'high',
    requiresLink: false,
    requiresActionRequired: false,
  },
  case_monitoring: {
    icon: 'bi-eye-fill',
    iconBg: '#f3e8ff',
    iconColor: '#7c3aed',
    titleText: 'Add Case to Monitor',
    subText: "After-hours watch request for the Manager On Call. They'll monitor the task and take the action you describe if it triggers.",
    submitLabel: 'Add to Monitor',
    defaultPriority: 'critical',
    requiresLink: true,
    requiresActionRequired: true,
  },
};

export default function CreateUrgentAssistModal({ onClose, onCreated, currentUser, initialKind = 'urgent_assist' }) {
  const backdropRef = useRef(null);
  const firstFieldRef = useRef(null);

  const kind = initialKind === 'case_monitoring' ? 'case_monitoring' : 'urgent_assist';
  const meta = KIND_META[kind];
  const isCaseMonitoring = kind === 'case_monitoring';

  const [subject, setSubject] = useState('');
  const [requestType, setRequestType] = useState(isCaseMonitoring ? 'Case Monitoring' : REQUEST_TYPES[0]);
  const [country, setCountry] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [status, setStatus] = useState('new');
  const [priority, setPriority] = useState(meta.defaultPriority);
  const [linkUrl, setLinkUrl] = useState('');
  const [description, setDescription] = useState('');
  // 2026-05-22 — case_monitoring only. The MOC's playbook ("if X happens,
  // do Y"). Required on submit when kind === 'case_monitoring'.
  const [actionRequired, setActionRequired] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Country options sorted alphabetically by code; restrict to ISO-2 keys
  // already in the FLAGS map (rejects the "UK" alias to avoid duplicates
  // with GB).
  const countryOptions = useMemo(() => (
    Object.keys(FLAGS)
      .filter(c => c !== 'UK')
      .sort()
  ), []);

  // Assignee options — every active roster member, sorted by name.
  const assigneeOptions = useMemo(() => (
    [...MEMBERS]
      .filter(m => !m.isDeleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  ), []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    // Autofocus the subject input once mounted.
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  }, []);

  const subjectOk = subject.trim().length > 0;
  const linkOk = isValidUrl(linkUrl.trim());
  const linkRequiredOk = !meta.requiresLink || (linkUrl.trim().length > 0 && linkOk);
  const actionRequiredOk = !meta.requiresActionRequired || actionRequired.trim().length > 0;
  const canSubmit = subjectOk && linkOk && linkRequiredOk && actionRequiredOk && !submitting;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const assignee = MEMBERS_BY_EMAIL[assigneeEmail.toLowerCase()] || null;
      const payload = {
        kind,
        subject: subject.trim(),
        requestType,
        country: country || null,
        assigneeEmail: assigneeEmail || null,
        assigneeName: assignee?.name || null,
        linkUrl: linkUrl.trim() || null,
        description: description.trim() || null,
        actionRequired: isCaseMonitoring ? actionRequired.trim() : null,
        status,
        priority,
      };
      const created = await createUrgentAssist(payload);
      onCreated?.(created);
      onClose?.();
    } catch (err) {
      setError(err?.message || `Failed to create ${isCaseMonitoring ? 'case monitoring' : 'urgent assist'}`);
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={ev => { if (ev.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="urgent-assist-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 560,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header — branded per kind (red exclamation for urgent_assist,
            purple eye for case_monitoring). The kind is fixed for the
            lifetime of the modal: callers open it with `initialKind` and
            the user picks the kind ANTE via the top-nav Quick Create or
            the Urgent Assist view's dual-buttons row. */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: meta.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className={meta.icon} style={{ fontSize: 18, color: meta.iconColor }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="urgent-assist-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{meta.titleText}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{meta.subText}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="ua-subject" style={labelStyle}>Subject *</label>
            <input
              ref={firstFieldRef}
              id="ua-subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={300}
              placeholder="Short summary of the urgent assist"
              style={inputStyle}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="ua-type" style={labelStyle}>Type</label>
              <select id="ua-type" value={requestType} onChange={e => setRequestType(e.target.value)} style={inputStyle}>
                {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ua-country" style={labelStyle}>Country</label>
              <select id="ua-country" value={country} onChange={e => setCountry(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {countryOptions.map(c => <option key={c} value={c}>{getFlag(c)} {getCountryName(c) || c}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="ua-assignee" style={labelStyle}>Assignee</label>
              <select id="ua-assignee" value={assigneeEmail} onChange={e => setAssigneeEmail(e.target.value)} style={inputStyle}>
                <option value="">— Unassigned —</option>
                {assigneeOptions.map(m => <option key={m.email} value={m.email}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ua-priority" style={labelStyle}>Priority</label>
              <select id="ua-priority" value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="ua-status" style={labelStyle}>Status</label>
              <select id="ua-status" value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ua-link" style={labelStyle}>{meta.requiresLink ? 'Link to Task *' : 'Link to Task'}</label>
              <input
                id="ua-link"
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://…"
                required={meta.requiresLink}
                style={{ ...inputStyle, borderColor: linkUrl && !linkOk ? '#d42d35' : '#e8e8e8' }}
              />
              {linkUrl && !linkOk && (
                <div style={{ fontSize: 11, color: '#d42d35', marginTop: 4 }}>
                  Must be a valid http(s) URL
                </div>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="ua-desc" style={labelStyle}>
              {isCaseMonitoring ? 'What to watch out for' : 'Description'}
            </label>
            <textarea
              id="ua-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={20000}
              placeholder={isCaseMonitoring
                ? "Describe the case the MOC should monitor — current state, triggers to watch for, any deadlines."
                : "Optional context, linked tickets, what's blocking…"}
              rows={isCaseMonitoring ? 5 : 4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* 2026-05-22 — Case Monitoring only. The MOC's playbook. */}
          {isCaseMonitoring && (
            <div>
              <label htmlFor="ua-action" style={labelStyle}>Action required *</label>
              <textarea
                id="ua-action"
                value={actionRequired}
                onChange={e => setActionRequired(e.target.value)}
                maxLength={20000}
                placeholder="If the case triggers, the MOC should… (countersign, escalate to TL on call, deposit, cancel offboarding, etc.)"
                rows={3}
                required
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  borderColor: actionRequiredOk ? '#e8e8e8' : '#fde68a',
                  background: actionRequiredOk ? 'var(--surface)' : '#fffbeb',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Be explicit. The MOC will read this verbatim when the case fires after hours.
              </div>
            </div>
          )}

          {error && (
            <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '9px 18px', borderRadius: 10, border: 'none',
                background: canSubmit ? (isCaseMonitoring ? '#7c3aed' : '#1b1b1b') : '#9e9e9e',
                color: 'white', fontSize: 13, fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Creating…' : meta.submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
