// ── CalendarView — Google Calendar integration UI ──────────────────────────
// This screen was previously a static demo that rendered CALENDAR_EVENTS
// from a mock JSON file. It is now the live Calendar tab, backed by:
//   • Google Calendar API (read-only) via /api/v1/calendar/events
//   • Local-only "add event" items via /api/v1/calendar/local-events
//   • useCalendarConnection — connect/disconnect + status
//   • useCalendarEvents — merged events with 2-min auto-refresh
//
// Layout (per user's spec):
//   1. Daily events strip on top (horizontal scrolling meeting cards).
//   2. Month/Week toggle + navigation in the middle.
//   3. EventDetail modal when user clicks any card / pill.
//   4. AddEventModal for quick local items.
//
// Soft launch gate: the Calendar tab is already restricted to OWNER_EMAIL
// in DeelTopNav (restrictToEmail) and again in App.jsx (RESTRICTED_VIEWS),
// and the server routes enforce the same gate at the API. This component
// assumes it's only rendered for eligible users — there's no third layer.
//
// Props (from App.jsx):
//   user        — current user ({ email, name, ... })
//   addToast    — (type, title, body, onUndo?) => void
//   setView     — view setter (used by alert toasts to focus the Calendar tab)

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '../ui/PageHeader';
import { useCalendarConnection } from '../../hooks/useCalendarConnection';
import { useCalendarEvents } from '../../hooks/useCalendarEvents';
import { createLocalEvent, deleteLocalEvent } from '../../services/calendarApi';

import ConnectPrompt from '../calendar/ConnectPrompt';
import DailyEvents from '../calendar/DailyEvents';
import MonthView from '../calendar/MonthView';
import WeekView from '../calendar/WeekView';
import EventDetail from '../calendar/EventDetail';
import AddEventModal from '../calendar/AddEventModal';

// ─────────────────────────────────────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────────────────────────────────────

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function endOfDay(d) {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

// Monday of the week containing `d`.
function startOfWeek(d) {
  const copy = startOfDay(d);
  // JS getDay: Sun=0, Mon=1, ... Sat=6. We want Monday-start, so:
  //   Sun → back 6 days, Mon → 0, Tue → 1, ... Sat → 5.
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
}
function endOfWeek(d) {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  end.setMilliseconds(-1);
  return end;
}

function startOfMonthGrid(year, month) {
  // Include the preceding days shown in the grid so event queries cover
  // the entire visible cell range. Monday-start grid → up to 6 days padding.
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const result = new Date(first);
  result.setDate(first.getDate() - offset);
  result.setHours(0, 0, 0, 0);
  return result;
}
function endOfMonthGrid(year, month) {
  // 6 weeks × 7 days max — covers every possible grid layout.
  const start = startOfMonthGrid(year, month);
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  end.setMilliseconds(-1);
  return end;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────────

const CalendarView = ({ user, addToast }) => {
  const enabled = !!user?.email;

  // ── Connection state ─────────────────────────────────────────────────────
  const {
    connected,
    googleEmail,
    lastError,
    loading: connectionLoading,
    connectError,
    connect,
    disconnect,
    refresh: refreshConnection,
  } = useCalendarConnection({ enabled, addToast });

  const [connecting, setConnecting] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState('month'); // 'week' | 'month'
  const [cursor, setCursor] = useState(() => new Date()); // current focus date
  const [selectedDay, setSelectedDay] = useState(null); // 'YYYY-MM-DD'
  const [detail, setDetail] = useState(null); // event to show in modal
  const [addOpen, setAddOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Tick `now` every 30 s so the "Live" / "in X min" badges on DailyEvents
  // stay accurate without re-fetching events.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Query window — wide enough to cover the current view.
  // • Month mode:  the 6-row grid range so we can fill every visible cell.
  // • Week mode:   the current week.
  // Kept as a memo so the fetch hook sees stable identity between renders.
  const { timeMin, timeMax } = useMemo(() => {
    if (mode === 'week') {
      return { timeMin: startOfWeek(cursor), timeMax: endOfWeek(cursor) };
    }
    return {
      timeMin: startOfMonthGrid(cursor.getFullYear(), cursor.getMonth()),
      timeMax: endOfMonthGrid(cursor.getFullYear(), cursor.getMonth()),
    };
  }, [cursor, mode]);

  const {
    events,
    loading: eventsLoading,
    googleError,
    localError,
    needsReconnect,
    refresh: refreshEvents,
    addLocalEventOptimistic,
    removeLocalEventOptimistic,
  } = useCalendarEvents({
    enabled: enabled && connected,
    timeMin,
    timeMax,
  });

  // If the events endpoint reports needsReconnect, flip the connection
  // status back to "not connected" so ConnectPrompt re-appears.
  useEffect(() => {
    if (needsReconnect) {
      refreshConnection();
    }
  }, [needsReconnect, refreshConnection]);

  // Today's events always come from a separate, tight time window
  // (start..end of today) — keeps the "Today strip" accurate even when
  // the user has navigated to a different month in the grid below.
  const { todayEvents, todaysRange } = useMemo(() => {
    const t0 = startOfDay(now);
    const t1 = endOfDay(now);
    return {
      todaysRange: { t0, t1 },
      todayEvents: events.filter((ev) => {
        if (!ev.startAt) return false;
        const s = new Date(ev.startAt);
        return s >= t0 && s <= t1;
      }),
    };
  }, [events, now]);

  // If the current view window doesn't include today (user is looking at
  // last month), we need a second fetch for today specifically. For now
  // the simplest correct approach is: when user navigates away from the
  // month containing today, todayEvents just shows [] — they can tap
  // "Today" to return. If we want a persistent today strip, we'd add a
  // second events hook here. Leaving as a simple behaviour v1.

  // ── Connect / disconnect handlers ────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await connect();
      // `connect` navigates away on success; if we're still here, something
      // went wrong and connectError will render via ConnectPrompt.
    } finally {
      // No-op: if navigation succeeds, we unmount before this runs.
      setConnecting(false);
    }
  }, [connect]);

  const handleDisconnect = useCallback(async () => {
    if (typeof window !== 'undefined'
      && !window.confirm('Disconnect your Google Calendar from Ops Hub?')) return;
    await disconnect();
  }, [disconnect]);

  // ── Local-event create / delete ──────────────────────────────────────────
  const handleAdd = useCallback(async ({ title, description, startAt, endAt, color }) => {
    const res = await createLocalEvent({ title, description, startAt, endAt, color });
    if (res?.event) {
      addLocalEventOptimistic(res.event);
      addToast?.('success', 'Event added', title);
    }
    // Force a refetch so the cache line matching the current window gets
    // re-populated from server state (captures any server-side rounding).
    refreshEvents();
    return res?.event;
  }, [addLocalEventOptimistic, addToast, refreshEvents]);

  const handleDeleteLocal = useCallback(async (event) => {
    if (event.source !== 'local') return;
    if (typeof window !== 'undefined'
      && !window.confirm('Delete this event?')) return;
    try {
      await deleteLocalEvent(event.id);
      removeLocalEventOptimistic(event.id);
      addToast?.('success', 'Event deleted', event.title);
      setDetail(null);
    } catch (err) {
      addToast?.('alert', 'Failed to delete', err.message);
    }
  }, [addToast, removeLocalEventOptimistic]);

  // ── Navigation helpers ───────────────────────────────────────────────────
  const navigateMonth = useCallback((dir) => {
    setCursor((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + dir);
      return next;
    });
    setSelectedDay(null);
  }, []);
  const navigateWeek = useCallback((dir) => {
    setCursor((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7 * dir);
      return next;
    });
  }, []);
  const goToday = useCallback(() => {
    setCursor(new Date());
    const today = new Date();
    setSelectedDay(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  }, []);

  // ── Selected day events (when a day in the month grid is clicked) ────────
  const selectedDayEvents = useMemo(() => {
    if (!selectedDay) return [];
    const d = new Date(`${selectedDay}T00:00:00`);
    if (Number.isNaN(d.getTime())) return [];
    return events.filter((ev) => {
      if (!ev.startAt) return false;
      return sameDay(new Date(ev.startAt), d);
    });
  }, [selectedDay, events]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!enabled) {
    // Defensive fallback — should never hit because App.jsx gates render.
    return null;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PageHeader
        icon="bi-calendar3"
        iconBg="#ede9fe"
        iconColor="#7c3aed"
        title="Calendar"
        subtitle={
          connected
            ? `Connected to ${googleEmail || 'Google Calendar'}`
            : 'Connect your Google Calendar to see today\u2019s meetings & upcoming events'
        }
        right={connected && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              display: 'inline-flex',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)',
              overflow: 'hidden',
              background: 'var(--surface)',
            }}>
              {['week', 'month'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: mode === m ? '#7c3aed' : 'transparent',
                    color: mode === m ? '#fff' : 'var(--text-1)',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refreshEvents}
              title="Refresh"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '6px 12px',
                cursor: 'pointer',
                color: 'var(--text-2)',
                fontSize: 13,
              }}
            >
              <i className={`bi-arrow-clockwise${eventsLoading ? ' spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              title="Disconnect"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '6px 14px',
                cursor: 'pointer',
                color: 'var(--text-2)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <i className="bi-plug" style={{ marginRight: 6 }} />
              Disconnect
            </button>
          </div>
        )}
      />

      <style>{`.spin { animation: spin 0.9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Not connected → prompt ──────────────────────────────────────── */}
      {!connected && !connectionLoading && (
        <ConnectPrompt
          onConnect={handleConnect}
          connecting={connecting}
          error={connectError}
        />
      )}

      {/* ── Loading initial status ──────────────────────────────────────── */}
      {!connected && connectionLoading && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-3)', fontSize: 13,
        }}>
          <i className="bi-arrow-clockwise spin" style={{ marginRight: 8 }} />
          Loading calendar status…
        </div>
      )}

      {/* ── Connected → main view ────────────────────────────────────────── */}
      {connected && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          padding: '20px 24px',
          gap: 16,
        }}>
          {lastError && (
            <div style={{
              background: 'var(--red-light, #fef2f2)',
              border: '1px solid var(--red-mid, #fecaca)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--red)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <i className="bi-exclamation-triangle" />
              Last refresh failed: {lastError}
            </div>
          )}
          {googleError && (
            <div style={{
              background: '#fef3c7',
              border: '1px solid #fcd34d',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: '#92400e',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <i className="bi-exclamation-triangle" />
              Couldn&rsquo;t load Google events: {googleError}
            </div>
          )}
          {localError && (
            <div style={{
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: '#4b5563',
            }}>
              Couldn&rsquo;t load local events: {localError}
            </div>
          )}

          <DailyEvents
            events={todayEvents}
            now={now}
            loading={eventsLoading && todayEvents.length === 0}
            onOpen={setDetail}
            onAdd={() => setAddOpen(true)}
          />

          {mode === 'month' ? (
            <MonthView
              year={cursor.getFullYear()}
              month={cursor.getMonth()}
              events={events}
              selectedDay={selectedDay}
              onSelectDay={(d) => setSelectedDay((prev) => (prev === d ? null : d))}
              onOpenEvent={setDetail}
              onNavigate={navigateMonth}
              onGoToday={goToday}
            />
          ) : (
            <WeekView
              weekStart={startOfWeek(cursor)}
              events={events}
              onOpenEvent={setDetail}
              onNavigate={navigateWeek}
              onGoToday={goToday}
            />
          )}

          {/* Selected day events (month mode only — week already shows them) */}
          {mode === 'month' && selectedDay && (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-sm)',
              padding: '14px 20px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="bi-calendar2-event" style={{ fontSize: 14, color: '#7c3aed' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: 'long', month: 'long', day: 'numeric',
                  })}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: 'var(--text-3)', background: 'var(--bg)',
                  borderRadius: 'var(--radius-pill)', padding: '2px 10px',
                }}>
                  {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'event' : 'events'}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  style={{
                    background: 'none', border: 'none',
                    cursor: 'pointer', color: 'var(--text-3)', fontSize: 14,
                  }}
                >
                  <i className="bi-x-lg" />
                </button>
              </div>
              {selectedDayEvents.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No events on this day.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {selectedDayEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setDetail(ev)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--text-1)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span>{new Date(ev.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span style={{ color: 'var(--text-3)' }}>·</span>
                      <span>{ev.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <EventDetail
        event={detail}
        onClose={() => setDetail(null)}
        onDelete={handleDeleteLocal}
      />

      <AddEventModal
        open={addOpen}
        defaultDate={selectedDay ? new Date(`${selectedDay}T00:00:00`) : new Date()}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
      />
    </div>
  );
};

export default CalendarView;
