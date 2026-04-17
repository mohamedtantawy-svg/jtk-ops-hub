// ── QueueV2Panels ───────────────────────────────────────────────────────────
// Side panels: Saved Views (chips + save) and Rules (CRUD editor).
import { useState, useEffect } from 'react';

// ── Saved Views chip strip ──────────────────────────────────────────────────
// Shows saved views inline above the filter bar. Pass in the current filters
// so "Save current view" can capture them.
export function SavedViewsStrip({
  views, currentName, onApply, onSave, onDelete,
}) {
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 24px',
      background: '#fbfaf8', borderBottom: '1px solid #f0efed', flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>
        <i className="bi-bookmark-star" style={{ marginRight: 4 }} />Views
      </span>
      {views.length === 0 && (
        <span style={{ fontSize: 11, color: '#bbb' }}>Save your first filter combo →</span>
      )}
      {views.map(v => {
        const active = v.name === currentName;
        return (
          <span key={v.name} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 4px 3px 10px', borderRadius: 128,
            border: active ? '1px solid #1f74b3' : '1px solid #e8e8e8',
            background: active ? '#eff6ff' : 'white',
            color: active ? '#1f74b3' : '#616161',
            fontSize: 11, fontWeight: active ? 600 : 500,
          }}>
            <button onClick={() => onApply?.(v)}
              style={{ border: 'none', background: 'transparent', color: 'inherit', fontSize: 11, fontWeight: 'inherit', cursor: 'pointer', padding: 0 }}>
              {v.name}
            </button>
            <button onClick={() => onDelete?.(v.name)} title="Delete view"
              style={{ border: 'none', background: 'transparent', color: '#9e9e9e', cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center' }}>
              <i className="bi-x" style={{ fontSize: 11 }} />
            </button>
          </span>
        );
      })}
      {saving ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) { onSave?.(newName.trim()); setNewName(''); setSaving(false); }
              if (e.key === 'Escape') { setSaving(false); setNewName(''); }
            }}
            placeholder="View name"
            style={{ height: 24, padding: '0 8px', borderRadius: 128, border: '1px solid #1f74b3', fontSize: 11, outline: 'none', width: 140 }} />
          <button onClick={() => { if (newName.trim()) { onSave?.(newName.trim()); setNewName(''); setSaving(false); } }}
            style={{ padding: '3px 10px', borderRadius: 128, border: 'none', background: '#1f74b3', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Save
          </button>
        </span>
      ) : (
        <button onClick={() => setSaving(true)}
          style={{ padding: '3px 10px', borderRadius: 128, border: '1px dashed #c0c0c0', background: 'transparent', color: '#616161', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
          <i className="bi-plus" style={{ fontSize: 11, marginRight: 2 }} />Save current
        </button>
      )}
    </div>
  );
}

// ── Rules editor — modal ────────────────────────────────────────────────────
export function RulesEditor({ open, onClose, rules, onSave }) {
  const [draft, setDraft] = useState(rules);
  useEffect(() => { if (open) setDraft(rules); }, [open, rules]);

  if (!open) return null;

  const addRule = () => {
    const id = `r_${Date.now()}`;
    setDraft([...draft, { id, name: 'New rule', if: {}, then: {} }]);
  };
  const removeRule = (id) => setDraft(draft.filter(r => r.id !== id));
  const updateRule = (id, patch) => setDraft(draft.map(r => r.id === id ? { ...r, ...patch } : r));

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 500 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 640, maxWidth: '92vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'white', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', zIndex: 501,
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            <i className="bi-magic" style={{ marginRight: 8 }} />Rules engine
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#9e9e9e', cursor: 'pointer' }}>
            <i className="bi-x-lg" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          <div style={{ fontSize: 12, color: '#616161', marginBottom: 12 }}>
            Rules match rows and annotate them (no destructive actions yet). Useful as a triage hint:
            "If country is DE and source is onboarding, flag for Federica".
          </div>
          {draft.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: '#9e9e9e', fontSize: 12, border: '1px dashed #e8e8e8', borderRadius: 8 }}>
              No rules yet.
            </div>
          )}
          {draft.map(rule => (
            <RuleRow key={rule.id} rule={rule} onChange={patch => updateRule(rule.id, patch)} onRemove={() => removeRule(rule.id)} />
          ))}
          <button onClick={addRule}
            style={{ marginTop: 8, padding: '8px 14px', borderRadius: 8, border: '1px dashed #c0c0c0', background: 'transparent', color: '#616161', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            <i className="bi-plus" style={{ marginRight: 4 }} />Add rule
          </button>
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, background: '#fafaf9' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#616161', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => { onSave?.(draft); onClose?.(); }}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1f74b3', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <i className="bi-check-lg" style={{ marginRight: 4 }} />Save rules
          </button>
        </div>
      </div>
    </>
  );
}

function RuleRow({ rule, onChange, onRemove }) {
  const cond = rule.if || {};
  return (
    <div style={{ padding: 12, border: '1px solid #e8e8e8', borderRadius: 8, marginBottom: 10, background: '#fbfaf8' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input value={rule.name} onChange={e => onChange({ name: e.target.value })}
          placeholder="Rule name"
          style={{ flex: 1, height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid #e8e8e8', fontSize: 13, outline: 'none', fontWeight: 600 }} />
        <button onClick={onRemove} style={{ border: 'none', background: 'transparent', color: '#d42d35', cursor: 'pointer', padding: 4 }}>
          <i className="bi-trash" />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
        <LabeledInput label="Country" value={cond.country || ''} onChange={v => onChange({ if: { ...cond, country: v || undefined } })} placeholder="e.g., DE" />
        <LabeledSelect label="Source" value={cond.source || ''} onChange={v => onChange({ if: { ...cond, source: v || undefined } })}
          options={[['', 'Any'], ['onboarding', 'Onboarding'], ['offboarding', 'Offboarding'], ['amendments', 'Amendments'], ['redlines', 'Redlines'], ['workbench', 'Workbench'], ['zendesk', 'Zendesk'], ['jira', 'Jira']]} />
        <LabeledSelect label="Status severity" value={cond.statusSeverity || ''} onChange={v => onChange({ if: { ...cond, statusSeverity: v || undefined } })}
          options={[['', 'Any'], ['critical', 'Critical'], ['warning', 'Warning'], ['active', 'Active'], ['info', 'Info']]} />
        <LabeledSelect label="Assignment" value={cond.isUnassigned == null ? '' : cond.isUnassigned ? 'yes' : 'no'}
          onChange={v => onChange({ if: { ...cond, isUnassigned: v === '' ? undefined : v === 'yes' } })}
          options={[['', 'Any'], ['yes', 'Unassigned'], ['no', 'Assigned']]} />
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}
function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', background: 'white', boxSizing: 'border-box' }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

const labelStyle = { fontSize: 10, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 };
