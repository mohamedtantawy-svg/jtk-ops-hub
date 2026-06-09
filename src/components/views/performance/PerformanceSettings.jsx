// ── PerformanceSettings ─────────────────────────────────────────────────────
// The Performance → Settings editor: the dept's role evaluation templates.
// View criteria + weights; perf-admins can edit (add/remove criteria, tune
// weights) and create new role templates. Read-only for managerial viewers
// without the grant (the API enforces too).
import { useState } from 'react';
import { usePerfTemplates } from '../../../hooks/usePerfTemplates';

const PURPLE = '#7c3aed';

export default function PerformanceSettings({ canManage = false }) {
  const { templates, loading, error, refresh, create, update } = usePerfTemplates();
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);   // { ...template } being edited
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const beginEdit = (t) => {
    setOpenId(t.id);
    setDraft(JSON.parse(JSON.stringify(t)));   // deep copy
    setSaveErr(null);
  };
  const cancel = () => { setDraft(null); setSaveErr(null); };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setSaveErr(null);
    try {
      await update(draft.id, {
        name: draft.name,
        weights: draft.weights,
        operationsCriteria: draft.operationsCriteria,
        growthCriteria: draft.growthCriteria,
      });
      setDraft(null);
    } catch (e) { setSaveErr(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const addCriterion = (which) => {
    setDraft(d => ({ ...d, [which]: [...(d[which] || []), { key: `c_${Date.now()}`, label: '', description: '' }] }));
  };
  const setCriterion = (which, i, field, val) => {
    setDraft(d => { const arr = [...d[which]]; arr[i] = { ...arr[i], [field]: val }; return { ...d, [which]: arr }; });
  };
  const removeCriterion = (which, i) => {
    setDraft(d => ({ ...d, [which]: d[which].filter((_, j) => j !== i) }));
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Role-specific evaluation templates for this department. {canManage ? 'Edit criteria & weights below.' : 'Read-only (Performance admin required to edit).'}
        </div>
        <button onClick={refresh} style={iconBtn} title="Refresh"><i className="bi bi-arrow-clockwise" /></button>
      </div>
      {error && <Err msg={error} />}
      {loading && templates.length === 0 && <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {!loading && templates.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 14, color: 'var(--text-muted)' }}>
          <i className="bi bi-clipboard-check" style={{ fontSize: 28, display: 'block', marginBottom: 10, opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No evaluation templates yet</div>
          <div style={{ fontSize: 12 }}>This department has no role templates configured.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {templates.map(t => {
          const editing = draft && draft.id === t.id;
          const data = editing ? draft : t;
          return (
            <div key={t.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
                onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <i className={`bi ${openId === t.id ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ fontSize: 12, color: 'var(--text-muted)' }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {(t.operationsCriteria?.length || 0)} operations · {(t.growthCriteria?.length || 0)} growth · v{t.version}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 10, fontWeight: 700 }}>
                  <Chip>{Math.round((t.weights?.operations ?? 0.5) * 100)}% Ops</Chip>
                  <Chip>{Math.round((t.weights?.kpi ?? 0.3) * 100)}% KPI</Chip>
                  <Chip>{Math.round((t.weights?.growth ?? 0.2) * 100)}% Growth</Chip>
                </div>
              </div>

              {openId === t.id && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                  {!editing && canManage && (
                    <button onClick={() => beginEdit(t)} style={primaryBtn}><i className="bi bi-pencil" style={{ marginRight: 5 }} />Edit template</button>
                  )}
                  {editing && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                      <button onClick={cancel} style={ghostBtn}>Cancel</button>
                      {saveErr && <span style={{ color: '#dc2626', fontSize: 12, alignSelf: 'center' }}>{saveErr}</span>}
                    </div>
                  )}

                  <CriteriaBlock title="🌏 Operations" which="operationsCriteria" data={data} editing={editing}
                    setC={setCriterion} addC={() => addCriterion('operationsCriteria')} rmC={(i) => removeCriterion('operationsCriteria', i)} />
                  <CriteriaBlock title="🥇 Growth Excellence" which="growthCriteria" data={data} editing={editing}
                    setC={setCriterion} addC={() => addCriterion('growthCriteria')} rmC={(i) => removeCriterion('growthCriteria', i)} />
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    KPI (30%) is scored from monthly KPI points (0–100). Final = Ops·{data.weights?.operations ?? 0.5} + KPI·{data.weights?.kpi ?? 0.3} + Growth·{data.weights?.growth ?? 0.2}.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CriteriaBlock({ title, which, data, editing, setC, addC, rmC }) {
  const list = data[which] || [];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 6 }}>{title} ({list.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.map((c, i) => (
          <div key={c.key || i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {editing ? (
              <>
                <input value={c.label} placeholder="Criterion" onChange={e => setC(which, i, 'label', e.target.value)} style={{ ...inp, width: 180 }} />
                <input value={c.description} placeholder="Description" onChange={e => setC(which, i, 'description', e.target.value)} style={{ ...inp, flex: 1 }} />
                <button onClick={() => rmC(i)} style={iconBtn} title="Remove"><i className="bi bi-x-lg" /></button>
              </>
            ) : (
              <div style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{c.label || '(unnamed)'}</span>
                {c.description && <span style={{ color: 'var(--text-muted)' }}> — {c.description}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && <button onClick={addC} style={{ ...ghostBtn, marginTop: 6 }}><i className="bi bi-plus-lg" style={{ marginRight: 4 }} />Add criterion</button>}
    </div>
  );
}

const Chip = ({ children }) => <span style={{ padding: '2px 8px', borderRadius: 128, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>{children}</span>;
const Err = ({ msg }) => <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>{msg}</div>;
const card = { padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)' };
const inp = { fontSize: 12, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' };
const primaryBtn = { fontSize: 12, fontWeight: 600, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' };
const ghostBtn = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' };
const iconBtn = { border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 4 };
