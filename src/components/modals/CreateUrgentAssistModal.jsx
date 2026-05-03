// ── CreateUrgentAssistModal ──────────────────────────────────────────────
// Captures every column the Urgent Assist table renders so the manual row
// drops in fully-formed:
//   • Subject
//   • Type (defaults to "HRX Urgent Assist Request"; editable)
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
import { FLAGS } from '../../data/constants';
import { createUrgentAssist } from '../../services/urgentAssistApi';

const REQUEST_TYPES = [
  'HRX Urgent Assist Request',
  'HRX Urgent Assist',
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
  width: '100%', padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: 10,
  fontSize: 13, color: '#1b1b1b', background: 'var(--surface)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: '#616161', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 6, display: 'block',
};

function isValidUrl(value) {
  if (!value) return true; // optional
  if (value.length > 2000) return false;
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export default function CreateUrgentAssistModal({ onClose, onCreated, currentUser }) {
  const backdropRef = useRef(null);
  const firstFieldRef = useRef(null);

  const [subject, setSubject] = useState('');
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [country, setCountry] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [status, setStatus] = useState('new');
  const [priority, setPriority] = useState('high');
  const [linkUrl, setLinkUrl] = useState('');
  const [description, setDescription] = useState('');
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
  const canSubmit = subjectOk && linkOk && !submitting;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const assignee = MEMBERS_BY_EMAIL[assigneeEmail.toLowerCase()] || null;
      const payload = {
        subject: subject.trim(),
        requestType,
        country: country || null,
        assigneeEmail: assigneeEmail || null,
        assigneeName: assignee?.name || null,
        linkUrl: linkUrl.trim() || null,
        description: description.trim() || null,
        status,
        priority,
      };
      const created = await createUrgentAssist(payload);
      onCreated?.(created);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Failed to create urgent assist');
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
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-exclamation-octagon-fill" style={{ fontSize: 18, color: '#d42d35' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="urgent-assist-title" style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>New Urgent Assist</div>
            <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 2 }}>Logs a manual urgent-assist request — 6h SLA from now.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                {countryOptions.map(c => <option key={c} value={c}>{FLAGS[c]} {c}</option>)}
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
              <label htmlFor="ua-link" style={labelStyle}>Link to Task</label>
              <input
                id="ua-link"
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://…"
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
            <label htmlFor="ua-desc" style={labelStyle}>Description</label>
            <textarea
              id="ua-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={20000}
              placeholder="Optional context, linked tickets, what's blocking…"
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #e8e8e8', background: 'var(--surface)', fontSize: 13, fontWeight: 500, color: '#616161', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '9px 18px', borderRadius: 10, border: 'none',
                background: canSubmit ? '#1b1b1b' : '#9e9e9e',
                color: 'white', fontSize: 13, fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Creating…' : 'Create Urgent Assist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
