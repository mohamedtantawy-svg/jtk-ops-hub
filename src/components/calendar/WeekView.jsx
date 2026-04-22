// ── WeekView — 7-column week grid with event pills per day ─────────────────
// Alternate to MonthView for when the user flicks the "Week" filter.
// Deliberately simple: column per day (Mon-start), vertical list of event
// cards inside each column. Not a time-grid like Google's week view — the
// daily section above already covers detailed timing; this view is for
// "what does the week look like at a glance".
//
// Props:
//   weekStart     — Date (Monday of the week being displayed)
//   events        — filtered to this week by the caller
//   onOpenEvent   — fn to open EventDetail
//   onNavigate    — (+1/-1) => void — next/prev week
//   onGoToday     — () => void

import { memo, useMemo } from 'react';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COLOUR_TOKENS = {
  google: { text: '#1565c0', bg: '#dbeafe', border: '#93c5fd' },
  blue:   { text: '#1565c0', bg: '#dbeafe', border: '#93c5fd' },
  green:  { text: '#29811e', bg: '#d1fae5', border: '#86efac' },
  purple: { text: '#7c3aed', bg: '#ede9fe', border: '#c4b5fd' },
  orange: { text: '#ed8d00', bg: '#fef3c7', border: '#fcd34d' },
  red:    { text: '#d42d35', bg: '#fee2e2', border: '#fca5a5' },
  gray:   { text: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
};
function colourFor(ev) {
  return ev.source === 'local'
    ? (COLOUR_TOKENS[ev.color] || COLOUR_TOKENS.purple)
    : COLOUR_TOKENS.google;
}

function formatTime(iso, allDay) {
  if (!iso) return '';
  if (allDay) return 'All day';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function WeekView({ weekStart, events, onOpenEvent, onNavigate, onGoToday }) {
  // Precompute the 7 dates of this week so each column knows its date.
  const days = useMemo(() => {
    const result = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      result.push(d);
    }
    return result;
  }, [weekStart]);

  const todayKey = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t.getTime();
  }, []);

  // Bucket events into day columns. Use local-time extraction for the day
  // key so evening events don't jump columns in non-UTC timezones.
  const byDay = useMemo(() => {
    const map = new Map(days.map((d) => [d.getTime(), []]));
    for (const ev of events) {
      if (!ev.startAt) continue;
      const d = new Date(ev.startAt);
      if (Number.isNaN(d.getTime())) continue;
      d.setHours(0, 0, 0, 0);
      const bucket = map.get(d.getTime());
      if (bucket) bucket.push(ev);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    }
    return map;
  }, [days, events]);

  const rangeLabel = useMemo(() => {
    const first = days[0];
    const last = days[6];
    const opts = { month: 'short', day: 'numeric' };
    if (first.getMonth() === last.getMonth()) {
      return `${first.toLocaleDateString('en-US', opts)} – ${last.getDate()}, ${last.getFullYear()}`;
    }
    return `${first.toLocaleDateString('en-US', opts)} – ${last.toLocaleDateString('en-US', opts)}, ${last.getFullYear()}`;
  }, [days]);

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
      {/* Header — week nav */}
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
            {rangeLabel}
          </span>
          <button type="button" onClick={onGoToday} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)', padding: '4px 13px',
            cursor: 'pointer', color: 'var(--purple)',
            fontSize: 12, fontWeight: 600, boxShadow: 'var(--shadow-sm)',
          }}>
            This week
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

      {/* Day column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
        {days.map((d, i) => {
          const isToday = d.getTime() === todayKey;
          const isWeekend = i >= 5;
          return (
            <div key={i} style={{
              padding: '8px 6px',
              textAlign: 'center',
              background: isWeekend ? '#fafafa' : 'var(--surface)',
              borderRight: i < 6 ? '1px solid var(--border)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {DAY_LABELS[i]}
              </div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26, height: 26,
                margin: '0 auto',
                borderRadius: 'var(--radius-pill)',
                background: isToday ? '#7c3aed' : 'transparent',
                color: isToday ? '#fff' : 'var(--text-1)',
                fontSize: 13, fontWeight: 700,
              }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day columns body */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        minHeight: 280,
      }}>
        {days.map((d, i) => {
          const items = byDay.get(d.getTime()) || [];
          const isWeekend = i >= 5;
          return (
            <div key={i} style={{
              borderRight: i < 6 ? '1px solid var(--border)' : 'none',
              background: isWeekend ? '#fafafa' : 'var(--surface)',
              padding: '8px 6px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: '100%',
            }}>
              {items.length === 0 ? (
                <div style={{
                  fontSize: 11, color: 'var(--text-3)',
                  textAlign: 'center', padding: '20px 0',
                  fontWeight: 500,
                }}>
                  —
                </div>
              ) : items.map((ev) => {
                const c = colourFor(ev);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onOpenEvent(ev)}
                    title={ev.title}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      background: c.bg,
                      color: c.text,
                      border: `1px solid ${c.border}`,
                      borderLeft: `3px solid ${c.text}`,
                      borderRadius: 6,
                      padding: '5px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.85 }}>
                      {formatTime(ev.startAt, ev.allDay)}
                    </span>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {ev.title}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(WeekView);
