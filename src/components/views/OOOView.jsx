// ── OOOView ───────────────────────────────────────────────────────────
// Single-tab OOO surface. Two view modes (Calendar Gantt, Table) and six
// lens chips (Mine / Covering me / My team / Approvals / Drafts / All).
// Phase 1 ships read-only — events render with their handover status,
// but no creation / acceptance / approval is wired yet (that's Phase 2).
//
// URL state contract:
//   ?mode=calendar|table        — view mode, sticky per-user
//   ?lens=mine|covering|team|approvals|drafts|all|auto
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — visible window
//   ?handover=<event-id>        — opens the detail slide-out anchored to
//                                  the time-off event (Phase 2 will key on
//                                  handover id once those exist)
// All keys round-trip on reload + browser back/forward.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LensChips from '../ooo/LensChips';
import ActionBanner from '../ooo/ActionBanner';
import CalendarMode from '../ooo/CalendarMode';
import TableMode from '../ooo/TableMode';
import DetailSlideOut from '../ooo/DetailSlideOut';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { listTimeOffEvents } from '../../services/timeOffApi';
import { fetchHandoverLensCounts } from '../../services/handoversApi';
import { LENS_IDS, autoLens, isoDate } from '../../lib/handover-helpers';

const MODE_KEY  = 'ops_hub_ooo_mode';
const LENS_KEY  = 'ops_hub_ooo_lens';

const DEFAULT_RANGE_DAYS = 60;

function readUrl() {
  if (typeof window === 'undefined') return {};
  try {
    const sp = new URL(window.location.href).searchParams;
    return {
      mode:    sp.get('mode'),
      lens:    sp.get('lens'),
      from:    sp.get('from'),
      to:      sp.get('to'),
      handover: sp.get('handover'),
    };
  } catch { return {}; }
}

function pushUrl({ mode, lens, from, to, handover }) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (mode)     url.searchParams.set('mode', mode);     else url.searchParams.delete('mode');
    if (lens)     url.searchParams.set('lens', lens);     else url.searchParams.delete('lens');
    if (from)     url.searchParams.set('from', from);     else url.searchParams.delete('from');
    if (to)       url.searchParams.set('to', to);         else url.searchParams.delete('to');
    if (handover) url.searchParams.set('handover', handover); else url.searchParams.delete('handover');
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

function isoOffsetFromToday(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function readLocal(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function isManagerRole(role) {
  return role === 'admin' || role === 'regional_manager' || role === 'team_lead';
}

function OOOView({ user, setView }) {
  const urlInit = readUrl();
  const todayIso = isoDate();

  const [mode, setMode] = useState(
    urlInit.mode === 'table' || urlInit.mode === 'calendar'
      ? urlInit.mode
      : readLocal(MODE_KEY, 'calendar'),
  );
  const [lens, setLens] = useState(urlInit.lens || readLocal(LENS_KEY, LENS_IDS.AUTO));
  const [from, setFrom] = useState(urlInit.from || isoOffsetFromToday(-7));
  const [to,   setTo]   = useState(urlInit.to   || isoOffsetFromToday(DEFAULT_RANGE_DAYS));
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('all');
  const [missingOnly, setMissingOnly] = useState(false);
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [autoResolved, setAutoResolved] = useState(lens !== LENS_IDS.AUTO);
  const [selectedEventId, setSelectedEventId] = useState(urlInit.handover || null);

  const { items: members } = useTeamMembers();

  // Sync state → URL + localStorage
  useEffect(() => { pushUrl({ mode, lens, from, to, handover: selectedEventId }); }, [mode, lens, from, to, selectedEventId]);
  useEffect(() => { writeLocal(MODE_KEY, mode); }, [mode]);
  useEffect(() => { if (lens !== LENS_IDS.AUTO) writeLocal(LENS_KEY, lens); }, [lens]);

  // Lookup map: email → member.
  const membersByEmail = useMemo(() => {
    const map = new Map();
    for (const m of (members || [])) {
      if (m?.email) map.set(m.email.toLowerCase(), m);
    }
    return map;
  }, [members]);

  // Distinct country list for the filter dropdown — derived from the
  // current event set so the dropdown only offers options that exist.
  const countryOptions = useMemo(() => {
    const set = new Set();
    for (const ev of events) {
      const cc = membersByEmail.get((ev.work_email || '').toLowerCase())?.country;
      if (cc) set.add(cc.toUpperCase());
    }
    return Array.from(set).sort();
  }, [events, membersByEmail]);

  // Load lens counts on mount + every time the lens changes (so a chip
  // count never lies after a state transition).
  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetchHandoverLensCounts();
      setCounts(res?.counts || {});
    } catch (err) {
      // Counts are nice-to-have — don't blow up the view on failure.
      // Set a zeroed-out object so the auto-lens resolver fires (the
      // hint `Object.keys(counts).length === 0` would otherwise loop
      // forever and leave the user stuck on "Loading…").
      // eslint-disable-next-line no-console
      console.warn('[OOOView] lens-counts failed:', err?.message);
      setCounts({
        mine: 0, mine_missing_handover: 0,
        covering: 0, covering_pending: 0,
        team: 0, approvals: 0, drafts: 0, all: 0,
        _failed: true,
      });
    }
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // Auto-lens resolution. Runs once after counts arrive on first mount
  // when the user landed without an explicit ?lens=. After that the user
  // owns the selection.
  useEffect(() => {
    if (autoResolved) return;
    if (!counts || Object.keys(counts).length === 0) return;
    const resolved = autoLens({
      approvalsCount: counts.approvals,
      coveringPendingCount: counts.covering_pending,
      mineMissingCount: counts.mine_missing_handover,
      isManager: isManagerRole(user?.role),
    });
    setLens(resolved);
    setAutoResolved(true);
  }, [autoResolved, counts, user?.role]);

  // Load events whenever lens / range changes.
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (lens === LENS_IDS.AUTO) return; // wait for auto resolution before fetching
    const reqId = ++reqIdRef.current;
    setLoading(true);
    listTimeOffEvents({ lens, from, to })
      .then(res => {
        if (reqIdRef.current !== reqId) return;
        setEvents(res?.items || []);
      })
      .catch(err => {
        if (reqIdRef.current !== reqId) return;
        // eslint-disable-next-line no-console
        console.warn('[OOOView] events fetch failed:', err?.message);
        setEvents([]);
      })
      .finally(() => {
        if (reqIdRef.current === reqId) setLoading(false);
      });
  }, [lens, from, to]);

  // Client-side filters: search, country, missing-only.
  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(ev => {
      const member = membersByEmail.get((ev.work_email || '').toLowerCase());
      if (q) {
        const hay = `${ev.work_email || ''} ${member?.name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (country !== 'all') {
        const cc = (member?.country || '').toUpperCase();
        if (cc !== country) return false;
      }
      if (missingOnly) {
        const status = ev.handover?.status;
        if (status && status !== 'draft' && status !== 'rejected' && status !== 'cancelled' && status !== 'expired') return false;
      }
      return true;
    });
  }, [events, search, country, missingOnly, membersByEmail]);

  const selectedEvent = useMemo(
    () => filteredEvents.find(e => e.id === selectedEventId) || events.find(e => e.id === selectedEventId) || null,
    [filteredEvents, events, selectedEventId],
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '18px 24px 12px',
        borderBottom: '1px solid var(--border-light)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>OOO &amp; Handovers</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Calendar of every upcoming OOO in your reporting tree, plus the handovers around them.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setView?.('settings')}
            title="Handover settings"
            aria-label="Open handover settings"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <i className="bi-gear" style={{ fontSize: 14 }} />
          </button>
          <button
            type="button"
            disabled
            title="Submit handover (Phase 2)"
            aria-disabled="true"
            style={{
              height: 32, padding: '0 14px', borderRadius: 8,
              background: 'rgba(124, 58, 237, 0.55)',
              color: 'white',
              border: 'none',
              fontWeight: 700, fontSize: 12,
              cursor: 'not-allowed',
              fontFamily: 'inherit',
              opacity: 0.7,
            }}
          >
            <i className="bi-plus-lg" style={{ marginRight: 6 }} />
            New handover
          </button>
        </div>

        {/* Mode toggle + lens chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div role="tablist" aria-label="View mode" style={{ display: 'inline-flex', borderRadius: 8, background: 'rgba(15,23,42,0.05)', padding: 2 }}>
            {[
              { id: 'calendar', label: 'Calendar', icon: 'bi-calendar3' },
              { id: 'table',    label: 'Table',    icon: 'bi-table' },
            ].map(opt => {
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setMode(opt.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    fontWeight: active ? 700 : 500,
                    fontSize: 12,
                    cursor: 'pointer',
                    boxShadow: active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  <i className={`bi ${opt.icon}`} style={{ fontSize: 12 }} />
                  {opt.label}
                </button>
              );
            })}
          </div>

          <LensChips lens={lens} counts={counts} onChange={setLens} />
        </div>

        {/* Filters row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 12, color: 'var(--text-secondary)',
            }} />
            <input
              type="search"
              placeholder="Search person…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: 240, height: 32, padding: '0 12px 0 30px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            />
          </div>
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            aria-label="Filter by country"
            style={{
              height: 32, padding: '0 8px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <option value="all">All countries</option>
            {countryOptions.map(cc => <option key={cc} value={cc}>{cc}</option>)}
          </select>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={missingOnly}
              onChange={e => setMissingOnly(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Missing handover only
          </label>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              From
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                style={{
                  height: 32, padding: '0 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: 'inherit',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              To
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                style={{
                  height: 32, padding: '0 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: 'inherit',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
            </label>
          </div>
        </div>

        <ActionBanner counts={counts} onJumpToLens={setLens} />
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        {loading && events.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            <i className="bi-arrow-repeat bi-spin" style={{ marginRight: 6 }} />
            Loading…
          </div>
        ) : mode === 'calendar' ? (
          <CalendarMode
            events={filteredEvents}
            membersByEmail={membersByEmail}
            from={from}
            to={to}
            todayIso={todayIso}
            onSelectEvent={ev => setSelectedEventId(ev?.id || null)}
          />
        ) : (
          <TableMode
            events={filteredEvents}
            membersByEmail={membersByEmail}
            todayIso={todayIso}
            onSelectEvent={ev => setSelectedEventId(ev?.id || null)}
          />
        )}
      </div>

      <DetailSlideOut
        event={selectedEvent}
        membersByEmail={membersByEmail}
        currentUserEmail={user?.email}
        todayIso={todayIso}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  );
}

export default OOOView;
