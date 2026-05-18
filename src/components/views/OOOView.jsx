// ── OOOView ───────────────────────────────────────────────────────────
// Single-tab OOO surface. Two view modes (Calendar Gantt, Table) and five
// lens chips (Mine / Covering me / My team / Drafts / All). Phase 1
// ships read-only — events render with their handover status, but no
// creation / acceptance is wired yet (that's Phase 2). The "Approvals"
// chip was removed 2026-05-18 — TL approval is no longer part of the
// state machine (HANDOVER_TEMPLATE_REVAMP_PLAN.md §4.2).
//
// URL state contract:
//   ?mode=calendar|table        — view mode, sticky per-user
//   ?lens=mine|covering|team|drafts|all|auto
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — visible window
//   ?handover=<event-id>        — opens the detail slide-out anchored to
//                                  the time-off event (Phase 2 will key on
//                                  handover id once those exist)
// All keys round-trip on reload + browser back/forward.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LensChips from '../ooo/LensChips';
import ActionBanner from '../ooo/ActionBanner';
import CalendarMode from '../ooo/CalendarMode';
import TableMode from '../ooo/TableMode';
import DetailSlideOut from '../ooo/DetailSlideOut';
import CreateHandoverModal from '../ooo/CreateHandoverModal';
import SubmitTimeOffModal from '../ooo/SubmitTimeOffModal';
import CountryHandoverDocView from '../country-handover-docs/CountryHandoverDocView';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { listTimeOffEvents } from '../../services/timeOffApi';
import {
  fetchHandoverLensCounts,
  bulkApproveHandovers,
  bulkRejectHandovers,
} from '../../services/handoversApi';
import { LENS_IDS, autoLens, isoDate } from '../../lib/handover-helpers';

const MODE_KEY  = 'ops_hub_ooo_mode';
const LENS_KEY  = 'ops_hub_ooo_lens';
const SUB_TAB_KEY = 'ops_hub_ooo_sub_tab';

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

function OOOView({ user, setView, addToast }) {
  const urlInit = readUrl();
  const todayIso = isoDate();

  const [mode, setMode] = useState(
    urlInit.mode === 'table' || urlInit.mode === 'calendar'
      ? urlInit.mode
      : readLocal(MODE_KEY, 'calendar'),
  );
  const [lens, setLens] = useState(urlInit.lens || readLocal(LENS_KEY, LENS_IDS.AUTO));
  // Default `from` widened from -7d to -90d (Megan Lawrence 2026-05-15) so
  // old + mass-imported PTO entries surface without the user having to
  // manually expand the date picker. The +60d forward window stays — most
  // users land here to plan or audit upcoming OOO, not to scroll into the
  // distant future. Users can still narrow / extend either side via the
  // date pickers on the filter row.
  const [from, setFrom] = useState(urlInit.from || isoOffsetFromToday(-90));
  const [to,   setTo]   = useState(urlInit.to   || isoOffsetFromToday(DEFAULT_RANGE_DAYS));
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('all');
  const [missingOnly, setMissingOnly] = useState(false);
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [autoResolved, setAutoResolved] = useState(lens !== LENS_IDS.AUTO);
  const [selectedEventId, setSelectedEventId] = useState(urlInit.handover || null);
  const [wizardEventId, setWizardEventId] = useState(null);   // null = closed; an id = open w/ that event
  const [submitTimeOffOpen, setSubmitTimeOffOpen] = useState(false);
  // When non-null, the SubmitTimeOffModal opens in edit mode prefilled
  // from this event. Editing is gated server-side by canManageTimeOffFor;
  // FE surfaces the Edit button via DetailSlideOut + TableMode row affordance.
  const [editTimeOffEvent, setEditTimeOffEvent] = useState(null);
  // Holds a handover_id received via the `ooo:openDetail` custom event
  // until we've loaded enough events to resolve it to a time_off_event_id
  // (the key the slide-out opens on). Cleared once resolved. Sarah Suge
  // 2026-05-13 bug "OOO Link to Accept Handover not Working" — the bell
  // notification carries handover_id, the slide-out wants event_id; this
  // is the bridge.
  const [pendingHandoverId, setPendingHandoverId] = useState(null);
  // Sub-tab toggles between the OOO calendar/table surface and the Phase B
  // Country Handover Doc editor. Sticky per-user so refreshes don't bounce
  // you back to OOO if you were knee-deep in editing France.
  const [subTab, setSubTab] = useState(readLocal(SUB_TAB_KEY, 'ooo'));
  useEffect(() => { writeLocal(SUB_TAB_KEY, subTab); }, [subTab]);

  // `useTeamMembers` returns `{ members, membersByEmail, ... }` — the
  // previous `items` rename matched an older shape and silently produced
  // `undefined`. With members undefined the create-handover modal's
  // coverer search rendered zero candidates (Jose's 2026-05-12 bug
  // report: "typing a name returns no results and no dropdown appears").
  const { members } = useTeamMembers();

  // Sync state → URL + localStorage
  useEffect(() => { pushUrl({ mode, lens, from, to, handover: selectedEventId }); }, [mode, lens, from, to, selectedEventId]);
  useEffect(() => { writeLocal(MODE_KEY, mode); }, [mode]);
  useEffect(() => { if (lens !== LENS_IDS.AUTO) writeLocal(LENS_KEY, lens); }, [lens]);

  // ── Notification deep-link listener (Sarah Suge 2026-05-13 bug fix) ──
  // App.jsx dispatches `ooo:openDetail` with `{ handoverId }` when the
  // user clicks an OOO notification from the bell. The slide-out opens
  // on time_off_event_id, so we save the handover_id here and let the
  // resolution effect below map it once `events` is loaded.
  useEffect(() => {
    const onOpen = (e) => {
      const hid = e?.detail?.handoverId;
      if (hid) setPendingHandoverId(String(hid));
    };
    window.addEventListener('ooo:openDetail', onOpen);
    return () => window.removeEventListener('ooo:openDetail', onOpen);
  }, []);

  // Resolve pending handover_id → time_off_event_id once the events
  // list contains a row carrying this handover. Re-runs on every events
  // update so a deep-link from a fresh login still works after the
  // fetch returns. Idempotent: clears pendingHandoverId once resolved
  // so we don't keep re-applying.
  useEffect(() => {
    if (!pendingHandoverId) return;
    if (!Array.isArray(events) || events.length === 0) return;
    const match = events.find(e => e?.handover?.id && String(e.handover.id) === pendingHandoverId);
    if (match?.id) {
      setSelectedEventId(match.id);
      setPendingHandoverId(null);
    }
  }, [pendingHandoverId, events]);

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
        team: 0, drafts: 0, all: 0,
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
      coveringPendingCount: counts.covering_pending,
      mineMissingCount: counts.mine_missing_handover,
      isManager: isManagerRole(user?.role),
    });
    setLens(resolved);
    setAutoResolved(true);
  }, [autoResolved, counts, user?.role]);

  // Load events whenever lens / range changes — and on demand via
  // refreshEvents() after a wizard / detail-panel write.
  const reqIdRef = useRef(0);
  const refreshEvents = useCallback(() => {
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
  useEffect(() => { refreshEvents(); }, [refreshEvents]);

  const refreshAll = useCallback(() => {
    refreshEvents();
    refreshCounts();
  }, [refreshEvents, refreshCounts]);

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

  // Emails the calendar should ALWAYS render as a row, even when they
  // have zero events in the current window. Always includes the caller
  // (so a newly-added member sees themselves on first login — Ines
  // Barata 2026-05-14 bug). On the 'team' lens, also includes everyone
  // in the caller's direct team (same managerEmail) so freshly-added
  // teammates appear immediately rather than only after their first
  // submission. Other lenses keep the events-first behaviour to avoid
  // clutter.
  const calendarAlwaysShowEmails = useMemo(() => {
    const set = new Set();
    const callerEmail = String(user?.email || '').toLowerCase();
    if (callerEmail) set.add(callerEmail);
    if (lens === LENS_IDS.TEAM && Array.isArray(members)) {
      const callerMember = members.find(m => String(m?.email || '').toLowerCase() === callerEmail);
      if (callerMember) {
        const callerAccess = String(callerMember.access || '').toLowerCase();
        const callerManagerEmail = String(callerMember.managerEmail || '').toLowerCase() || null;
        // The team root is callerMember.email when the caller is a
        // manager (everyone reports to them), and callerManagerEmail
        // otherwise (everyone shares the same boss).
        const teamRoot = (callerAccess === 'team_lead' || callerAccess === 'regional_manager' || callerAccess === 'admin')
          ? callerEmail
          : callerManagerEmail;
        if (teamRoot) {
          for (const m of members) {
            if (!m || m.isDeleted) continue;
            const mgr = String(m.managerEmail || '').toLowerCase() || null;
            const me = String(m.email || '').toLowerCase();
            if (mgr === teamRoot || me === teamRoot) set.add(me);
          }
        }
      }
    }
    return set;
  }, [user?.email, lens, members]);

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
              {subTab === 'country_docs'
                ? 'Long-lived per-country handover docs — fill once, every OOO reuses them.'
                : 'Calendar of every upcoming OOO in your reporting tree, plus the handovers around them.'}
            </div>
            {/* Sub-tab toggle */}
            <div role="tablist" aria-label="OOO section" style={{ display: 'inline-flex', marginTop: 10, borderRadius: 8, background: 'rgba(15,23,42,0.05)', padding: 2 }}>
              {[
                { id: 'ooo',           label: 'OOO calendar', icon: 'bi-calendar3' },
                { id: 'country_docs',  label: 'Country docs', icon: 'bi-journal-text' },
              ].map(opt => {
                const active = subTab === opt.id;
                return (
                  <button
                    key={opt.id}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    onClick={() => setSubTab(opt.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px',
                      border: 'none',
                      background: active ? 'var(--surface)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-secondary)',
                      fontWeight: active ? 700 : 500,
                      fontSize: 12, fontFamily: 'inherit',
                      borderRadius: 6,
                      cursor: 'pointer',
                      boxShadow: active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                    }}
                  >
                    <i className={`bi ${opt.icon}`} style={{ fontSize: 12 }} />
                    {opt.label}
                  </button>
                );
              })}
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
          {subTab === 'ooo' && (
            <>
              <button
                type="button"
                onClick={() => setSubmitTimeOffOpen(true)}
                title="Submit a manual time-off entry"
                style={{
                  height: 32, padding: '0 14px', borderRadius: 8,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  fontWeight: 600, fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <i className="bi-calendar-plus" style={{ marginRight: 6 }} />
                Submit time off
              </button>
              <button
                type="button"
                onClick={() => setWizardEventId('')}
                title="Create a new handover"
                style={{
                  height: 32, padding: '0 14px', borderRadius: 8,
                  background: 'var(--purple, #7c3aed)',
                  color: 'white',
                  border: 'none',
                  fontWeight: 700, fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <i className="bi-plus-lg" style={{ marginRight: 6 }} />
                New handover
              </button>
            </>
          )}
        </div>

        {subTab === 'ooo' && (
        <React.Fragment>
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

        <ActionBanner
          counts={counts}
          onJumpToLens={setLens}
          onCreateHandover={() => setWizardEventId('')}
        />
        </React.Fragment>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      {subTab === 'country_docs' ? (
        <CountryHandoverDocView user={user} />
      ) : (
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
            alwaysShowEmails={calendarAlwaysShowEmails}
          />
        ) : (
          <TableMode
            events={filteredEvents}
            membersByEmail={membersByEmail}
            todayIso={todayIso}
            onSelectEvent={ev => setSelectedEventId(ev?.id || null)}
            currentUserEmail={user?.email}
            currentUserRole={user?.role}
            onEditEvent={(ev) => setEditTimeOffEvent(ev)}
            onUpdated={refreshAll}
            onToast={addToast}
            onBulkApprove={async (eventIds) => {
              // Convert event ids → handover ids using the events array.
              const ids = events
                .filter(e => eventIds.includes(e.id) && e.handover?.id)
                .map(e => e.handover.id);
              if (ids.length === 0) return;
              try {
                await bulkApproveHandovers(ids);
                addToast?.({ kind: 'success', message: `Approved ${ids.length} handover${ids.length === 1 ? '' : 's'}.` });
                refreshAll();
              } catch (err) {
                addToast?.({ kind: 'error', message: err?.message || 'Bulk approve failed' });
              }
            }}
            onBulkReject={async (eventIds) => {
              const ids = events
                .filter(e => eventIds.includes(e.id) && e.handover?.id)
                .map(e => e.handover.id);
              if (ids.length === 0) return;
              const reason = typeof window !== 'undefined'
                ? window.prompt('Reason for rejection (required, shared across all selected):')
                : null;
              if (!reason) return;
              try {
                await bulkRejectHandovers(ids, reason);
                addToast?.({ kind: 'success', message: `Rejected ${ids.length} handover${ids.length === 1 ? '' : 's'}.` });
                refreshAll();
              } catch (err) {
                addToast?.({ kind: 'error', message: err?.message || 'Bulk reject failed' });
              }
            }}
          />
        )}
      </div>
      )}

      <DetailSlideOut
        event={selectedEvent}
        membersByEmail={membersByEmail}
        currentUserEmail={user?.email}
        currentUserRole={user?.role}
        todayIso={todayIso}
        onClose={() => setSelectedEventId(null)}
        onUpdated={refreshAll}
        onSubmitDraft={(ev) => setWizardEventId(ev?.id || '')}
        onEdit={(ev) => setEditTimeOffEvent(ev)}
        onToast={addToast}
      />

      {wizardEventId !== null && (
        <CreateHandoverModal
          initialEventId={wizardEventId || null}
          currentUserEmail={user?.email}
          members={members}
          onClose={() => setWizardEventId(null)}
          onCreated={(handover) => {
            setWizardEventId(null);
            refreshAll();
            addToast?.({ kind: 'success', message: handover?.status === 'draft'
              ? 'Handover saved as draft.'
              : 'Handover submitted — coverers notified.',
            });
            if (handover?.time_off_event_id) setSelectedEventId(handover.time_off_event_id);
          }}
        />
      )}

      {submitTimeOffOpen && (
        <SubmitTimeOffModal
          currentUserEmail={user?.email}
          currentUserAccess={user?.role}
          members={members}
          onClose={() => setSubmitTimeOffOpen(false)}
          onCreated={(item) => {
            refreshAll();
            if (item?.id) setSelectedEventId(item.id);
          }}
          onToast={addToast}
        />
      )}

      {editTimeOffEvent && (
        <SubmitTimeOffModal
          currentUserEmail={user?.email}
          currentUserAccess={user?.role}
          members={members}
          editEvent={editTimeOffEvent}
          onClose={() => setEditTimeOffEvent(null)}
          onCreated={(item) => {
            // `onCreated` is also fired in edit mode — refresh so the
            // calendar bar / table row picks up the new dates + reason.
            refreshAll();
            if (item?.id) setSelectedEventId(item.id);
          }}
          onToast={addToast}
        />
      )}
    </div>
  );
}

export default OOOView;
