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

function TableMode({ events, membersByEmail, todayIso, onSelectEvent }) {
  const today = todayIso || isoDate();
  const [sortBy, setSortBy] = useState('start_date');
  const [sortDir, setSortDir] = useState('asc');

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
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
            {[
              { id: 'name',       label: 'Person',  w: 240 },
              { id: 'start_date', label: 'Range',   w: 200 },
              { id: 'days',       label: 'Days',    w: 70  },
              { id: 'status',     label: 'Status',  w: 160 },
              { id: null,         label: 'Coverer(s)', w: 220 },
              { id: null,         label: 'Countries',  w: 140 },
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TableMode;
