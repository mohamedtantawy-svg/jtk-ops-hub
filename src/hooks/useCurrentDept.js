// ── useCurrentDept (Phase 11a — 2026-05-20) ────────────────────────────────
// Resolves the FE's current dept context. Returns:
//   • deptId / dept — what every isolated query filters by
//   • isGlobalSuperAdmin — true only for mohamed.tantawy@deel.com
//   • depts — list of pickable top-level depts (super-admin only)
//   • setDept(id|null) — super-admin switches dept; reloads the page so
//     every cached scoped query refreshes against the new boundary.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { idbClear } from '../lib/idb-cache';

// Wipe every server-data cache before a dept-switch reload so the new
// dept's first paint comes from a fresh fetch — not the previous dept's
// localStorage / IDB blob. Mohamed 2026-05-21 bug: switched the picker
// chip to Global Immigration but Home / Workspace / OOO / Urgent Assist
// kept rendering HRX-scale numbers because useQueueSync /
// useOnboardingData / useWorkbenchData / etc. cache server payloads
// keyed by `<base>:<email>` (user-scoped) — not by dept. After
// `window.location.reload()` the hooks read those caches on mount and
// painted stale HRX data while the new GIX fetch was still in flight
// (and for long-TTL caches the fetch wouldn't even fire for minutes).
//
// What we keep through the wipe:
//   • Auth (token / token_ts / logged-in email).
//   • Theme.
//   • Per-user UI prefs that don't change per dept — saved queue
//     filters, resizable Subject column width (PR #742), the
//     Personal Checklist on Home (per-user todo list, not server
//     data).
// Everything else under `ops_hub_*` gets dropped. The next mount
// refetches everything against the new dept-scope cookie.
const KEEP_EXACT_STORAGE_KEYS = new Set([
  'ops_hub_token',
  'ops_hub_token_ts',
  'ops_hub_logged_in_email',
  'ops_hub_theme',
]);
const KEEP_STORAGE_PREFIXES = [
  'ops_hub_queue_subject_width',
  'ops_hub_queue_filters',
  'ops_hub_checklist_v2',
];

function clearDeptScopedCachesForReload() {
  if (typeof window === 'undefined') return;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('ops_hub_')) continue;
      if (KEEP_EXACT_STORAGE_KEYS.has(k)) continue;
      if (KEEP_STORAGE_PREFIXES.some(p => k === p || k.startsWith(`${p}:`))) continue;
      toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch { /* private-mode / quota — proceed with the reload anyway */ }
}

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
});

export function useCurrentDept() {
  const [state, setState] = useState({
    deptId: null,
    dept: null,
    isGlobalSuperAdmin: false,
    depts: [],
    visibleSources: EMPTY_VISIBLE_SOURCES,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      // apiFetch returns the PARSED body on success and throws an Error
      // (with `.status`) on non-2xx. 2026-05-20 fix: the original code
      // treated the return as a Response object (`.ok` / `.status` / `.json()`)
      // which silently failed for every user — the hook ALWAYS landed in
      // the catch branch, so the super-admin chip never rendered and
      // visibleSources stayed at the empty default.
      const data = await apiFetch('/dept-scope/current');
      setState({
        deptId: data?.deptId || null,
        dept: data?.dept || null,
        isGlobalSuperAdmin: data?.isGlobalSuperAdmin === true,
        depts: Array.isArray(data?.depts) ? data.depts : [],
        visibleSources: (data?.visibleSources && typeof data.visibleSources === 'object')
          ? { ...EMPTY_VISIBLE_SOURCES, ...data.visibleSources }
          : EMPTY_VISIBLE_SOURCES,
        loading: false,
        error: null,
      });
    } catch (err) {
      // 401 during initial paint is fine — leave the hook in loading state
      // until auth lands. Don't surface as an error.
      if (err?.status === 401) {
        setState(s => ({ ...s, loading: false }));
        return;
      }
      console.warn('[useCurrentDept] load failed:', err?.message);
      setState(s => ({ ...s, loading: false, error: err?.message || 'load failed' }));
    }
  }, []);

  const setDept = useCallback(async (deptId) => {
    try {
      // apiFetch throws on non-2xx, so a successful call means the cookie
      // is set and we can reload immediately.
      await apiFetch('/dept-scope/current', {
        method: 'POST',
        body: JSON.stringify({ deptId: deptId || null }),
      });
      // Invalidate every dept-scoped FE cache so the post-reload paint
      // is a clean slate. See KEEP_* lists above for what survives.
      clearDeptScopedCachesForReload();
      try { await idbClear(); } catch { /* IDB unavailable — proceed */ }
      window.location.reload();
    } catch (err) {
      console.warn('[useCurrentDept] setDept failed:', err?.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, refresh: load, setDept };
}
