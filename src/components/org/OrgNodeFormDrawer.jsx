// ── OrgNodeFormDrawer (Phase 1, 2026-05-20) ────────────────────────────────
// Right-side drawer for creating + editing a node. Same component handles
// both flows — when `node` is null we're creating; otherwise we're editing.
// Matches the HrHubSettingsPanel drawer pattern: dark overlay + right-side
// 480px panel + close + save buttons.

import { useEffect, useMemo, useState } from 'react';
import { FLAGS, getCountryName } from '../../data/constants';
import {
  listNodeAdmins, grantNodeAdmin, revokeNodeAdmin,
  listNodeVacancies, addNodeVacancy, removeNodeVacancy,
} from '../../services/orgApi';

const PRESET_COLORS = [
  { hex: '#7c3aed', name: 'Purple' },
  { hex: '#1f74b3', name: 'Blue' },
  { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#10b981', name: 'Green' },
  { hex: '#d97706', name: 'Amber' },
  { hex: '#dc2626', name: 'Red' },
  { hex: '#db2777', name: 'Pink' },
  { hex: '#6b7280', name: 'Slate' },
];

const PRESET_ICONS = [
  'bi-building',         // generic department
  'bi-people-fill',
  'bi-people',
  'bi-globe',
  'bi-globe2',
  'bi-stars',
  'bi-rocket-takeoff',
  'bi-shield-check',
  'bi-cash-coin',
  'bi-graph-up',
  'bi-headset',
  'bi-tools',
  'bi-diagram-3',
  'bi-diagram-2',
  'bi-grid-1x2',
  'bi-flag',
];

function emptyForm(kind, parentNode) {
  return {
    kind,
    name: '',
    description: '',
    leadEmail: '',
    color: kind === 'department' ? '#7c3aed' : '#1f74b3',
    icon: kind === 'department' ? 'bi-building' : 'bi-people',
    slackChannel: '',
    // Sub-teams inherit parent's country list as a starting point. Admin
    // can edit before saving.
    countryCodes: Array.isArray(parentNode?.countryCodes) ? [...parentNode.countryCodes] : [],
    // Phase 5: nested config slots — SLA cascade + dashboards stub.
    slaTicketMins: '',
    slaOnboardingMins: '',
    dashboards: '',
  };
}

export default function OrgNodeFormDrawer({
  mode,            // 'create' | 'edit'
  open,
  onClose,
  parentNode,      // for 'create': the chosen parent (null = root); for 'edit': the node's parent for sibling-name hints
  defaultKind,     // for 'create': 'department' | 'team'
  node,            // for 'edit': the node being edited
  onSave,          // async (payload) => savedNode
  // Phase 10b (2026-05-20): resolves an email to its current top-level
  // department so we can warn before moving a member across dept boundaries.
  // (email) => { node, topLevel, memberName } | null
  getCurrentDeptForEmail,
}) {
  const initial = useMemo(() => {
    if (mode === 'edit' && node) {
      const ticket = node.config?.sla?.thresholds?.ticket;
      const onb = node.config?.sla?.thresholds?.onboarding;
      const dashSlugs = Array.isArray(node.config?.dashboards) ? node.config.dashboards.join(', ') : '';
      return {
        kind: node.kind,
        name: node.name || '',
        description: node.description || '',
        leadEmail: node.leadEmail || '',
        color: node.color || (node.kind === 'department' ? '#7c3aed' : '#1f74b3'),
        icon: node.icon || (node.kind === 'department' ? 'bi-building' : 'bi-people'),
        slackChannel: node.slackChannel || '',
        countryCodes: node.countryCodes || [],
        slaTicketMins: ticket != null ? String(ticket) : '',
        slaOnboardingMins: onb != null ? String(onb) : '',
        dashboards: dashSlugs,
      };
    }
    return emptyForm(defaultKind || 'team', parentNode);
  }, [mode, node, defaultKind, parentNode]);

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [countryQuery, setCountryQuery] = useState('');

  useEffect(() => { setForm(initial); setError(null); }, [initial]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const toggleCountry = (code) => {
    setForm(prev => {
      const has = prev.countryCodes.includes(code);
      return { ...prev, countryCodes: has
        ? prev.countryCodes.filter(c => c !== code)
        : [...prev.countryCodes, code] };
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

  const handleSave = async () => {
    setError(null);
    const name = form.name.trim();
    if (!name) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      // Phase 5: roll the SLA + dashboards inputs into the config blob.
      // Preserve any keys the user hasn't surfaced yet (capacity, MOC, etc.)
      const baseConfig = (mode === 'edit' && node?.config && typeof node.config === 'object') ? { ...node.config } : {};
      const slaThresholds = {};
      const ticketMins = Number(form.slaTicketMins);
      const onbMins = Number(form.slaOnboardingMins);
      if (Number.isFinite(ticketMins) && form.slaTicketMins !== '') slaThresholds.ticket = ticketMins;
      if (Number.isFinite(onbMins) && form.slaOnboardingMins !== '') slaThresholds.onboarding = onbMins;
      const slaPatch = Object.keys(slaThresholds).length
        ? { ...(baseConfig.sla || {}), thresholds: slaThresholds }
        : (baseConfig.sla && (delete baseConfig.sla.thresholds, baseConfig.sla));
      const dashSlugs = String(form.dashboards || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const nextConfig = {
        ...baseConfig,
        ...(slaPatch ? { sla: slaPatch } : { sla: undefined }),
        dashboards: dashSlugs,
      };
      // Drop undefined keys so JSONB stays clean.
      const cleanConfig = Object.fromEntries(
        Object.entries(nextConfig).filter(([, v]) => v !== undefined),
      );

      const payload = {
        kind: form.kind,
        name,
        description: form.description.trim() || null,
        leadEmail: form.leadEmail.trim().toLowerCase() || null,
        color: form.color || null,
        icon: form.icon || null,
        slackChannel: form.slackChannel.trim() || null,
        countryCodes: form.countryCodes,
        config: cleanConfig,
      };
      if (mode === 'create') {
        payload.parentId = parentNode?.id || null;
      }
      await onSave(payload);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const isEdit = mode === 'edit';
  const titleText = isEdit
    ? `Edit ${form.kind === 'department' ? 'department' : 'team'}`
    : `New ${form.kind === 'department' ? 'department' : 'team'}${parentNode ? ` in ${parentNode.name}` : ''}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titleText}
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
          width: 'min(520px, 96vw)',
          background: 'var(--surface)',
          boxShadow: '-12px 0 30px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${form.color}22`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={`bi ${form.icon}`} style={{ color: form.color, fontSize: 14 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text)' }}>{titleText}</div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
              {isEdit
                ? 'Changes apply immediately. Members and child nodes are unaffected.'
                : 'Settings are saved to the org tree on create.'}
            </div>
          </div>
          <button
            type="button" aria-label="Close" onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 6, color: 'var(--text-secondary)',
              borderRadius: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <i className="bi bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div role="alert" style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'var(--red-light, #fef2f2)',
              color: 'var(--red-solid, #b91c1c)',
              fontSize: 'var(--font-sm)', fontWeight: 500,
            }}>{error}</div>
          )}

          {/* Kind switcher — create flow only, edit is locked. */}
          {!isEdit && !parentNode?.kind && (
            <Field label="Kind">
              <div style={{ display: 'flex', gap: 8 }}>
                {['department', 'team'].map(k => {
                  const active = form.kind === k;
                  // Spec: a team can't be a root node (we forbid this server-side too).
                  const disabled = k === 'team' && !parentNode;
                  return (
                    <button
                      key={k} type="button"
                      onClick={() => !disabled && set('kind', k)}
                      disabled={disabled}
                      style={{
                        flex: 1, padding: '10px 14px',
                        background: active ? 'var(--purple-light)' : 'var(--surface-2)',
                        border: `1px solid ${active ? 'var(--purple)' : 'var(--border)'}`,
                        borderRadius: 8,
                        color: active ? 'var(--purple)' : (disabled ? 'var(--text-disabled)' : 'var(--text)'),
                        fontSize: 'var(--font-md)', fontWeight: 600,
                        textTransform: 'capitalize',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >{k}</button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label="Name" required>
            <input
              autoFocus
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder={form.kind === 'department' ? 'e.g. HR Experience' : 'e.g. EOR Operations'}
              maxLength={120}
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </Field>

          <Field label="Description" hint="Short blurb shown under the name in the tree.">
            <textarea
              rows={3}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder={form.kind === 'department' ? 'What this department owns.' : 'What this team does.'}
              maxLength={2000}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </Field>

          <Field label="Lead email" hint="The person who runs this group. On create, they're auto-seeded as this department's Admin.">
            <input
              type="email"
              value={form.leadEmail}
              onChange={e => set('leadEmail', e.target.value)}
              placeholder="lead@deel.com"
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
            <LeadMoveWarning
              email={form.leadEmail}
              kind={form.kind}
              currentNodeId={node?.id || null}
              getCurrentDeptForEmail={getCurrentDeptForEmail}
            />
          </Field>

          <Field label="Slack channel" hint="Optional. Without the leading #.">
            <input
              type="text"
              value={form.slackChannel}
              onChange={e => set('slackChannel', e.target.value)}
              placeholder="hrx-eor-ops"
              maxLength={120}
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </Field>

          <Field label="Color">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRESET_COLORS.map(c => {
                const active = form.color === c.hex;
                return (
                  <button
                    key={c.hex} type="button" title={c.name}
                    onClick={() => set('color', c.hex)}
                    aria-label={c.name}
                    aria-pressed={active}
                    style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: c.hex,
                      border: `2px solid ${active ? 'var(--text)' : 'transparent'}`,
                      cursor: 'pointer',
                      transition: 'transform .12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  />
                );
              })}
            </div>
          </Field>

          <Field label="Icon">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESET_ICONS.map(i => {
                const active = form.icon === i;
                return (
                  <button
                    key={i} type="button"
                    onClick={() => set('icon', i)}
                    aria-pressed={active}
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: active ? `${form.color}22` : 'var(--surface-2)',
                      border: `1px solid ${active ? form.color : 'var(--border)'}`,
                      color: active ? form.color : 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all .12s',
                    }}
                  >
                    <i className={`bi ${i}`} style={{ fontSize: 14 }} />
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Phase 5 — SLA cascade override */}
          {isEdit && (
            <Field label="SLA override (minutes)" hint="Leave blank to inherit from the parent node. Sub-teams inherit if you don't set their own value.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Ticket</div>
                  <input type="number" min={0} value={form.slaTicketMins}
                    onChange={e => set('slaTicketMins', e.target.value)}
                    placeholder="inherit"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Onboarding</div>
                  <input type="number" min={0} value={form.slaOnboardingMins}
                    onChange={e => set('slaOnboardingMins', e.target.value)}
                    placeholder="inherit"
                    style={inputStyle}
                  />
                </div>
              </div>
            </Field>
          )}

          {/* Phase 5 — Dashboards stub (Phase 8 editor lands behind FF) */}
          {isEdit && (
            <Field label="Dashboard slugs" hint="Comma-separated. These map to the per-team mini-workspace landing in a follow-up phase.">
              <input value={form.dashboards} onChange={e => set('dashboards', e.target.value)}
                placeholder="hrx-eor-overview, hrx-eor-sla"
                style={inputStyle}
              />
            </Field>
          )}

          {/* Phase 5 — Delegated admins */}
          {isEdit && node && (
            <DelegatedAdminsSection nodeId={node.id} />
          )}

          {/* Phase 5 — Vacant role placeholders */}
          {isEdit && node && (
            <VacanciesSection nodeId={node.id} />
          )}

          <Field label="Countries" hint="Multi-select. Sub-teams inherit from their parent unless overridden.">
            <div>
              <input
                type="search"
                value={countryQuery}
                onChange={e => setCountryQuery(e.target.value)}
                placeholder="Search countries…"
                style={{ ...inputStyle, marginBottom: 8 }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
              {form.countryCodes.length > 0 && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                  marginBottom: 10,
                }}>
                  {form.countryCodes.map(c => (
                    <span key={c} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-pill)',
                      background: 'var(--purple-light)',
                      color: 'var(--purple)',
                      fontSize: 'var(--font-xs)', fontWeight: 600,
                    }}>
                      <span>{FLAGS[c] || ''}</span> {c}
                      <button type="button" onClick={() => toggleCountry(c)}
                        aria-label={`Remove ${c}`}
                        style={{
                          background: 'transparent', border: 'none',
                          color: 'inherit', cursor: 'pointer', padding: 0,
                          marginLeft: 2,
                        }}>
                        <i className="bi bi-x" style={{ fontSize: 11 }} />
                      </button>
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
                ) : countryList.map(c => {
                  const active = form.countryCodes.includes(c);
                  return (
                    <button
                      key={c} type="button"
                      onClick={() => toggleCountry(c)}
                      aria-pressed={active}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '7px 12px',
                        background: active ? 'var(--purple-light)' : 'transparent',
                        border: 'none', textAlign: 'left',
                        fontSize: 'var(--font-sm)',
                        color: active ? 'var(--purple)' : 'var(--text)',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-3)'; }}
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
            </div>
          </Field>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 22px', borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          flexShrink: 0,
        }}>
          <button
            type="button" onClick={onClose} disabled={saving}
            style={{
              padding: '8px 16px', height: 36,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-base)', fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >Cancel</button>
          <button
            type="button" onClick={handleSave} disabled={saving || !form.name.trim()}
            style={{
              padding: '8px 16px', height: 36,
              background: form.name.trim() ? 'var(--purple)' : 'var(--surface-3)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              color: form.name.trim() ? 'white' : 'var(--text-disabled)',
              fontSize: 'var(--font-base)', fontWeight: 600,
              cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: saving ? 0.65 : 1,
            }}
          >
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : `Create ${form.kind}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lead-move warning ───────────────────────────────────────────────────
// Phase 10b (2026-05-20): when the typed lead email already belongs to
// another active department, surface a confirm banner BEFORE the admin
// hits Save — the locked one-node-per-member rule means submitting will
// move the lead out of their current dept entirely.
function LeadMoveWarning({ email, kind, currentNodeId, getCurrentDeptForEmail }) {
  if (!getCurrentDeptForEmail) return null;
  const trimmed = (email || '').trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  const current = getCurrentDeptForEmail(trimmed);
  if (!current) return null;
  // Suppress when the lead is already in this exact node (edit flow with no
  // change) — re-saving an unchanged dept shouldn't show a scary banner.
  if (currentNodeId && current.node?.id === currentNodeId) return null;
  const fromDept = current.topLevel?.name || current.node?.name || 'their current group';
  return (
    <div role="alert" style={{
      marginTop: 8,
      padding: '10px 12px',
      borderRadius: 8,
      background: 'var(--orange-light, #fff7ed)',
      border: '1px solid var(--orange, #ea580c)',
      color: 'var(--orange, #c2410c)',
      fontSize: 'var(--font-sm)',
      lineHeight: 1.4,
      display: 'flex', gap: 8, alignItems: 'flex-start',
    }}>
      <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: 13, marginTop: 2, flexShrink: 0 }} />
      <div>
        <strong>{current.memberName}</strong> is currently in <strong>{fromDept}</strong>.
        Saving this {kind} will move them out of {fromDept}
        {kind === 'department' ? ' and seat them here as Admin.' : '.'}
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 'var(--font-sm)', fontWeight: 600,
        color: 'var(--text)',
        marginBottom: 6,
      }}>
        {label}
        {required && <span style={{ color: 'var(--red-solid, #b91c1c)', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 5 }}>{hint}</div>
      )}
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
  transition: 'border-color .12s',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

// ── Delegated admins section ────────────────────────────────────────────
function DelegatedAdminsSection({ nodeId }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listNodeAdmins(nodeId);
      setAdmins(res?.admins || []);
    } catch (e) { setErr(e?.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [nodeId]);

  const grant = async () => {
    const lc = email.trim().toLowerCase();
    if (!lc) return;
    setBusy(true); setErr(null);
    try {
      await grantNodeAdmin(nodeId, lc);
      setEmail('');
      await load();
    } catch (e) { setErr(e?.message || 'Could not grant'); }
    finally { setBusy(false); }
  };
  const revoke = async (target) => {
    setBusy(true); setErr(null);
    try {
      await revokeNodeAdmin(nodeId, target);
      await load();
    } catch (e) { setErr(e?.message || 'Could not revoke'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 'var(--font-sm)', fontWeight: 600,
        color: 'var(--text)', marginBottom: 6,
      }}>Delegated admins</label>
      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 8 }}>
        These users can edit this node and every descendant — no global admin powers granted.
      </div>
      {err && (
        <div role="alert" style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'var(--red-light, #fef2f2)',
          color: 'var(--red-solid, #b91c1c)',
          fontSize: 'var(--font-sm)', marginBottom: 8,
        }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="admin@deel.com" style={{ ...inputStyle, flex: 1 }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); grant(); } }}
        />
        <button type="button" onClick={grant} disabled={busy || !email.trim()}
          style={{
            padding: '8px 14px', height: 38,
            background: 'var(--purple)', color: 'white',
            border: 'none', borderRadius: 8,
            fontSize: 'var(--font-sm)', fontWeight: 600,
            fontFamily: 'inherit',
            cursor: busy || !email.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !email.trim() ? 0.55 : 1,
          }}
        >Grant</button>
      </div>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 8,
        background: 'var(--surface-2)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 12, fontSize: 'var(--font-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
        ) : admins.length === 0 ? (
          <div style={{ padding: 12, fontSize: 'var(--font-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
            No delegated admins yet.
          </div>
        ) : admins.map(a => (
          <div key={a.email} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-light)',
          }}>
            <i className="bi bi-shield-lock" style={{ fontSize: 12, color: 'var(--purple)' }} />
            <span style={{ flex: 1, fontSize: 'var(--font-sm)', color: 'var(--text)' }}>{a.email}</span>
            <button type="button" onClick={() => revoke(a.email)} disabled={busy}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer',
                padding: 4, borderRadius: 4,
                fontFamily: 'inherit',
              }}
              aria-label={`Revoke ${a.email}`}
            ><i className="bi bi-x-circle" style={{ fontSize: 13 }} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Vacancies section ───────────────────────────────────────────────────
function VacanciesSection({ nodeId }) {
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listNodeVacancies(nodeId);
      setVacancies(res?.vacancies || []);
    } catch (e) { setErr(e?.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [nodeId]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      await addNodeVacancy(nodeId, { title: t });
      setTitle('');
      await load();
    } catch (e) { setErr(e?.message || 'Could not add'); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true); setErr(null);
    try {
      await removeNodeVacancy(nodeId, id);
      await load();
    } catch (e) { setErr(e?.message || 'Could not remove'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 'var(--font-sm)', fontWeight: 600,
        color: 'var(--text)', marginBottom: 6,
      }}>Open roles (vacancies)</label>
      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 8 }}>
        Ghost placeholders show on the chart under this node so hiring is visible at a glance.
      </div>
      {err && (
        <div role="alert" style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'var(--red-light, #fef2f2)',
          color: 'var(--red-solid, #b91c1c)',
          fontSize: 'var(--font-sm)', marginBottom: 8,
        }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Senior HR Experience Manager"
          style={{ ...inputStyle, flex: 1 }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} disabled={busy || !title.trim()}
          style={{
            padding: '8px 14px', height: 38,
            background: 'var(--purple)', color: 'white',
            border: 'none', borderRadius: 8,
            fontSize: 'var(--font-sm)', fontWeight: 600,
            fontFamily: 'inherit',
            cursor: busy || !title.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !title.trim() ? 0.55 : 1,
          }}
        >Add</button>
      </div>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 8,
        background: 'var(--surface-2)', overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 12, fontSize: 'var(--font-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
        ) : vacancies.length === 0 ? (
          <div style={{ padding: 12, fontSize: 'var(--font-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
            No open roles yet.
          </div>
        ) : vacancies.map(v => (
          <div key={v.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-light)',
          }}>
            <i className="bi bi-person-dash" style={{ fontSize: 12, color: 'var(--orange)' }} />
            <span style={{ flex: 1, fontSize: 'var(--font-sm)', color: 'var(--text)' }}>{v.title}</span>
            <button type="button" onClick={() => remove(v.id)} disabled={busy}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer',
                padding: 4, borderRadius: 4, fontFamily: 'inherit',
              }}
              aria-label={`Remove ${v.title}`}
            ><i className="bi bi-x-circle" style={{ fontSize: 13 }} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
