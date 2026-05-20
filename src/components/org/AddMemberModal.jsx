// ── AddMemberModal (Phase 3, 2026-05-20) ───────────────────────────────────
// Lightweight centered modal for adding a new team member directly under
// an org node. Captures the minimum we need to seed an override row;
// admins can fill in the rest from the MemberDetailDrawer once the
// person is in the chart.

import { useEffect, useState } from 'react';

const ACCESS_OPTIONS = [
  { id: 'agent',            label: 'Agent' },
  { id: 'team_lead',        label: 'Team Lead' },
  { id: 'regional_manager', label: 'Regional Manager' },
  { id: 'admin',            label: 'Admin' },
];

const TITLE_SUGGESTIONS = [
  'HR Experience Specialist',
  'HR Experience Manager',
  'Senior HR Experience Manager',
  'Operations Analyst',
  'Team Lead, HR Experience',
];

export default function AddMemberModal({
  open, node, leadEmail, onClose, onSubmit,
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    title: TITLE_SUGGESTIONS[0],
    access: 'agent',
    managerEmail: leadEmail || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: '',
      email: '',
      title: TITLE_SUGGESTIONS[0],
      access: 'agent',
      managerEmail: leadEmail || '',
    });
    setError(null);
  }, [open, leadEmail]);

  if (!open || !node) return null;

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setError(null);
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name) { setError('Name is required.'); return; }
    if (!email) { setError('Email is required.'); return; }
    if (!email.endsWith('@deel.com')) { setError('Email must be a @deel.com address.'); return; }
    setSaving(true);
    try {
      const res = await onSubmit({
        name,
        email,
        title: form.title,
        access: form.access,
        managerEmail: form.managerEmail.trim().toLowerCase() || null,
        orgNodeId: node.id,
      });
      if (res && res.ok === false) throw new Error(res.error || 'Could not add member');
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not add member');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1500,
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(480px, 92vw)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--purple-light)', color: 'var(--purple)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="bi bi-person-plus" style={{ fontSize: 16 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text)' }}>
              Add member to {node.name}
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
              They land under {node.name} on the chart. Edit their profile any time after.
            </div>
          </div>
          <button
            type="button" aria-label="Close" onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 6, color: 'var(--text-secondary)', borderRadius: 6,
            }}
          ><i className="bi bi-x-lg" style={{ fontSize: 14 }} /></button>
        </div>

        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div role="alert" style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'var(--red-light, #fef2f2)',
              color: 'var(--red-solid, #b91c1c)',
              fontSize: 'var(--font-sm)', fontWeight: 500,
            }}>{error}</div>
          )}

          <Field label="Full name" required>
            <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Doe" style={inputStyle} />
          </Field>
          <Field label="Email" required>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane.doe@deel.com" style={inputStyle} />
          </Field>
          <Field label="Title">
            <input value={form.title} onChange={e => set('title', e.target.value)} list="title-suggestions" style={inputStyle} />
            <datalist id="title-suggestions">
              {TITLE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Role">
              <select value={form.access} onChange={e => set('access', e.target.value)} style={inputStyle}>
                {ACCESS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Manager email" hint={leadEmail ? `Defaults to ${node.name}'s lead.` : null}>
              <input value={form.managerEmail} onChange={e => set('managerEmail', e.target.value)} placeholder="manager@deel.com" style={inputStyle} />
            </Field>
          </div>
        </div>

        <div style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--border-light)',
          background: 'var(--surface-2)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button type="button" onClick={onClose} disabled={saving} style={secondaryBtn()}>Cancel</button>
          <button
            type="button" onClick={handleSubmit}
            disabled={saving || !form.name.trim() || !form.email.trim()}
            style={{
              ...primaryBtn(),
              opacity: saving || !form.name.trim() || !form.email.trim() ? 0.55 : 1,
              cursor: saving || !form.name.trim() || !form.email.trim() ? 'not-allowed' : 'pointer',
            }}
          >{saving ? 'Adding…' : 'Add member'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 'var(--font-xs)', fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {label}{required && <span style={{ color: 'var(--red-solid, #b91c1c)', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 'var(--font-md)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

function primaryBtn() {
  return {
    padding: '8px 16px', height: 36,
    background: 'var(--purple)', border: 'none',
    borderRadius: 'var(--radius-lg)', color: 'white',
    fontSize: 'var(--font-base)', fontWeight: 600,
    fontFamily: 'inherit',
  };
}
function secondaryBtn() {
  return {
    padding: '8px 16px', height: 36,
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--font-base)', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
