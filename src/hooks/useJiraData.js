// ── useJiraData hook ─────────────────────────────────────────────────────────
// Fetches Jira issues relevant to the ops hub (HR escalations, open tasks).
// Caches in localStorage. Staggered load to avoid mount stampede.
import { useState, useEffect, useCallback, useRef } from 'react';
import { searchJiraIssues, fetchJiraProjects } from '../services/integrationsApi';

const CACHE_TTL = 3 * 60 * 1000; // 3 minutes (up from 2)
const CACHE_KEY = 'ops_hub_jira_data';
const LOAD_DELAY = 1500; // defer slightly — queue sync goes first

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) return parsed;
    }
  } catch {}
  return null;
}

export function useJiraData(enabled = true, { jql } = {}) {
  const cached = readCache();
  const [issues, setIssues] = useState(cached?.issues || null);
  const [projects, setProjects] = useState(cached?.projects || null);
  const [loading, setLoading] = useState(!cached && enabled);
  const [error, setError] = useState(null);
  const lastFetch = useRef(cached ? cached.ts : 0);

  const defaultJql = jql || 'project IN (COHD, OSHD) AND status != Done ORDER BY updated DESC';

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const [issueRes, projRes] = await Promise.allSettled([
        searchJiraIssues(defaultJql, { maxResults: 100 }),
        fetchJiraProjects({ maxResults: 50 }),
      ]);

      const iData = issueRes.status === 'fulfilled' ? (issueRes.value?.issues || []) : issues;
      const pData = projRes.status === 'fulfilled' ? (projRes.value?.values || projRes.value) : projects;

      setIssues(iData);
      setProjects(pData);

      lastFetch.current = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ issues: iData, projects: pData, ts: Date.now() }));
      } catch {}
    } catch (err) {
      console.warn('[useJiraData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, defaultJql]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    if (lastFetch.current > 0 && Date.now() - lastFetch.current < CACHE_TTL) return;
    const timer = setTimeout(() => refresh(), LOAD_DELAY);
    return () => clearTimeout(timer);
  }, [refresh, enabled]);

  const searchIssues = useCallback(async (customJql) => {
    try {
      const res = await searchJiraIssues(customJql, { maxResults: 50 });
      return res?.issues || [];
    } catch {
      return [];
    }
  }, []);

  return {
    issues, projects,
    loading, error, refresh: () => refresh(true), searchIssues,
    isAvailable: !!issues,
  };
}
