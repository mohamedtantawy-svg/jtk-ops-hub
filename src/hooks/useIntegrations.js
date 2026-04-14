// ── useIntegrations hook ─────────────────────────────────────────────────────
// Fetches integration status on mount and provides helper methods for
// checking whether a specific integration is available.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchIntegrationStatus } from '../services/integrationsApi';

const CACHE_KEY = 'ops_hub_integration_status';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useIntegrations() {
  const [status, setStatus] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) return data;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(!status);
  const [error, setError] = useState(null);
  const fetched = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchIntegrationStatus();
      const data = res.integrations || res;
      setStatus(data);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch (err) {
      console.warn('[useIntegrations] Failed to fetch status:', err.message);
      setError(err.message);
      // Set all as unconfigured on error
      setStatus({
        deel: { configured: false, label: 'Deel Admin' },
        jira: { configured: false, label: 'Jira' },
        slack: { configured: false, label: 'Slack' },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      refresh();
    }
  }, [refresh]);

  const isConfigured = useCallback(
    (key) => status?.[key]?.configured ?? false,
    [status],
  );

  return { status, loading, error, refresh, isConfigured };
}
