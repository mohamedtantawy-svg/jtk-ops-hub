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

// Two-tier freshness so a long-running tab signals drift *before* users act on
// stale data: warn at 5 min (yellow), escalate at 10 min (red). Matches the
// resilience audit's recommended thresholds.
const WARN_AFTER_MS  = 5  * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
// If a refresh has been running this long without finishing, flip the
// indicator to "stalled" and surface an actionable retry. Matches the
// server-side scan timeout (45s) plus a small buffer for the response
// to traverse the FE.
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
  let label = 'Synced';
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

  if (isOffline) {
    state = 'offline';
    label = 'Offline';
    sublabel = hasEverSynced ? `cached ${formatAgo(oldestSyncAt, now)}` : 'no cached data';
    dotColor = '#9e9e9e';
    bg = '#f3f3f3';
    border = '#d5d5d5';
    textColor = '#616161';
  } else if (isStalled) {
    state = 'stalled';
    label = `Sync stalled (${formatRunning(refreshRunningMs)})`;
    sublabel = hasEverSynced
      ? `cached ${formatAgo(oldestSyncAt, now)} · click Force resync`
      : 'first sync taking longer than expected';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (isAnyRefreshing) {
    state = 'syncing';
    label = `Syncing ${formatRunning(refreshRunningMs)}`;
    sublabel = hasEverSynced ? `last ${formatAgo(oldestSyncAt, now)}` : 'first sync';
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else if (sourceErrors?.length > 0) {
    state = 'error';
    label = `${sourceErrors.length} source${sourceErrors.length > 1 ? 's' : ''} failing`;
    sublabel = hasEverSynced ? `last ok ${formatAgo(oldestSyncAt, now)}` : 'retry';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (!hasEverSynced) {
    state = 'waiting';
    label = 'Waiting…';
    sublabel = 'first sync';
    dotColor = '#9e9e9e';
    bg = '#f7f5f2';
    border = '#e8e8e8';
    textColor = '#616161';
  } else if (isStale) {
    state = 'stale';
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = 'stale — click to refresh';
    dotColor = '#d42d35';
    bg = '#fef2f2';
    border = '#fca5a5';
    textColor = '#991b1b';
  } else if (isWarn) {
    state = 'aging';
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = 'aging — consider refresh';
    dotColor = '#ed8d00';
    bg = '#fff8e6';
    border = '#ffe27c';
    textColor = '#92400e';
  } else {
    label = `Synced ${formatAgo(oldestSyncAt, now)}`;
    sublabel = '';
  }

  // Allow forcing a refresh even when one is in flight if it has stalled —
  // the user shouldn't be locked out of recovery just because a hung scan
  // is still nominally "running". Otherwise honour the in-flight guard so
  // the click doesn't spam the same refresh path.
  const handleClick = () => {
    if (!isAnyRefreshing || isStalled) onRefresh?.();
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={handleClick}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onMouseLeave={() => { /* dismissal via outside click */ }}
        disabled={isAnyRefreshing && !isStalled}
        aria-label={`Sync status: ${label}${sublabel ? `, ${sublabel}` : ''}`}
        title={sublabel || label}
        style={{
          height: 32,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '0 12px', borderRadius: 128,
          border: `1px solid ${border}`, background: bg, color: textColor,
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          cursor: (isAnyRefreshing && !isStalled) ? 'wait' : 'pointer',
          transition: 'background .15s, border-color .15s',
        }}>
        <span
          aria-hidden="true"
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: dotColor,
            animation: state === 'syncing' ? 'pulse 1s infinite' : 'none',
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
          className={state === 'syncing' ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'}
          style={{ fontSize: 12, marginLeft: 2, opacity: 0.7 }}
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
              disabled={isAnyRefreshing && !isStalled}
              style={{
                padding: '3px 10px', borderRadius: 128,
                border: `1px solid ${isStalled ? '#fca5a5' : '#e8e8e8'}`,
                background: isStalled ? '#fef2f2' : (isAnyRefreshing ? '#f7f5f2' : 'white'),
                color: isStalled ? '#991b1b' : '#1b1b1b', fontSize: 11, fontWeight: 600,
                cursor: (isAnyRefreshing && !isStalled) ? 'wait' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              <i className={(isAnyRefreshing && !isStalled) ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 10 }} />
              {isStalled ? 'Force resync' : (isAnyRefreshing ? 'Syncing' : 'Refresh all')}
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
