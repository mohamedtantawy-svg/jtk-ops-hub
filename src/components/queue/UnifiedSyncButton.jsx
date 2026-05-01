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

// 2026-05-01 redesign: badge tracks DATA FRESHNESS, not poll-in-flight state.
// As long as the freshest source completed within the last `STALE_AFTER_MS`
// the user has actionable data — flipping the badge to amber/orange every
// time a background poll fires (which can take 30–60s for offboarding) is
// noise. The badge only goes amber/red when the data itself is genuinely
// out of date.
//
// Hover still shows the live per-source breakdown so an HRX lead can
// see "Workbench refreshing 12s — last ok 3 min ago" while the badge
// itself stays green. The dropdown has the granular state; the badge
// has the headline.
const STALE_AFTER_MS = 10 * 60 * 1000; // hard threshold — data is now stale
const WARN_AFTER_MS  = 7  * 60 * 1000; // soft threshold — getting close
// We still need a stall threshold so the *dropdown* can offer a Force
// Resync action when something's actually hung, but it no longer drives
// the badge color/state when the freshest source is recent.
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

  // Derive state. Precedence: Offline > Stalled > Error > Refreshing > Stale > Live > Waiting.
  const { lastSyncAt, oldestSyncAt, isAnyRefreshing, sourceErrors, isOffline, hasEverSynced } = meta;
  const now = nowTick || Date.now();
  const ageMs = oldestSyncAt ? now - oldestSyncAt : null;
  const isStale = ageMs != null && ageMs > STALE_AFTER_MS;
  const isWarn  = ageMs != null && ageMs > WARN_AFTER_MS && !isStale;

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

  // ── Freshness-first state machine (2026-05-01 redesign) ────────────────
  // Old behaviour: any in-flight poll → amber "Syncing 12s" badge, even
  // when the user already had 1-min-old data. That created panic-clicks
  // and made the page feel broken whenever the offboarding scan ran in
  // the background. Concretely, an HR lead with 3-min-old cached data
  // saw the badge flip amber for 60s every poll cycle, then back to
  // green, then amber, then green — 12× per hour. Awful.
  //
  // New behaviour: the badge follows the *freshest* successful sync time.
  // If anything completed in the last STALE_AFTER_MS window, the user
  // has actionable data — show green "Live · synced N min ago", no
  // matter what's happening in the background. Hover the badge to see
  // the live per-source breakdown (Workbench refreshing 12s — last ok
  // 3 min ago) for users who actually want the granular state.
  //
  // Only the genuine red flags break the green badge:
  //   • Offline (no network)
  //   • Stale (no successful sync inside the 10-min window)
  //   • All sources failing (every source returned an error)
  // Background polls — even a 60-second offboarding scan — leave the
  // badge green as long as the cache is fresh. The dropdown still
  // surfaces "Syncing Xs" per source for users who hover.
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
  } else if (isStale) {
    // Past the 10-min hard threshold AND not currently refreshing → red.
    // If a poll is in-flight while stale, the next branch handles that.
    state = isAnyRefreshing ? 'stale-refreshing' : 'stale';
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = isAnyRefreshing
      ? `refreshing ${formatRunning(refreshRunningMs)}…`
      : 'stale — click to refresh';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (sourceErrors?.length === Object.keys(sources || {}).length && (sourceErrors?.length || 0) > 0) {
    // Every source failed — escalate to red regardless of freshness, since
    // the cache is about to drift and the user can't recover by waiting.
    // Partial failures stay green (they don't invalidate the cache).
    state = 'error';
    label = `${sourceErrors.length} source${sourceErrors.length > 1 ? 's' : ''} failing`;
    sublabel = hasEverSynced ? `last ok ${formatAgo(oldestSyncAt, now)}` : 'retry';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (isWarn) {
    // 7–10 min old. Soft warning so the user notices drift before it's
    // actionable. If a refresh is in flight, lean back toward green
    // because relief is on the way.
    state = 'aging';
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = isAnyRefreshing
      ? `refreshing ${formatRunning(refreshRunningMs)}…`
      : 'aging — refresh soon';
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else {
    // ✨ Default green path. We're inside the freshness window — even if
    // a background poll is currently running. Show "Live · synced N min
    // ago" and let the dropdown carry the per-source detail.
    state = 'live';
    label = 'Live';
    sublabel = `synced ${formatAgo(oldestSyncAt, now)}`;
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
