// ── EventDetail — modal shown when user clicks a card / pill ───────────────
// Purpose: give the user a quick "what is this meeting" view with a big
// Join button (for Google events with a video link) and a link out to
// the Google Calendar web UI for the full detail page.
//
// For local events: the modal shows the description the user typed and a
// Delete button, since local events are purely CRUD'd by this user.
//
// Props:
//   event        — normalized event or null (closed state)
//   onClose      — () => void
//   onDelete     — async (event) => void  (local events only)

import { memo } from 'react';

function formatRange(ev) {
  if (!ev.startAt) return '';
  const s = new Date(ev.startAt);
  if (ev.allDay) {
    return s.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }
  const e = ev.endAt ? new Date(ev.endAt) : null;
  const datePart = s.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const timeOpts = { hour: '2-digit', minute: '2-digit' };
  const startTime = s.toLocaleTimeString([], timeOpts);
  const endTime = e ? e.toLocaleTimeString([], timeOpts) : null;
  if (endTime && s.toDateString() === e.toDateString()) {
    return `${datePart}, ${startTime} – ${endTime}`;
  }
  return `${datePart}, ${startTime}`;
}

function EventDetail({ event, onClose, onDelete }) {
  if (!event) return null;

  const isLocal = event.source === 'local';
  const hasLink = !!event.meetingLink;

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      onClick={overlayClick}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(17,24,39,0.45)',
        zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-detail-title"
    >
      <div style={{
        background: 'var(--surface)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        width: '100%', maxWidth: 520,
        maxHeight: 'min(80vh, 680px)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: 10,
            background: isLocal ? '#ede9fe' : '#dbeafe',
            color: isLocal ? '#7c3aed' : '#1565c0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            fontSize: 16,
          }}>
            <i className={isLocal ? 'bi-pin-fill' : 'bi-google'} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="event-detail-title" style={{
              margin: 0,
              fontSize: 16, fontWeight: 700,
              color: 'var(--text-1)',
              lineHeight: 1.35,
              wordBreak: 'break-word',
            }}>
              {event.title || '(No title)'}
            </h3>
            <div style={{
              fontSize: 12,
              color: 'var(--text-3)',
              fontWeight: 500,
              marginTop: 4,
            }}>
              {formatRange(event)}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              cursor: 'pointer', padding: '4px 8px',
              color: 'var(--text-3)', fontSize: 18,
              borderRadius: 6,
            }}
          >
            <i className="bi-x-lg" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {event.location && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <i className="bi-geo-alt" style={{ color: 'var(--text-3)', marginTop: 2 }} />
              <span style={{ color: 'var(--text-1)' }}>{event.location}</span>
            </div>
          )}

          {event.organizer?.email && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <i className="bi-person" style={{ color: 'var(--text-3)', marginTop: 2 }} />
              <span style={{ color: 'var(--text-1)' }}>
                Organized by <b>{event.organizer.name || event.organizer.email}</b>
              </span>
            </div>
          )}

          {event.attendees?.length > 0 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <i className="bi-people" style={{ color: 'var(--text-3)', marginTop: 2 }} />
              <div>
                <div style={{ color: 'var(--text-1)', fontWeight: 600, marginBottom: 4 }}>
                  {event.attendees.length} {event.attendees.length === 1 ? 'attendee' : 'attendees'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {event.attendees.slice(0, 8).map((a, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {a.name || a.email}
                      {a.responseStatus === 'accepted' && <span style={{ marginLeft: 6, color: '#29811e' }}>✓</span>}
                      {a.responseStatus === 'declined' && <span style={{ marginLeft: 6, color: '#d42d35' }}>✕</span>}
                      {a.responseStatus === 'tentative' && <span style={{ marginLeft: 6, color: '#ed8d00' }}>?</span>}
                    </div>
                  ))}
                  {event.attendees.length > 8 && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      +{event.attendees.length - 8} more
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {event.description && (
            <div style={{
              fontSize: 13,
              color: 'var(--text-2)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'var(--bg)',
              borderRadius: 8,
              padding: '10px 12px',
              maxHeight: 180,
              overflowY: 'auto',
            }}>
              {event.description}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
        }}>
          {isLocal && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(event)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--red-mid, #fecaca)',
                borderRadius: 'var(--radius-pill)',
                color: 'var(--red)',
                padding: '8px 16px',
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
                marginRight: 'auto',
              }}
            >
              <i className="bi-trash" style={{ marginRight: 6 }} />
              Delete
            </button>
          )}
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                color: 'var(--text-1)',
                padding: '8px 16px',
                fontSize: 13, fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <i className="bi-box-arrow-up-right" />
              Open in Google
            </a>
          )}
          {hasLink && (
            <a
              href={event.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#7c3aed',
                border: 'none',
                borderRadius: 'var(--radius-pill)',
                color: '#fff',
                padding: '8px 18px',
                fontSize: 13, fontWeight: 700,
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <i className="bi-camera-video-fill" />
              Join meeting
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(EventDetail);
