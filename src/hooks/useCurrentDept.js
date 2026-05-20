// ── useCurrentDept (Phase 11a — 2026-05-20) ────────────────────────────────
// Resolves the FE's current dept context. Returns:
//   • deptId / dept — what every isolated query filters by
//   • isGlobalSuperAdmin — true only for mohamed.tantawy@deel.com
//   • depts — list of pickable top-level depts (super-admin only)
//   • setDept(id|null) — super-admin switches dept; reloads the page so
//     every cached scoped query refreshes against the new boundary.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

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
      const res = await apiFetch('/dept-scope/current');
      if (!res.ok) {
        // 401 during initial paint is fine — just leave the hook in loading
        // state until auth lands. Don't propagate as an error.
        if (res.status === 401) {
          setState(s => ({ ...s, loading: false }));
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setState({
        deptId: data.deptId || null,
        dept: data.dept || null,
        isGlobalSuperAdmin: data.isGlobalSuperAdmin === true,
        depts: Array.isArray(data.depts) ? data.depts : [],
        visibleSources: (data.visibleSources && typeof data.visibleSources === 'object')
          ? { ...EMPTY_VISIBLE_SOURCES, ...data.visibleSources }
          : EMPTY_VISIBLE_SOURCES,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.warn('[useCurrentDept] load failed:', err?.message);
      setState(s => ({ ...s, loading: false, error: err?.message || 'load failed' }));
    }
  }, []);

  const setDept = useCallback(async (deptId) => {
    try {
      const res = await apiFetch('/dept-scope/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deptId: deptId || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Full reload — simpler + safer than invalidating every scoped hook
      // by hand. The super-admin uses this maybe 1-2x per day.
      window.location.reload();
    } catch (err) {
      console.warn('[useCurrentDept] setDept failed:', err?.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, refresh: load, setDept };
}
