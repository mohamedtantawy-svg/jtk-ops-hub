// ── useCurrentDept (Phase 11a — 2026-05-20) ────────────────────────────────
// Resolves the FE's current dept context. Returns:
//   • deptId / dept — what every isolated query filters by
//   • isGlobalSuperAdmin — true only for mohamed.tantawy@deel.com
//   • depts — list of pickable top-level depts (super-admin only)
//   • setDept(id|null) — super-admin switches dept; reloads the page so
//     every cached scoped query refreshes against the new boundary.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

export function useCurrentDept() {
  const [state, setState] = useState({
    deptId: null,
    dept: null,
    isGlobalSuperAdmin: false,
    depts: [],
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
