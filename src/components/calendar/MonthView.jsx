// ── MonthView — classic 7-column month grid ────────────────────────────────
// Lifted from the original CalendarView (see components/views/CalendarView.jsx
// pre-rewrite) but fed from live events instead of CALENDAR_EVENTS mock data.
// Week starts on Monday to match the app's existing calendar convention.
//
// Props:
//   year, month       — selected month (month is 0-based JS convention)
//   events            — pre-filtered to this month's window by the caller
//   selectedDay       — 'YYYY-MM-DD' or null
//   onSelectDay       — (string|null) => void
//   onOpenEvent       — (event) => void
//   onNavigate        — (+1/-1) => void  prev/next month
//   onGoToday         — () => void

import { memo, useMemo } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

// Event colours indexed by source / local-event colour choice.
const COLOUR_TOKENS = {
  google: { text: '#1565c0', bg: '#dbeafe' },
  blue:   { text: '#1565c0', bg: '#dbeafe' },
  green:  { text: '#29811e', bg: '#d1fae5' },
  purple: { text: '#7c3aed', bg: '#ede9fe' },
  orange: { text: '#ed8d00', bg: '#fef3c7' },
  red:    { text: '#d42d35', bg: '#fee2e2' },
  gray:   { text: '#6b7280', bg: '#f3f4f6' },
};

function colourFor(event) {
  if (event.source === 'local') return COLOUR_TOKENS[event.color] || COLOUR_TOKENS.purple;
  return COLOUR_TOKENS.google;
}

// Bucket events by YYYY-MM-DD in the user's local timezone.
// Uses local date extraction because that's how the grid cells are keyed;
// doing UTC here would cause evening events to jump days in western TZs.
function bucketByDay(events) {
  const map = new Map();
  for (const ev of events) {
    if (!ev.startAt) continue;
    const d = new Date(ev.startAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  }
  return map;
}

function EventPill({ event, onClick }) {
  const c = colourFor(event);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(event); }}
      title={event.title}
      style={{
        all: 'unset',
        fontSize: 11,
        fontWeight: 600,
        color: c.text,
        background: c.bg,
        borderRadius: 4,
        padding: '2px 6px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        lineHeight: '16px',
        maxWidth: '100%',
        display: 'block',
        cursor: 'pointer',
      }}
    >
      {event.title}
    </button>
  );
}

function DayCell({ cell, isToday, isSelected, isWeekend, onSelectDay, onOpenEvent }) {
  const visible = cell.events.slice(0, 2);
  const overflow = cell.events.length - visible.length;

  const bg = isSelected ? 'var(--bg)' : isWeekend ? '#fafafa' : 'var(--surface)';
  const borderLeft = isSelected ? '3px solid var(--purple)' : '1px solid var(--border)';

  return (
    <div
      onClick={() => cell.inMonth && onSelectDay(cell.date)}
      style={{
        background: bg,
        borderLeft,
        borderRight: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        minHeight: 90,
        padding: '6px 7px',
        cursor: cell.inMonth ? 'pointer' : 'default',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 2 }}>
        {isToday ? (
          <span style={{
            width: 26, height: 26,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--purple)', color: '#fff',
            fontSize: 14, fontWeight: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {cell.day}
          </span>
        ) : (
          <span style={{
            fontSize: 14,
            fontWeight: cell.inMonth ? 500 : 400,
            color: cell.inMonth
              ? (isSelected ? 'var(--purple)' : 'var(--text)')
              : 'var(--text-3)',
            lineHeight: '24px',
            paddingLeft: 3,
          }}>
            {cell.day}
          </span>
        )}
      </div>

      {visible.map((ev, i) => (
        <EventPill key={`${ev.id}-${i}`} event={ev} onClick={onOpenEvent} />
      ))}
      {overflow > 0 && (
        <div style={{
          fontSize: 10, color: 'var(--text-3)',
          fontWeight: 500, paddingLeft: 3, cursor: 'pointer',
        }}>
          +{overflow} more
        </div>
      )}
    </div>
  );
}

function MonthView({
  year, month, events,
  selectedDay, onSelectDay,
  onOpenEvent, onNavigate, onGoToday,
}) {
  const todayStr = useMemo(() => {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);

  const byDay = useMemo(() => bucketByDay(events), [events]);

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const rows = [];
    const prevLast = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      rows.push({ day: prevLast - i, inMonth: false, date: null, events: [] });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = toDateStr(year, month, d);
      rows.push({ day: d, inMonth: true, date: dateStr, events: byDay.get(dateStr) || [] });
    }
    const rem = rows.length % 7;
    if (rem !== 0) {
      for (let i = 1; i <= 7 - rem; i++) {
        rows.push({ day: i, inMonth: false, date: null, events: [] });
      }
    }
    return rows;
  }, [year, month, byDay]);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header with prev/next and Today */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--border)',
      }}>
        <button type="button" onClick={() => onNavigate(-1)} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-pill)', padding: '6px 12px',
          cursor: 'pointer', color: 'var(--text-2)', fontSize: 13,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <i className="bi-chevron-left" />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button type="button" onClick={onGoToday} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)', padding: '4px 13px',
            cursor: 'pointer', color: 'var(--purple)',
            fontSize: 12, fontWeight: 600,
            boxShadow: 'var(--shadow-sm)',
          }}>
            Today
          </button>
        </div>
        <button type="button" onClick={() => onNavigate(1)} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-pill)', padding: '6px 12px',
          cursor: 'pointer', color: 'var(--text-2)', fontSize: 13,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <i className="bi-chevron-right" />
        </button>
      </div>

      {/* Day-of-week header row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
        {DAY_LABELS.map((d, i) => (
          <div key={d} style={{
            textAlign: 'center',
            fontSize: 11, fontWeight: 600,
            color: 'var(--text-muted)',
            padding: '10px 0',
            background: (i === 5 || i === 6) ? '#fafafa' : 'var(--surface)',
            borderRight: i < 6 ? '1px solid var(--border)' : 'none',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((cell, i) => (
          <DayCell
            key={`${cell.date || 'x'}-${i}`}
            cell={cell}
            isToday={cell.date === todayStr}
            isSelected={cell.date === selectedDay}
            isWeekend={(i % 7) === 5 || (i % 7) === 6}
            onSelectDay={onSelectDay}
            onOpenEvent={onOpenEvent}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(MonthView);
