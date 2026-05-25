// ── useWorkProjects (Phase 3, 2026-05-25) ──────────────────────────────────
// Tiny SWR-style hook over the work_projects API. Used by the Tasks tab's
// project filter pill + the composer's project dropdown. Cached locally so
// the composer opens instantly while a background refresh runs.

import { useCallback, useEffect, useState } from 'react';
import {
  listWorkProjects,
  createWorkProject,
  patchWorkProject,
  archiveWorkProject,
} from '../services/workTasksApi';

const CACHE_KEY_BASE = 'ops_hub_work_projects_cache';
function cacheKeyFor(email) {
  const lc = String(email || '').toLowerCase();
  return lc ? `${CACHE_KEY_BASE}:${lc}` : CACHE_KEY_BASE;
}
function readCache(email) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(email));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(email, projects) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKeyFor(email), JSON.stringify({ projects, ts: Date.now() }));
  } catch {}
}

export function useWorkProjects(userEmail, { includeArchived = false } = {}) {
  const cached = readCache(userEmail);
  const [projects, setProjects] = useState(() => cached?.projects || []);
  const [loading, setLoading] = useState(() => !cached?.projects?.length);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWorkProjects({ includeArchived });
      const fresh = Array.isArray(res?.projects) ? res.projects : [];
      setProjects(fresh);
      setError(null);
      writeCache(userEmail, fresh);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [userEmail, includeArchived]);

  useEffect(() => {
    if (!userEmail) {
      setProjects([]); setLoading(false);
      return;
    }
    reload();
  }, [userEmail, reload]);

  const create = useCallback(async (payload) => {
    const res = await createWorkProject(payload);
    await reload();
    return res?.project || null;
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const res = await patchWorkProject(id, patch);
    await reload();
    return res?.project || null;
  }, [reload]);

  const archive = useCallback(async (id) => {
    await archiveWorkProject(id);
    await reload();
  }, [reload]);

  return { projects, loading, error, reload, create, update, archive };
}
