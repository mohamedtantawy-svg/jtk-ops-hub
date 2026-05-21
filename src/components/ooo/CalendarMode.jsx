// ── CalendarMode (Gantt) ──────────────────────────────────────────────
// People × days grid. Each row is one person; bars span their OOO
// ranges. Bars are colour-coded by handover state via
// handoverStateColor() so a manager can scan a column to spot coverage
// holes at a glance (HANDOVERS_PLAN.md §4.1).
//
// Rendering model: every row is a single flex container with two
// children:
//   1. Sticky left column with avatar + name + dated pill
//   2. Day strip — a relative-positioned div that renders one absolute
//      bar per OOO event the person has in the visible window.
// The day grid lines + today indicator are drawn as a single CSS
// repeating background + an absolute vertical line — no per-day DOM
// nodes, so 30 days × 200 people stays cheap.

import { useMemo, useState } from 'react';
import Avatar from '../ui/Avatar';
import { isoDate, eventTiming, handoverStateColor } from '../../lib/handover-helpers';

const LEFT_COL_PX = 220;
const DAY_PX = 32;
const ROW_H = 36;

const BAR_COLOURS = {
  green: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
  amber: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  red:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  slate: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' },
  grey:  { bg: '#E5E7EB', fg: '#6B7280', border: '#D1D5DB' },
};

function isoFromDayIndex(startIso, idx) {
  const [y, m, d] = startIso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + idx);
  const dt = new Date(t);
  return dt.toISOString().slice(0, 10);
}

function dayDelta(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function monthLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function CalendarMode({
  events,
  membersByEmail,
  from,
  to,
  todayIso,
  onSelectEvent,
  // Emails that should ALWAYS render as a calendar row even with zero
  // events in the window. Lets a newly-added member (no time off
  // scheduled yet) confirm their presence on the calendar — Ines Barata
  // 2026-05-14 bug "Personal OOO view" / "we just added her to the ops
  // hub, maybe a bug?". OOOView wires this with the caller's own email
  // (always shown) plus, when the lens is 'team', the rest of the
  // visible direct-team roster. Other lenses keep the legacy
  // events-first behaviour to avoid clutter.
  alwaysShowEmails = null,
}) {
  const today = todayIso || isoDate();
  const totalDays = Math.max(1, dayDelta(from, to) + 1);
  const gridWidth = totalDays * DAY_PX;
  const [hoveredEventId, setHoveredEventId] = useState(null);

  // Group events by work_email; sort each group by start_date. Seed the
  // map with `alwaysShowEmails` so even members with zero events in the
  // window get a row (empty timeline) — keeps the calendar honest about
  // who's on the team.
  const byEmail = useMemo(() => {
    const map = new Map();
    if (alwaysShowEmails) {
      for (const e of alwaysShowEmails) {
        if (!e) continue;
        const lc = String(e).toLowerCase();
        if (!map.has(lc)) map.set(lc, []);
      }
    }
    for (const ev of events || []) {
      if (!ev?.work_email) continue;
      const e = ev.work_email.toLowerCase();
      if (!map.has(e)) map.set(e, []);
      map.get(e).push(ev);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    }
    return map;
  }, [events, alwaysShowEmails]);

  // Stable, alphabetical row order by member name (fall back to derived
  // display name from email localpart, then finally to the raw email).
  // 2026-05-21 audit F31: the previous fallback was the raw email, which
  // produced inconsistent rows like "Abe Elkholi" next to
  // "alice.muncapui@deel.com" / "alaetra.wilkerson@deel.com" — a visual
  // mess that made the calendar look unprofessional. Now we derive
  // "Alice Muncapui" / "Alaetra Wilkerson" from the localpart so unmatched
  // roster members render in title-case alongside the named ones.
  const nameFromEmail = (email) => {
    if (!email) return '';
    const local = String(email).split('@')[0] || '';
    if (!local) return email;
    const parts = local.split(/[._-]/).filter(Boolean);
    if (parts.length === 0) return local;
    return parts.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  };
  const personRows = useMemo(() => {
    return Array.from(byEmail.entries())
      .map(([email, evs]) => {
        const m = membersByEmail?.get(email);
        const name = m?.name || nameFromEmail(email);
        return { email, name, member: m, events: evs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [byEmail, membersByEmail]);

  if (personRows.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i className="bi-calendar2-check" style={{ fontSize: 32, opacity: 0.4, display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nothing on the calendar</div>
        <div style={{ fontSize: 12 }}>No OOO ranges in the selected window for the current lens.</div>
      </div>
    );
  }

  // Day-header labels — show "May 12" at the start of the range + every
  // 7 days for readability, today gets a stronger label.
  const todayOffset = dayDelta(from, today);
  const todayWithinWindow = todayOffset >= 0 && todayOffset < totalDays;

  return (
    /* flex:1 + minHeight:0 so the calendar claims its parent's full height
       (the OOO body uses `overflow:hidden` + flex column). Without this the
       grid stretches to natural row × ROW_H height and overflows past the
       viewport's bottom edge — Megan Lawrence 2026-05-15 "the pages are
       not showing full" repro. */
    <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto', position: 'relative' }}>
      <div style={{ minWidth: LEFT_COL_PX + gridWidth }}>
        {/* ── Sticky day header ──────────────────────────────────────── */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 4,
            display: 'flex',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border-light)',
            height: ROW_H,
          }}
        >
          <div
            style={{
              position: 'sticky',
              left: 0,
              zIndex: 5,
              width: LEFT_COL_PX,
              minWidth: LEFT_COL_PX,
              background: 'var(--surface)',
              borderRight: '1px solid var(--border-light)',
              padding: '0 14px',
              display: 'flex',
              alignItems: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Person
          </div>
          <div
            style={{
              position: 'relative',
              width: gridWidth,
              minWidth: gridWidth,
              height: ROW_H,
              background:
                `repeating-linear-gradient(to right,` +
                ` transparent 0, transparent ${DAY_PX - 1}px,` +
                ` rgba(15,23,42,0.06) ${DAY_PX - 1}px, rgba(15,23,42,0.06) ${DAY_PX}px)`,
            }}
          >
            {/* Day labels every Monday + first day */}
            {Array.from({ length: totalDays }, (_, i) => {
              const iso = isoFromDayIndex(from, i);
              const [y, m, d] = iso.split('-').map(Number);
              const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
              const showLabel = i === 0 || dow === 1; // Mondays + range-start
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: i * DAY_PX,
                    top: 0,
                    width: DAY_PX,
                    height: ROW_H,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    color: dow === 0 || dow === 6 ? 'var(--text-secondary)' : 'var(--text)',
                    fontWeight: i === todayOffset ? 700 : 500,
                  }}
                >
                  {showLabel ? monthLabel(iso) : (
                    <span style={{ opacity: 0.45 }}>{d}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Body rows ──────────────────────────────────────────────── */}
        <div style={{ position: 'relative' }}>
          {/* Today vertical line spans the whole rows area */}
          {todayWithinWindow && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: LEFT_COL_PX + todayOffset * DAY_PX + DAY_PX / 2 - 1,
                top: 0,
                bottom: 0,
                width: 2,
                background: 'var(--purple, #7c3aed)',
                opacity: 0.35,
                zIndex: 1,
                pointerEvents: 'none',
              }}
            />
          )}

          {personRows.map((row, rowIdx) => (
            <div
              key={row.email}
              style={{
                display: 'flex',
                height: ROW_H,
                borderBottom: '1px solid var(--border-light)',
                background: rowIdx % 2 === 0 ? 'var(--surface)' : 'rgba(15,23,42,0.015)',
              }}
            >
              {/* Sticky left column — avatar + name */}
              <div
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                  width: LEFT_COL_PX,
                  minWidth: LEFT_COL_PX,
                  background: rowIdx % 2 === 0 ? 'var(--surface)' : '#FAFBFC',
                  borderRight: '1px solid var(--border-light)',
                  padding: '0 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  overflow: 'hidden',
                }}
              >
                <Avatar
                  name={row.name}
                  initials={row.member?.initials}
                  src={row.member?.avatarUrl || row.member?.avatar_url}
                  size="sm"
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{row.name}</div>
                  {row.member?.country && (
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                      {row.member.country}
                    </div>
                  )}
                </div>
              </div>

              {/* Day strip with bars */}
              <div
                style={{
                  position: 'relative',
                  width: gridWidth,
                  minWidth: gridWidth,
                  height: ROW_H,
                  background:
                    `repeating-linear-gradient(to right,` +
                    ` transparent 0, transparent ${DAY_PX - 1}px,` +
                    ` rgba(15,23,42,0.04) ${DAY_PX - 1}px, rgba(15,23,42,0.04) ${DAY_PX}px)`,
                }}
              >
                {row.events.map(ev => {
                  if (!ev.start_date || !ev.end_date) return null;
                  let startOffset = dayDelta(from, ev.start_date);
                  let endOffset   = dayDelta(from, ev.end_date);
                  if (endOffset < 0 || startOffset >= totalDays) return null; // outside window
                  if (startOffset < 0) startOffset = 0;
                  if (endOffset >= totalDays) endOffset = totalDays - 1;
                  const width = (endOffset - startOffset + 1) * DAY_PX - 4;
                  const left  = startOffset * DAY_PX + 2;
                  const timing = eventTiming(ev, today);
                  const colour = BAR_COLOURS[handoverStateColor({ handover: ev.handover, eventInPast: timing === 'past' })] || BAR_COLOURS.red;
                  const isHovered = hoveredEventId === ev.id;
                  const label = ev.handover
                    ? `${ev.handover.status.replace(/_/g, ' ')}`
                    : 'No handover';
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onSelectEvent?.(ev)}
                      onMouseEnter={() => setHoveredEventId(ev.id)}
                      onMouseLeave={() => setHoveredEventId(prev => prev === ev.id ? null : prev)}
                      title={`${row.name} · ${ev.start_date} → ${ev.end_date} · ${label}`}
                      style={{
                        position: 'absolute',
                        top: 6,
                        height: ROW_H - 12,
                        left,
                        width: Math.max(DAY_PX - 4, width),
                        borderRadius: 6,
                        background: colour.bg,
                        border: `1px solid ${colour.border}`,
                        color: colour.fg,
                        cursor: 'pointer',
                        padding: '0 6px',
                        fontSize: 10,
                        fontWeight: 600,
                        textAlign: 'left',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        boxShadow: isHovered ? '0 2px 6px rgba(15,23,42,0.12)' : 'none',
                        transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
                        transition: 'transform .12s, box-shadow .12s',
                        fontFamily: 'inherit',
                      }}
                    >
                      <i
                        className={ev.handover ? 'bi-check2-circle' : 'bi-exclamation-circle'}
                        style={{ fontSize: 10, marginRight: 4 }}
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CalendarMode;
