// ── ImmigrationCasesTable ───────────────────────────────────────────────────
// Bespoke read-only table for the GIX "Immigration Cases" queue. The generic
// SourceTable has a fixed column set that can't express the Deel mobility
// cases layout, so this component renders the EXACT columns from Mohamed's
// 2026-06-03 admin-table screenshot:
//
//   Name and organization · Country and case type · Process step ·
//   Process step SLA · Action required · Vendor · Next case date ·
//   Case team · Tags · Est. completion date · Expiry date · Last updated on
//
// Rows arrive PRE-NORMALISED from /api/v1/integrations/deel/immigration-cases
// (the route runs normalizeImmigrationCases server-side, then scopes by the
// case's active-agent email). Clicking a row opens the case in
// admin.deel.network. Virtualised (useVirtualRows) because the backlog can
// exceed 1,000 cases.
import { useMemo, useRef } from 'react';
import { getFlag, getCountryName } from '../../data/constants';
import { useVirtualRows } from '../../hooks/useVirtualRows';

const ROW_HEIGHT = 60;

// ── Date formatters ──────────────────────────────────────────────────────
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
// "Jun 5th 2026" (year) / "Jun 3rd" (no year) — matches the admin table.
function fmtDate(iso, { year = false } = {}) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `${mon} ${ordinal(d.getDate())}${year ? ` ${d.getFullYear()}` : ''}`;
}
function relDue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due in 1 day';
  return `Due in ${days} days`;
}
function dueColor(label) {
  if (label === 'Overdue') return '#d42d35';
  if (label === 'Due today' || label === 'Due in 1 day') return '#d97706';
  return 'var(--text-muted)';
}

const COLUMNS = [
  { key: 'name',        label: 'Name and organization', minWidth: 200 },
  { key: 'country',     label: 'Country and case type', minWidth: 190 },
  { key: 'process',     label: 'Process step',          minWidth: 200 },
  { key: 'processSla',  label: 'Process step SLA',      minWidth: 120 },
  { key: 'action',      label: 'Action required',       minWidth: 150 },
  { key: 'vendor',      label: 'Vendor',                minWidth: 110 },
  { key: 'nextDate',    label: 'Next case date',        minWidth: 120 },
  { key: 'caseTeam',    label: 'Case team',             minWidth: 150 },
  { key: 'tags',        label: 'Tags',                  minWidth: 110 },
  { key: 'estDate',     label: 'Est. completion date',  minWidth: 130 },
  { key: 'expiry',      label: 'Expiry date',           minWidth: 110 },
  { key: 'updated',     label: 'Last updated on',       minWidth: 120 },
];

const thStyle = {
  position: 'sticky', top: 0, zIndex: 1,
  background: 'var(--surface-2)',
  textAlign: 'left', padding: '8px 12px',
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.03em',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '8px 12px', fontSize: 12, color: 'var(--text)',
  borderBottom: '1px solid var(--border-light)', verticalAlign: 'middle',
  overflow: 'hidden',
};
const subStyle = { fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const topStyle = { fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function StateMsg({ icon, title, sub }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 48, color: 'var(--text-muted)', textAlign: 'center' }}>
      <i className={`bi ${icon}`} style={{ fontSize: 28, opacity: 0.7 }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

export default function ImmigrationCasesTable({ rows = [], loading = false, error = null, onRefresh }) {
  const scrollerRef = useRef(null);

  // Default sort: soonest process-step SLA first (urgent surfaces up), then
  // most-recently-updated. Rows with no SLA date sort after dated rows.
  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const as = a.processStepSlaDate ? Date.parse(a.processStepSlaDate) : Infinity;
      const bs = b.processStepSlaDate ? Date.parse(b.processStepSlaDate) : Infinity;
      if (as !== bs) return as - bs;
      const au = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bu = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bu - au;
    });
    return list;
  }, [rows]);

  const { startIdx, endIdx, topPad, bottomPad } = useVirtualRows({
    rowCount: sorted.length, rowHeight: ROW_HEIGHT, scrollerRef,
  });
  const visible = sorted.slice(startIdx, endIdx);

  if (loading && rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <StateMsg icon="bi-hourglass-split" title="Loading immigration cases…" sub="Pulling every open & on-hold case from Deel" />
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <StateMsg icon="bi-exclamation-triangle" title="Could not load immigration cases" sub={typeof error === 'string' ? error : (error?.message || 'Try refreshing.')} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', minHeight: 320 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border-light)', background: 'var(--surface-2)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
          <i className="bi bi-folder-fill" style={{ marginRight: 6, color: '#0c4a6e' }} />
          Immigration Cases <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>({sorted.length})</span>
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={() => onRefresh(true)}
            title="Refresh"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
          >
            <i className={loading ? 'bi bi-arrow-clockwise spin' : 'bi bi-arrow-clockwise'} /> Refresh
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <StateMsg icon="bi-folder" title="No immigration cases" sub="No open or on-hold cases right now" />
      ) : (
        <div ref={scrollerRef} style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              {COLUMNS.map(c => <col key={c.key} style={{ minWidth: c.minWidth, width: c.minWidth }} />)}
            </colgroup>
            <thead>
              <tr>{COLUMNS.map(c => <th key={c.key} style={thStyle}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={COLUMNS.length} /></tr>}
              {visible.map((r) => {
                const slaLabel = fmtDate(r.processStepSlaDate, { year: true });
                const due = r.actionDueLabel || '';
                const nextRel = relDue(r.nextCaseDate);
                return (
                  <tr
                    key={r.id}
                    onClick={() => { if (r.caseUrl) window.open(r.caseUrl, '_blank', 'noopener,noreferrer'); }}
                    style={{ height: ROW_HEIGHT, cursor: r.caseUrl ? 'pointer' : 'default' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    title={r.caseUrl ? 'Open case in admin.deel.network' : undefined}
                  >
                    {/* 1 — Name and organization */}
                    <td style={tdStyle}>
                      <div style={topStyle}>{r.applicantName || '—'}</div>
                      {r.organization && <div style={subStyle}>{r.organization}</div>}
                    </td>
                    {/* 2 — Country and case type */}
                    <td style={tdStyle}>
                      <div style={{ ...topStyle, color: '#1f74b3' }}>
                        {r.country ? <span style={{ marginRight: 5 }}>{getFlag(r.country)}</span> : null}
                        {r.workTypeLabel || getCountryName(r.country) || r.country || '—'}
                      </div>
                      {r.caseTypeLabel && <div style={subStyle}>{r.caseTypeLabel}</div>}
                    </td>
                    {/* 3 — Process step */}
                    <td style={tdStyle}>
                      <div style={topStyle}>{r.processName || '—'}</div>
                      {(r.processStep || r.processStepOwner) && (
                        <div style={subStyle}>
                          {r.processStep}{r.processStepOwner ? ` · ${r.processStepOwner}` : ''}
                        </div>
                      )}
                    </td>
                    {/* 4 — Process step SLA */}
                    <td style={tdStyle}>
                      <span style={{ color: slaLabel ? 'var(--text)' : 'var(--text-muted)' }}>{slaLabel || 'No SLA'}</span>
                    </td>
                    {/* 5 — Action required */}
                    <td style={tdStyle}>
                      {r.hasActionRequired ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...topStyle }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ color: '#d97706', fontSize: 11 }} />
                            {(r.actionOwners || []).join(', ') || '—'}
                          </div>
                          {due && <div style={{ ...subStyle, color: dueColor(due) }}>{due}</div>}
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    {/* 6 — Vendor */}
                    <td style={tdStyle}>
                      <span style={{ color: r.vendor ? 'var(--text)' : 'var(--text-muted)' }}>{r.vendor || 'No vendor'}</span>
                    </td>
                    {/* 7 — Next case date */}
                    <td style={tdStyle}>
                      <div style={topStyle}>{r.nextCaseDateLabel || (fmtDate(r.nextCaseDate) || '—')}</div>
                      {nextRel && <div style={{ ...subStyle, color: dueColor(nextRel) }}>{nextRel}</div>}
                    </td>
                    {/* 8 — Case team */}
                    <td style={tdStyle}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{r.caseTeam || '—'}</span>
                    </td>
                    {/* 9 — Tags */}
                    <td style={tdStyle}>
                      {(r.tags && r.tags.length > 0) ? (
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.tags.slice(0, 3).map((t, i) => (
                            <span key={i} style={{ padding: '1px 6px', borderRadius: 999, background: 'var(--surface-3)', color: 'var(--text-secondary)', fontSize: 10 }}>{t}</span>
                          ))}
                          {r.tags.length > 3 && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>+{r.tags.length - 3}</span>}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    {/* 10 — Est. completion date */}
                    <td style={tdStyle}>
                      <span style={{ color: r.estCompletionDate ? 'var(--text)' : 'var(--text-muted)' }}>{fmtDate(r.estCompletionDate, { year: true }) || '—'}</span>
                    </td>
                    {/* 11 — Expiry date */}
                    <td style={tdStyle}>
                      <span style={{ color: r.expiryDate ? 'var(--text)' : 'var(--text-muted)' }}>{fmtDate(r.expiryDate, { year: true }) || '—'}</span>
                    </td>
                    {/* 12 — Last updated on */}
                    <td style={tdStyle}>
                      <span style={{ color: 'var(--text-muted)' }}>{fmtDate(r.updatedAt) || '—'}</span>
                    </td>
                  </tr>
                );
              })}
              {bottomPad > 0 && <tr style={{ height: bottomPad }}><td colSpan={COLUMNS.length} /></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
