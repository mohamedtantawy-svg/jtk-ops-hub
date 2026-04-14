import { useState, useMemo } from 'react';
import { CALENDAR_EVENTS } from '../../data/calendar';
import PageHeader from '../ui/PageHeader';

// ─── Event type colour tokens ──────────────────────────────────────────────────
const EVENT_COLOURS = {
  deadline: { bg: 'var(--red-light)',    text: 'var(--red)',    border: 'var(--red-mid)' },
  meeting:  { bg: 'var(--blue-light)',   text: 'var(--blue)',   border: 'var(--blue-mid)' },
  review:   { bg: 'var(--orange-light)', text: 'var(--orange)', border: 'var(--orange-mid)' },
  leave:    { bg: 'var(--green-light)',  text: 'var(--green)',  border: 'var(--green-mid)' },
  default:  { bg: 'var(--purple-light)', text: 'var(--purple)', border: 'var(--purple-mid)' },
};

// Legacy config kept for icon/label lookup (colours replaced by EVENT_COLOURS)
const TYPE_CONFIG = {
  deadline: { label: 'Deadline',  icon: 'bi-clock-history'    },
  meeting:  { label: 'Meeting',   icon: 'bi-camera-video'      },
  review:   { label: 'Review',    icon: 'bi-clipboard2-check'  },
  leave:    { label: 'Leave',     icon: 'bi-person-heart'      },
};

// Resolve colours for an event type
function getEventColour(type) {
  return EVENT_COLOURS[type] || EVENT_COLOURS.default;
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function formatDetailHeader(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function formatTime(time) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EventPill({ event }) {
  const c = getEventColour(event.type);
  return (
    <div
      title={event.title}
      style={{
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
      }}
    >
      {event.title}
    </div>
  );
}

function DayCell({ cell, isToday, isSelected, isWeekend, onClick }) {
  const [hovered, setHovered] = useState(false);

  const bgColor = isSelected
    ? 'var(--bg)'
    : hovered && cell.inMonth
    ? 'var(--bg)'
    : isWeekend
    ? '#fafafa'
    : 'var(--surface)';

  const borderLeft = isSelected ? '3px solid var(--purple)' : '1px solid var(--border)';

  const visibleEvents = cell.events ? cell.events.slice(0, 2) : [];
  const overflowCount = cell.events ? cell.events.length - 2 : 0;

  return (
    <div
      onClick={() => cell.inMonth && onClick(cell.date)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: bgColor,
        borderLeft,
        borderRight: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        borderTop: 'none',
        minHeight: 90,
        padding: '6px 7px',
        cursor: cell.inMonth ? 'pointer' : 'default',
        transition: 'background 0.12s',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      {/* Date number */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 2 }}>
        {isToday ? (
          <span style={{
            width: 26,
            height: 26,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--purple)',
            color: '#fff',
            fontSize: 'var(--font-md, 14px)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {cell.day}
          </span>
        ) : (
          <span style={{
            fontSize: 'var(--font-md, 14px)',
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

      {/* Event pills */}
      {visibleEvents.map((evt, j) => (
        <EventPill key={j} event={evt} />
      ))}
      {overflowCount > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500, paddingLeft: 3 }}>
          +{overflowCount} more
        </div>
      )}
    </div>
  );
}

function TodayStrip({ todayStr, todayEvents }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      padding: '12px 20px',
      maxHeight: 120,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Strip header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-pill)',
          background: 'var(--purple)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {new Date(todayStr + 'T00:00:00').getDate()}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
          Today
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
          {formatDetailHeader(todayStr)}
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--purple)',
          background: '#ede9fe',
          borderRadius: 'var(--radius-pill)',
          padding: '2px 10px',
          marginLeft: 4,
        }}>
          {todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Horizontal scrollable event pills */}
      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        flex: 1,
        minHeight: 0,
        paddingBottom: 2,
      }}>
        {todayEvents.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-3)',
            fontSize: 12,
            fontWeight: 500,
            padding: '4px 0',
          }}>
            <i className="bi-calendar2-check" style={{ fontSize: 14 }} />
            No events scheduled for today
          </div>
        ) : (
          todayEvents.map((evt) => {
            const c = getEventColour(evt.type);
            const meta = TYPE_CONFIG[evt.type] || { label: evt.type, icon: 'bi-calendar2' };
            return (
              <div
                key={evt.id}
                style={{
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                  borderRadius: 8,
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                  minWidth: 160,
                  maxWidth: 280,
                }}
              >
                <i className={meta.icon} style={{ color: c.text, fontSize: 13, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: c.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {evt.title}
                  </div>
                  {evt.time && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', marginTop: 1 }}>
                      {formatTime(evt.time)}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ExpandedDayEvents({ selectedDay, events, onClose }) {
  if (!selectedDay) return null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="bi-calendar2-event" style={{ fontSize: 14, color: 'var(--purple)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
            {formatDetailHeader(selectedDay)}
          </span>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-3)',
            background: 'var(--bg)',
            borderRadius: 'var(--radius-pill)',
            padding: '2px 10px',
          }}>
            {events.length === 0 ? 'No events' : `${events.length} event${events.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-3)',
            fontSize: 16,
            padding: '2px 6px',
            borderRadius: 'var(--radius-sm, 4px)',
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <i className="bi-x-lg" />
        </button>
      </div>

      {/* Events body */}
      <div style={{ padding: '12px 20px' }}>
        {events.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '16px 0',
            color: 'var(--text-3)',
            fontSize: 12,
            fontWeight: 500,
          }}>
            <i className="bi-calendar2" style={{ fontSize: 18, color: 'var(--border)' }} />
            No events scheduled for this day
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
          }}>
            {events.map((evt) => {
              const c = getEventColour(evt.type);
              const meta = TYPE_CONFIG[evt.type] || { label: evt.type, icon: 'bi-calendar2' };
              return (
                <div
                  key={evt.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${c.text}`,
                    borderRadius: 10,
                    padding: '10px 14px',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flex: '1 1 280px',
                    maxWidth: 420,
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                >
                  {/* Icon badge */}
                  <div style={{
                    width: 32,
                    height: 32,
                    background: c.bg,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <i className={meta.icon} style={{ color: c.text, fontSize: 14 }} />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: c.text,
                        background: c.bg,
                        borderRadius: 'var(--radius-pill)',
                        padding: '1px 7px',
                      }}>
                        {meta.label}
                      </span>
                      {evt.time && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                          {formatTime(evt.time)}
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-1)',
                      lineHeight: 1.35,
                      marginBottom: evt.description ? 3 : 0,
                    }}>
                      {evt.title}
                    </div>
                    {evt.description && (
                      <div style={{
                        fontSize: 11,
                        color: 'var(--text-3)',
                        lineHeight: 1.4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {evt.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
const CalendarView = ({ tasks }) => {
  // Use real today's date
  const realToday = new Date();
  const todayStr = toDateStr(realToday.getFullYear(), realToday.getMonth(), realToday.getDate());

  const [currentMonth, setCurrentMonth] = useState(realToday.getMonth());
  const [currentYear, setCurrentYear]   = useState(realToday.getFullYear());
  const [selectedDay, setSelectedDay]   = useState(todayStr);

  // Build the grid cells for the displayed month (Mon-start grid)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay  = new Date(currentYear, currentMonth + 1, 0);
    const totalDays = lastDay.getDate();

    // Mon=0 … Sun=6 offset
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const days = [];

    // Trailing days of previous month
    const prevLastDay = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      days.push({ day: prevLastDay - i, inMonth: false, date: null, events: [] });
    }

    // Days of current month
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = toDateStr(currentYear, currentMonth, d);
      const evts = CALENDAR_EVENTS.filter(e => e.date === dateStr);
      days.push({ day: d, inMonth: true, date: dateStr, events: evts });
    }

    // Leading days of next month
    const remaining = days.length % 7;
    if (remaining !== 0) {
      for (let i = 1; i <= 7 - remaining; i++) {
        days.push({ day: i, inMonth: false, date: null, events: [] });
      }
    }

    return days;
  }, [currentMonth, currentYear]);

  const goMonth = (dir) => {
    let m = currentMonth + dir;
    let y = currentYear;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    setCurrentMonth(m);
    setCurrentYear(y);
    setSelectedDay(null);
  };

  const goToday = () => {
    setCurrentMonth(realToday.getMonth());
    setCurrentYear(realToday.getFullYear());
    setSelectedDay(todayStr);
  };

  const handleDayClick = (dateStr) => {
    setSelectedDay(prev => prev === dateStr ? null : dateStr);
  };

  const todayEvents = CALENDAR_EVENTS.filter(e => e.date === todayStr);

  const selectedEvents = selectedDay
    ? CALENDAR_EVENTS.filter(e => e.date === selectedDay)
    : [];

  // Legend entries using EVENT_COLOURS
  const legendEntries = [
    { key: 'deadline', label: 'Deadline' },
    { key: 'meeting',  label: 'Meeting'  },
    { key: 'review',   label: 'Review'   },
    { key: 'leave',    label: 'Leave'    },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PageHeader
        icon="bi-calendar3"
        iconBg="#ede9fe"
        iconColor="#7c3aed"
        title="Deadlines & Reviews"
        subtitle="Monthly calendar view with upcoming deadlines, reviews & meetings"
      />

      {/* Stacked layout: Today strip → Calendar grid → Expanded day events */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        padding: '20px 24px',
        gap: 16,
      }}>

        {/* ── TOP: Today's events strip (full width, compact) ── */}
        <TodayStrip todayStr={todayStr} todayEvents={todayEvents} />

        {/* ── MIDDLE: Calendar grid (full width) ─────────────── */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* Month navigation header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px 12px',
            borderBottom: '1px solid var(--border)',
          }}>
            <button
              onClick={() => goMonth(-1)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '6px 12px',
                cursor: 'pointer',
                color: 'var(--text-2)',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
            >
              <i className="bi-chevron-left" />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
                {MONTHS[currentMonth]} {currentYear}
              </span>
              <button
                onClick={goToday}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)',
                  padding: '4px 13px',
                  cursor: 'pointer',
                  color: 'var(--purple)',
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: 'var(--shadow-sm)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
              >
                Today
              </button>
            </div>

            <button
              onClick={() => goMonth(1)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '6px 12px',
                cursor: 'pointer',
                color: 'var(--text-2)',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
            >
              <i className="bi-chevron-right" />
            </button>
          </div>

          {/* Day-of-week headers: Mon -> Sun */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: '1px solid var(--border)',
          }}>
            {DAY_LABELS.map((d, i) => (
              <div
                key={d}
                style={{
                  textAlign: 'center',
                  fontSize: 'var(--font-xs, 11px)',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  letterSpacing: 'normal',
                  textTransform: 'none',
                  padding: '10px 0',
                  background: (i === 5 || i === 6) ? '#fafafa' : 'var(--surface)',
                  borderRight: i < 6 ? '1px solid var(--border)' : 'none',
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
          }}>
            {calendarDays.map((cell, i) => {
              const isToday    = cell.date === todayStr;
              const isSelected = cell.date === selectedDay;
              const colIndex   = i % 7;
              const isWeekend  = colIndex === 5 || colIndex === 6;

              return (
                <DayCell
                  key={i}
                  cell={cell}
                  isToday={isToday}
                  isSelected={isSelected}
                  isWeekend={isWeekend}
                  onClick={handleDayClick}
                />
              );
            })}
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-4)',
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
          }}>
            {legendEntries.map(({ key, label }) => {
              const c = EVENT_COLOURS[key];
              return (
                <span
                  key={key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-3)',
                  }}
                >
                  <span style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: c.text,
                    display: 'inline-block',
                  }} />
                  {label}
                </span>
              );
            })}
          </div>
        </div>

        {/* ── BOTTOM: Expanded day events (when a day is clicked) */}
        <ExpandedDayEvents
          selectedDay={selectedDay}
          events={selectedEvents}
          onClose={() => setSelectedDay(null)}
        />
      </div>
    </div>
  );
};

export default CalendarView;
