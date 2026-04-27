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

function slaBadge(createdAt, thresholdDays = null) {
  const mins = slaAge(createdAt);
  if (mins == null || mins < 0) return null; // guard against future dates
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);

  // Type-aware mode: caller passed an SLA threshold (offboarding: 14d terms, 5d resigs).
  // Breach = age >= threshold. At-risk = age >= 70% of threshold.
  if (thresholdDays != null && thresholdDays > 0) {
    const overdue = days - thresholdDays;
    if (overdue >= 0) {
      const label = overdue > 0 ? `+${overdue}d over` : `${days}d`;
      return { label, color: '#d42d35', bg: '#fef2f2', severity: 'breached' };
    }
    if (days >= Math.ceil(thresholdDays * 0.7)) {
      return { label: `${days}d`, color: '#ed8d00', bg: '#fff8e6', severity: 'at_risk' };
    }
    return { label: `${days}d`, color: '#1d4ed8', bg: '#eff6ff', severity: 'ok' };
  }

  // Generic thresholds (non-offboarding).
  if (days >= 7) return { label: `${days}d`, color: '#d42d35', bg: '#fef2f2', severity: 'breached' };
  if (days >= 3) return { label: `${days}d ${hrs}h`, color: '#ed8d00', bg: '#fff8e6', severity: 'at_risk' };
  if (days >= 1) return { label: `${days}d ${hrs}h`, color: '#1d4ed8', bg: '#eff6ff', severity: 'ok' };
  return { label: hrs > 0 ? `${hrs}h` : `${mins}m`, color: '#15803d', bg: '#e8f5e9', severity: 'ok' };
}

// ── Offboarding SLA + end-date urgency ──────────────────────────────────────
// Combines two urgency signals into a single tier + rank:
//   • SLA age (14d for terminations, 5d for resignations)
//   • End-date proximity (ASAP / past / within 3 days)
// Lower tier = more urgent. Within a tier, higher rank = more urgent.
function offboardingSlaThreshold(row) {
  return (row.typeLabel || '').startsWith('Resignation') ? 5 : 14;
}
function offboardingUrgency(row) {
  const now = Date.now();
  const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
  const ageDays = Number.isFinite(createdMs) ? (now - createdMs) / 86400000 : 0;
  const threshold = offboardingSlaThreshold(row);
  const slaBreached = ageDays >= threshold;
  const slaAtRisk = ageDays >= threshold * 0.7;

  const endMsRaw = row.endDate ? new Date(row.endDate).getTime() : NaN;
  const endMs = Number.isFinite(endMsRaw) ? endMsRaw : null;
  const endDays = endMs != null ? (endMs - now) / 86400000 : null;
  const endPast = endDays != null && endDays <= 0;
  const endImminent = endDays != null && endDays > 0 && endDays <= 3;
  const asap = endMs == null || row.endDateIsConfirmed === false;

  if (slaBreached && endPast)  return { tier: 0, rank: (ageDays - threshold) + Math.min(60, -endDays) };
  if (slaBreached)             return { tier: 1, rank: ageDays - threshold };
  if (endPast)                 return { tier: 2, rank: Math.min(60, -endDays) };
  if (endImminent)             return { tier: 3, rank: 3 - endDays };
  if (asap)                    return { tier: 4, rank: ageDays };
  if (slaAtRisk)               return { tier: 5, rank: ageDays };
  return                              { tier: 6, rank: -(endDays ?? 999) }; // normal: earliest end date first
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
  sortDefault = 'oldest',    // 'oldest' | 'newest' | 'sla' | 'startDate' | 'endDate'
  showPausedSla = false,     // use 48h countdown from pausedAt instead of age-based SLA
  hideStatusPills = false,   // hide the internal All/Action Needed/etc. pills
  currentUser = null,        // for "Assign me" button on unassigned rows
  dateField = 'startDate',   // row field rendered in the date column
  dateLabel = 'Start Date',  // header label for the date column
  showClient = false,        // show "Organization" column (offboarding, etc.)
  showType = false,          // show "Type" column (Termination / Resignation — offboarding)
  hideFilterBar = false,     // hide the whole filter bar (pills + search + refresh + count) when redundant
  hideUpdated = false,       // hide the "Updated" column
  hideContract = false,      // hide the "Contract" column (redlines don't always have one)
}) {
  const [searchTerm, setSearchTerm] = useState('');
  // Column-based sorting: col name + direction
  const defaultCol = sortDefault === 'endDate' ? 'endDate' : sortDefault === 'startDate' ? 'startDate' : sortDefault === 'sla' ? 'sla' : 'createdAt';
  const defaultDir = sortDefault === 'newest' ? 'desc' : 'asc';
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState(defaultDir); // 'asc' | 'desc'
  const [statusFilter, setStatusFilter] = useState(null);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

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
        (row.clientName || '').toLowerCase().includes(q) ||
        (row.typeLabel || '').toLowerCase().includes(q) ||
        (row.id || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [rows, searchTerm, statusFilter]);

  // Sort by column + direction
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'desc' ? -1 : 1;

    // Smart offboarding SLA sort: combines SLA age (type-aware) + end-date
    // proximity via tiered urgency. When the user clicks the SLA column on
    // offboarding rows, we use this instead of simple age sorting.
    const isOffboardingSla = sortCol === 'sla' && arr.some(r => r.source === 'offboarding');
    if (isOffboardingSla) {
      // Most urgent first by default (asc click → most urgent; desc → least).
      const mult = dir;
      return arr.sort((a, b) => {
        const au = a.source === 'offboarding' ? offboardingUrgency(a) : { tier: 99, rank: 0 };
        const bu = b.source === 'offboarding' ? offboardingUrgency(b) : { tier: 99, rank: 0 };
        if (au.tier !== bu.tier) return (au.tier - bu.tier) * mult;
        return (bu.rank - au.rank) * mult; // higher rank = more urgent
      });
    }

    const getVal = (row) => {
      switch (sortCol) {
        case 'subject':   return (row.subject || '').toLowerCase();
        case 'clientName':return (row.clientName || '').toLowerCase();
        case 'typeLabel': return (row.typeLabel || '').toLowerCase();
        case 'country':   return (row.country || '').toLowerCase();
        case 'assignee':  return (row.assignee || '').toLowerCase();
        case 'startDate': return row.startDate ? new Date(row.startDate).getTime() : Infinity;
        case 'endDate':   return row.endDate ? new Date(row.endDate).getTime() : Infinity;
        case 'createdAt': return row.createdAt ? new Date(row.createdAt).getTime() : Infinity;
        case 'updatedAt': return row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
        case 'status':    return (row.status?.label || '').toLowerCase();
        case 'sla': {
          if (row.slaRemaining != null) return row.slaRemaining;
          if (row.createdAt) return -(Date.now() - new Date(row.createdAt).getTime());
          return 0;
        }
        default: return 0;
      }
    };

    return arr.sort((a, b) => {
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  }, [filtered, sortCol, sortDir]);

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
      {!hideFilterBar && (
      <div style={{ padding: '10px 24px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!hideStatusPills && <>
          <StatusPill label="All" count={counts.total} active={!statusFilter} onClick={() => setStatusFilter(null)} color="#1b1b1b" />
          {counts.critical > 0 && <StatusPill label="Critical" count={counts.critical} active={statusFilter === 'critical'} onClick={() => setStatusFilter(statusFilter === 'critical' ? null : 'critical')} color="#d42d35" />}
          {counts.warning > 0 && <StatusPill label="Action Needed" count={counts.warning} active={statusFilter === 'warning'} onClick={() => setStatusFilter(statusFilter === 'warning' ? null : 'warning')} color="#ed8d00" />}
          {counts.active > 0 && <StatusPill label="In Progress" count={counts.active} active={statusFilter === 'active'} onClick={() => setStatusFilter(statusFilter === 'active' ? null : 'active')} color="#1d4ed8" />}
          {counts.info > 0 && <StatusPill label="Other" count={counts.info} active={statusFilter === 'info'} onClick={() => setStatusFilter(statusFilter === 'info' ? null : 'info')} color="#616161" />}
        </>}

        <div style={{ flex: 1 }} />

        {searchable && (
          <div style={{ position: 'relative' }}>
            <i className="bi-search" aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search..."
              role="searchbox"
              aria-label="Search tasks"
              style={{ width: 200, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }} />
          </div>
        )}


        {onRefresh && (
          <button onClick={onRefresh} title="Refresh" aria-label={loading ? 'Refreshing tasks' : 'Refresh tasks'} style={{ ...iconBtnStyle, color: loading ? '#ed8d00' : '#9e9e9e' }}>
            <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} aria-hidden="true" style={{ fontSize: 12 }} />
          </button>
        )}

        <span aria-live="polite" aria-atomic="true" style={{ fontSize: 11, color: '#9e9e9e' }}>{sorted.length} {sorted.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      )}

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
                {showSourceColumn && <th style={{ ...thStyle, width: 70 }}>Source</th>}
                <SortTh col="subject"   label="Employee"   sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, textAlign: 'left', minWidth: 150, maxWidth: 180 }} />
                {showClient && <SortTh col="clientName" label="Organization" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, textAlign: 'left', minWidth: 120, maxWidth: 150 }} />}
                {showType && <SortTh col="typeLabel" label="Type" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 90 }} />}
                <SortTh col="country"   label="Country"    sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 80 }} />
                <SortTh col="assignee"  label="Assignee"   sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 90 }} />
                <SortTh col={dateField} label={dateLabel} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 80 }} />
                <SortTh col="sla"       label="SLA"        sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 60 }} />
                {!hideUpdated && <SortTh col="updatedAt" label="Updated"    sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 70 }} />}
                <SortTh col="status"    label="Status"     sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} style={{ ...thStyle, width: 115 }} />
                <th style={{ ...thStyle, width: 55 }}>Task</th>
                {!hideContract && <th style={{ ...thStyle, width: 55 }}>Contract</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <SourceRow key={`${row.source}-${row.id}`} row={row} showSource={showSourceColumn} showPausedSla={showPausedSla} currentUser={currentUser} dateField={dateField} showClient={showClient} showType={showType} hideUpdated={hideUpdated} hideContract={hideContract} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Row component ──
const SourceRow = memo(function SourceRow({ row, showSource, showPausedSla = false, currentUser = null, dateField = 'startDate', showClient = false, showType = false, hideUpdated = false, hideContract = false }) {
  const [hov, setHov] = useState(false);
  const [localAssignee, setLocalAssignee] = useState(null);
  const sev = row.status?.severity || 'info';
  const isUrgent = sev === 'critical';
  const isWarning = sev === 'warning';
  const rowBg = isUrgent ? '#fffbfb' : isWarning ? '#fffdf5' : 'white';
  // Offboarding gets type-aware SLA: Termination 14d, Resignation 5d.
  const slaThresholdDays = row.source === 'offboarding' ? offboardingSlaThreshold(row) : null;
  const sla = slaBadge(row.createdAt, slaThresholdDays);
  const flag = getFlag(row.country);
  const countryDisplay = getCountryName(row.country) || row.country || '';
  const tool = TOOLS[row.source];

  // Status badge colors — use per-status color when available, fall back to severity
  const sevConfig = {
    critical: { bg: '#fef2f2', color: '#d42d35', border: '#fca5a5', icon: 'bi-exclamation-triangle-fill' },
    warning:  { bg: '#fef3c7', color: '#92400e', border: '#ffe27c', icon: 'bi-exclamation-circle-fill' },
    active:   { bg: '#eff6ff', color: '#1d4ed8', border: '#bddcf0', icon: 'bi-arrow-repeat' },
    info:     { bg: '#f7f5f2', color: '#616161', border: '#e8e8e8', icon: 'bi-clock' },
  };
  const baseCfg = sevConfig[sev] || sevConfig.info;
  // If the status has its own color, derive bg/border from it
  const statusColor = row.status?.color;
  const cfg = statusColor && statusColor !== baseCfg.color
    ? { ...baseCfg, color: statusColor, bg: statusColor + '12', border: statusColor + '40' }
    : baseCfg;

  // Row-body click opens the primary task URL in a new tab. Inner interactive
  // elements (checkbox, action buttons, source links, assignee pill) already
  // stopPropagation(), so only clicks on cell whitespace trigger this.
  const primaryUrl = row.taskUrl || row.jiraUrl || row.zendeskUrl || row.contractUrl;
  const openPrimary = () => {
    if (!primaryUrl) return;
    try { window.open(primaryUrl, '_blank', 'noopener,noreferrer'); } catch {}
  };
  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={primaryUrl ? openPrimary : undefined}
      title={primaryUrl ? 'Open task (click row)' : undefined}
      style={{
        borderBottom: '1px solid #f0efed',
        background: hov ? '#faf8ff' : rowBg,
        transition: 'background .1s',
        borderLeft: isUrgent ? '3px solid #d42d35' : isWarning ? '3px solid #ed8d00' : '3px solid transparent',
        cursor: primaryUrl ? 'pointer' : 'default',
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
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 180 }}>
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

      {/* Client Name */}
      {showClient && (
        <td style={{ ...tdStyle, textAlign: 'left', fontSize: 12, color: '#1b1b1b', fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={row.clientName || ''}>
          {row.clientName || '--'}
        </td>
      )}

      {/* Type (Termination / Resignation) */}
      {showType && (() => {
        const t = row.typeLabel || '';
        const isResignation = t.startsWith('Resignation');
        const bg = isResignation ? '#eef2ff' : '#fef2f2';
        const color = isResignation ? '#4338ca' : '#d42d35';
        const border = isResignation ? '#c7d2fe' : '#fca5a5';
        const short = t === 'Resignation (Employee)' ? 'Resign. (Emp)' : t === 'Resignation (Client)' ? 'Resign. (Client)' : t || '--';
        return (
          <td style={tdStyle}>
            {t ? (
              <span title={t} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 128, background: bg, color, border: `1px solid ${border}`, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {short}
              </span>
            ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
          </td>
        );
      })()}

      {/* Country */}
      <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>
        {flag && <span style={{ marginRight: 3 }}>{flag}</span>}
        <span style={{ color: '#616161', fontWeight: 500 }}>{countryDisplay || '--'}</span>
      </td>

      {/* Assignee */}
      <td style={tdStyle}>
        {(row.assignee || localAssignee) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Avatar name={localAssignee || row.assignee} size="xs" />
            <span style={{ fontSize: 11, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
              {(localAssignee || row.assignee).split(' ')[0]}
            </span>
          </div>
        ) : currentUser?.name ? (
          <button onClick={e => { e.stopPropagation(); setLocalAssignee(currentUser.name); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, border: '1px solid #e8e8e8', background: hov ? '#f3eff8' : 'white', color: '#6b3fa0', fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}>
            <i className="bi-person-plus" style={{ fontSize: 9 }} />Assign me
          </button>
        ) : <span style={{ fontSize: 11, color: '#d42d35', fontWeight: 500 }}>Unassigned</span>}
      </td>

      {/* Date column (Start Date for onboarding, End Date for offboarding, etc.) */}
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161', whiteSpace: 'nowrap' }}>
        {(() => {
          const val = row[dateField];
          // Offboarding: when end date is not yet confirmed, mirror admin UI's "ASAP" label.
          if (dateField === 'endDate' && !row.endDateIsConfirmed) {
            if (val) return <span title={`Desired: ${fmtDate(val)}`} style={{ color: '#9e9e9e' }}>{fmtDate(val)}<span style={{ fontSize: 9, marginLeft: 4, color: '#b0b0b0' }}>(desired)</span></span>;
            return <span style={{ color: '#9e9e9e', fontStyle: 'italic' }}>ASAP</span>;
          }
          return val ? fmtDate(val) : '--';
        })()}
      </td>

      {/* SLA — prefer the row's computed slaRemaining (honours dynamic
          Team-tab SLA settings) over the hardcoded-48h PausedSlaBadge.
          PausedSlaBadge only fires as a fallback when slaRemaining is
          missing (rare — happens when the row has no createdAt). */}
      <td style={tdStyle}>
        {row.slaRemaining != null ? (
          <WorkbenchSlaBadge slaRemaining={row.slaRemaining} slaBreachStatus={row.slaBreachStatus} />
        ) : showPausedSla && row.pausedAt ? (
          <PausedSlaBadge pausedAt={row.pausedAt} />
        ) : sla ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: sla.bg, color: sla.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <i className="bi-clock" style={{ fontSize: 8 }} /> {sla.label}
          </span>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>

      {/* Updated */}
      {!hideUpdated && (
        <td style={{ ...tdStyle, fontSize: 11, color: '#9e9e9e', whiteSpace: 'nowrap' }}>
          {row.updatedAt ? timeAgo(row.updatedAt) : '--'}
        </td>
      )}

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
          {row.zendeskUrl && (
            <a href={row.zendeskUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#e7f5ee' : '#f5f4f2', color: hov ? '#03363d' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #b8e0c8' : '1px solid transparent',
              }}>
              <i className="bi-headset" style={{ fontSize: 9 }} />Zendesk
            </a>
          )}
          {row.workbenchUrl && (
            <a href={row.workbenchUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                background: hov ? '#f3eff8' : '#f5f4f2', color: hov ? '#6b3fa0' : '#9e9e9e',
                fontSize: 10, fontWeight: 600, textDecoration: 'none', transition: 'all .15s', whiteSpace: 'nowrap',
                border: hov ? '1px solid #d4c4f0' : '1px solid transparent',
              }}>
              <i className="bi-grid-3x3-gap" style={{ fontSize: 9 }} />Workbench
            </a>
          )}
          {!row.taskUrl && !row.jiraUrl && !row.zendeskUrl && !row.workbenchUrl && <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
        </div>
      </td>

      {/* Contract Link */}
      {!hideContract && (
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
      )}
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

// ── Paused SLA badge (48h countdown from pausedAt) ──
function PausedSlaBadge({ pausedAt }) {
  if (!pausedAt) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;
  const pausedTime = new Date(pausedAt).getTime();
  if (isNaN(pausedTime)) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;

  const SLA_MS = 48 * 60 * 60 * 1000; // 48 hours
  const elapsed = Date.now() - pausedTime;
  const remaining = SLA_MS - elapsed;

  let label, color, bg;
  if (remaining <= 0) {
    // Breached
    const overMs = Math.abs(remaining);
    const overHrs = Math.floor(overMs / 3600000);
    label = overHrs >= 24 ? `${Math.floor(overHrs / 24)}d over` : `${overHrs}h over`;
    color = '#d42d35'; bg = '#fef2f2';
  } else {
    const remHrs = Math.floor(remaining / 3600000);
    const remMins = Math.floor((remaining % 3600000) / 60000);
    if (remHrs >= 24) label = `${Math.floor(remHrs / 24)}d ${remHrs % 24}h`;
    else if (remHrs > 0) label = `${remHrs}h ${remMins}m`;
    else label = `${remMins}m`;

    if (remHrs < 6) { color = '#d42d35'; bg = '#fef2f2'; }       // < 6h — red
    else if (remHrs < 24) { color = '#ed8d00'; bg = '#fff8e6'; }  // < 24h — amber
    else { color = '#15803d'; bg = '#e8f5e9'; }                   // > 24h — green
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: bg, color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <i className="bi-hourglass-split" style={{ fontSize: 8 }} /> {label}
    </span>
  );
}

// ── StatusPill ──
function StatusPill({ label, count, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      aria-label={`Filter: ${label}${count > 0 ? ` (${count})` : ''}`}
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

// ── Sortable table header ──
function SortTh({ col, label, sortCol, sortDir, onSort, style }) {
  const active = sortCol === col;
  const sortState = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSort(col);
    }
  };
  return (
    <th
      role="columnheader"
      aria-sort={sortState}
      style={{ ...style, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(col)}
    >
      <span
        role="button"
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={`Sort by ${label}${active ? `, currently ${sortState}` : ''}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {label}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, gap: 0, fontSize: 7, marginTop: -1 }}>
          <i className="bi-caret-up-fill" style={{ color: active && sortDir === 'asc' ? '#1b1b1b' : '#ccc' }} />
          <i className="bi-caret-down-fill" style={{ color: active && sortDir === 'desc' ? '#1b1b1b' : '#ccc', marginTop: -3 }} />
        </span>
      </span>
    </th>
  );
}

// ── Styles ──
const iconBtnStyle = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const thStyle = { padding: '10px 12px', fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' };
