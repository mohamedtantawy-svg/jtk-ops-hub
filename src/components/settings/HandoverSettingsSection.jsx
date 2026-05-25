// ── HandoverSettingsSection ────────────────────────────────────────────
// Phase 5 of HANDOVERS_PLAN.md §17. Three cards inside SettingsView:
//   1. Configurations (handover_settings rows)
//   2. Checklist templates (handover_checklist_templates rows)
//   3. Time-off imports + audit export
//
// Gated by admin / regional_manager / is_handover_admin via the server
// route. Renders nothing for users who can't manage handovers — saves
// the round-trip from clogging unrelated user sessions.
//
// Visually mirrors the existing Settings sections: section header,
// padded card panels, simple inline controls. No drag-and-drop in this
// pass — required + label edits are inline; reordering uses ↑↓ buttons.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listHandoverSettings, createHandoverSetting, updateHandoverSetting, deleteHandoverSetting,
  listHandoverTemplates, createHandoverTemplate, updateHandoverTemplate, deleteHandoverTemplate,
  listTimeOffImportBatches, downloadHandoverAuditCsv,
} from '../../services/handoversApi';

function Card({ title, desc, children }) {
  return (
    <div style={{
      background: 'var(--surface, white)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function SmallButton({ children, onClick, variant = 'secondary', disabled, type = 'button' }) {
  const styles = {
    primary:   { bg: '#7c3aed', fg: 'white', border: 'transparent' },
    secondary: { bg: 'var(--surface, white)', fg: '#1b1b1b', border: '#e8e8e8' },
    danger:    { bg: 'var(--surface, white)', fg: '#B91C1C', border: '#FCA5A5' },
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding: '5px 10px', borderRadius: 6,
      background: styles.bg, color: styles.fg, border: `1px solid ${styles.border}`,
      fontSize: 11, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit', opacity: disabled ? 0.55 : 1,
    }}>{children}</button>
  );
}

function Pill({ children, tone = 'neutral' }) {
  const map = {
    neutral: { bg: '#f5f4f2', fg: '#616161' },
    success: { bg: '#DCFCE7', fg: '#166534' },
    danger:  { bg: '#FEE2E2', fg: '#991B1B' },
  };
  const s = map[tone] || map.neutral;
  return <span style={{
    background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
  }}>{children}</span>;
}

function ymdShort(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// ── Configurations card ───────────────────────────────────────────────
function ConfigurationsCard({ items, refresh, addToast }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  function startEdit(row) {
    setEditingId(row.id);
    setDraft({ ...row });
  }

  async function save() {
    setBusy(true);
    try {
      await updateHandoverSetting(editingId, draft);
      setEditingId(null);
      setDraft(null);
      await refresh();
      addToast?.({ kind: 'success', message: 'Configuration updated.' });
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function addNew() {
    setBusy(true);
    try {
      const res = await createHandoverSetting({
        name: 'New configuration',
        scope: 'global',
        manager_approval_required: true,
        coverer_acceptance_required: true,
        allow_country_split: true,
        reminder_48h_enabled: true,
        reminder_24h_enabled: true,
        reminder_handback_enabled: true,
        min_days_to_trigger: 1,
        is_default: false,
      });
      await refresh();
      if (res?.item?.id) startEdit(res.item);
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Create failed' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete configuration "${row.name}"?`)) return;
    setBusy(true);
    try {
      await deleteHandoverSetting(row.id);
      await refresh();
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Delete failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Configurations" desc="Per-region / per-team setups. Resolution order: team → region → global. Exactly one global default at a time.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
            No configurations yet — defaults seed on first boot. Use “New configuration” to add scope-specific overrides.
          </div>
        )}
        {items.map(row => {
          const editing = editingId === row.id && draft;
          return (
            <div key={row.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 12, padding: 12,
              background: editing ? 'rgba(124, 58, 237, 0.04)' : 'var(--surface, white)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: editing ? 10 : 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editing ? (
                    <input
                      value={draft.name}
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value.slice(0, 200) }))}
                      style={{
                        width: '100%', border: '1px solid var(--border)', borderRadius: 8,
                        padding: '5px 10px', fontSize: 13, fontWeight: 700, color: 'var(--text)',
                        fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{row.name}</div>
                  )}
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Pill tone={row.is_default ? 'success' : 'neutral'}>
                      {row.scope}{row.scope_value ? ` · ${row.scope_value}` : ''}
                    </Pill>
                    {row.is_default && <Pill tone="success">Default</Pill>}
                  </div>
                </div>
                {editing ? (
                  <>
                    <SmallButton variant="secondary" disabled={busy} onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</SmallButton>
                    <SmallButton variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</SmallButton>
                  </>
                ) : (
                  <>
                    <SmallButton onClick={() => startEdit(row)}>Edit</SmallButton>
                    <SmallButton variant="danger" disabled={row.is_default && row.scope === 'global'} onClick={() => remove(row)}>Delete</SmallButton>
                  </>
                )}
              </div>
              {editing && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
                  fontSize: 12, color: 'var(--text)',
                }}>
                  {[
                    // 'manager_approval_required' removed 2026-05-25 —
                    // TL/manager approval was retired from the handover
                    // state machine 2026-05-18. The column still exists
                    // on handover_settings for history but no transition
                    // reads it; hiding the toggle so admins don't think
                    // they can re-enable a flow that no longer runs.
                    ['coverer_acceptance_required', 'Coverer acceptance required'],
                    ['allow_country_split', 'Per-coverer country split allowed'],
                    ['reminder_48h_enabled', '48h reminder enabled'],
                    ['reminder_24h_enabled', '24h reminder enabled'],
                    ['reminder_handback_enabled', 'Return-day reminder enabled'],
                    ['is_default', 'Set as global default'],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={draft[key] !== false}
                        onChange={e => setDraft(d => ({ ...d, [key]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Min days to trigger
                    <input
                      type="number" min={0} max={30}
                      value={draft.min_days_to_trigger ?? 1}
                      onChange={e => setDraft(d => ({ ...d, min_days_to_trigger: Number(e.target.value) }))}
                      style={{ width: 60, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontFamily: 'inherit' }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Scope
                    <select
                      value={draft.scope || 'global'}
                      onChange={e => setDraft(d => ({ ...d, scope: e.target.value }))}
                      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontFamily: 'inherit' }}
                    >
                      <option value="global">global</option>
                      <option value="region">region</option>
                      <option value="team">team</option>
                    </select>
                    {draft.scope !== 'global' && (
                      <input
                        value={draft.scope_value || ''}
                        onChange={e => setDraft(d => ({ ...d, scope_value: e.target.value }))}
                        placeholder="region/team name"
                        style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontFamily: 'inherit' }}
                      />
                    )}
                  </label>
                </div>
              )}
            </div>
          );
        })}
        <div>
          <SmallButton variant="primary" onClick={addNew} disabled={busy}>+ New configuration</SmallButton>
        </div>
      </div>
    </Card>
  );
}

// ── Templates card ────────────────────────────────────────────────────
function TemplatesCard({ items, refresh, addToast }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  function startEdit(row) {
    setEditingId(row.id);
    setDraft({ ...row, items: Array.isArray(row.items) ? row.items.map(i => ({ ...i })) : [] });
  }

  async function save() {
    setBusy(true);
    try {
      await updateHandoverTemplate(editingId, draft);
      setEditingId(null);
      setDraft(null);
      await refresh();
      addToast?.({ kind: 'success', message: 'Template updated.' });
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function addNew() {
    setBusy(true);
    try {
      const res = await createHandoverTemplate({
        name: 'New template', scope: 'global', items: [], is_default: false,
      });
      await refresh();
      if (res?.item?.id) startEdit(res.item);
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Create failed' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete template "${row.name}"?`)) return;
    setBusy(true);
    try {
      await deleteHandoverTemplate(row.id);
      await refresh();
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Delete failed' });
    } finally {
      setBusy(false);
    }
  }

  function moveItem(idx, dir) {
    setDraft(d => {
      const arr = [...d.items];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return d;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...d, items: arr };
    });
  }

  return (
    <Card title="Checklist templates" desc="The wizard pre-fills the default template's items. Mark items required to block submit until they're checked.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
            No templates yet — defaults seed on first boot.
          </div>
        )}
        {items.map(row => {
          const editing = editingId === row.id && draft;
          return (
            <div key={row.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 12, padding: 12,
              background: editing ? 'rgba(124, 58, 237, 0.04)' : 'var(--surface, white)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: editing ? 10 : 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editing ? (
                    <input
                      value={draft.name}
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value.slice(0, 200) }))}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{row.name}</div>
                  )}
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Pill>{row.scope}{row.scope_value ? ` · ${row.scope_value}` : ''}</Pill>
                    {row.is_default && <Pill tone="success">Default</Pill>}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(row.items || []).length} items</span>
                  </div>
                </div>
                {editing ? (
                  <>
                    <SmallButton variant="secondary" disabled={busy} onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</SmallButton>
                    <SmallButton variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</SmallButton>
                  </>
                ) : (
                  <>
                    <SmallButton onClick={() => startEdit(row)}>Edit</SmallButton>
                    <SmallButton variant="danger" disabled={row.is_default && row.scope === 'global'} onClick={() => remove(row)}>Delete</SmallButton>
                  </>
                )}
              </div>
              {editing && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {(draft.items || []).map((item, idx) => (
                      <div key={item.id || idx} style={{
                        display: 'flex', gap: 6, alignItems: 'center',
                        padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8,
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button type="button" onClick={() => moveItem(idx, -1)} aria-label="Move up"
                            disabled={idx === 0}
                            style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>
                            <i className="bi-caret-up-fill" style={{ fontSize: 10 }} />
                          </button>
                          <button type="button" onClick={() => moveItem(idx, +1)} aria-label="Move down"
                            disabled={idx === (draft.items.length - 1)}
                            style={{ background: 'transparent', border: 'none', cursor: idx === draft.items.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>
                            <i className="bi-caret-down-fill" style={{ fontSize: 10 }} />
                          </button>
                        </div>
                        <input
                          value={item.label}
                          onChange={e => setDraft(d => {
                            const arr = [...d.items];
                            arr[idx] = { ...arr[idx], label: e.target.value.slice(0, 500) };
                            return { ...d, items: arr };
                          })}
                          placeholder="Item label"
                          style={{ flex: 1, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 12 }}
                        />
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                          <input
                            type="checkbox"
                            checked={item.required !== false}
                            onChange={e => setDraft(d => {
                              const arr = [...d.items];
                              arr[idx] = { ...arr[idx], required: e.target.checked };
                              return { ...d, items: arr };
                            })}
                          />
                          Required
                        </label>
                        <button type="button"
                          onClick={() => setDraft(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }))}
                          aria-label="Remove item"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, fontFamily: 'inherit' }}>
                          <i className="bi-x-lg" style={{ fontSize: 11 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <SmallButton onClick={() => setDraft(d => ({
                      ...d,
                      items: [...(d.items || []), { id: `item_${Date.now()}`, label: 'New item', required: true, hint: '' }],
                    }))}>+ Add item</SmallButton>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={!!draft.is_default}
                        onChange={e => setDraft(d => ({ ...d, is_default: e.target.checked }))}
                      />
                      Set as global default
                    </label>
                  </div>
                </>
              )}
            </div>
          );
        })}
        <div>
          <SmallButton variant="primary" onClick={addNew} disabled={busy}>+ New template</SmallButton>
        </div>
      </div>
    </Card>
  );
}

// ── CSV import + audit card ───────────────────────────────────────────
function ImportAndAuditCard({ batches, refresh, addToast }) {
  const [busy, setBusy] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const fileInputRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('ops_hub_token') || '') : '';
    try {
      const res = await fetch('/api/v1/time-off-events/import', {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Import failed (${res.status})`);
      addToast?.({
        kind: 'success',
        message: `Imported: ${body.rows_inserted} new · ${body.rows_skipped} duplicate · ${body.rows_invalid} invalid.`,
      });
      await refresh();
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Import failed' });
    } finally {
      setBusy(false);
    }
  }

  async function downloadAudit() {
    setBusy(true);
    try {
      const res = await downloadHandoverAuditCsv({ from: fromDate || null, to: toDate || null });
      addToast?.({ kind: 'success', message: `Audit CSV downloaded (${(res.bytes/1024).toFixed(1)} KB).` });
    } catch (err) {
      addToast?.({ kind: 'error', message: err?.message || 'Export failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Time-off imports + audit" desc="Re-upload the HRX time-off report when it refreshes. Export the full handover audit for a date range as CSV.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel"
            onChange={onFile}
            style={{ display: 'none' }}
          />
          <SmallButton variant="primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <i className="bi-upload" style={{ marginRight: 4 }} /> Upload CSV
          </SmallButton>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Expected columns: Start Date, End Date, Work Email
          </span>
        </div>

        {batches.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              Recent imports
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {batches.map((b, i) => (
                <div key={b.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid #e8e8e8',
                  fontSize: 12, color: 'var(--text)',
                }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{b.filename || b.source}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{b.uploaded_by_email}</span>
                  <Pill tone="success">+{b.rows_inserted}</Pill>
                  <Pill>{b.rows_skipped} dup</Pill>
                  {b.rows_invalid > 0 && <Pill tone="danger">{b.rows_invalid} invalid</Pill>}
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 100, textAlign: 'right' }}>
                    {ymdShort(b.uploaded_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Audit export
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              From
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              To
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit' }} />
            </label>
            <SmallButton variant="primary" onClick={downloadAudit} disabled={busy}>
              <i className="bi-download" style={{ marginRight: 4 }} /> Export CSV
            </SmallButton>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HandoverSettingsSection({ user, addToast }) {
  const [settings, setSettings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState(null);

  const refreshSettings = useCallback(async () => {
    try { const r = await listHandoverSettings(); setSettings(r?.items || []); }
    catch (err) { if (err?.status === 403) setAccessError('You do not have access to handover settings.'); else throw err; }
  }, []);
  const refreshTemplates = useCallback(async () => {
    try { const r = await listHandoverTemplates(); setTemplates(r?.items || []); }
    catch (err) { if (err?.status === 403) setAccessError('You do not have access to handover settings.'); else throw err; }
  }, []);
  const refreshBatches = useCallback(async () => {
    try { const r = await listTimeOffImportBatches(); setBatches(r?.items || []); }
    catch (err) { if (err?.status === 403) setAccessError('You do not have access to handover settings.'); else throw err; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([refreshSettings(), refreshTemplates(), refreshBatches()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshSettings, refreshTemplates, refreshBatches]);

  if (accessError) {
    return null;   // hide entire section if caller can't manage it
  }

  return (
    <div id="handovers" style={{ marginTop: 36 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <i className="bi-airplane" style={{ fontSize: 18, color: 'var(--text)' }} />
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Handovers</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 28 }}>
          Configure how the OOO surface behaves: which presets apply, the default checklist items, and time-off import + audit.
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>Loading…</div>
      ) : (
        <>
          <ConfigurationsCard items={settings} refresh={refreshSettings} addToast={addToast} />
          <TemplatesCard items={templates} refresh={refreshTemplates} addToast={addToast} />
          <ImportAndAuditCard batches={batches} refresh={refreshBatches} addToast={addToast} />
        </>
      )}
    </div>
  );
}

export default HandoverSettingsSection;
