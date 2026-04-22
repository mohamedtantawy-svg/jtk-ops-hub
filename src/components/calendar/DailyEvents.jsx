// ── DailyEvents — horizontal scrolling strip of today's meeting cards ─────
// The "daily view on top" from the user's spec. One card per event; click
// opens EventDetail with the full payload. Local events get a small 📌
// pin badge to differentiate from Google events.
//
// Props:
//   events     — normalized events (already filtered/sorted for today)
//   onOpen     — (event) => void  fired when a card is clicked
//   loading    — bool — shows skeleton rows
//   now        — Date — used to compute "in X min" / "Live" badges.
//                       Passed in so the parent can tick it forward.

import { memo, useMemo } from 'react';

function formatTime(iso, allDay) {
  if (!iso) return '';
  if (allDay) return 'All day';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Returns a short status badge for an event relative to `now`:
//   'live'       — currently happening
//   'upcoming'   — starts within the next 60 min
//   'done'       — already ended
//   null         — neither; just show the start time
function statusBadge(ev, now) {
  if (!ev.startAt || !ev.endAt || ev.allDay) return null;
  const start = new Date(ev.startAt).getTime();
  const end = new Date(ev.endAt).getTime();
  const n = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (n >= start && n <= end) return { kind: 'live', label: 'Live', color: '#d42d35', bg: '#fee2e2' };
  if (n > end) return { kind: 'done', label: 'Ended', color: '#6b7280', bg: '#f3f4f6' };
  const minsUntil = Math.round((start - n) / 60000);
  if (minsUntil <= 60 && minsUntil > 0) {
    return { kind: 'upcoming', label: `in ${minsUntil}m`, color: '#ed8d00', bg: '#fef3c7' };
  }
  return null;
}

function EventCard({ event, now, onOpen }) {
  const badge = statusBadge(event, now);
  const isLocal = event.source === 'local';
  const accent = isLocal ? '#7c3aed' : '#1565c0';
  const accentBg = isLocal ? '#ede9fe' : '#dbeafe';

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: '10px 14px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 220,
        maxWidth: 300,
        flexShrink: 0,
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          background: accentBg,
          borderRadius: 'var(--radius-pill)',
          padding: '2px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {isLocal ? <i className="bi-pin-fill" style={{ fontSize: 9 }} /> : <i className="bi-google" style={{ fontSize: 9 }} />}
          {formatTime(event.startAt, event.allDay)}
          {!event.allDay && event.endAt && (
            <>
              <span style={{ opacity: 0.6, margin: '0 2px' }}>–</span>
              {formatTime(event.endAt, false)}
            </>
          )}
        </span>
        {badge && (
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: badge.color,
            background: badge.bg,
            borderRadius: 'var(--radius-pill)',
            padding: '2px 8px',
          }}>
            {badge.label}
          </span>
        )}
        {event.meetingLink && (
          <i className="bi-camera-video-fill"
            title="Has video link"
            style={{ fontSize: 11, color: 'var(--text-3)' }}
          />
        )}
      </div>

      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-1)',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {event.title || '(No title)'}
      </div>

      {event.location && (
        <div style={{
          fontSize: 11,
          color: 'var(--text-3)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          <i className="bi-geo-alt" style={{ fontSize: 10 }} />
          {event.location}
        </div>
      )}

      {event.attendees?.length > 0 && (
        <div style={{
          fontSize: 11,
          color: 'var(--text-3)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <i className="bi-people" style={{ fontSize: 10 }} />
          {event.attendees.length} {event.attendees.length === 1 ? 'attendee' : 'attendees'}
        </div>
      )}
    </button>
  );
}

function DailyEvents({ events, now, onOpen, loading, onAdd }) {
  const dayLabel = useMemo(
    () => now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [now]
  );

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      padding: '14px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{
          width: 28, height: 28,
          borderRadius: 'var(--radius-pill)',
          background: '#7c3aed', color: '#fff',
          fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {now.getDate()}
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Today</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>{dayLabel}</span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: '#7c3aed', background: '#ede9fe',
          borderRadius: 'var(--radius-pill)', padding: '2px 10px',
        }}>
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
        <div style={{ flex: 1 }} />
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)',
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-1)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <i className="bi-plus-lg" style={{ fontSize: 11 }} />
            Add event
          </button>
        )}
      </div>

      <div style={{
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        paddingBottom: 4,
      }}>
        {loading && events.length === 0 && (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{
              minWidth: 220, height: 80,
              background: 'linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s infinite linear',
              borderRadius: 10,
              flexShrink: 0,
            }} />
          ))
        )}
        {!loading && events.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--text-3)', fontSize: 13,
            padding: '12px 0',
          }}>
            <i className="bi-calendar2-check" style={{ fontSize: 16 }} />
            Nothing scheduled for today.
          </div>
        )}
        {events.map((ev) => (
          <EventCard key={ev.id} event={ev} now={now} onOpen={onOpen} />
        ))}
      </div>

      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

export default memo(DailyEvents);
