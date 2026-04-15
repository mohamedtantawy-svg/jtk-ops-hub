// ── useQueueSync hook ───────────────────────────────────────────────────────
// Per-source independent sync: Zendesk and Jira fetch on their own intervals,
// with their own caches, and their own error states. One failing doesn't
// block the other. Results are merged client-side.
//
// Architecture:
// - Each source syncs independently at its own rate
// - Zendesk: every 2 minutes (tickets change frequently)
// - Jira: every 3 minutes (issues change less often)
// - localStorage caches per source for instant loads
// - Local state (snooze, notes) preserved across syncs
// - Tickets that disappear from sync = resolved in source system
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchQueueBySource, fetchQueue } from '../services/integrationsApi';
import { MEMBERS } from '../data/members';

// ── Per-source sync config ──────────────────────────────────────────────────
const SOURCE_CONFIG = {
  zendesk: { interval: 2 * 60 * 1000, cacheKey: 'ops_hub_queue_zendesk', cacheTtl: 2 * 60 * 1000, delay: 100 },
  jira:    { interval: 3 * 60 * 1000, cacheKey: 'ops_hub_queue_jira',    cacheTtl: 3 * 60 * 1000, delay: 800 },
};

// ── Normalize a queue item from the backend into the frontend task shape ─────
function normalizeQueueItem(item) {
  const createdAt = item.createdAt ? new Date(item.createdAt) : null;
  const updatedAt = item.updatedAt ? new Date(item.updatedAt) : null;
  const now = Date.now();

  const minutesAgo = createdAt
    ? Math.max(0, Math.round((now - createdAt.getTime()) / 60000))
    : 0;
  const updatedMinsAgo = updatedAt
    ? Math.max(0, Math.round((now - updatedAt.getTime()) / 60000))
    : minutesAgo;

  const lastResponseAt = item.lastCustomerResponseAt ? new Date(item.lastCustomerResponseAt) : null;
  const minutesSinceLastResponse = lastResponseAt
    ? Math.max(0, Math.round((now - lastResponseAt.getTime()) / 60000))
    : updatedMinsAgo;

  const receivedAt = createdAt
    ? createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  const member = item.assigneeEmail
    ? MEMBERS.find(m => m.email === item.assigneeEmail)
    : null;

  return {
    id: item.id,
    _beId: null,
    _externalId: item.externalId,
    source: item.source || 'zendesk',
    subject: item.subject || '',
    body: item.description || '',
    assigneeId: member ? member.id : null,
    assigneeEmail: item.assigneeEmail || null,
    assigneeName: item.assigneeName || (member ? member.name : null),
    country: item.country || '',
    minutesAgo,
    updatedMinsAgo,
    minutesSinceLastResponse,
    lastCustomerResponseAt: item.lastCustomerResponseAt || null,
    receivedAt,
    status: item.status || 'new',
    type: item.type || 'Policy Query',
    priority: item.priority || 'medium',
    isAlert: item.priority === 'critical',
    requesterName: item.requesterName || 'Unknown',
    requesterEmail: item.requesterEmail || null,
    linkedTickets: [],
    externalUrl: item.externalUrl || '',
    tags: item.tags || [],
    aiSummary: '',
    suggestedReply: '',
    snoozedUntil: null,
    snoozeLabel: null,
    prevStatus: null,
  };
}

// ── Read cached items for a source from localStorage ────────────────────────
function readSourceCache(source) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  try {
    const raw = localStorage.getItem(cfg.cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ts && Date.now() - parsed.ts < cfg.cacheTtl * 2) return parsed; // 2x TTL for stale-while-revalidate
    }
  } catch {}
  return null;
}

function writeSourceCache(source, items, meta) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return;
  try {
    localStorage.setItem(cfg.cacheKey, JSON.stringify({ items, meta, ts: Date.now() }));
  } catch {}
}

// ── Merge synced tasks with current state (preserve snooze, local edits) ────
function mergeSourceResults(current, synced, source) {
  const currentMap = new Map();
  for (const t of current) {
    if (t.source === source) currentMap.set(t.id, t);
  }

  const result = [];
  const seen = new Set();

  for (const syncTask of synced) {
    seen.add(syncTask.id);
    const existing = currentMap.get(syncTask.id);

    if (existing) {
      result.push({
        ...syncTask,
        snoozedUntil: existing.snoozedUntil,
        snoozeLabel: existing.snoozeLabel,
        prevStatus: existing.prevStatus,
        status: existing.snoozedUntil && existing.status === 'waiting'
          ? 'waiting'
          : syncTask.status,
      });
    } else {
      result.push(syncTask);
    }
  }

  // Mark disappeared tickets as resolved
  for (const [id, existing] of currentMap) {
    if (!seen.has(id) && existing.status !== 'resolved' && existing.source !== 'manual') {
      result.push({ ...existing, status: 'resolved' });
    }
  }

  return result;
}

// ── Hook: per-source independent sync ───────────────────────────────────────
function useSourceSync(source, enabled) {
  const cfg = SOURCE_CONFIG[source];
  const cached = readSourceCache(source);

  const [items, setItems] = useState(() => {
    if (cached?.items) return cached.items.map(normalizeQueueItem);
    return [];
  });
  const [meta, setMeta] = useState(cached?.meta || null);
  const [loading, setLoading] = useState(!cached && enabled);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(cached?.ts ? new Date(cached.ts).toISOString() : null);
  const syncCount = useRef(0);
  const intervalRef = useRef(null);

  const sync = useCallback(async (opts = {}) => {
    if (!enabled) return;

    try {
      const res = await fetchQueueBySource(source, opts);
      const synced = (res?.items || []).map(normalizeQueueItem);

      setItems(prev => {
        if (prev.length === 0 && syncCount.current === 0) return synced;
        return mergeSourceResults([...prev], synced, source);
      });

      setMeta(res?.meta || null);
      setLastSync(new Date().toISOString());
      setError(null);
      syncCount.current += 1;
      writeSourceCache(source, res?.items || [], res?.meta || null);
    } catch (err) {
      console.warn(`[useQueueSync/${source}] Sync failed:`, err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, source]);

  // Initial fetch (staggered by source delay)
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    // Skip initial fetch if cache is still fresh
    if (cached?.ts && Date.now() - cached.ts < cfg.cacheTtl) {
      setLoading(false);
      // Schedule next sync at expiry time
      const remainingTtl = cfg.cacheTtl - (Date.now() - cached.ts);
      const timer = setTimeout(sync, remainingTtl);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(sync, cfg.delay);
    return () => clearTimeout(timer);
  }, [sync, enabled]);

  // Auto-sync interval
  useEffect(() => {
    if (!enabled) return;
    intervalRef.current = setInterval(sync, cfg.interval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [sync, enabled]);

  const refresh = useCallback(() => {
    setLoading(true);
    return sync({ bustCache: true });
  }, [sync]);

  return { items, meta, loading, error, lastSync, refresh, source };
}

// ── Main hook: combines all sources ─────────────────────────────────────────
export function useQueueSync(enabled = true) {
  const zendesk = useSourceSync('zendesk', enabled);
  const jira = useSourceSync('jira', enabled);

  // Merge items from all sources, deduplicated
  const tasks = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const item of [...zendesk.items, ...jira.items]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [zendesk.items, jira.items]);

  const [localOverrides, setLocalOverrides] = useState([]);

  // Expose setTasks that applies local overrides on top of synced data
  const setTasks = useCallback((updater) => {
    setLocalOverrides(prev => {
      const next = typeof updater === 'function' ? updater(prev.length ? prev : tasks) : updater;
      return next;
    });
  }, [tasks]);

  const effectiveTasks = localOverrides.length > 0 ? localOverrides : tasks;

  // Combined meta
  const meta = useMemo(() => ({
    zendesk: { count: zendesk.meta?.count || 0, status: zendesk.meta?.status || 'unknown', error: zendesk.error },
    jira:    { count: jira.meta?.count || 0,    status: jira.meta?.status || 'unknown',    error: jira.error },
    syncedAt: zendesk.lastSync && jira.lastSync
      ? (zendesk.lastSync > jira.lastSync ? zendesk.lastSync : jira.lastSync)
      : (zendesk.lastSync || jira.lastSync),
    totalActive: effectiveTasks.filter(i => i.status !== 'resolved').length,
    totalResolved: effectiveTasks.filter(i => i.status === 'resolved').length,
  }), [zendesk.meta, jira.meta, zendesk.error, jira.error, zendesk.lastSync, jira.lastSync, effectiveTasks]);

  // Loading = both loading on first load
  const loading = (zendesk.loading && zendesk.items.length === 0) ||
                  (jira.loading && jira.items.length === 0);

  // Error = only if BOTH sources error (one working = we still show data)
  const error = zendesk.error && jira.error
    ? `Zendesk: ${zendesk.error}; Jira: ${jira.error}`
    : null;

  const lastSync = meta.syncedAt;

  const refresh = useCallback(() => {
    zendesk.refresh();
    jira.refresh();
  }, [zendesk.refresh, jira.refresh]);

  return {
    tasks: effectiveTasks,
    setTasks,
    meta,
    loading,
    error,
    lastSync,
    refresh,
    isLive: !!(zendesk.lastSync || jira.lastSync) && !error,
    // Expose per-source status for UI indicators
    sources: {
      zendesk: { loading: zendesk.loading, error: zendesk.error, lastSync: zendesk.lastSync, count: zendesk.items.length },
      jira:    { loading: jira.loading,    error: jira.error,    lastSync: jira.lastSync,    count: jira.items.length },
    },
  };
}
