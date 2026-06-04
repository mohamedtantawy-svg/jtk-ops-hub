// ── Current-dept storage (2026-05-21) ──────────────────────────────────────
// Single source of truth on the FE for "which top-level department is the
// user currently viewing". Every dept-scoped data hook (queue sources,
// onboarding/offboarding/workbench/amendments/redlines/incentive-plans,
// notifications, team members, etc.) composes its localStorage / IDB cache
// key with the current dept-id so each dept gets its OWN cache namespace.
// That gives us two behaviours the previous reload-and-wipe approach
// couldn't:
//
//   • Switching back to a previously-viewed dept paints instantly from its
//     persisted cache — no spinner, no flash of empty state, no slow
//     refetch. The original dept's data sits untouched in localStorage.
//
//   • No page reload on switch — the dept-scope cookie is updated, the
//     new dept's cache (if any) is shown, and hooks revalidate in the
//     background. Switching between depts feels like swapping a single
//     state field, not a fresh login.
//
// Architecture:
//
//   1. `useCurrentDept` (the master hook) calls writeCurrentDeptId() every
//      time the server returns a resolved dept. That puts the id in
//      localStorage AND broadcasts to other tabs + other in-process
//      instances.
//
//   2. Every data hook calls useCurrentDeptId() — a lightweight hook that
//      reads localStorage synchronously on mount (so the first cache-key
//      lookup is correct) and subscribes to the broadcast for changes.
//      It does NOT hit /dept-scope/current itself — that's the master
//      hook's job, dedup'd via module-level state.
//
//   3. On dept switch (super-admin only), useCurrentDept.setDept() POSTs
//      the cookie, calls writeCurrentDeptId(newId), and updates its own
//      state. Every subscribed hook re-runs its effect with the new id,
//      reads its dept-scoped cache (instant render if cached), and
//      revalidates in the background. NO window.location.reload().

const STORAGE_KEY = 'ops_hub_current_dept_id';
const CHANNEL_NAME = 'ops_hub_current_dept';

// Subscribers in this tab — every useCurrentDeptId() call adds one. We
// fan out writes to all of them on top of the cross-tab BroadcastChannel.
const _subscribers = new Set();
let _channel = null;
let _channelInitTried = false;

// Whether this tab is a dedicated "Login as" impersonation session (opened via
// /?impersonate=<email>; App.jsx sets this marker synchronously at boot). Such
// tabs keep their current-dept-id TAB-LOCAL (sessionStorage) and never
// broadcast it, so an admin impersonating someone in another department sees
// 100% the target's view with no dept-id leaking to — or from — their own
// tabs. Read lazily per call so it's correct regardless of module-eval order.
function _isImpersonationTab() {
  if (typeof window === 'undefined') return false;
  try { return sessionStorage.getItem('ops_hub_impersonation_tab') === '1'; } catch { return false; }
}

function _getChannel() {
  if (_channelInitTried) return _channel;
  _channelInitTried = true;
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  // Impersonation tabs are isolated: they neither broadcast nor adopt other
  // tabs' dept changes, so never open the channel for them.
  if (_isImpersonationTab()) return null;
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME);
    _channel.addEventListener('message', (e) => {
      if (e?.data?.type !== 'current-dept-changed') return;
      const next = typeof e.data.deptId === 'string' ? e.data.deptId : null;
      _notify(next);
    });
  } catch {
    _channel = null;
  }
  return _channel;
}

function _notify(deptId) {
  for (const cb of _subscribers) {
    try { cb(deptId); } catch { /* swallow — subscriber error must not block fan-out */ }
  }
}

/**
 * Synchronous read of the current dept-id from localStorage. Returns null
 * when storage is unavailable (SSR, private mode) or no dept has been
 * resolved yet. Safe to call inline during cache-key computation.
 */
export function getCurrentDeptIdSync() {
  if (typeof window === 'undefined') return null;
  try {
    // Impersonation tabs read their dept-id from tab-local sessionStorage so
    // they never inherit the admin's own dept (see _isImpersonationTab).
    const store = _isImpersonationTab() ? sessionStorage : localStorage;
    const v = store.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist the current dept-id, notify in-process subscribers, and broadcast
 * to other tabs. Null/empty clears the value (e.g. on logout / unassigned
 * user). Idempotent — no notification if the value didn't actually change.
 */
export function writeCurrentDeptId(deptId) {
  if (typeof window === 'undefined') return;
  const next = deptId && typeof deptId === 'string' ? deptId : null;
  // Impersonation tabs persist their (target's) dept-id tab-locally and never
  // broadcast it, so the admin's own tabs are untouched.
  const impTab = _isImpersonationTab();
  const store = impTab ? sessionStorage : localStorage;
  let prev = null;
  try { prev = store.getItem(STORAGE_KEY) || null; } catch { /* no-op */ }
  if (prev === next) return; // no-op
  try {
    if (next) store.setItem(STORAGE_KEY, next);
    else store.removeItem(STORAGE_KEY);
  } catch { /* quota / private mode — proceed with broadcast anyway */ }
  // Notify same-tab subscribers (keeps this tab's data hooks in sync).
  _notify(next);
  // Cross-tab broadcast for normal tabs only.
  if (impTab) return;
  const ch = _getChannel();
  if (ch) {
    try { ch.postMessage({ type: 'current-dept-changed', deptId: next }); }
    catch { /* channel closed mid-write — fine, callers re-init on next read */ }
  }
}

/**
 * Subscribe to current-dept-id changes. Returns an unsubscribe function.
 * The callback is invoked with the new id (or null) when:
 *   • Another in-process consumer calls writeCurrentDeptId
 *   • Another tab broadcasts a change via the BroadcastChannel
 * Init the channel lazily on first subscription.
 */
export function subscribeCurrentDeptId(cb) {
  _subscribers.add(cb);
  _getChannel(); // lazy-init the cross-tab listener on first subscriber
  return () => { _subscribers.delete(cb); };
}

// ── React hook ────────────────────────────────────────────────────────────
// Lightweight: reads the synchronous initial value and subscribes for
// updates. Use in any data hook that needs to compose a dept-scoped cache
// key — does NOT hit /dept-scope/current (that's useCurrentDept's job, and
// we explicitly avoid duplicating the fetch across every consumer).
import { useEffect, useState } from 'react';

export function useCurrentDeptId() {
  const [deptId, setDeptId] = useState(() => getCurrentDeptIdSync());
  useEffect(() => {
    // Resync on mount in case localStorage changed between the initialiser
    // and the effect (e.g. a sibling hook resolved the dept faster than us).
    const current = getCurrentDeptIdSync();
    setDeptId(prev => (prev === current ? prev : current));
    const unsub = subscribeCurrentDeptId((next) => {
      setDeptId(prev => (prev === next ? prev : next));
    });
    return unsub;
  }, []);
  return deptId;
}
