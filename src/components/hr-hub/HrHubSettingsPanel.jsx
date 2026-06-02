// ── HrHubSettingsPanel ──────────────────────────────────────────────────────
// HR Hub Admin–only configuration drawer. Per-flow editor for:
//   • Statuses     — labels and ordering of the lifecycle pills
//   • Fields       — labels, required flag (kind/source stay code-defined for
//                    Stage 6; full schema editing lands in Stage 7+)
//   • Dropdowns    — add/remove options on simple lists; cascading dropdowns
//                    (function_area → request_type) are edited per parent value
//   • Auto-assign  — read-only summary in this stage; rule editing in Stage 7
//
// Every save POSTs to PUT /hr-hub/settings/[flow] which writes both the
// settings row and a hr_hub_settings_history audit entry. The panel
// re-fetches after save so the user sees the canonical value.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getHrHubSettings, putHrHubSettings } from '../../../src/services/hrHubApi';
import { useCurrentDept } from '../../../src/hooks/useCurrentDept';
import { getHubBrand } from '../../../src/lib/hub-brand';

// 2026-05-21 split: Escalation Zero + Ops Hub Feedback moved out of HR
// Hub to the Feedback board. The settings panel only manages the
// surviving HR-ops flows now. The retired flows' settings rows in
// app_settings stay intact (harmless; would be needed if the flows are
// ever brought back) but the Settings UI no longer offers tabs for them.
// 2026-05-22 — flow labels are dept-branded at render time. Static values
// here are cold-paint fallbacks.
const FLOWS = [
  { id: 'hr_request',      label: 'HR Request' },
  { id: 'hr_reporting',    label: 'HR Reporting' },
  { id: 'payment_refund',  label: 'Payment Refund' },
];

export default function HrHubSettingsPanel({ onClose }) {
  const deptState = useCurrentDept();
  const hubBrand = useMemo(() => getHubBrand(deptState.dept), [deptState.dept]);
  const flows = useMemo(() => ([
    { id: 'hr_request',   label: hubBrand.requestLabel },
    { id: 'hr_reporting', label: hubBrand.reportingLabel },
    // Payment Refund is not dept-branded — same label across every hub.
    { id: 'payment_refund', label: 'Payment Refund' },
  ]), [hubBrand]);
  const [activeFlow, setActiveFlow] = useState('hr_request');
  const [tab, setTab] = useState('dropdowns');     // statuses | fields | dropdowns | auto_assign
  const [bundles, setBundles] = useState({});      // flow → { settings, loading, error }
  const [savingKey, setSavingKey] = useState(null);
  const [toast, setToast] = useState(null);

  // I2: lock background page scroll while the settings drawer is open (mirrors
  // the detail drawer, PR #902) so the list behind it can't scroll under the
  // user and closing leaves the page where it was.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const loadFlow = useCallback(async (flow) => {
    setBundles(prev => ({ ...prev, [flow]: { ...(prev[flow] || {}), loading: true, error: null } }));
    try {
      const res = await getHrHubSettings(flow);
      setBundles(prev => ({ ...prev, [flow]: { settings: res?.settings || {}, loading: false, error: null } }));
    } catch (err) {
      setBundles(prev => ({ ...prev, [flow]: { ...(prev[flow] || {}), loading: false, error: err?.message || 'Could not load' } }));
    }
  }, []);

  useEffect(() => { loadFlow(activeFlow); }, [activeFlow, loadFlow]);

  const settingsFor = (flow) => bundles[flow]?.settings || {};

  const saveKey = useCallback(async (flow, key, value) => {
    setSavingKey(`${flow}:${key}`);
    try {
      await putHrHubSettings(flow, { [key]: value });
      setToast({ kind: 'success', text: 'Saved.' });
      await loadFlow(flow);
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Save failed' });
    } finally {
      setSavingKey(null);
      setTimeout(() => setToast(null), 2500);
    }
  }, [loadFlow]);

  const flowSettings = settingsFor(activeFlow);
  const loading = bundles[activeFlow]?.loading;
  const error = bundles[activeFlow]?.error;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 1450,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 'min(820px, 96vw)', background: 'var(--surface)',
        boxShadow: '-12px 0 30px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
        }}>
          <i className="bi bi-gear" style={{ fontSize: 16, color: 'var(--text)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{hubBrand.hubLabel} Settings</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Configure statuses, fields, dropdowns, and auto-assign rules per flow. Changes apply immediately.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}>
            <i className="bi bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        {/* Flow + tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ borderRight: '1px solid var(--border)', width: 200, padding: '8px 0' }}>
            {flows.map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFlow(f.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 14px',
                  background: activeFlow === f.id ? 'var(--surface-3)' : 'transparent',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: activeFlow === f.id ? 600 : 500,
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >{f.label}</button>
            ))}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 4, padding: '8px 16px 0' }}>
            {[
              { id: 'dropdowns',   label: 'Dropdowns' },
              { id: 'statuses',    label: 'Statuses' },
              { id: 'fields',      label: 'Fields' },
              { id: 'auto_assign', label: 'Auto-assign' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '8px 14px', borderRadius: '8px 8px 0 0',
                  border: 'none', background: 'transparent',
                  fontSize: 13, fontWeight: tab === t.id ? 600 : 500,
                  color: tab === t.id ? 'var(--text)' : 'var(--text-secondary)',
                  borderBottom: tab === t.id ? '2px solid var(--text)' : '2px solid transparent',
                  marginBottom: -1, cursor: 'pointer',
                }}
              >{t.label}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {loading && (
            <div style={{ padding: 30, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>{error}</div>
          )}
          {!loading && !error && tab === 'dropdowns' && (
            <DropdownsEditor
              flow={activeFlow}
              settings={flowSettings}
              saving={savingKey === `${activeFlow}:dropdowns`}
              onSave={(value) => saveKey(activeFlow, 'dropdowns', value)}
            />
          )}
          {!loading && !error && tab === 'statuses' && (
            <StatusesEditor
              flow={activeFlow}
              settings={flowSettings}
              saving={savingKey === `${activeFlow}:statuses`}
              onSave={(value) => saveKey(activeFlow, 'statuses', value)}
            />
          )}
          {!loading && !error && tab === 'fields' && (
            <FieldsViewer settings={flowSettings} />
          )}
          {!loading && !error && tab === 'auto_assign' && (
            <AutoAssignViewer settings={flowSettings} />
          )}
        </div>

        {toast && (
          <div style={{
            position: 'absolute', bottom: 16, right: 16,
            padding: '8px 14px', borderRadius: 10,
            background: toast.kind === 'success' ? '#1b1b1b' : '#dc2626',
            color: 'white', fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
          }}>{toast.text}</div>
        )}
      </div>
    </div>
  );
}

// ── Dropdowns editor ─────────────────────────────────────────────────────────
// Settings shape:
//   { dropdowns: { value: { [key]: string[] | { [parent]: string[] } } } }
function DropdownsEditor({ flow, settings, saving, onSave }) {
  const value = (settings?.dropdowns?.value || settings?.dropdowns || {});
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateList = (key, list) => setDraft(prev => ({ ...prev, [key]: list }));
  const updateNested = (key, parent, list) => {
    setDraft(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [parent]: list },
    }));
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div>
      {Object.keys(draft).length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No dropdowns configured for this flow.
        </div>
      )}

      {Object.entries(draft).map(([key, val]) => {
        if (Array.isArray(val)) {
          return (
            <Section key={key} title={key.replace(/_/g, ' ')}>
              <ListEditor list={val} onChange={(list) => updateList(key, list)} />
            </Section>
          );
        }
        // Cascading map: { parent: string[] }
        if (val && typeof val === 'object') {
          return (
            <Section key={key} title={`${key.replace(/_/g, ' ')} (cascading)`}>
              {Object.entries(val).map(([parent, list]) => (
                <div key={parent} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
                    Parent: <span style={{ color: 'var(--text-muted)' }}>{parent}</span>
                  </div>
                  <ListEditor list={list} onChange={(next) => updateNested(key, parent, next)} />
                </div>
              ))}
            </Section>
          );
        }
        return null;
      })}

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={() => setDraft(value)}
          disabled={!dirty || saving}
          style={{
            padding: '8px 14px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', fontSize: 13, fontWeight: 500,
            cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
          }}
        >Discard</button>
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty || saving}
          style={{
            padding: '8px 18px', borderRadius: 10, border: 'none',
            background: (!dirty || saving) ? '#9e9e9e' : '#1b1b1b',
            color: 'white', fontSize: 13, fontWeight: 600,
            cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
          }}
        >{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '.04em',
        marginBottom: 8,
      }}>{title}</div>
      {children}
    </div>
  );
}

function ListEditor({ list, onChange }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.map((opt, idx) => (
          <div key={`${opt}-${idx}`} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6,
            fontSize: 13,
          }}>
            <span style={{ flex: 1 }}>{opt}</span>
            <button
              onClick={() => onChange(list.filter((_, i) => i !== idx))}
              aria-label="Remove"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 14 }}
            ><i className="bi bi-x" /></button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...list, draft.trim()]);
              setDraft('');
            }
          }}
          placeholder="Add a new option and press Enter…"
          style={{
            flex: 1, padding: '6px 10px', fontSize: 13,
            border: '1px solid var(--border)', borderRadius: 6, outline: 'none',
            background: 'var(--surface)',
          }}
        />
        <button
          onClick={() => { if (draft.trim()) { onChange([...list, draft.trim()]); setDraft(''); } }}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >Add</button>
      </div>
    </div>
  );
}

function StatusesEditor({ flow, settings, saving, onSave }) {
  const value = settings?.statuses?.value || settings?.statuses || [];
  const [draft, setDraft] = useState(Array.isArray(value) ? value : []);
  useEffect(() => { setDraft(Array.isArray(value) ? value : []); }, [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = (idx, key, val) => {
    setDraft(prev => prev.map((s, i) => i === idx ? { ...s, [key]: val } : s));
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div>
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10,
        background: '#fff8e6', padding: '8px 12px', borderRadius: 8,
      }}>
        <strong>Heads up:</strong> the lifecycle is enforced by a database CHECK
        constraint on the <code>status</code> column. Adding a new status here
        without a matching DB migration will cause inserts to fail. Renaming
        labels or recolouring is safe.
      </div>
      {draft.map((s, idx) => (
        <div key={s.id || idx} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: 10, marginBottom: 8,
          border: '1px solid var(--border)', borderRadius: 10,
        }}>
          <input
            type="color"
            aria-label={`Colour for ${s.label || s.id}`}
            title="Pick a colour"
            value={/^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : '#9e9e9e'}
            onChange={e => updateField(idx, 'color', e.target.value)}
            style={{ width: 28, height: 28, padding: 0, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', flexShrink: 0 }}
          />
          <input
            value={s.label || ''}
            onChange={e => updateField(idx, 'label', e.target.value)}
            placeholder="Label"
            style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, outline: 'none', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <input
            value={s.color || ''}
            onChange={e => updateField(idx, 'color', e.target.value)}
            placeholder="#rrggbb"
            style={{ width: 96, padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, outline: 'none', background: 'var(--surface)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.id}</span>
        </div>
      ))}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={() => setDraft(Array.isArray(value) ? value : [])}
          disabled={!dirty || saving}
          style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 500, cursor: (!dirty || saving) ? 'not-allowed' : 'pointer' }}
        >Discard</button>
        <button onClick={() => onSave(draft)}
          disabled={!dirty || saving}
          style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: (!dirty || saving) ? '#9e9e9e' : '#1b1b1b', color: 'white', fontSize: 13, fontWeight: 600, cursor: (!dirty || saving) ? 'not-allowed' : 'pointer' }}
        >{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}

function FieldsViewer({ settings }) {
  const fields = settings?.fields?.value || settings?.fields || [];
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Field labels and required flags are stored here. The kind / source / cascading rules are code-defined for now (Stage 6 ships dropdown editing — full schema editing is Stage 7).
      </div>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Field</th>
            <th style={th}>Label</th>
            <th style={th}>Kind</th>
            <th style={th}>Required</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f, idx) => (
            <tr key={f.id || idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
              <td style={td}>{f.id}</td>
              <td style={td}>{f.label}</td>
              <td style={td}><code>{f.kind}</code></td>
              <td style={td}>{f.required ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutoAssignViewer({ settings }) {
  const rules = settings?.auto_assign?.value || settings?.auto_assign || [];
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Auto-assignment rules. Editing UI ships in Stage 7; these are populated via the API today.
      </div>
      {rules.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No auto-assign rules.
        </div>
      ) : (
        <pre style={{
          padding: 12, background: 'var(--surface-2)', borderRadius: 8,
          fontSize: 12, color: 'var(--text)', overflowX: 'auto',
        }}>
          {JSON.stringify(rules, null, 2)}
        </pre>
      )}
    </div>
  );
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 };
const td = { padding: '8px 10px', verticalAlign: 'top' };
