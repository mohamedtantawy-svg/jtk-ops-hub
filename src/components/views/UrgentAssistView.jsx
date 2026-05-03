// ── UrgentAssistView ──────────────────────────────────────────────────────
// Top-level tab that consolidates "HRX Urgent Assist Request" / "HRX Urgent
// Assist" workbench tasks with manually-created urgent assists from the DB.
//
// Layout mirrors the HR Hub view conventions for consistency:
//   1. Hero header (icon, title, subtitle, primary "New Urgent Assist" CTA).
//   2. Scope segmented toggle: My / Team / All Requests.
//   3. Four status cards (New, In Progress, On Hold, Resolved) — clicking a
//      card filters the table; clicking it again clears.
//   4. Filter bar (search + refresh).
//   5. Table — Subject · Type · Country · Assignee · Created · SLA · Status · Link.
//      SLA pill is 6 BIZ HOURS from createdAt (Sat/Sun excluded), uniform
//      across both workbench-sourced and manually-created rows.
//
// Inline status edits on manual rows hit PATCH /api/v1/urgent-assist/[id];
// workbench rows are read-only on this surface (status mirrors the upstream
// Deel admin task — drive that surface via the row's "Open" deep link).

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsContext } from '../../App';
import { useUrgentAssistData } from '../../hooks/useUrgentAssistData';
import { updateUrgentAssist, deleteUrgentAssist } from '../../services/urgentAssistApi';
import { getDirectReports, getAllReports, getVisibleEmailsForAccess } from '../../data/members';
import { getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';

const STATUS_FILTERS = [
  { value: 'new',         label: 'New',         icon: 'bi-circle-fill',          color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { value: 'in_progress', label: 'In Progress', icon: 'bi-arrow-repeat',         color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  { value: 'on_hold',     label: 'On Hold',     icon: 'bi-pause-circle-fill',    color: '#737373', bg: '#f5f5f4', tint: '#e7e5e4' },
  { value: 'resolved',    label: 'Resolved',    icon: 'bi-check-circle-fill',    color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
];

const STATUS_OPTIONS = STATUS_FILTERS.map(s => ({ value: s.value, label: s.label }));

function fmtDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d)) return '--';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function isManagerRole(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = user.access || user.accessTypeName || '';
  if (typeof access === 'string') {
    const lc = access.toLowerCase();
    if (lc.includes('admin') || lc.includes('lead') || lc.includes('manager')) return true;
  }
  return false;
}

function isAdminRole(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = user.access || user.accessTypeName || '';
  return typeof access === 'string' && access.toLowerCase().includes('admin');
}

// ── SLA pill — 6 biz-hour spec, mirrors WorkbenchSlaBadge in SourceTable ──
function SlaBadge({ slaRemaining, slaBreachStatus }) {
  if (slaRemaining == null) return <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>;
  const breached = slaBreachStatus === 'SLA_BREACHED' || slaRemaining <= 0;
  const abs = Math.abs(slaRemaining);
  const hrs = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const label = hrs >= 24
    ? `${Math.floor(hrs / 24)}d ${hrs % 24}h`
    : hrs > 0
      ? `${hrs}h ${mins}m`
      : `${mins}m`;
  const tone = breached
    ? { color: '#d42d35', bg: '#fef2f2' }
    : (hrs < 1)
      ? { color: '#ed8d00', bg: '#fff8e6' }   // < 1h remaining = at risk on a 6h SLA
      : { color: '#29811e', bg: '#e8f5e9' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 128, background: tone.bg, color: tone.color, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <i className="bi-clock" style={{ fontSize: 8 }} />
      {breached ? `${label} over` : label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_FILTERS.find(s => s.value === status) || STATUS_FILTERS[0];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 128, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.tint}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <i className={cfg.icon} style={{ fontSize: 9 }} />
      {cfg.label}
    </span>
  );
}

function StatusSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        padding: '3px 8px', borderRadius: 8, border: '1px solid #e8e8e8',
        background: 'white', fontSize: 11, color: '#1b1b1b',
        cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none',
      }}
    >
      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default function UrgentAssistView({ user, onCreate }) {
  const perms = useContext(PermissionsContext);
  const isAdmin = isAdminRole(user) || perms?.dataScope === 'all_tasks';
  const isManager = isManagerRole(user) || perms?.dataScope === 'team_tasks' || perms?.dataScope === 'regional_tasks';

  const [scope, setScope] = useState('mine');
  const [statusFilter, setStatusFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState(null);

  // Compute the manager's team email set + the viewer's full visible chain
  // once. The hook uses these to scope workbench-sourced rows on the FE.
  const lcEmail = (user?.email || '').toLowerCase();
  const teamEmails = useMemo(() => {
    if (!lcEmail) return new Set();
    const access = (user?.access || user?.accessTypeName || '').toLowerCase();
    const out = new Set([lcEmail]);
    if (access.includes('admin') || access.includes('regional')) {
      for (const e of getAllReports(lcEmail)) out.add(e);
    } else if (access.includes('lead')) {
      for (const r of getDirectReports(lcEmail)) out.add(r.email);
    }
    return out;
  }, [lcEmail, user?.access, user?.accessTypeName]);

  const visibleEmails = useMemo(() => {
    if (!lcEmail) return new Set();
    return getVisibleEmailsForAccess(lcEmail) || new Set([lcEmail]);
  }, [lcEmail]);

  const { items, statusCounts, loading, error, refresh, refreshManual } = useUrgentAssistData({
    scope,
    userEmail: lcEmail,
    isManager,
    isAdmin,
    teamEmails,
    visibleEmails,
  });

  // Apply status + search filters client-side. Status pills come from the
  // hook's pre-scoping count, so the four cards stay accurate when the user
  // narrows search (search is purely a row-level filter).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(row => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (q) {
        const hay = `${row.subject} ${row.requestType} ${row.country} ${row.assigneeName} ${row.createdByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, search]);

  // ── Inline edit handlers (manual rows only) ──
  const handleStatusChange = useCallback(async (row, newStatus) => {
    if (!row?.isManual) return;
    setActionError(null);
    try {
      await updateUrgentAssist(row.rawId, { status: newStatus });
      refreshManual();
    } catch (err) {
      setActionError(err?.message || 'Failed to update status');
    }
  }, [refreshManual]);

  const handleDelete = useCallback(async (row) => {
    if (!row?.isManual) return;
    if (!confirm(`Delete "${row.subject}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await deleteUrgentAssist(row.rawId);
      refreshManual();
    } catch (err) {
      setActionError(err?.message || 'Failed to delete');
    }
  }, [refreshManual]);

  // Keyboard shortcut: hitting "n" anywhere on the page (when not in an
  // input) opens the create modal — same affordance HR Hub provides. Skip
  // when an input/textarea/select has focus so typing doesn't trigger.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onCreate?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCreate]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafaf9' }}>
      {/* Hero */}
      <div style={{ padding: '20px 32px 12px', background: 'white', borderBottom: '1px solid #e8e8e8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-exclamation-octagon-fill" style={{ fontSize: 22, color: '#d42d35' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b' }}>Urgent Assist</div>
            <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 2 }}>
              HRX urgent-assist requests from Workbench &amp; manual entries · 6h SLA from creation
            </div>
          </div>
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              aria-label="Create new urgent assist request"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: '#1b1b1b', color: 'white',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: 'none',
              }}
            >
              <i className="bi-plus-lg" style={{ fontSize: 13 }} />
              New Urgent Assist
            </button>
          )}
        </div>

        {/* Scope toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <ScopePill value="mine" current={scope} onChange={setScope} label="My Requests" />
          <ScopePill value="team" current={scope} onChange={setScope} label="Team Requests" />
          <ScopePill value="all"  current={scope} onChange={setScope} label="All Requests" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9e9e9e' }}>
            {loading ? 'Loading…' : `${statusCounts.total} ${statusCounts.total === 1 ? 'request' : 'requests'}`}
          </span>
        </div>

        {/* Status cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
          {STATUS_FILTERS.map(s => {
            const active = statusFilter === s.value;
            const count = statusCounts[s.value] || 0;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(active ? null : s.value)}
                aria-pressed={active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 10,
                  background: active ? s.bg : 'white',
                  border: active ? `1.5px solid ${s.color}` : '1px solid #e8e8e8',
                  cursor: 'pointer', textAlign: 'left',
                  boxShadow: active ? `0 1px 4px ${s.color}22` : 'none',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 8, background: s.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={s.icon} style={{ color: s.color, fontSize: 13 }} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b', lineHeight: 1 }}>{count}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '10px 32px', background: 'white', borderBottom: '1px solid #f0efed', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <i className="bi-search" aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9e9e9e' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search subject, country, assignee…"
            aria-label="Search urgent assist requests"
            style={{ width: 280, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none' }}
          />
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          aria-label="Refresh"
          title="Refresh"
          style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: loading ? '#ed8d00' : '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 12 }} />
        </button>
        {(statusFilter || search) && (
          <button
            type="button"
            onClick={() => { setStatusFilter(null); setSearch(''); }}
            style={{ height: 32, padding: '0 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#9e9e9e', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9e9e9e' }}>
          {filtered.length} shown
        </span>
      </div>

      {error && (
        <div role="alert" style={{ padding: '8px 32px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
          <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
        </div>
      )}
      {actionError && (
        <div role="alert" style={{ padding: '8px 32px', background: '#fef3c7', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: 12 }}>
          <i className="bi-exclamation-circle-fill" style={{ marginRight: 6 }} />{actionError}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <i className="bi-shield-check" style={{ fontSize: 40, color: '#c0c0c0', display: 'block', marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
              {statusFilter || search ? 'No matches' : 'All clear'}
            </div>
            <div style={{ fontSize: 13, color: '#9e9e9e' }}>
              {statusFilter || search ? 'Try adjusting the filters' : 'No urgent assist requests in this scope right now.'}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
                <Th label="Subject"  align="left" minWidth={220} />
                <Th label="Type"     width={170} />
                <Th label="Country"  width={110} />
                <Th label="Assignee" width={130} />
                <Th label="Created"  width={120} />
                <Th label="SLA (6h)" width={90} />
                <Th label="Status"   width={150} />
                <Th label="Link"     width={100} />
                <Th label=""         width={70} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <UrgentRow
                  key={row.id}
                  row={row}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Row component ──
function UrgentRow({ row, onStatusChange, onDelete }) {
  const [hov, setHov] = useState(false);
  const flag = getFlag(row.country);
  const countryLabel = getCountryName(row.country) || row.country || '';

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: '1px solid #f0efed',
        background: hov ? '#faf8ff' : 'white',
        transition: 'background .1s',
      }}
    >
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320, paddingLeft: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i
            className={row.isManual ? 'bi-pencil-square' : 'bi-grid-3x3-gap-fill'}
            title={row.isManual ? 'Manually created' : 'From Workbench'}
            style={{ fontSize: 12, color: row.isManual ? '#7c3aed' : '#0369a1', flexShrink: 0 }}
          />
          <span title={row.subject} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {row.subject}
          </span>
        </div>
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161' }} title={row.requestType}>
        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 128, background: '#fef2f2', color: '#d42d35', border: '1px solid #fca5a5', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {row.requestType}
        </span>
      </td>
      <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }} title={countryLabel}>
        {flag && <span style={{ marginRight: 3 }}>{flag}</span>}
        <span style={{ color: '#616161', fontWeight: 500 }}>{row.country || '--'}</span>
      </td>
      <td style={tdStyle} title={row.assigneeName || 'Unassigned'}>
        {row.assigneeName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Avatar name={row.assigneeName} size="xs" />
            <span style={{ fontSize: 11, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
              {row.assigneeName.split(' ')[0]}
            </span>
          </div>
        ) : <span style={{ fontSize: 11, color: '#9e9e9e' }}>Unassigned</span>}
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: '#616161', whiteSpace: 'nowrap' }} title={row.createdAt ? new Date(row.createdAt).toLocaleString() : ''}>
        <div>{fmtDate(row.createdAt)}</div>
        <div style={{ fontSize: 10, color: '#9e9e9e' }}>{relTime(row.createdAt)}</div>
      </td>
      <td style={tdStyle}>
        <SlaBadge slaRemaining={row.slaRemaining} slaBreachStatus={row.slaBreachStatus} />
      </td>
      <td style={tdStyle}>
        {row.isManual ? (
          <StatusSelect value={row.status} onChange={(v) => onStatusChange(row, v)} />
        ) : (
          <StatusBadge status={row.status} />
        )}
      </td>
      <td style={tdStyle}>
        {row.linkUrl ? (
          <a
            href={row.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
              background: hov ? '#e8f0fe' : '#f5f4f2', color: hov ? '#1f74b3' : '#9e9e9e',
              fontSize: 10, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
              border: hov ? '1px solid #c8d9f0' : '1px solid transparent',
            }}
          >
            <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />Open
          </a>
        ) : <span style={{ color: '#d5d5d5', fontSize: 11 }}>--</span>}
      </td>
      <td style={tdStyle}>
        {row.isManual && (
          <button
            type="button"
            onClick={() => onDelete(row)}
            aria-label={`Delete "${row.subject}"`}
            title="Delete"
            style={{ background: 'transparent', border: 'none', color: '#9e9e9e', cursor: 'pointer', padding: '4px 6px', borderRadius: 6 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#d42d35'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e9e9e'; }}
          >
            <i className="bi-trash" style={{ fontSize: 12 }} />
          </button>
        )}
      </td>
    </tr>
  );
}

function ScopePill({ value, current, onChange, label }) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={active}
      style={{
        height: 32, padding: '0 14px', borderRadius: 8,
        border: active ? '1.5px solid #1b1b1b' : '1px solid #e8e8e8',
        background: active ? '#1b1b1b' : 'white',
        color: active ? 'white' : '#616161',
        fontSize: 12, fontWeight: active ? 600 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

function Th({ label, width, minWidth, align }) {
  return (
    <th
      scope="col"
      style={{
        ...thStyle,
        ...(width ? { width } : null),
        ...(minWidth ? { minWidth } : null),
        ...(align ? { textAlign: align } : null),
      }}
    >
      {label}
    </th>
  );
}

const thStyle = { padding: '10px 12px', fontSize: 10, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' };
