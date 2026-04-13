// ── useJiraData hook ─────────────────────────────────────────────────────────
// Fetches Jira issues relevant to the ops hub (HR escalations, open tasks).
// Falls back gracefully if the integration is not configured.
import { useState, useEffect, useCallback, useRef } from 'react';
import { searchJiraIssues, fetchJiraProjects } from '../services/integrationsApi';

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export function useJiraData(enabled = true, { jql } = {}) {
  const [issues, setIssues] = useState(null);
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetch = useRef(0);

  const defaultJql = jql || 'project = HROP AND status != Done ORDER BY updated DESC';

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (Date.now() - lastFetch.current < CACHE_TTL) return;

    setLoading(true);
    setError(null);
    try {
      const [issueRes, projRes] = await Promise.allSettled([
        searchJiraIssues(defaultJql, { maxResults: 100 }),
        fetchJiraProjects({ maxResults: 50 }),
      ]);

      if (issueRes.status === 'fulfilled') setIssues(issueRes.value?.issues || []);
      if (projRes.status === 'fulfilled') setProjects(projRes.value?.values || projRes.value);

      lastFetch.current = Date.now();
    } catch (err) {
      console.warn('[useJiraData] Failed:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, defaultJql]);

  useEffect(() => { refresh(); }, [refresh]);

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
    loading, error, refresh, searchIssues,
    isAvailable: !!issues,
  };
}
