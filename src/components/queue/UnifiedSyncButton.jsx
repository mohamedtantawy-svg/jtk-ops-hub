// ── UnifiedSyncButton ───────────────────────────────────────────────────────
// Single sync-status control for the Queue header. One button, always
// visible, gives you:
//   • State at a glance (Live / Syncing / Stalled / Offline / Stale / Error)
//   • "Synced N min ago" label driven by the parent's nowTick
//   • Live "Syncing for Xs" counter while a refresh is in flight so the
//     spinner never feels frozen
//   • A `stalled` state if a refresh runs longer than STALL_AFTER_MS — the
//     same dropdown surfaces a Force Resync button so the user is never
//     stuck behind a hung scan
//   • Click → refresh all sources (disabled while a refresh is in flight)
//   • Hover → per-source breakdown with individual Retry buttons
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

// 2026-05-01 redesign: badge tracks DATA FRESHNESS per source, not a single
// aggregate. Freshness scoring (per-source 7/10-min thresholds, "stale-but-
// refreshing → fresh" carve-out) lives in `useQueueUnifiedSync` so the
// counts arrive here pre-computed in `meta` (freshSourceCount, anyStale,
// allFailing, etc.). This component just renders the state machine on top.
//
// Hover still shows the live per-source breakdown so an HRX lead can
// see "Workbench refreshing 12s — last ok 3 min ago" while the badge
// itself stays green. The dropdown has the granular state; the badge
// has the headline.
//
// The only threshold this file owns is the in-flight stall: if a refresh
// has been running longer than STALL_AFTER_MS, the dropdown surfaces a
// Force Resync button so the user can abandon a hung scan. It no longer
// drives the badge color when fresh sources exist.
const STALL_AFTER_MS = 50 * 1000;

function formatAgo(ts, now) {
  if (!ts) return 'never';
  const diff = Math.max(0, (now || Date.now()) - ts);
  if (diff < 10_000) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function UnifiedSyncButton({ meta, sources, onRefresh, nowTick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Derive state. Precedence: Offline > First sync > All stale > All failing >
  //                          Some stale (partial) > Some aging > Live.
  // Freshness is now per-source: a stale source that's currently refreshing
  // counts as fresh ("the system is fixing it"), so the badge stays green
  // while a background offboarding poll runs. The only states that break
  // green are genuine red flags — every source stale-and-not-refreshing,
  // every source erroring, no network — or a mixed state where partial
  // staleness/failure survives without a refresh in flight.
  const {
    lastSyncAt, oldestSyncAt, isAnyRefreshing, sourceErrors, isOffline, hasEverSynced,
    totalSources = 0,
    freshSourceCount = 0,
    agingSourceCount = 0,
    staleSourceCount = 0,
    refreshingStaleSourceCount = 0,
    staleSources = [],
    agingSources = [],
    anyStale = false,
    anyAging = false,
    allStale = false,
    allFailing = false,
  } = meta;
  const now = nowTick || Date.now();
  const someFailing = (sourceErrors?.length || 0) > 0 && !allFailing;

  // ── Refresh-running heartbeat ──────────────────────────────────────────
  // Track when the current refresh started so the indicator can show
  // "Syncing 12s" instead of an opaque spinner, and so we can flip to
  // "stalled" when something is clearly hung. We can't read the start
  // timestamp from `meta` directly because it's derived per-render — so
  // the button stamps it locally the moment isAnyRefreshing flips on.
  const refreshStartedAtRef = useRef(null);
  const [refreshRunningMs, setRefreshRunningMs] = useState(0);
  useEffect(() => {
    if (isAnyRefreshing) {
      if (refreshStartedAtRef.current == null) refreshStartedAtRef.current = Date.now();
      // 1s heartbeat while a refresh is in-flight — keeps the "Syncing 12s"
      // counter alive without coupling to the parent's 30s nowTick.
      const id = setInterval(() => {
        if (refreshStartedAtRef.current != null) {
          setRefreshRunningMs(Date.now() - refreshStartedAtRef.current);
        }
      }, 1000);
      return () => clearInterval(id);
    }
    refreshStartedAtRef.current = null;
    setRefreshRunningMs(0);
  }, [isAnyRefreshing]);
  // Reset the running counter whenever a source successfully syncs — without
  // this, `isAnyRefreshing` aggregating 8 sources stays true for the whole
  // window of the slowest one, and `refreshRunningMs` climbs past
  // STALL_AFTER_MS even when 7/8 sources just succeeded. The 2026-05-01
  // audit observed the indicator stuck on "Sync stalled (1m 31s)" while the
  // page counters were still updating in real time — i.e., not actually
  // stalled. Re-stamp the start time when any source resolves so the
  // counter tracks the *currently slowest* refresh, not the aggregate.
  useEffect(() => {
    if (!isAnyRefreshing) return;
    if (!lastSyncAt) return;
    if (refreshStartedAtRef.current && lastSyncAt > refreshStartedAtRef.current) {
      refreshStartedAtRef.current = Date.now();
      setRefreshRunningMs(0);
    }
  }, [lastSyncAt, isAnyRefreshing]);
  const isStalled = isAnyRefreshing && refreshRunningMs > STALL_AFTER_MS;

  let state = 'live';
  let label = 'Live';
  let sublabel = '';
  let dotColor = '#29811e';
  let bg = '#e8f5e9';
  let border = '#bbf7d0';
  let textColor = '#166534';

  // Format "Xs" / "Xm Ys" for the running counter — the eye picks this
  // up faster than ms or "12345 ms".
  const formatRunning = (ms) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  // ── Per-source freshness state machine (2026-05-01 second pass) ────────
  // Earlier pass already moved off "any-in-flight = amber" — but it still
  // drove staleness from a single `oldestSyncAt` aggregate. That meant a
  // 15-min-old offboarding source flipped the whole badge red even when
  // 6 of 7 other sources were synced inside the 2-min mark and offboarding
  // itself was already refreshing in the background.
  //
  // New behaviour scores each source independently against the same
  // thresholds and reads the mix:
  //   • Every source fresh (or stale-but-refreshing) → green "Live".
  //     A refresh in flight on a stale source is the system fixing
  //     itself; show live, don't panic.
  //   • Some sources >10 min and not refreshing, but ≥1 fresh → soft
  //     amber "Live · M of N synced". The user still has actionable
  //     data on screen and the dropdown shows which source is behind.
  //   • Every source >10 min and none refreshing → red "Stale".
  //   • Some sources erroring, others ok → soft amber "X failing".
  //     Click the row in the dropdown to retry.
  //   • Every source erroring → red "All sources failing".
  //   • 7–10 min drift on at least one source, none stale → soft amber
  //     "Aging".
  //
  // Background polls — even a 80-second offboarding scan that started 15
  // min after the last cache hit — leave the badge green as long as the
  // refresh is in flight. The dot pulses to signal "working in the
  // background"; hover the badge to see which source.
  if (isOffline) {
    state = 'offline';
    label = 'Offline';
    sublabel = hasEverSynced ? `cached ${formatAgo(oldestSyncAt, now)}` : 'no cached data';
    dotColor = '#9e9e9e';
    bg = '#f3f3f3';
    border = '#d5d5d5';
    textColor = '#616161';
  } else if (!hasEverSynced && !isAnyRefreshing) {
    // Fresh login, no cache hydrated yet, no poll fired. Brief state.
    state = 'waiting';
    label = 'Waiting…';
    sublabel = 'first sync';
    dotColor = '#9e9e9e';
    bg = '#f7f5f2';
    border = '#e8e8e8';
    textColor = '#616161';
  } else if (!hasEverSynced && isAnyRefreshing) {
    // First sync in progress — only state where we surface the in-flight
    // counter on the badge itself. The user has nothing to look at yet.
    state = 'syncing';
    label = `Syncing ${formatRunning(refreshRunningMs)}`;
    sublabel = 'first sync';
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else if (allFailing) {
    // Every source failed — escalate to red regardless of freshness,
    // since the cache is about to drift and the user can't recover by
    // waiting.
    state = 'error';
    label = `${sourceErrors.length} source${sourceErrors.length > 1 ? 's' : ''} failing`;
    sublabel = hasEverSynced ? `last ok ${formatAgo(lastSyncAt, now)}` : 'retry';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (allStale && !isAnyRefreshing) {
    // Every source past the 10-min mark AND nothing refreshing → red.
    // (allStale is computed AFTER the stale-but-refreshing carve-out, so
    // a single source stuck in a slow refresh leaves us in the partial
    // branch below, not here.)
    state = 'stale';
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = 'stale — click to refresh';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (anyStale) {
    // Some sources >10 min and not refreshing, but at least one source
    // is fresh. Soft amber — actionable data is on screen; the dropdown
    // surfaces which source is behind so the user can retry that one.
    state = 'partial-stale';
    const n = staleSourceCount;
    const labels = staleSources.slice(0, 2).map(s => s.label).join(', ');
    label = `${n} stale source${n > 1 ? 's' : ''}`;
    sublabel = staleSources.length
      ? `${labels}${staleSources.length > 2 ? ` +${staleSources.length - 2}` : ''} — others live`
      : 'others live';
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else if (someFailing) {
    // Partial failure: ≥1 source erroring, ≥1 source ok. Soft amber so
    // the user notices, but the queue still has live data from the
    // healthy sources.
    state = 'partial-error';
    const n = sourceErrors.length;
    label = `${n} source${n > 1 ? 's' : ''} failing`;
    sublabel = `others live · synced ${formatAgo(lastSyncAt, now)}`;
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else if (anyAging) {
    // 7–10 min drift on at least one source, none stale. Surface as
    // "aging" so users notice drift before it's actionable. If a
    // refresh is in flight, the sublabel hints at relief.
    state = 'aging';
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = isAnyRefreshing
      ? `refreshing ${formatRunning(refreshRunningMs)}…`
      : `${agingSourceCount} aging — refresh soon`;
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else {
    // ✨ Default green path. Every source either fresh or stale-but-
    // refreshing. Background polls (even slow ones) live here.
    //
    // Quiet by default: when nothing has crossed its per-source stale
    // threshold (10 min for most, 15 min for offboarding), the badge
    // is just "Live" — no timestamp. The "synced N min ago" line is
    // noise when the data is comfortably fresh and only adds value
    // when something *has* drifted past its threshold but the system
    // is currently catching up (refreshingStaleSourceCount > 0). In
    // that case we surface the last-success time so the user can
    // judge how stale the on-screen data is while the refresh runs.
    state = 'live';
    label = 'Live';
    if (refreshingStaleSourceCount > 0) {
      sublabel = `synced ${formatAgo(lastSyncAt, now)} · ${refreshingStaleSourceCount} refreshing`;
    } else {
      sublabel = '';
    }
    dotColor = '#29811e';
    bg = '#e8f5e9';
    border = '#bbf7d0';
    textColor = '#166534';
  }

  // Click semantics:
  //   • In the green "Live" state, a click forces a refresh — users who
  //     do want the very latest data can override the freshness window.
  //   • In stalled / stale / aging states, click also force-refreshes.
  //   • While a fresh-cache first sync is running, clicks are still no-ops
  //     since there's no cache to refresh.
  // Pre-2026-05-01 the button was disabled the entire time isAnyRefreshing
  // was true — that's what made every offboarding poll feel like the page
  // was locked up.
  const handleClick = () => {
    if (state === 'syncing' || state === 'waiting') return;
    onRefresh?.();
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={handleClick}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onMouseLeave={() => { /* dismissal via outside click */ }}
        // Only the very first sync (no cache yet) disables the button —
        // every other state is interactive so the user can always force
        // a refresh.
        disabled={state === 'syncing' || state === 'waiting'}
        aria-label={`Sync status: ${label}${sublabel ? `, ${sublabel}` : ''}`}
        // Hover tooltip emphasises that the per-source breakdown is one
        // hover away — useful in the "Live" green state where the badge
        // intentionally hides the in-flight detail.
        title={isAnyRefreshing && state === 'live'
          ? `${label} · ${sublabel} — hover for live per-source state`
          : (sublabel || label)}
        style={{
          height: 32,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '0 12px', borderRadius: 128,
          border: `1px solid ${border}`, background: bg, color: textColor,
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          cursor: (state === 'syncing' || state === 'waiting') ? 'wait' : 'pointer',
          transition: 'background .15s, border-color .15s',
        }}>
        <span
          aria-hidden="true"
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: dotColor,
            // Pulse the dot whenever a poll is in flight — a subtle hint
            // that the system is still working in the background, even
            // when the badge stays green. The dot is the only thing that
            // moves; the rest of the badge holds steady.
            animation: isAnyRefreshing ? 'pulse 1s infinite' : 'none',
            flexShrink: 0,
          }}
        />
        <span>{label}</span>
        {sublabel && (
          <span style={{ fontWeight: 400, color: textColor, opacity: 0.75 }}>
            · {sublabel}
          </span>
        )}
        <i
          className={isAnyRefreshing ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'}
          style={{ fontSize: 12, marginLeft: 2, opacity: 0.55 }}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Per-source sync breakdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)', right: 0,
            width: 320,
            background: 'white',
            border: '1px solid #e8e8e8',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 8, zIndex: 300,
          }}>
          <div style={{
            padding: '6px 10px 8px',
            fontSize: 11,
            color: '#9e9e9e',
            borderBottom: '1px solid #f0efed',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sources
            </span>
            <button
              onClick={onRefresh}
              // Only disabled during the very first sync (no cache to refresh).
              // In every other state the button is interactive so the user
              // can always override the freshness window.
              disabled={state === 'syncing' || state === 'waiting'}
              style={{
                padding: '3px 10px', borderRadius: 128,
                border: `1px solid ${isStalled ? '#fca5a5' : '#e8e8e8'}`,
                background: isStalled ? '#fef2f2' : 'white',
                color: isStalled ? '#991b1b' : '#1b1b1b', fontSize: 11, fontWeight: 600,
                cursor: (state === 'syncing' || state === 'waiting') ? 'wait' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              <i className={isAnyRefreshing ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 10 }} />
              {isStalled ? 'Force resync' : (isAnyRefreshing ? 'Refreshing…' : 'Refresh all')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {Object.values(sources).map(src => (
              <SourceRow key={src.id} source={src} now={now} />
            ))}
          </div>
          {isStalled && (
            <div style={{
              marginTop: 6, padding: '6px 10px',
              background: '#fef2f2', borderRadius: 8,
              fontSize: 11, color: '#991b1b',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <i className="bi-exclamation-triangle-fill" style={{ fontSize: 11 }} />
              A sync has been running for {formatRunning(refreshRunningMs)} — the server may be cold. Click <strong>Force resync</strong> to abandon and retry, or wait for it to recover on its own.
            </div>
          )}
          {isOffline && (
            <div style={{
              marginTop: 6, padding: '6px 10px',
              background: '#f7f5f2', borderRadius: 8,
              fontSize: 11, color: '#616161',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <i className="bi-wifi-off" style={{ fontSize: 11 }} />
              You're offline — showing cached data. Auto-resumes when connection returns.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceRow({ source, now }) {
  const { label, count, loading, isRefreshing, error, lastSyncAt, retry } = source;

  let dotColor = '#bbf7d0';
  let statusText = 'Synced';
  if (isRefreshing) { dotColor = '#ed8d00'; statusText = 'Syncing…'; }
  else if (error) { dotColor = '#d42d35'; statusText = 'Failed'; }
  else if (loading) { dotColor = '#9e9e9e'; statusText = 'Loading'; }
  else if (!lastSyncAt) { dotColor = '#9e9e9e'; statusText = 'Waiting'; }
  else { dotColor = '#29811e'; statusText = formatAgo(lastSyncAt, now); }

  return (
    <div style={{
      padding: '6px 10px',
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 12, color: '#1b1b1b',
      borderRadius: 6,
    }}>
      <span
        aria-hidden="true"
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: dotColor,
          animation: isRefreshing ? 'pulse 1s infinite' : 'none',
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 500, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={error || ''}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: '#9e9e9e' }}>{count}</span>
      <span
        style={{ fontSize: 11, color: error ? '#d42d35' : '#616161', cursor: error ? 'help' : 'default' }}
        title={error ? `Failed — ${error}` : statusText}
      >
        {statusText}
      </span>
      {(error || !isRefreshing) && retry && (
        <button
          onClick={retry}
          disabled={isRefreshing}
          title={error ? `Retry — ${error}` : 'Refresh this source'}
          style={{
            padding: '2px 6px', borderRadius: 6, border: '1px solid #e8e8e8',
            background: 'white', color: '#616161',
            fontSize: 10, fontWeight: 600, cursor: isRefreshing ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center',
          }}>
          <i className="bi-arrow-clockwise" style={{ fontSize: 10 }} />
        </button>
      )}
    </div>
  );
}
