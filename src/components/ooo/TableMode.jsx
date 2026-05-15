// ── TableMode ─────────────────────────────────────────────────────────
// Sortable, virtualised-friendly list of OOO ranges with their handover
// status. Columns: Person · Range · Days · Status · Coverer(s) ·
// Countries · Updated. Row click opens the Detail slide-out.
//
// Phase 1 ships read-only; Phase 5 adds bulk-select + bulk approve in
// the toolbar slot at the top of this component.

import { useMemo, useState } from 'react';
import Avatar from '../ui/Avatar';
import { isoDate, eventTiming, handoverStateColor, daysBetween } from '../../lib/handover-helpers';
import { deleteTimeOffEvent } from '../../services/timeOffApi';

// Mirror of canCallerManageTarget in DetailSlideOut — duplicated here so the
// inline row actions can gate without an import cycle. Keep both copies in
// sync if the rules change. Server-side `canManageTimeOffFor` is the
// authority; this is UX-only.
function canCallerManageTarget(callerEmail, callerRole, targetEmail, membersByEmail) {
  if (!callerEmail || !targetEmail) return false;
  const callerLc = String(callerEmail).toLowerCase();
  const targetLc = String(targetEmail).toLowerCase();
  if (callerLc === targetLc) return true;
  if (callerRole === 'admin') return true;
  const targetMember = membersByEmail?.get?.(targetLc);
  if (!targetMember) return false;
  const directMgr = String(targetMember.managerEmail || '').toLowerCase();
  if (callerRole === 'team_lead') return directMgr === callerLc;
  if (callerRole === 'regional_manager') {
    let cursor = directMgr;
    let safety = 0;
    while (cursor && safety++ < 20) {
      if (cursor === callerLc) return true;
      const next = membersByEmail?.get?.(cursor);
      cursor = String(next?.managerEmail || '').toLowerCase();
    }
    return false;
  }
  return false;
}

const STATUS_COLOURS = {
  green: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC', label: 'Approved / Active' },
  amber: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D', label: 'Pending' },
  red:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5', label: 'No handover' },
  slate: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: 'Past' },
  grey:  { bg: '#E5E7EB', fg: '#6B7280', border: '#D1D5DB', label: 'Closed' },
};

const SORT_LABELS = {
  start_date: 'Start date',
  name:       'Name',
  days:       'Days',
  status:     'Status',
};

function formatRange(start, end) {
  if (!start || !end) return '';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function statusLabel(ev, today) {
  if (!ev) return STATUS_COLOURS.red.label;
  const timing = eventTiming(ev, today);
  const colour = handoverStateColor({ handover: ev.handover, eventInPast: timing === 'past' });
  if (colour === 'green' && ev.handover) {
    return ev.handover.status === 'active' ? 'Active' : 'Approved';
  }
  if (colour === 'amber' && ev.handover) {
    if (ev.handover.status === 'pending_coverage_acceptance') return 'Awaiting coverer';
    if (ev.handover.status === 'pending_manager_approval')    return 'Awaiting approval';
  }
  return STATUS_COLOURS[colour]?.label || 'Unknown';
}

function TableMode({
  events, membersByEmail, todayIso, onSelectEvent,
  currentUserEmail, currentUserRole, onBulkApprove, onBulkReject,
  // Per-row edit/delete affordances. Megan Lawrence 2026-05-15 ask: surface
  // inline pencil + trash on rows the caller can manage, so users don't have
  // to dig into the slide-out to update or remove an entry.
  onEditEvent,
  onUpdated,
  onToast,
}) {
  const today = todayIso || isoDate();
  const [sortBy, setSortBy] = useState('start_date');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  // Per-row delete busy state — keyed by event id so multiple deletes can be
  // in flight without one row blocking the rest.
  const [deletingId, setDeletingId] = useState(null);

  const callerLc = (currentUserEmail || '').toLowerCase();
  const isAdminish = currentUserRole === 'admin' || currentUserRole === 'regional_manager';

  // Pre-compute which rows the caller can manage so the actions column
  // visibility is cheap inside the row map.
  const canManageEmail = (email) => canCallerManageTarget(currentUserEmail, currentUserRole, email, membersByEmail);

  const handleRowDelete = async (ev) => {
    if (!ev?.id || deletingId) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Delete this time-off entry?\n\n${ev.work_email} · ${ev.start_date} → ${ev.end_date}\n\nThis can't be undone.`)
      : false;
    if (!confirmed) return;
    setDeletingId(ev.id);
    try {
      await deleteTimeOffEvent(ev.id);
      onToast?.({ kind: 'success', message: 'Time-off entry removed.' });
      onUpdated?.();
    } catch (err) {
      onToast?.({ kind: 'error', message: err?.body?.error || err?.message || 'Delete failed' });
    } finally {
      setDeletingId(null);
    }
  };
  function eligibleForBulk(ev) {
    if (!ev?.handover) return false;
    if (ev.handover.status !== 'pending_manager_approval') return false;
    if (isAdminish) return true;
    return (ev.handover.manager_email || '').toLowerCase() === callerLc;
  }

  const rows = useMemo(() => {
    const arr = (events || []).map(ev => {
      const m = membersByEmail?.get((ev.work_email || '').toLowerCase());
      const timing = eventTiming(ev, today);
      const colour = handoverStateColor({ handover: ev.handover, eventInPast: timing === 'past' });
      return {
        event: ev,
        member: m,
        name: m?.name || ev.work_email,
        days: Math.max(1, daysBetween(ev.start_date, ev.end_date) + 1),
        colour,
        statusLabel: statusLabel(ev, today),
      };
    });
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'start_date') cmp = (a.event.start_date || '').localeCompare(b.event.start_date || '');
      else if (sortBy === 'name')  cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'days')  cmp = a.days - b.days;
      else if (sortBy === 'status') cmp = a.colour.localeCompare(b.colour);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [events, membersByEmail, today, sortBy, sortDir]);

  const eligibleRows = useMemo(() => rows.filter(r => eligibleForBulk(r.event)), [rows]);
  const allEligibleSelected = eligibleRows.length > 0 && eligibleRows.every(r => selectedIds.has(r.event.id));
  const bulkAvailable = eligibleRows.length > 0;
  const selectedCount = selectedIds.size;

  function toggleSelectAll() {
    setSelectedIds(prev => {
      if (allEligibleSelected) return new Set();
      const next = new Set(prev);
      for (const r of eligibleRows) next.add(r.event.id);
      return next;
    });
  }
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runBulk(handler, label) {
    if (selectedCount === 0) return;
    setBusy(true);
    try {
      await handler(Array.from(selectedIds));
      setSelectedIds(new Set());
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i className="bi-table" style={{ fontSize: 32, opacity: 0.4, display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No rows in this lens</div>
        <div style={{ fontSize: 12 }}>Try switching lens or expanding the date range.</div>
      </div>
    );
  }

  function setSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  return (
    /* flex:1 + minHeight:0 lets the wrapper claim the OOO body's available
       height so the inner `overflow:auto` actually scrolls. Without it the
       table renders at natural height and the parent's `overflow:hidden`
       clips the bottom rows — Megan Lawrence 2026-05-15 "the pages are
       not showing full" repro. */
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {selectedCount > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 3,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 16px',
          background: 'rgba(124, 58, 237, 0.10)',
          borderBottom: '1px solid rgba(124, 58, 237, 0.25)',
          color: 'var(--purple, #7c3aed)',
          fontSize: 12,
        }}>
          <strong>{selectedCount} selected</strong>
          <span style={{ color: 'var(--text-secondary)' }}>·</span>
          <button type="button" disabled={busy}
            onClick={() => runBulk(onBulkApprove, 'approve')}
            style={{
              padding: '5px 12px', borderRadius: 6,
              background: 'var(--purple, #7c3aed)', color: 'white',
              border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', opacity: busy ? 0.55 : 1,
            }}>
            Approve all
          </button>
          <button type="button" disabled={busy}
            onClick={() => runBulk(onBulkReject, 'reject')}
            style={{
              padding: '5px 12px', borderRadius: 6,
              background: 'var(--surface)', color: '#B91C1C',
              border: '1px solid #B91C1C', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', opacity: busy ? 0.55 : 1,
            }}>
            Reject all
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => setSelectedIds(new Set())}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-secondary)',
              fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
            }}>
            Clear selection
          </button>
        </div>
      )}
      <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
            {bulkAvailable && (
              <th style={{
                width: 36, padding: '10px 8px 10px 14px',
                borderBottom: '1px solid var(--border-light)',
              }}>
                <input
                  type="checkbox"
                  aria-label="Select all eligible rows"
                  checked={allEligibleSelected}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
            )}
            {[
              { id: 'name',       label: 'Person',  w: 240 },
              { id: 'start_date', label: 'Range',   w: 200 },
              { id: 'days',       label: 'Days',    w: 70  },
              { id: 'status',     label: 'Status',  w: 160 },
              { id: null,         label: 'Coverer(s)', w: 220 },
              { id: null,         label: 'Countries',  w: 140 },
              { id: null,         label: '',          w: 90  },   // actions column (edit/delete)
            ].map(col => (
              <th
                key={col.label}
                style={{
                  textAlign: 'left',
                  padding: '10px 14px',
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: col.id ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                  width: col.w,
                }}
                onClick={col.id ? () => setSort(col.id) : undefined}
                aria-sort={col.id && sortBy === col.id ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                title={col.id ? `Sort by ${SORT_LABELS[col.id] || col.label}` : undefined}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {col.id && sortBy === col.id && (
                    <i className={`bi-caret-${sortDir === 'asc' ? 'up' : 'down'}-fill`} style={{ fontSize: 10 }} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const colour = STATUS_COLOURS[r.colour] || STATUS_COLOURS.red;
            const coverers = r.event.handover?.coverers || [];
            const accepted = coverers.filter(c => c.acceptance_status === 'accepted');
            const labels = (accepted.length ? accepted : coverers).slice(0, 2).map(c => {
              const m = membersByEmail?.get((c.email || '').toLowerCase());
              return m?.name || c.email;
            });
            const more = coverers.length > 2 ? `, +${coverers.length - 2} more` : '';
            const isEligible = eligibleForBulk(r.event);
            return (
              <tr
                key={r.event.id}
                onClick={() => onSelectEvent?.(r.event)}
                style={{
                  background: i % 2 === 0 ? 'var(--surface)' : 'rgba(15,23,42,0.015)',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                {bulkAvailable && (
                  <td
                    onClick={(e) => e.stopPropagation()}
                    style={{ padding: '10px 8px 10px 14px', width: 36 }}
                  >
                    {isEligible ? (
                      <input
                        type="checkbox"
                        aria-label={`Select handover for ${r.name}`}
                        checked={selectedIds.has(r.event.id)}
                        onChange={() => toggleSelect(r.event.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    ) : (
                      <span style={{ display: 'inline-block', width: 13 }} aria-hidden />
                    )}
                  </td>
                )}
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar
                      name={r.name}
                      initials={r.member?.initials}
                      src={r.member?.avatarUrl || r.member?.avatar_url}
                      size="sm"
                    />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{r.name}</div>
                      {r.member?.title && (
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{r.member.title}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {formatRange(r.event.start_date, r.event.end_date)}
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{r.days}d</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: colour.bg,
                    color: colour.fg,
                    border: `1px solid ${colour.border}`,
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>
                    {r.statusLabel}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {coverers.length === 0
                    ? <span style={{ color: 'var(--text-secondary)' }}>—</span>
                    : `${labels.join(', ')}${more}`}
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                  {r.member?.country || <span>—</span>}
                </td>
                <td
                  onClick={(e) => e.stopPropagation()}
                  style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}
                >
                  {canManageEmail(r.event.work_email) && (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {onEditEvent && (
                        <button
                          type="button"
                          onClick={() => onEditEvent(r.event)}
                          aria-label={`Edit ${r.name}'s time off`}
                          title="Edit dates or reason"
                          style={{
                            width: 26, height: 26, padding: 0,
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--text-secondary)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: 'inherit',
                          }}
                        >
                          <i className="bi-pencil" style={{ fontSize: 11 }} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRowDelete(r.event)}
                        disabled={deletingId === r.event.id}
                        aria-label={`Delete ${r.name}'s time off`}
                        title="Delete this entry"
                        style={{
                          width: 26, height: 26, padding: 0,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          color: deletingId === r.event.id ? 'var(--text-secondary)' : '#b91c1c',
                          borderRadius: 6,
                          cursor: deletingId === r.event.id ? 'wait' : 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'inherit',
                        }}
                      >
                        <i className={deletingId === r.event.id ? 'bi-arrow-repeat' : 'bi-trash'} style={{ fontSize: 11 }} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default TableMode;
