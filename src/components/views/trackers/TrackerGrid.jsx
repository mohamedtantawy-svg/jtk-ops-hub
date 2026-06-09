// ── TrackerGrid ───────────────────────────────────────────────────────────
// The editable spreadsheet surface for a generic tracker (Mass Onboarding /
// Mass Offboarding today; user-built trackers later). Renders the tracker's
// column schema as a grid of click-to-edit cells + a Status column, an
// "action items" strip (blocked / overdue), and add/delete-row controls.
// Managers-only — rendered only when the parent has confirmed a managerial
// viewer; `canEdit` gates the inline editors (read-only fallback otherwise).
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTrackerRows } from '../../../hooks/useTrackerRows';
import { TRACKER_ROW_STATUSES, trackerStatusMeta } from '../../../lib/tracker-constants';

const PURPLE = '#7c3aed';

function todayIso() {
  // Local date as YYYY-MM-DD (avoids UTC off-by-one for overdue checks).
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// Render a read-only cell value per column kind.
function CellDisplay({ kind, value }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  }
  if (kind === 'country_multi' && Array.isArray(value)) {
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3 }}>
        {value.map(cc => (
          <span key={cc} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 128, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>{cc}</span>
        ))}
      </span>
    );
  }
  if (kind === 'url') {
    const href = /^https?:\/\//i.test(String(value)) ? value : `https://${value}`;
    return <a href={href} target="_blank" rel="noreferrer" style={{ color: PURPLE, fontSize: 12, fontWeight: 500, textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{String(value).replace(/^https?:\/\//, '').slice(0, 28)}</a>;
  }
  return <span style={{ fontSize: 12, color: 'var(--text)' }}>{String(value)}</span>;
}

// A single editable cell. Click → input/select; commit on blur/Enter.
function EditableCell({ col, value, canEdit, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const begin = () => {
    if (!canEdit) return;
    if (col.kind === 'country_multi') setDraft(Array.isArray(value) ? value.join(', ') : '');
    else setDraft(value == null ? '' : String(value));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    let next = draft;
    if (col.kind === 'country_multi') {
      next = draft.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    }
    onCommit(next);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && col.kind !== 'select') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { setEditing(false); }
  };

  const tdStyle = { padding: '6px 10px', borderRight: '1px solid var(--border-light)', verticalAlign: 'middle', cursor: canEdit ? 'text' : 'default', minWidth: 90 };

  if (!editing) {
    return (
      <td style={tdStyle} onClick={begin} title={canEdit ? 'Click to edit' : undefined}>
        <CellDisplay kind={col.kind} value={value} />
      </td>
    );
  }

  const baseInput = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 6px', border: `1px solid ${PURPLE}`, borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', outline: 'none' };

  if (col.kind === 'select') {
    return (
      <td style={tdStyle}>
        <select ref={inputRef} style={baseInput} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey}>
          <option value="">—</option>
          {(col.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
    );
  }
  const inputType = col.kind === 'date' ? 'date' : col.kind === 'number' ? 'number' : col.kind === 'url' ? 'url' : 'text';
  return (
    <td style={tdStyle}>
      <input
        ref={inputRef}
        type={inputType}
        style={baseInput}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder={col.kind === 'country_multi' ? 'US, GB, DE' : ''}
      />
    </td>
  );
}

// Status pill cell (bound to the row's own status column).
function StatusCell({ status, canEdit, onChange }) {
  const meta = trackerStatusMeta(status);
  const tdStyle = { padding: '6px 10px', borderRight: '1px solid var(--border-light)', whiteSpace: 'nowrap' };
  if (!canEdit) {
    return <td style={tdStyle}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 128, background: meta.bg, color: meta.color }}>{meta.label}</span></td>;
  }
  return (
    <td style={tdStyle}>
      <select
        value={status}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize: 10, fontWeight: 700, padding: '3px 6px', borderRadius: 128, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33`, cursor: 'pointer', outline: 'none' }}
      >
        {TRACKER_ROW_STATUSES.map(s => <option key={s.key} value={s.key} style={{ background: 'var(--surface)', color: 'var(--text)' }}>{s.label}</option>)}
      </select>
    </td>
  );
}

export default function TrackerGrid({ trackerId, trackerName, canEdit = false }) {
  const { tracker, rows, columnSchema, loading, error, addRow, patchRow, deleteRow } = useTrackerRows(trackerId);
  const [busy, setBusy] = useState(false);

  // Find an end-date column (if any) to drive the "overdue" action-item flag.
  const endDateKey = useMemo(() => {
    const c = columnSchema.find(c => c.kind === 'date' && /end/i.test(c.key));
    return c?.key || null;
  }, [columnSchema]);

  const flagsFor = useCallback((row) => {
    const blocked = row.status === 'blocked';
    let overdue = false;
    if (endDateKey && row.status !== 'completed') {
      const v = row.cells?.[endDateKey];
      overdue = !!v && String(v) < todayIso();
    }
    return { blocked, overdue };
  }, [endDateKey]);

  const { blockedCount, overdueCount } = useMemo(() => {
    let b = 0, o = 0;
    for (const r of rows) { const f = flagsFor(r); if (f.blocked) b++; if (f.overdue) o++; }
    return { blockedCount: b, overdueCount: o };
  }, [rows, flagsFor]);

  const onAddRow = useCallback(async () => {
    if (!canEdit || busy) return;
    setBusy(true);
    try { await addRow({ cells: {}, status: 'new' }); }
    catch (e) { /* surfaced via error */ }
    finally { setBusy(false); }
  }, [canEdit, busy, addRow]);

  const colCount = columnSchema.length + 2 + (canEdit ? 1 : 0); // + status + (actions)

  return (
    <div style={{ padding: '4px 0 24px' }}>
      {/* Toolbar + action-items strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
          {blockedCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 128, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}>
              <i className="bi bi-exclamation-octagon-fill" style={{ marginRight: 4 }} />{blockedCount} blocked
            </span>
          )}
          {overdueCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 128, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>
              <i className="bi bi-clock-history" style={{ marginRight: 4 }} />{overdueCount} overdue
            </span>
          )}
          {blockedCount === 0 && overdueCount === 0 && rows.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 128, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }}>
              <i className="bi bi-check-circle-fill" style={{ marginRight: 4 }} />No action items
            </span>
          )}
        </div>
        {canEdit && (
          <button
            onClick={onAddRow}
            disabled={busy || loading}
            style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 1px 2px rgba(124,58,237,0.3)' }}
          >
            <i className="bi bi-plus-lg" style={{ marginRight: 5 }} />Add row
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* Grid */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)' }}>
              {columnSchema.map(col => (
                <th key={col.key} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{col.label}</th>
              ))}
              <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border)' }}>Status</th>
              {canEdit && <th style={{ width: 44, borderBottom: '1px solid var(--border)' }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={colCount} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <i className="bi bi-table" style={{ fontSize: 28, display: 'block', marginBottom: 10, opacity: 0.35 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 }}>No rows yet</div>
                  <div style={{ fontSize: 12 }}>{canEdit ? `Add the first ${trackerName || 'tracker'} entry to get started.` : 'Nothing tracked here yet.'}</div>
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={colCount} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</td></tr>
            )}
            {rows.map(row => {
              const f = flagsFor(row);
              const leftBorder = f.blocked ? '#dc2626' : f.overdue ? '#f59e0b' : 'transparent';
              return (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border-light)', borderLeft: `3px solid ${leftBorder}`, background: (f.blocked || f.overdue) ? `${f.blocked ? '#dc2626' : '#f59e0b'}0a` : 'transparent' }}>
                  {columnSchema.map(col => (
                    <EditableCell
                      key={col.key}
                      col={col}
                      value={row.cells?.[col.key]}
                      canEdit={canEdit}
                      onCommit={(val) => patchRow(row.id, { cells: { [col.key]: val } })}
                    />
                  ))}
                  <StatusCell status={row.status} canEdit={canEdit} onChange={(s) => patchRow(row.id, { status: s })} />
                  {canEdit && (
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => { if (window.confirm('Delete this row?')) deleteRow(row.id); }}
                        title="Delete row"
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 4, borderRadius: 6 }}
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
