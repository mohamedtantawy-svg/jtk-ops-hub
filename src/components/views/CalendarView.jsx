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

function DayDetailPanel({ selectedDay, events }) {
  return (
    <div style={{
      width: '40%',
      flexShrink: 0,
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '16px 18px 12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 2 }}>
          {selectedDay ? formatDetailHeader(selectedDay) : 'Day Events'}
        </div>
        {selectedDay && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
            {events.length === 0 ? 'No events' : `${events.length} event${events.length !== 1 ? 's' : ''}`}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        {!selectedDay ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 10,
            color: 'var(--text-3)',
          }}>
            <i className="bi-calendar2" style={{ fontSize: 36, color: 'var(--border)' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Select a day</div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 180 }}>
              Click any date on the calendar to view its events
            </div>
          </div>
        ) : events.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 200,
            gap: 10,
            color: 'var(--text-3)',
          }}>
            <i className="bi-calendar2" style={{ fontSize: 34, color: 'var(--border)' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>No events today</div>
            <div style={{ fontSize: 12 }}>This day has no scheduled events.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    padding: '12px 14px',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                >
                  {/* Icon badge */}
                  <div style={{
                    width: 36,
                    height: 36,
                    background: c.bg,
                    borderRadius: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <i className={meta.icon} style={{ color: c.text, fontSize: 15 }} />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Type + time row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: c.text,
                        background: c.bg,
                        borderRadius: 'var(--radius-pill)',
                        padding: '2px 8px',
                        textTransform: 'none',
                        letterSpacing: 'normal',
                      }}>
                        {meta.label}
                      </span>
                      {evt.time && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                          {formatTime(evt.time)}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <div style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-1)',
                      marginBottom: evt.description || evt.attendees ? 4 : 0,
                      lineHeight: 1.35,
                    }}>
                      {evt.title}
                    </div>

                    {/* Description */}
                    {evt.description && (
                      <div style={{
                        fontSize: 11.5,
                        color: 'var(--text-3)',
                        lineHeight: 1.45,
                        marginBottom: evt.attendees ? 5 : 0,
                      }}>
                        {evt.description}
                      </div>
                    )}

                    {/* Attendees */}
                    {evt.attendees && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="bi-people" style={{ fontSize: 11, color: 'var(--text-3)' }} />
                        <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>
                          {evt.attendees} attendee{evt.attendees !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Chevron */}
                  <i className="bi-chevron-right" style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Event footer */}
      <div style={{
        padding: '14px 18px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            padding: '9px 0',
            background: 'transparent',
            border: '1px dashed var(--purple)',
            borderRadius: 'var(--radius-pill)',
            color: 'var(--purple)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <i className="bi-plus-circle" style={{ fontSize: 14 }} />
          Add Event
        </button>
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

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT: Calendar grid (60%) ─────────────────────────── */}
        <div style={{
          width: '60%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '20px 24px',
          gap: 0,
        }}>

          {/* Calendar card */}
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
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

            {/* Day-of-week headers: Mon → Sun */}
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
              flex: 1,
              overflow: 'hidden',
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
        </div>

        {/* ── RIGHT: Day detail panel (40%) ────────────────────── */}
        <DayDetailPanel selectedDay={selectedDay} events={selectedEvents} />
      </div>
    </div>
  );
};

export default CalendarView;
