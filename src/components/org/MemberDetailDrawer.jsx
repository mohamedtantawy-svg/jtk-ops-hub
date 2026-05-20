// ── MemberDetailDrawer (Phase 3, 2026-05-20) ───────────────────────────────
// Right-side drawer for editing a member's full profile from the Org tab.
// Covers everything Team.jsx's edit-allocation, permissions, on-leave, and
// remove modals used to do — now mounted off the visual chart so admins
// can manage people without leaving the org surface.
//
// All writes go through the existing useTeamMembers hook
// (updateMember / removeMember / toggleOnLeave / setCountries) so the
// Home page team table + briefing + queue scoping see the same updates
// in real time.

import { useEffect, useMemo, useState } from 'react';
import { FLAGS, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';

const ACCESS_OPTIONS = [
  { id: 'agent',            label: 'Agent' },
  { id: 'team_lead',        label: 'Team Lead' },
  { id: 'regional_manager', label: 'Regional Manager' },
  { id: 'admin',            label: 'Admin' },
];

const SERVICE_OPTIONS = ['EOR', 'LifeCycle', 'New Services', 'All'];

function fmtNodePath(nodeId, tree) {
  if (!nodeId) return null;
  const chain = [];
  let cur = tree.byId.get(nodeId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? tree.byId.get(cur.parentId) : null;
  }
  if (!chain.length) return null;
  return chain;
}

export default function MemberDetailDrawer({
  open, member, tree, rootNodes,
  canEdit, onClose, onUpdate, onRemove, onToggleLeave, onSetCountries,
}) {
  const baseline = useMemo(() => member ? {
    name: member.name || '',
    title: member.title || '',
    access: member.access || 'agent',
    managerEmail: member.managerEmail || '',
    service: member.service || 'EOR',
    orgNodeId: member.orgNodeId || '',
    isAnnouncementsAdmin: member.isAnnouncementsAdmin === true,
    isAccessAdmin: member.isAccessAdmin === true,
    isHrHubAdmin: member.isHrHubAdmin === true,
    isLeaderAlertsAdmin: member.isLeaderAlertsAdmin === true,
    onLeave: member.onLeave === true,
    countries: Array.isArray(member.countries) ? member.countries : [],
  } : null, [member]);

  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');

  useEffect(() => { setForm(baseline); setError(null); setConfirmRemove(false); }, [baseline]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const dirty = useMemo(() => {
    if (!baseline || !form) return false;
    for (const k of Object.keys(baseline)) {
      if (k === 'countries') {
        const a = baseline.countries || [];
        const b = form.countries || [];
        if (a.length !== b.length || a.some((c, i) => c !== b[i])) return true;
        continue;
      }
      if (baseline[k] !== form[k]) return true;
    }
    return false;
  }, [baseline, form]);

  const handleSave = async () => {
    if (!member) return;
    setError(null);
    setSaving(true);
    try {
      const patch = {};
      const map = {
        name: 'name', title: 'title', access: 'access',
        managerEmail: 'managerEmail', service: 'service',
        orgNodeId: 'orgNodeId',
        isAnnouncementsAdmin: 'isAnnouncementsAdmin',
        isAccessAdmin: 'isAccessAdmin',
      };
      for (const [src, dst] of Object.entries(map)) {
        if (form[src] !== baseline[src]) patch[dst] = form[src] === '' ? null : form[src];
      }
      if (form.onLeave !== baseline.onLeave) {
        await onToggleLeave(member.email);
      }
      const before = baseline.countries.slice().sort();
      const after = form.countries.slice().sort();
      const countriesChanged = before.length !== after.length || before.some((c, i) => c !== after[i]);
      if (countriesChanged) {
        await onSetCountries(member.email, form.countries);
      }
      if (Object.keys(patch).length > 0) {
        const res = await onUpdate(member.email, patch);
        if (res && res.ok === false) {
          throw new Error(res.error || 'Save failed');
        }
      }
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!member) return;
    setSaving(true);
    setError(null);
    try {
      const res = await onRemove(member.email);
      if (res && res.ok === false) throw new Error(res.error || 'Could not remove member');
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not remove');
    } finally {
      setSaving(false);
    }
  };

  const toggleCountry = (code) => {
    setForm(prev => {
      const has = prev.countries.includes(code);
      return { ...prev, countries: has
        ? prev.countries.filter(c => c !== code)
        : [...prev.countries, code] };
    });
  };

  const countryList = useMemo(() => {
    const all = Object.keys(FLAGS).filter(c => c.length === 2 && c !== 'UK');
    const lc = countryQuery.trim().toLowerCase();
    if (!lc) return all.sort();
    return all
      .filter(c => c.toLowerCase().includes(lc) || getCountryName(c).toLowerCase().includes(lc))
      .sort();
  }, [countryQuery]);

  if (!open || !member || !form) return null;
  const currentChain = fmtNodePath(form.orgNodeId, tree);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${member.name}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.42)',
        zIndex: 1500,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 'min(540px, 96vw)',
          background: 'var(--surface)',
          boxShadow: '-12px 0 30px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <Avatar size={44} name={member.name} initials={member.initials} src={member.avatarUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--font-lg)', fontWeight: 700,
              color: 'var(--text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{member.name}</div>
            <div style={{
              fontSize: 'var(--font-sm)', color: 'var(--text-secondary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{member.email}</div>
          </div>
          {member.onLeave && (
            <span style={{
              padding: '3px 9px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--orange-light)',
              color: 'var(--orange)',
              fontSize: 'var(--font-xs)', fontWeight: 700,
            }}>On leave</span>
          )}
          <button
            type="button" aria-label="Close" onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 6, color: 'var(--text-secondary)',
              borderRadius: 6, flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <i className="bi bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        {/* Current allocation breadcrumb */}
        <div style={{
          padding: '10px 22px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border-light)',
          fontSize: 'var(--font-sm)',
          color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', gap: 6,
          flexShrink: 0,
        }}>
          <i className="bi bi-diagram-3" style={{ fontSize: 12 }} />
          <span style={{ color: 'var(--text-muted)' }}>Current allocation:</span>
          {currentChain ? (
            <span style={{ color: 'var(--text)' }}>
              {currentChain.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>›</span>}
                  {n.name}
                </span>
              ))}
            </span>
          ) : (
            <span style={{ color: 'var(--orange)', fontWeight: 600 }}>Unassigned</span>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {error && (
            <div role="alert" style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'var(--red-light, #fef2f2)',
              color: 'var(--red-solid, #b91c1c)',
              fontSize: 'var(--font-sm)', fontWeight: 500,
            }}>{error}</div>
          )}

          <Section title="Allocation" subtitle="Where this person sits in the org chart.">
            <NodePicker
              tree={tree}
              rootNodes={rootNodes}
              value={form.orgNodeId}
              onChange={(id) => set('orgNodeId', id)}
              disabled={!canEdit}
            />
          </Section>

          <Section title="Basics">
            <Field label="Name">
              <input value={form.name} onChange={e => set('name', e.target.value)} disabled={!canEdit} style={inputStyle} />
            </Field>
            <Field label="Title">
              <input value={form.title} onChange={e => set('title', e.target.value)} disabled={!canEdit} style={inputStyle} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Role">
                <select value={form.access} onChange={e => set('access', e.target.value)} disabled={!canEdit} style={inputStyle}>
                  {ACCESS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Service">
                <select value={form.service} onChange={e => set('service', e.target.value)} disabled={!canEdit} style={inputStyle}>
                  {SERVICE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Manager email" hint="Reporting line. Independent of org placement; we'll suggest aligning if it drifts.">
              <input value={form.managerEmail} onChange={e => set('managerEmail', e.target.value)} disabled={!canEdit} style={inputStyle} placeholder="manager@deel.com" />
            </Field>
          </Section>

          <Section title="Permissions" subtitle="Per-user grants — additive on top of the role tier.">
            <ToggleRow
              label="On leave"
              hint="Hides the agent from queue auto-assign while leave is active."
              icon="bi-airplane"
              checked={form.onLeave}
              onChange={v => set('onLeave', v)}
              disabled={!canEdit}
            />
            <ToggleRow
              label="Announcements admin"
              hint="Can compose, edit, and pin announcements for everyone."
              icon="bi-megaphone"
              checked={form.isAnnouncementsAdmin}
              onChange={v => set('isAnnouncementsAdmin', v)}
              disabled={!canEdit}
            />
            <ToggleRow
              label="Access admin"
              hint="Can add or remove team members and edit allocations."
              icon="bi-shield-lock"
              checked={form.isAccessAdmin}
              onChange={v => set('isAccessAdmin', v)}
              disabled={!canEdit}
            />
          </Section>

          <Section title="Countries" subtitle="Country ownership for this member (separate from team country scope).">
            <input
              type="search"
              value={countryQuery}
              onChange={e => setCountryQuery(e.target.value)}
              placeholder="Search countries…"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            {form.countries.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {form.countries.map(c => (
                  <span key={c} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--purple-light)',
                    color: 'var(--purple)',
                    fontSize: 'var(--font-xs)', fontWeight: 600,
                  }}>
                    <span>{FLAGS[c] || ''}</span> {c}
                    {canEdit && (
                      <button type="button" onClick={() => toggleCountry(c)} aria-label={`Remove ${c}`}
                        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 2 }}>
                        <i className="bi bi-x" style={{ fontSize: 11 }} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div style={{
              maxHeight: 200, overflowY: 'auto',
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface-2)',
            }}>
              {countryList.length === 0 ? (
                <div style={{ padding: 12, fontSize: 'var(--font-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
                  No countries match.
                </div>
              ) : countryList.slice(0, 80).map(c => {
                const active = form.countries.includes(c);
                return (
                  <button
                    key={c} type="button"
                    onClick={() => canEdit && toggleCountry(c)}
                    disabled={!canEdit}
                    aria-pressed={active}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 12px',
                      background: active ? 'var(--purple-light)' : 'transparent',
                      border: 'none', textAlign: 'left',
                      fontSize: 'var(--font-sm)',
                      color: active ? 'var(--purple)' : 'var(--text)',
                      fontWeight: active ? 600 : 500,
                      cursor: canEdit ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { if (!active && canEdit) e.currentTarget.style.background = 'var(--surface-3)'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 14 }}>{FLAGS[c] || '🏳'}</span>
                    <span style={{ flex: 1 }}>{getCountryName(c)}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>{c}</span>
                    {active && <i className="bi bi-check2" style={{ fontSize: 14 }} />}
                  </button>
                );
              })}
            </div>
          </Section>

          {canEdit && (
            <Section title="Danger zone">
              {confirmRemove ? (
                <div style={{
                  padding: 16,
                  border: '1px solid var(--red-mid, #fee2e2)',
                  background: 'var(--red-light, #fef2f2)',
                  borderRadius: 10,
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div style={{ fontSize: 'var(--font-sm)', color: 'var(--red-solid, #b91c1c)', fontWeight: 600 }}>
                    Remove {member.name}? They'll be hidden from the org chart and queues. Tickets they own keep their assignee — reassign first if you need them moved.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setConfirmRemove(false)} disabled={saving} style={secondaryBtn()}>Keep</button>
                    <button type="button" onClick={handleRemove} disabled={saving} style={dangerBtn()}>
                      {saving ? 'Removing…' : 'Remove member'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmRemove(true)} style={dangerBtnOutline()}>
                  <i className="bi bi-trash" /> Remove from org
                </button>
              )}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 22px', borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
        }}>
          <button type="button" onClick={onClose} disabled={saving} style={secondaryBtn()}>Cancel</button>
          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              style={{
                ...primaryBtn(),
                opacity: saving || !dirty ? 0.55 : 1,
                cursor: saving || !dirty ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cascading org-node picker (Department → Team → Sub-team) ─────────────
function NodePicker({ tree, rootNodes, value, onChange, disabled }) {
  // Compute the chain that leads to the current value so the dropdowns
  // initialise correctly. If value is null, only the top-level select is
  // populated.
  const chain = useMemo(() => {
    if (!value) return [];
    const out = [];
    let cur = tree.byId.get(value);
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId ? tree.byId.get(cur.parentId) : null;
    }
    return out;
  }, [value, tree]);

  const levels = [];
  let parentId = null;
  let depth = 0;
  while (true) {
    const siblings = (tree.byParent.get(parentId || '__root__') || []).filter(n => !n.isArchived);
    if (!siblings.length) break;
    const selected = chain[depth]?.id || '';
    levels.push({ depth, siblings, selected, parentId });
    if (!selected) break;
    parentId = selected;
    depth += 1;
    if (depth > 8) break; // hard guard
  }

  const handleLevelChange = (depth, newValue) => {
    // Setting a level resets every deeper level — picking "EOR Operations"
    // wipes any prior EMEA selection.
    onChange(newValue || (depth === 0 ? null : levels[depth - 1].selected));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {levels.map(l => (
        <select
          key={l.depth}
          value={l.selected}
          onChange={e => handleLevelChange(l.depth, e.target.value)}
          disabled={disabled}
          style={inputStyle}
        >
          <option value="">— {l.depth === 0 ? 'Select department' : 'Select child'} —</option>
          {l.siblings.map(n => (
            <option key={n.id} value={n.id}>{n.name}{n.kind === 'department' ? ' (dept)' : ''}</option>
          ))}
        </select>
      ))}
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent', border: 'none',
            color: 'var(--orange)',
            fontSize: 'var(--font-xs)', fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            padding: '4px 0', fontFamily: 'inherit',
          }}
        >
          <i className="bi bi-x-circle" /> Clear allocation
        </button>
      )}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{
          fontSize: 'var(--font-md)', fontWeight: 700,
          color: 'var(--text)',
        }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 'var(--font-xs)', fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function ToggleRow({ label, hint, icon, checked, onChange, disabled }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: 12,
      border: '1px solid var(--border)',
      borderRadius: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: 'var(--surface)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: checked ? 'var(--purple-light)' : 'var(--surface-2)',
        color: checked ? 'var(--purple)' : 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <i className={`bi ${icon}`} style={{ fontSize: 14 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--font-md)', fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div style={{
        width: 36, height: 20, borderRadius: 10,
        background: checked ? 'var(--purple)' : 'var(--surface-3)',
        position: 'relative',
        transition: 'background .12s',
        flexShrink: 0, marginTop: 2,
      }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'inherit' }}
        />
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: 'white',
          transition: 'left .12s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </div>
    </label>
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
  transition: 'border-color .12s',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

function primaryBtn() {
  return {
    padding: '8px 16px', height: 36,
    background: 'var(--purple)',
    border: 'none',
    borderRadius: 'var(--radius-lg)',
    color: 'white',
    fontSize: 'var(--font-base)', fontWeight: 600,
    cursor: 'pointer',
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
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
function dangerBtn() {
  return {
    padding: '8px 16px', height: 36,
    background: 'var(--red-solid, #b91c1c)',
    border: 'none',
    borderRadius: 'var(--radius-lg)',
    color: 'white',
    fontSize: 'var(--font-base)', fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
function dangerBtnOutline() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', height: 36,
    background: 'transparent',
    border: '1px solid var(--red-mid, #fee2e2)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--red-solid, #b91c1c)',
    fontSize: 'var(--font-base)', fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
