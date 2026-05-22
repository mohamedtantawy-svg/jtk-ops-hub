// ── useCurrentDept (Phase 11a — 2026-05-20, instant-switch refactor 2026-05-21)
// Resolves the FE's current dept context. Returns:
//   • deptId / dept — what every isolated query filters by
//   • currentDeptNodeIds — Set of dept-id + every descendant org_node.id
//     (used by Team Summary + ack-tracker sub-tree membership checks)
//   • isGlobalSuperAdmin — true only for mohamed.tantawy@deel.com
//   • depts — list of pickable top-level depts (super-admin only)
//   • visibleSources — per-dept Deel-source visibility (Phase 13a)
//   • setDept(id|null) — super-admin switches dept WITHOUT page reload
//
// Why no page reload?
// ───────────────────
// The original implementation (PR #716, PR #746) called
// `window.location.reload()` after POSTing the dept-scope cookie. That
// did two things wrong:
//
//   1. Every dept switch felt like a fresh login — full app boot, every
//      cache wiped, every hook refetching against the new cookie.
//      Switching HRX → GIX → HRX repaid the cost both directions, so
//      the user lost everything HRX had already loaded.
//
//   2. Pre-reload, the previous dept's data was still rendered. The
//      reload took ~1-2s during which the user saw stale numbers,
//      then a blank skeleton, then the new dept's data trickle in.
//
// The new model: per-dept localStorage cache namespacing (each data
// hook composes its cache key with `${BASE}:${email}:${deptId}`).
// Switching dept becomes:
//
//   • POST /dept-scope/current to update the cookie server-side.
//   • Update local state (deptId, currentDeptNodeIds, visibleSources).
//   • writeCurrentDeptId(newId) — fans out via BroadcastChannel +
//     same-tab subscribers to every data hook.
//   • Each subscribed hook re-runs its effect with the new deptId.
//     If a cache exists for the target dept, it paints INSTANTLY;
//     otherwise it shows a skeleton + revalidates.
//   • Switching BACK to a previously-visited dept paints from that
//     dept's persisted cache — no spinner, no fetch wait.
//
// Shared in-process state
// ───────────────────────
// Multiple components used to each call `useCurrentDept()` (BriefingView,
// AnnouncementsView, Queue, DeelTopNav), each spawning an independent
// state + independent /dept-scope/current fetch on mount. We now keep
// a module-level cached snapshot that all instances share — the first
// instance triggers the fetch, subsequent instances reuse the result.
// setDept() in one instance broadcasts to every other instance via
// subscribeCurrentDeptId so they all re-render with the new id.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import {
  getCurrentDeptIdSync,
  subscribeCurrentDeptId,
  writeCurrentDeptId,
} from '../lib/current-dept-storage';

// Phase 13a (2026-05-20): visibleSources tells the FE which Deel-source
// sections to render in Briefing / Home / etc. The server is the source
// of truth (per-dept profile in src/lib/dept-integrations.js); this
// default matches an "empty" dept profile so we fail-closed before the
// first fetch lands rather than briefly flashing HRX-style sections.
const EMPTY_VISIBLE_SOURCES = Object.freeze({
  onboarding: false,
  offboarding: false,
  amendments: false,
  redlines: false,
  incentivePlans: false,
  workbench: false,
  // 2026-05-22: GIX-only "Immigration Tasks" source. Defaults to false so
  // the FE never shows the tab until the per-dept profile resolves and
  // confirms visibility (only true for the Global Immigration dept).
  immigrationTasks: false,
});

// 2026-05-21 — initial Set is empty AND .size === 0 so consumers can
// fall back to "include everything" while the first fetch is in flight,
// matching the pre-PR #745 behavior on cold paint. Once the real list
// arrives consumers switch to strict sub-tree membership.
const EMPTY_NODE_IDS = Object.freeze(new Set());

// ── Module-level shared state ────────────────────────────────────────────
// Multiple hook instances read from this snapshot; the first to mount
// triggers the fetch and populates it. Subsequent instances reuse it.
// Subscribers are notified on every update.
const _initialDeptId = (() => {
  try { return getCurrentDeptIdSync(); } catch { return null; }
})();

let _snapshot = {
  deptId: _initialDeptId,
  dept: null,
  isGlobalSuperAdmin: false,
  depts: [],
  visibleSources: EMPTY_VISIBLE_SOURCES,
  currentDeptNodeIds: EMPTY_NODE_IDS,
  loading: true,
  error: null,
};

let _inFlightLoad = null;
const _instanceListeners = new Set();

function _publish(next) {
  _snapshot = next;
  for (const cb of _instanceListeners) {
    try { cb(next); } catch { /* never let one bad subscriber break the rest */ }
  }
}

async function _doLoad() {
  try {
    // apiFetch returns the PARSED body on success and throws an Error
    // (with `.status`) on non-2xx. The 2026-05-20 fix replaced an earlier
    // `.ok` / `.status` / `.json()` shape that silently failed for every
    // user — the hook ALWAYS landed in the catch branch, so the super-
    // admin chip never rendered and visibleSources stayed at the empty
    // default. This shape is the correct one.
    const data = await apiFetch('/dept-scope/current');
    const nodeIds = Array.isArray(data?.currentDeptNodeIds)
      ? new Set(data.currentDeptNodeIds)
      : EMPTY_NODE_IDS;
    const next = {
      deptId: data?.deptId || null,
      dept: data?.dept || null,
      isGlobalSuperAdmin: data?.isGlobalSuperAdmin === true,
      depts: Array.isArray(data?.depts) ? data.depts : [],
      visibleSources: (data?.visibleSources && typeof data.visibleSources === 'object')
        ? { ...EMPTY_VISIBLE_SOURCES, ...data.visibleSources }
        : EMPTY_VISIBLE_SOURCES,
      currentDeptNodeIds: nodeIds,
      loading: false,
      error: null,
    };
    _publish(next);
    // Mirror to localStorage + broadcast so dept-scoped data hooks pick
    // up the resolved id without their own /dept-scope/current fetch.
    writeCurrentDeptId(next.deptId);
  } catch (err) {
    // 401 during initial paint is fine — leave the hook in loading state
    // until auth lands. Don't surface as an error.
    if (err?.status === 401) {
      _publish({ ..._snapshot, loading: false });
      return;
    }
    console.warn('[useCurrentDept] load failed:', err?.message);
    _publish({ ..._snapshot, loading: false, error: err?.message || 'load failed' });
  } finally {
    _inFlightLoad = null;
  }
}

function _ensureLoadStarted() {
  if (_inFlightLoad) return _inFlightLoad;
  _inFlightLoad = _doLoad();
  return _inFlightLoad;
}

// Cross-tab + cross-instance dept-id sync: when ANY caller writes a new
// dept-id (this tab, another tab, another in-process hook instance), we
// reflect it into the shared snapshot so every subscriber re-renders.
// This is the bridge that lets a non-master useCurrentDept instance see
// the master's setDept() result without a fetch.
if (typeof window !== 'undefined') {
  subscribeCurrentDeptId((next) => {
    if (_snapshot.deptId === next) return;
    _publish({ ..._snapshot, deptId: next });
  });
}

export function useCurrentDept() {
  const [state, setState] = useState(_snapshot);

  // Subscribe to module-level snapshot changes so every instance stays
  // in sync with the master fetch / setDept result.
  useEffect(() => {
    const cb = (next) => setState(next);
    _instanceListeners.add(cb);
    // Catch up if the snapshot moved between render and subscription.
    if (state !== _snapshot) setState(_snapshot);
    // Kick off the load on the first mount; subsequent mounts are no-ops.
    _ensureLoadStarted();
    return () => { _instanceListeners.delete(cb); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    // Force a fresh fetch. Bypass the in-flight dedup so a manual refresh
    // always reaches the server.
    _inFlightLoad = _doLoad();
    return _inFlightLoad;
  }, []);

  const setDept = useCallback(async (deptId) => {
    const next = deptId && typeof deptId === 'string' ? deptId : null;
    try {
      // apiFetch throws on non-2xx, so a successful call means the cookie
      // is set. We do NOT reload — every dept-scoped hook switches its
      // cache namespace on the next render via the broadcast below.
      await apiFetch('/dept-scope/current', {
        method: 'POST',
        body: JSON.stringify({ deptId: next }),
      });
      // Optimistic snapshot update: flip deptId + loading so consumers
      // can render their per-dept cache (or skeleton) immediately. The
      // background refresh fills in dept name + visibleSources + node-ids
      // for the new dept.
      _publish({
        ..._snapshot,
        deptId: next,
        // We don't know the new dept's metadata yet — null these to avoid
        // serving the OLD dept's name / nodes alongside the new id.
        dept: null,
        visibleSources: EMPTY_VISIBLE_SOURCES,
        currentDeptNodeIds: EMPTY_NODE_IDS,
        loading: true,
        error: null,
      });
      // Persist + broadcast so every data hook in the app + every other
      // tab switches cache namespaces. This is what makes the switch
      // visible in the queue / home / sidebar immediately.
      writeCurrentDeptId(next);
      // Refetch the new dept's full payload (name, nodeIds, visibleSources).
      await _doLoad();
    } catch (err) {
      console.warn('[useCurrentDept] setDept failed:', err?.message);
    }
  }, []);

  return { ...state, refresh, setDept };
}
