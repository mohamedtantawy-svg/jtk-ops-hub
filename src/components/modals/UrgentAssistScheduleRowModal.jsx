// ── UrgentAssistScheduleRowModal ────────────────────────────────────────
// Edit (or create) a single day in the HRX Urgent Assist MOC schedule.
// 6 slots — EMEA / NAM / APAC × main + backup — each typed as a member
// email with autocomplete from the live roster. Save POSTs the date as
// an upsert key so editing an existing day overwrites in place.

import { useEffect, useMemo, useRef, useState } from 'react';
import { upsertUrgentAssistScheduleDay } from '../../services/urgentAssistScheduleApi';
import { useTeamMembers } from '../../hooks/useTeamMembers';

const inputStyle = {
  width: '100%', padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 13, color: 'var(--text)', background: 'var(--surface)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 10, fontWeight: 700, color: 'var(--text-secondary, #616161)', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 4, display: 'block',
};

const SLOTS = [
  { key: 'emeaMain',   label: 'EMEA Main',   region: 'emea', kind: 'main',   color: '#15803d', bg: '#dcfce7' },
  { key: 'emeaBackup', label: 'EMEA Backup', region: 'emea', kind: 'backup', color: '#15803d', bg: '#f0fdf4' },
  { key: 'namMain',    label: 'NAM Main',    region: 'nam',  kind: 'main',   color: '#b45309', bg: '#fed7aa' },
  { key: 'namBackup',  label: 'NAM Backup',  region: 'nam',  kind: 'backup', color: '#b45309', bg: '#fff7ed' },
  { key: 'apacMain',   label: 'APAC Main',   region: 'apac', kind: 'main',   color: '#991b1b', bg: '#fecaca' },
  { key: 'apacBackup', label: 'APAC Backup', region: 'apac', kind: 'backup', color: '#991b1b', bg: '#fee2e2' },
];

function MemberPicker({ value, onChange, members, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const query = String(value || '').toLowerCase();
  const filtered = useMemo(() => {
    const list = members || [];
    if (!query) return list.slice(0, 8);
    return list
      .filter(m => `${m.name || ''} ${m.email || ''}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [members, query]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value || ''}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || 'Type name or email…'}
        style={inputStyle}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
          maxHeight: 220, overflowY: 'auto', zIndex: 50,
        }}>
          {filtered.map(m => (
            <div
              key={m.email}
              role="button"
              tabIndex={0}
              onMouseDown={(e) => { e.preventDefault(); onChange(m.email); setOpen(false); }}
              style={{ padding: '7px 11px', fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontWeight: 500 }}>{m.name || m.email}</div>
              {m.name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.email}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function UrgentAssistScheduleRowModal({ existing, onClose, onSaved }) {
  const { members } = useTeamMembers();
  const backdropRef = useRef(null);

  const initial = useMemo(() => ({
    scheduleDate: existing?.scheduleDate || todayIso(),
    emeaMainEmail:   existing?.emeaMainEmail   || '',
    emeaBackupEmail: existing?.emeaBackupEmail || '',
    namMainEmail:    existing?.namMainEmail    || '',
    namBackupEmail:  existing?.namBackupEmail  || '',
    apacMainEmail:   existing?.apacMainEmail   || '',
    apacBackupEmail: existing?.apacBackupEmail || '',
    notes: existing?.notes || '',
  }), [existing]);
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Resolve names from email match against the roster — server also
      // does this, but resolving on the client lets the optimistic
      // refresh land with the right names without waiting for the next
      // GET to roundtrip.
      const byEmail = new Map((members || []).map(m => [String(m.email || '').toLowerCase(), m]));
      const nameFor = (email) => byEmail.get(String(email || '').toLowerCase())?.name || null;
      const payload = {
        scheduleDate: form.scheduleDate,
        emeaMainEmail:   form.emeaMainEmail,   emeaMainName:   nameFor(form.emeaMainEmail),
        emeaBackupEmail: form.emeaBackupEmail, emeaBackupName: nameFor(form.emeaBackupEmail),
        namMainEmail:    form.namMainEmail,    namMainName:    nameFor(form.namMainEmail),
        namBackupEmail:  form.namBackupEmail,  namBackupName:  nameFor(form.namBackupEmail),
        apacMainEmail:   form.apacMainEmail,   apacMainName:   nameFor(form.apacMainEmail),
        apacBackupEmail: form.apacBackupEmail, apacBackupName: nameFor(form.apacBackupEmail),
        notes: form.notes || null,
      };
      const res = await upsertUrgentAssistScheduleDay(payload);
      onSaved?.(res?.item);
    } catch (err) {
      setError(err?.message || 'Failed to save');
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="uas-row-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1500,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 600,
        maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        border: '1px solid var(--border)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light, #f0efed)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-calendar3" style={{ fontSize: 16, color: '#7c3aed' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="uas-row-title" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {existing ? 'Edit schedule day' : 'Add schedule day'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Pick the date + the main + backup for each region.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 11 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Date *</label>
            <input
              type="date"
              required
              value={form.scheduleDate}
              onChange={e => set('scheduleDate', e.target.value)}
              disabled={!!existing}
              title={existing ? 'Date is the row key — to move a day, delete this row and add a new one.' : ''}
              style={{ ...inputStyle, opacity: existing ? 0.6 : 1, cursor: existing ? 'not-allowed' : 'text' }}
            />
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10,
          }}>
            {SLOTS.map(slot => (
              <div key={slot.key}>
                <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: slot.color, display: 'inline-block' }} />
                  {slot.label}
                </label>
                <MemberPicker
                  value={form[`${slot.key}Email`]}
                  onChange={(v) => set(`${slot.key}Email`, v)}
                  members={members}
                  placeholder="email or name"
                />
              </div>
            ))}
          </div>

          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Anything the team should know about this day…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div role="alert" style={{ padding: '7px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 5 }} />{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 2 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #616161)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '8px 18px', borderRadius: 9, border: 'none',
                background: submitting ? 'var(--text-muted)' : '#7c3aed',
                color: 'white', fontSize: 12, fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Saving…' : (existing ? 'Save changes' : 'Add day')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
