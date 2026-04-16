// ── useQueueSync hook ───────────────────────────────────────────────────────
// Per-source independent sync: Zendesk and Jira fetch on their own intervals,
// with their own caches, and their own error states. One failing doesn't
// block the other. Results are merged into a single tasks state.
//
// Architecture:
// - Each source syncs independently at its own rate
// - Zendesk: every 2 minutes (tickets change frequently)
// - Jira: every 3 minutes (issues change less often)
// - localStorage caches per source for instant loads
// - Single combined tasks state — App.jsx can mutate via setTasks
// - Local mutations (snooze, reassign) preserved across syncs
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchQueueBySource } from '../services/integrationsApi';
import { MEMBERS } from '../data/members';

// ── Per-source sync config ──────────────────────────────────────────────────
const SOURCE_CONFIG = {
  zendesk: { interval: 2 * 60 * 1000, cacheKey: 'ops_hub_queue_zendesk', cacheTtl: 2 * 60 * 1000, delay: 100 },
  jira:    { interval: 3 * 60 * 1000, cacheKey: 'ops_hub_queue_jira',    cacheTtl: 3 * 60 * 1000, delay: 800 },
};

// ── Normalize a queue item from the backend ─────────────────────────────────
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
    ? MEMBERS.find(m => m.email.toLowerCase() === item.assigneeEmail.toLowerCase())
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

// ── Read/write per-source localStorage cache ────────────────────────────────
function readSourceCache(source) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  try {
    const raw = localStorage.getItem(cfg.cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ts && Date.now() - parsed.ts < cfg.cacheTtl) return parsed;
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

// ── Merge source sync into combined tasks (preserves local mutations) ───────
function mergeSourceIntoTasks(currentTasks, syncedItems, source) {
  const syncMap = new Map();
  for (const item of syncedItems) syncMap.set(item.id, item);

  const result = [];
  const seen = new Set();

  // Update existing tasks from this source
  for (const task of currentTasks) {
    if (task.source === source && syncMap.has(task.id)) {
      // Synced task exists — update external data, preserve local state
      const synced = syncMap.get(task.id);
      seen.add(task.id);
      result.push({
        ...synced,
        // Preserve local mutations
        snoozedUntil: task.snoozedUntil,
        snoozeLabel: task.snoozeLabel,
        prevStatus: task.prevStatus,
        status: task.snoozedUntil && task.status === 'waiting' ? 'waiting' : synced.status,
      });
    } else if (task.source === source && !syncMap.has(task.id)) {
      // Task disappeared from source — mark as resolved (unless manual)
      if (task.status !== 'resolved' && task.source !== 'manual') {
        result.push({ ...task, status: 'resolved' });
      }
      seen.add(task.id);
    } else {
      // Task from a different source — keep as-is
      result.push(task);
    }
  }

  // Add new tasks from sync that we haven't seen
  for (const [id, item] of syncMap) {
    if (!seen.has(id)) result.push(item);
  }

  return result;
}

// ── Load initial tasks from all source caches ───────────────────────────────
function loadInitialTasks() {
  const all = [];
  const seen = new Set();
  for (const source of Object.keys(SOURCE_CONFIG)) {
    const cached = readSourceCache(source);
    if (cached?.items) {
      for (const item of cached.items) {
        const normalized = normalizeQueueItem(item);
        if (!seen.has(normalized.id)) {
          seen.add(normalized.id);
          all.push(normalized);
        }
      }
    }
  }
  return all;
}

// ── Hook ────────────────────────────────────────────────────────────────────
export function useQueueSync(enabled = true) {
  const [tasks, setTasks] = useState(loadInitialTasks);
  const [sourceMeta, setSourceMeta] = useState({});
  const [sourceErrors, setSourceErrors] = useState({});
  const [sourceLastSync, setSourceLastSync] = useState({});
  const [sourceLoading, setSourceLoading] = useState({ zendesk: true, jira: true });
  const syncCounts = useRef({ zendesk: 0, jira: 0 });
  const intervalRefs = useRef({});

  // Per-source sync function
  const syncSource = useCallback(async (source, opts = {}) => {
    if (!enabled) return;

    try {
      const res = await fetchQueueBySource(source, opts);
      const synced = (res?.items || []).map(normalizeQueueItem);

      setTasks(prev => {
        if (syncCounts.current[source] === 0 && prev.filter(t => t.source === source).length === 0) {
          // First sync for this source — just add the items
          const otherTasks = prev.filter(t => t.source !== source);
          return [...otherTasks, ...synced];
        }
        return mergeSourceIntoTasks(prev, synced, source);
      });

      setSourceMeta(prev => ({ ...prev, [source]: res?.meta || null }));
      setSourceErrors(prev => ({ ...prev, [source]: null }));
      setSourceLastSync(prev => ({ ...prev, [source]: new Date().toISOString() }));
      syncCounts.current[source] = (syncCounts.current[source] || 0) + 1;
      writeSourceCache(source, res?.items || [], res?.meta || null);
    } catch (err) {
      console.warn(`[useQueueSync/${source}] Sync failed:`, err.message);
      setSourceErrors(prev => ({ ...prev, [source]: err.message }));
    } finally {
      setSourceLoading(prev => ({ ...prev, [source]: false }));
    }
  }, [enabled]);

  // Initial fetch per source (staggered)
  useEffect(() => {
    if (!enabled) {
      setSourceLoading({ zendesk: false, jira: false });
      return;
    }

    const timers = [];
    for (const [source, cfg] of Object.entries(SOURCE_CONFIG)) {
      const cached = readSourceCache(source);
      // Skip if cache is still fresh
      if (cached?.ts && Date.now() - cached.ts < cfg.cacheTtl) {
        setSourceLoading(prev => ({ ...prev, [source]: false }));
        // Schedule sync at cache expiry
        const remaining = cfg.cacheTtl - (Date.now() - cached.ts);
        timers.push(setTimeout(() => syncSource(source), remaining));
      } else {
        // Fetch with staggered delay
        timers.push(setTimeout(() => syncSource(source), cfg.delay));
      }
    }

    return () => timers.forEach(t => clearTimeout(t));
  }, [syncSource, enabled]);

  // Per-source auto-sync intervals
  useEffect(() => {
    if (!enabled) return;

    for (const [source, cfg] of Object.entries(SOURCE_CONFIG)) {
      intervalRefs.current[source] = setInterval(() => syncSource(source), cfg.interval);
    }

    return () => {
      for (const ref of Object.values(intervalRefs.current)) {
        if (ref) clearInterval(ref);
      }
    };
  }, [syncSource, enabled]);

  // Manual refresh (all sources)
  const refresh = useCallback(() => {
    setSourceLoading({ zendesk: true, jira: true });
    for (const source of Object.keys(SOURCE_CONFIG)) {
      syncSource(source, { bustCache: true });
    }
  }, [syncSource]);

  // Combined meta
  const meta = useMemo(() => ({
    zendesk: { count: sourceMeta.zendesk?.count || 0, status: sourceMeta.zendesk?.status || 'unknown', error: sourceErrors.zendesk },
    jira:    { count: sourceMeta.jira?.count || 0,    status: sourceMeta.jira?.status || 'unknown',    error: sourceErrors.jira },
    syncedAt: sourceLastSync.zendesk && sourceLastSync.jira
      ? (sourceLastSync.zendesk > sourceLastSync.jira ? sourceLastSync.zendesk : sourceLastSync.jira)
      : (sourceLastSync.zendesk || sourceLastSync.jira),
    totalActive: tasks.filter(i => i.status !== 'resolved').length,
    totalResolved: tasks.filter(i => i.status === 'resolved').length,
  }), [sourceMeta, sourceErrors, sourceLastSync, tasks]);

  // Loading = any source loading on first load with no cached data
  const loading = (sourceLoading.zendesk && tasks.filter(t => t.source === 'zendesk').length === 0) ||
                  (sourceLoading.jira && tasks.filter(t => t.source === 'jira').length === 0);

  // Error = only if BOTH sources fail
  const error = sourceErrors.zendesk && sourceErrors.jira
    ? `Zendesk: ${sourceErrors.zendesk}; Jira: ${sourceErrors.jira}`
    : null;

  const lastSync = meta.syncedAt;

  return {
    tasks,
    setTasks,  // Direct state setter — App.jsx can mutate freely
    meta,
    loading,
    error,
    lastSync,
    refresh,
    isLive: !!(sourceLastSync.zendesk || sourceLastSync.jira) && !error,
    sources: {
      zendesk: { loading: sourceLoading.zendesk, error: sourceErrors.zendesk, lastSync: sourceLastSync.zendesk, count: tasks.filter(t => t.source === 'zendesk').length },
      jira:    { loading: sourceLoading.jira,    error: sourceErrors.jira,    lastSync: sourceLastSync.jira,    count: tasks.filter(t => t.source === 'jira').length },
    },
  };
}
