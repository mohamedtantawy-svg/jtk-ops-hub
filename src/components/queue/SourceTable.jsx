// ── SourceTable ─────────────────────────────────────────────────────────────
// Unified table for all work sources (onboarding, offboarding, amendments,
// redlines, workbench, and the combined "All" view).
// Expects normalized rows with a common shape.
import { useState, useMemo, memo } from 'react';
import { TOOLS, getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';

// ── Date formatters ──
function fmtDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d)) return '--';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d)) return '--';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  return `${days}d ago`;
}

function slaAge(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 60000); // minutes
}

function slaBadge(createdAt) {
  const mins = slaAge(createdAt);
  if (mins == null || mins < 0) return null; // guard against future dates
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  if (days >= 7) return { label: `${days}d`, color: '#d42d35', bg: '#fef2f2', severity: 'breached' };
  if (days >= 3) return { label: `${days}d ${hrs}h`, color: '#ed8d00', bg: '#fff8e6', severity: 'at_risk' };
  if (days >= 1) return { label: `${days}d ${hrs}h`, color: '#1d4ed8', bg: '#eff6ff', severity: 'ok' };
  return { label: hrs > 0 ? `${hrs}h` : `${mins}m`, color: '#15803d', bg: '#e8f5e9', severity: 'ok' };
}

/**
 * SourceTable renders a flat table of normalized rows.
 *
 * Each row shape:
 * {
 *   id:        string,
 *   source:    'onboarding' | 'offboarding' | 'amendments' | 'redlines' | 'workbench',
 *   subject:   string,          // "Employee name — Start date"
 *   function:  string,          // e.g. "Compliance Docs · Awaiting Review"
 *   country:   string,          // code or name
 *   assignee:  string,
 *   createdAt: string,          // ISO date
 *   updatedAt: string,          // ISO date
 *   status:    { label, severity, color },
 *   taskUrl:   string,
 *   slaRemaining: number|null,  // seconds remaining (workbench tasks)
 *   slaBreachStatus: string,    // workbench SLA status
 * }
 */
export default function SourceTable({
  rows = [],
  loading = false,
  error = null,
  onRefresh,
  emptyIcon = 'bi-inbox',
  emptyLabel = 'No tasks found',
  emptySubLabel = 'All caught up',
  showSourceColumn = false,  // show Source column (for "All" view)
  searchable = true,
  sortDefault = 'oldest',    // 'oldest' | 'newest' | 'sla'
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState(sortDefault);
  const [statusFilter, setStatusFilter] = useState(null);

  // Filter
  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter) {
      r = r.filter(row => row.status?.severity === statusFilter);
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      r = r.filter(row =>
        (row.subject || '').toLowerCase().includes(q) ||
        (row.function || '').toLowerCase().includes(q) ||
        (row.country || '').toLowerCase().includes(q) ||
        (row.assignee || '').toLowerCase().includes(q) ||
        (row.id || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [rows, searchTerm, statusFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'oldest') return arr.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
      return aTime - bTime; // oldest first
    });
    if (sort === 'newest') return arr.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime; // newest first
    });
    if (sort === 'sla') return arr.sort((a, b) => {
      // Workbench tasks have slaRemaining (seconds) — use it when available
      const aHasSla = a.slaRemaining != null;
      const bHasSla = b.slaRemaining != null;
      if (aHasSla && bHasSla) return a.slaRemaining - b.slaRemaining; // lowest remaining first
      if (aHasSla) return -1; // SLA tasks before non-SLA
      if (bHasSla) return 1;
      // Fallback: oldest (most SLA-critical) first
      const aAge = a.createdAt ? (Date.now() - new Date(a.createdAt).getTime()) : 0;
      const bAge = b.createdAt ? (Date.now() - new Date(b.createdAt).getTime()) : 0;
      return bAge - aAge;
    });
    return arr;
  }, [filtered, sort]);

  // Status counts
  const counts = useMemo(() => {
    const c = { total: rows.length, critical: 0, warning: 0, active: 0, info: 0 };
    for (const r of rows) {
      const sev = r.status?.severity;
      if (sev && c[sev] !== undefined) c[sev]++;
    }
    return c;
  }, [rows]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafaf9', overflow: 'hidden' }}>
      {/* ── Filter bar ── */}
      <div style={{ padding: '10px 24px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusPill label="All" count={counts.total} active={!statusFilter} onClick={() => setStatusFilter(null)} color="#1b1b1b" />
        {counts.critical > 0 && <StatusPill label="Critical" count={counts.critical} active={statusFilter === 'critical'} onClick={() => setStatusFilter(statusFilter === 'critical' ? null : 'critical')} color="#d42d35" />}
        {counts.warning > 0 && <StatusPill label="Action Needed" count={counts.warning} active={statusFilter === 'warning'} onClick={() => setStatusFilter(statusFilter === 'warning' ? null : 'warning')} color="#ed8d00" />}
        {counts.active > 0 && <StatusPill label="In Progress" count={counts.active} active={statusFilter === 'active'} onClick={() => setStatusFilter(statusFilter === 'active' ? null : 'active')} color="#1d4ed8" />}
        {counts.info > 0 && <StatusPill label="Other" count={counts.info} active={statusFilter === 'info'} onClick={() => setStatusFilter(statusFilter === 'info' ? null : 'info')} color="#616161" />}

        <div style={{ flex: 1 }} />

        {searchable && (
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search..."
              style={{ width: 200, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }} />
          </div>
        )}

        {/* Sort */}
        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, color: '#616161', background: 'white', cursor: 'pointer', outline: 'none' }}>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="sla">SLA urgency</option>
        </select>

        {onRefresh && (
          <button onClick={onRefresh} title="Refresh" style={{ ...iconBtnStyle, color: loading ? '#ed8d00' : '#9e9e9e' }}>
            <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 12 }} />
          </button>
        )}

        <span style={{ fontSize: 11, color: '#9e9e9e' }}>{sorted.length} {sorted.length === 1 ? 'task' : 'tasks'}</span>
      </div>

      {/* ── Loading ── */}
      {loading && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-arrow-clockwise spin" style={{ fontSize: 28, color: '#9e9e9e', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: '#9e9e9e' }}>Loading tasks...</div>
        </div>
      )}

      {/* ── Error ── */}
      {error && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className="bi-exclamation-triangle" style={{ fontSize: 40, color: '#ed8d00', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>Failed to load</div>
          <div style={{ fontSize: 13, color: '#9e9e9e', marginBottom: 16, maxWidth: 480 }}>{error}</div>
          {onRefresh && (
            <button onClick={onRefresh} style={{ padding: '8px 20px', borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#1b1b1b' }}>
              <i className="bi-arrow-clockwise" style={{ marginRight: 6 }} />Retry
            </button>
          )}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && sorted.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <i className={emptyIcon} style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
            {searchTerm || statusFilter ? 'No matches' : emptyLabel}
          </div>
          <div style={{ fontSize: 13, color: '#9e9e9e' }}>
            {searchTerm || statusFilter ? 'Try adjusting the filters' : emptySubLabel}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {sorted.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
                {showSourceColumn && <th style={{ ...thStyle, width: 80 }}>Source</th>}
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Subject</th>
                <th style={{ ...thStyle, width: 110 }}>Function</th>
                <th style={{ ...thStyle, width: 80 }}>Country</th>
                <th style={{ ...thStyle, width: 100 }}>Assignee</th>
                <th style={{ ...thStyle, width: 80 }}>Start Date</th>
                <th style={{ ...thStyle, width: 80 }}>Created</th>
                <th style={{ ...thStyle, width: 70 }}>SLA</th>
                <th style={{ ...thStyle, width: 80 }}>Updated</th>
                <th style={{ ...thStyle, width: 100 }}>Status</th>
                <th style={{ ...thStyle, width: 70 }}>Task</th>
                <th style={{ ...thStyle, width: 70 }}>Contract</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <SourceRow key={`${row.source}-${row.id}`} row={row} showSource={showSourceColumn} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Row component ──
const SourceRow = memo(function SourceRow({ row, showSource }) {
  const [hov, setHov] = useState(false);
  const sev = row.status?.severity || 'info';
  const isUrgent = sev === 'critical';
  const isWarning = sev === 'warning';
  const rowBg = isUrgent ? '#fffbfb' : isWarning ? '#fffdf5' : 'white';
  const sla = slaBadge(row.createdAt);
  const flag = getFlag(row.country);
  const countryDisplay = getCountryName(row.country) || row.country || '';
  const tool = TOOLS[row.source];

  // Status badge colors
  const sevConfig = {
    critical: { bg: '#fef2f2', color: '#d42d35', border: '#fca5a5', icon: 'bi-exclamation-triangle-fill' },
    warning:  { bg: '#fef3c7', color: '#92400e', border: '#ffe27c', icon: 'bi-exclamation-circle-fill' },
    active:   { bg: '#eff6ff', color: '#1d4ed8', border: '#bddcf0', icon: 'bi-arrow-repeat' },
    info:     { bg: '#f7f5f2', color: '#616161', border: '#e8e8e8', icon: 'bi-clock' },
  };
  const cfg = sevConfig[sev] || sevConfig.info;

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: '1px solid #f0efed',
        background: hov ? '#faf8ff' : rowBg,
        transition: 'background .1s',
        borderLeft: isUrgent ? '3px solid #d42d35' : isWarning ? '3px solid #ed8d00' : '3px solid transparent',
      }}
    >
      {/* Source */}
      {showSource && (
        <td style={tdStyle}>
          {tool ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: tool.bg, color: tool.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <i className={tool.icon} style={{ fontSize: 9 }} />{tool.label}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: '#9e9e9e' }}>{row.source}</span>
          )}
        </td>
      )}

      {/* Subject */}
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: tool?.bg || '#f3f3f3',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: tool?.color || '#616161', flexShrink: 0,
          }}>
            {(row.subject || '?').split(' ').filter(w => w.length > 0).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {row.subject || '--'}
          </span>
        </div>
      </td>

      {/* Function */}
      <td style={tdStyle}>
        {row.function ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 128, background: '#f2f2f2', color: '#616161', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.function}>
            {row.function}
          </span>
        ) : <span style={{ color: '#d5d5d5' }}>--</span>}
      </td>

      {/* Country */}
      <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>
        {flag && <span style={{ marginRight: 3 }}>{flag}</span>}
        <span style={{ color: '#616161', fontWeight: 500 }}>{countryDisplay || '--'}</span>
      </td>

      {/* Assignee */}
      <td style={tdStyle}>
        {row.assignee ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Avatar name={row.assignee} size="xs" />
            <span style={{ fontSize: 11, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
              {row.assignee.split(' ')[0]}
            </span>
          </div>
        ) : <span style={{ fontSize: 11, color: '#d42d35', fontWeight: 500 }}>Unassigned</span>}
      </td>

      {/* Start Date */}
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161', whiteSpace: 'nowrap' }}>
        {row.startDate ? fmtDate(row.startDate) : '--'}
      </td>

      {/* Created */}
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161', whiteSpace: 'nowrap' }}>
        {fmtDate(row.createdAt)}
      </td>

      {/* SLA (age-based) */}
      <td style={tdStyle}>
        {row.slaRemaining != null ? (
          // Workbench-style SLA with remaining time
          <WorkbenchSlaBadge slaRemaining={row.slaRemaining} slaBreachStatus={row.slaBreachStatus} />
        ) : sla ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: sla.bg, color: sla.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <i className="bi-clock" style={{ fontSize: 8 }} /> {sla.label}
          </span>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>

      {/* Updated */}
      <td style={{ ...tdStyle, fontSize: 11, color: '#9e9e9e', whiteSpace: 'nowrap' }}>
        {row.updatedAt ? timeAgo(row.updatedAt) : '--'}
      </td>

      {/* Status */}
      <td style={tdStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 128,
          background: cfg.bg, color: cfg.color,
          border: `1px solid ${cfg.border}`,
          fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          <i className={cfg.icon} style={{ fontSize: 9 }} />
          {row.status?.label || '--'}
        </span>
      </td>

      {/* Task Link */}
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
          {row.taskUrl && (
            <a href={row.taskUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#e8f0fe' : '#f5f4f2', color: hov ? '#1f74b3' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #c8d9f0' : '1px solid transparent',
              }}>
              <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />Open
            </a>
          )}
          {row.jiraUrl && (
            <a href={row.jiraUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#e0ecff' : '#f5f4f2', color: hov ? '#0052CC' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #b3d4ff' : '1px solid transparent',
              }}>
              <i className="bi-kanban" style={{ fontSize: 9 }} />Jira
            </a>
          )}
          {!row.taskUrl && !row.jiraUrl && <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
        </div>
      </td>

      {/* Contract Link */}
      <td style={tdStyle}>
        {row.contractUrl ? (
          <a href={row.contractUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
              background: hov ? '#f3eff8' : '#f5f4f2', color: hov ? '#6b3fa0' : '#9e9e9e',
              fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
              border: hov ? '1px solid #d4c4f0' : '1px solid transparent',
            }}>
            <i className="bi-file-earmark-text" style={{ fontSize: 9 }} />View
          </a>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>
    </tr>
  );
});
SourceRow.displayName='SourceRow';

// ── Workbench SLA badge ──
function WorkbenchSlaBadge({ slaRemaining, slaBreachStatus }) {
  const SLA_MAP = {
    SLA_BREACHED:     { label: 'Breached', color: '#d42d35', bg: '#fef2f2' },
    SLA_NOT_BREACHED: { label: 'On Track', color: '#29811e', bg: '#e8f5e9' },
    SLA_PAUSED:       { label: 'Paused',   color: '#616161', bg: '#f3f3f3' },
    SLA_NOT_STARTED:  { label: 'Not Set',  color: '#9e9e9e', bg: '#f7f5f2' },
  };
  const sla = SLA_MAP[slaBreachStatus] || null;
  if (!sla) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;

  // Format remaining time
  let timeStr = '';
  if (slaRemaining != null) {
    const hrs = Math.floor(Math.abs(slaRemaining) / 3600);
    if (hrs >= 24) timeStr = `${Math.floor(hrs / 24)}d`;
    else if (hrs > 0) timeStr = `${hrs}h`;
    else timeStr = `${Math.floor(Math.abs(slaRemaining) / 60)}m`;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: sla.bg, color: sla.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <i className="bi-clock" style={{ fontSize: 8 }} />
      {timeStr || sla.label}
    </span>
  );
}

// ── StatusPill ──
function StatusPill({ label, count, active, onClick, color }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 128,
        border: active ? `1px solid ${color}` : '1px solid #e8e8e8',
        background: active ? `${color}10` : 'white',
        color: active ? color : '#616161',
        fontSize: 12, fontWeight: active ? 600 : 500,
        cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
      }}>
      {label}
      {count > 0 && (
        <span style={{ padding: '1px 6px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: active ? `${color}18` : '#f2f2f2', color: active ? color : '#9e9e9e' }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Styles ──
const iconBtnStyle = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const thStyle = { padding: '10px 12px', fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' };
