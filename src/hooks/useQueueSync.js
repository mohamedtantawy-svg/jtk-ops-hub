// ── useQueueSync hook ───────────────────────────────────────────────────────
// Per-source independent sync: Zendesk and Jira fetch on their own intervals,
// with their own caches, and their own error states. One failing doesn't
// block the other. Results are merged into a single tasks state.
//
// Architecture:
// - Each source syncs independently at its own rate
// - Zendesk: every 2 minutes, Jira: every 3 minutes
// - IndexedDB caches per source (per-user) for instant first paint
// - Concurrent refresh() calls are de-duped via an in-flight Promise ref
// - Cross-tab adoption: when another tab syncs, we pick up the broadcast
//   payload and skip our own network round-trip
// - Single combined tasks state — App.jsx can mutate via setTasks
//
// Read-only Q model: there are no in-app mutations to preserve, so the
// merge takes server data verbatim. Locally-created tasks (manual entries
// from the top-nav Create flow) are kept until the source confirms them.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchQueueBySource } from '../services/integrationsApi';
import { MEMBERS } from '../data/members';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { idbGet, idbSet } from '../lib/idb-cache';
import { useCurrentDeptId } from '../lib/current-dept-storage';

// ── Per-source sync config ──────────────────────────────────────────────────
// Cache keys are user + dept scoped via cacheKeyFor() so two signed-in users
// (or two dept-scopes for the same super-admin) on the same browser never
// inherit each other's payload. Phase 11+ instant-switch (2026-05-21):
// switching dept now swaps cache namespaces instead of wiping + reloading.
const SOURCE_CONFIG = {
  zendesk: { interval: 2 * 60 * 1000, cacheKey: 'ops_hub_queue_zendesk', cacheTtl: 2 * 60 * 1000 },
  jira:    { interval: 3 * 60 * 1000, cacheKey: 'ops_hub_queue_jira',    cacheTtl: 3 * 60 * 1000 },
};

function cacheKeyFor(source, userEmail, deptId) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  const lc = (userEmail || '').toLowerCase();
  const u = lc ? `:${lc}` : '';
  const d = deptId ? `:${deptId}` : ':no-dept';
  return `${cfg.cacheKey}${u}${d}`;
}

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
    slaMinsOverride: Number.isFinite(item.slaMinsOverride) ? item.slaMinsOverride : null,
    // SLA fields stamped by the queue route's policy-cache enrichment +
    // metric_set detection (FRT / NRT / RWT / PUT). 2026-05-19 — these
    // were missing from the normalised shape, so `slaInfo`'s strict-
    // equality `task.slaMetric === null` check failed on undefined,
    // fell through to the legacy biz-day fallback, and produced
    // false-positive multi-month breach pills on caught-up tickets
    // (anchor = lastCustomerResponseAt = ticket creation date).
    // Passing them through verbatim restores the route's intent.
    slaMetric: item.slaMetric ?? null,
    slaSource: item.slaSource || null,
    slaBreachAt: item.slaBreachAt || null,
    slaFrtBreachAt: item.slaFrtBreachAt || null,
    slaFrtMinutes: Number.isFinite(item.slaFrtMinutes) ? item.slaFrtMinutes : null,
    slaNrtBreachAt: item.slaNrtBreachAt || null,
    slaNrtMinutes: Number.isFinite(item.slaNrtMinutes) ? item.slaNrtMinutes : null,
    slaRwtBreachAt: item.slaRwtBreachAt || null,
    slaRwtMinutes: Number.isFinite(item.slaRwtMinutes) ? item.slaRwtMinutes : null,
    slaPutBreachAt: item.slaPutBreachAt || null,
    slaPutMinutes: Number.isFinite(item.slaPutMinutes) ? item.slaPutMinutes : null,
    pausedAt: item.pausedAt || null,
    secondaryAssigneeEmails: Array.isArray(item.secondaryAssigneeEmails)
      ? item.secondaryAssigneeEmails.map(e => (e || '').toLowerCase()).filter(Boolean)
      : [],
    receivedAt,
    status: item.status || 'new',
    zdStatus: item.zdStatus || null,
    // Raw Jira status name (e.g. "HRX Review", "Client Approval", "PRM
    // Review", "EOR Signing"). The bucket on `status` flattens these to
    // new/in_progress/waiting/resolved for tier-based scoping; the raw
    // name is surfaced as a sub-status in the queue's StatusBadge so
    // managers can tell apart "PRM sent the final payslip" from
    // "still waiting on legal" without opening every ticket.
    jiraStatus: item.jiraStatus || null,
    type: item.type || 'Policy Query',
    priority: item.priority || 'medium',
    isAlert: item.priority === 'critical',
    requesterName: item.requesterName || 'Unknown',
    requesterEmail: item.requesterEmail || null,
    externalUrl: item.externalUrl || '',
    tags: item.tags || [],
  };
}

// ── Read/write per-source IndexedDB cache ───────────────────────────────────
// IDB (~50% of free disk space) instead of localStorage (5–10 MB cap that
// used to overflow on heavy Jira queues). One-time migration from the LS
// keys still happens on first read.
async function readSourceCache(source, userEmail, deptId) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  const key = cacheKeyFor(source, userEmail, deptId);
  try {
    const idbHit = await idbGet(key);
    if (idbHit?.items) return idbHit;
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.items) {
          await idbSet(key, parsed);
          try { localStorage.removeItem(key); } catch {}
          return parsed;
        }
      }
    }
  } catch {}
  return null;
}

// Drop large fields not needed to restore the queue view on reload.
const CACHE_STRIP_FIELDS = ['body'];

function slimForCache(items) {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    const slim = { ...item };
    for (const f of CACHE_STRIP_FIELDS) delete slim[f];
    return slim;
  });
}

async function writeSourceCache(source, items, meta, userEmail, deptId) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return;
  const key = cacheKeyFor(source, userEmail, deptId);
  const slim = slimForCache(items);
  await idbSet(key, { items: slim, meta, ts: Date.now() });
}

// ── Merge synced items into the combined tasks list ─────────────────────────
// Read-only model: take server values verbatim. Tasks that disappear from a
// source are auto-resolved unless they're locally-created (manual top-nav
// entries that the source doesn't know about).
function mergeSourceIntoTasks(currentTasks, syncedItems, source) {
  const syncMap = new Map();
  for (const item of syncedItems) syncMap.set(item.id, item);

  const result = [];
  const seen = new Set();

  for (const task of currentTasks) {
    if (task.source === source && syncMap.has(task.id)) {
      const synced = syncMap.get(task.id);
      seen.add(task.id);
      result.push(synced);
    } else if (task.source === source && !syncMap.has(task.id)) {
      if (task._locallyCreated) {
        result.push(task);
      } else if (task.status !== 'resolved') {
        result.push({ ...task, status: 'resolved' });
      }
      seen.add(task.id);
    } else {
      result.push(task);
    }
  }

  for (const [id, item] of syncMap) {
    if (!seen.has(id)) result.push(item);
  }

  return result;
}

// ── Async cache load — reads every source from IDB and assembles the list. ─
async function loadCachedTasksAsync(userEmail, deptId) {
  const all = [];
  const seen = new Set();
  const meta = {};
  for (const source of Object.keys(SOURCE_CONFIG)) {
    const cached = await readSourceCache(source, userEmail, deptId);
    if (cached?.items?.length) {
      for (const item of cached.items) {
        const normalized = normalizeQueueItem(item);
        if (!seen.has(normalized.id)) {
          seen.add(normalized.id);
          all.push(normalized);
        }
      }
    }
    if (cached?.meta) meta[source] = cached.meta;
    if (cached?.ts) meta[`${source}_ts`] = cached.ts;
  }
  return { tasks: all, meta };
}

// ── Hook ────────────────────────────────────────────────────────────────────
export function useQueueSync(arg = true) {
  const { enabled, userEmail } = typeof arg === 'object' && arg !== null
    ? { enabled: arg.enabled ?? true, userEmail: arg.userEmail || null }
    : { enabled: !!arg, userEmail: null };

  const [tasks, setTasks] = useState([]);
  const [sourceMeta, setSourceMeta] = useState({});
  const [sourceErrors, setSourceErrors] = useState({});
  const [sourceLastSync, setSourceLastSync] = useState({});
  const [sourceLoading, setSourceLoading] = useState({ zendesk: true, jira: true });
  const [sourceRefreshing, setSourceRefreshing] = useState({ zendesk: false, jira: false });
  const syncCounts = useRef({ zendesk: 0, jira: 0 });
  const intervalRefs = useRef({});
  const inFlightRefs = useRef({ zendesk: null, jira: null });
  const abortControllersRef = useRef({ zendesk: null, jira: null });
  const mountedRef = useRef(true);
  const lastFetchTsRefs = useRef({ zendesk: 0, jira: 0 });
  const firstSyncDoneRef = useRef({ zendesk: false, jira: false });
  const userEmailRef = useRef(userEmail);
  useEffect(() => { userEmailRef.current = userEmail; }, [userEmail]);

  // Phase 11+ instant-switch (2026-05-21): current dept-id flows into the
  // cache key + broadcast filter. Ref mirror keeps syncSource's callback
  // identity stable across dept changes — the live ref is read inside the
  // callback so the new dept's namespace gets written + broadcast.
  const currentDeptId = useCurrentDeptId();
  const currentDeptIdRef = useRef(currentDeptId);
  useEffect(() => { currentDeptIdRef.current = currentDeptId; }, [currentDeptId]);

  // ── IDB cache hydration ────────────────────────────────────────────────
  // Reads the per-source cache from IndexedDB on mount + on every dept
  // change. Skipped per-source when a sync has already filled that source —
  // never overwrite fresh server data with stale cache. On dept switch
  // we reset firstSyncDoneRef so the new dept's cache hydrates rather
  // than being treated as already-served by the previous dept's payload.
  useEffect(() => {
    let cancelled = false;
    // Dept just switched: clear the per-source "already synced" flags and
    // last-fetch timestamps so the new dept's cache + sync take effect.
    firstSyncDoneRef.current = { zendesk: false, jira: false };
    lastFetchTsRefs.current = { zendesk: 0, jira: 0 };
    inFlightRefs.current = { zendesk: null, jira: null };
    setTasks([]);
    setSourceLoading({ zendesk: true, jira: true });
    (async () => {
      const { tasks: cachedTasks, meta: cachedMeta } = await loadCachedTasksAsync(userEmail, currentDeptId);
      if (cancelled || !mountedRef.current) return;
      if (cachedTasks.length === 0) return;

      const filteredTasks = cachedTasks.filter(t => !firstSyncDoneRef.current[t.source]);
      if (filteredTasks.length === 0) return;

      setTasks(prev => {
        const byId = new Map();
        for (const t of prev) byId.set(t.id, t);
        for (const t of filteredTasks) if (!byId.has(t.id)) byId.set(t.id, t);
        return [...byId.values()];
      });

      setSourceMeta(prev => {
        const next = { ...prev };
        if (!firstSyncDoneRef.current.zendesk && cachedMeta.zendesk) next.zendesk = cachedMeta.zendesk;
        if (!firstSyncDoneRef.current.jira && cachedMeta.jira) next.jira = cachedMeta.jira;
        return next;
      });
      setSourceLastSync(prev => {
        const next = { ...prev };
        if (!firstSyncDoneRef.current.zendesk && cachedMeta.zendesk_ts) next.zendesk = new Date(cachedMeta.zendesk_ts).toISOString();
        if (!firstSyncDoneRef.current.jira && cachedMeta.jira_ts) next.jira = new Date(cachedMeta.jira_ts).toISOString();
        return next;
      });
      setSourceLoading(prev => {
        const next = { ...prev };
        if (filteredTasks.some(t => t.source === 'zendesk')) next.zendesk = false;
        if (filteredTasks.some(t => t.source === 'jira')) next.jira = false;
        return next;
      });
      if (!firstSyncDoneRef.current.zendesk && cachedMeta.zendesk_ts) {
        lastFetchTsRefs.current.zendesk = cachedMeta.zendesk_ts;
      }
      if (!firstSyncDoneRef.current.jira && cachedMeta.jira_ts) {
        lastFetchTsRefs.current.jira = cachedMeta.jira_ts;
      }
    })();
    return () => { cancelled = true; };
  }, [userEmail, currentDeptId]);

  // Per-source sync function (with in-flight dedup).
  const syncSource = useCallback(async (source, opts = {}) => {
    if (!enabled) return null;
    // opts.force=true bypasses the in-flight guard so Force resync can
    // recover from a hung Promise instead of attaching to it. Mirrors the
    // per-Deel-hook fix from PR #341 — Zendesk / Jira were missed there.
    // The old in-flight Promise keeps running until apiFetch's 90s timeout
    // resolves it; we just don't attach to it.
    if (!opts.force && inFlightRefs.current[source]) return inFlightRefs.current[source];

    if (abortControllersRef.current[source]) {
      try { abortControllersRef.current[source].abort(); } catch {}
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortControllersRef.current[source] = controller;

    setSourceRefreshing(prev => ({ ...prev, [source]: true }));

    const run = (async () => {
      try {
        const res = await fetchQueueBySource(source, {
          ...opts,
          signal: controller?.signal,
        });
        const rawItems = res?.items || [];
        const synced = rawItems.map(normalizeQueueItem);
        const now = Date.now();

        if (!mountedRef.current) return null;

        setTasks(prev => {
          // Guard: empty response with cached rows present → keep existing.
          if (synced.length === 0 && prev.some(t => t.source === source)) {
            return prev;
          }
          if (syncCounts.current[source] === 0 && prev.filter(t => t.source === source).length === 0) {
            const otherTasks = prev.filter(t => t.source !== source);
            return [...otherTasks, ...synced];
          }
          return mergeSourceIntoTasks(prev, synced, source);
        });

        const meta = res?.meta || null;
        setSourceMeta(prev => ({ ...prev, [source]: meta }));
        setSourceErrors(prev => ({ ...prev, [source]: null }));
        setSourceLastSync(prev => ({ ...prev, [source]: new Date(now).toISOString() }));
        syncCounts.current[source] = (syncCounts.current[source] || 0) + 1;
        lastFetchTsRefs.current[source] = now;
        firstSyncDoneRef.current[source] = true;

        // Persist + broadcast (fire-and-forget). Both keys (user + dept)
        // are read from refs so a dept switch mid-sync writes to the new
        // dept's namespace, not the stale closure.
        writeSourceCache(source, rawItems, meta, userEmailRef.current, currentDeptIdRef.current).catch(() => {});
        if (rawItems.length > 0) {
          broadcastSync(source, rawItems, meta, userEmailRef.current, currentDeptIdRef.current);
        }
        return synced;
      } catch (err) {
        if (err?.name === 'AbortError') return null;
        if (!mountedRef.current) return null;
        console.warn(`[useQueueSync/${source}] Sync failed:`, err.message);
        setSourceErrors(prev => ({ ...prev, [source]: err.message }));
        return null;
      } finally {
        if (mountedRef.current) {
          setSourceLoading(prev => ({ ...prev, [source]: false }));
          setSourceRefreshing(prev => ({ ...prev, [source]: false }));
        }
        inFlightRefs.current[source] = null;
        if (abortControllersRef.current[source] === controller) {
          abortControllersRef.current[source] = null;
        }
      }
    })();

    inFlightRefs.current[source] = run;
    return run;
  }, [enabled]);

  // Initial fetch — fire both sources in parallel immediately.
  useEffect(() => {
    if (!enabled) {
      setSourceLoading({ zendesk: false, jira: false });
      return;
    }

    const kick = () => {
      for (const [source, cfg] of Object.entries(SOURCE_CONFIG)) {
        const ts = lastFetchTsRefs.current[source];
        if (ts && Date.now() - ts < cfg.cacheTtl) {
          setSourceLoading(prev => ({ ...prev, [source]: false }));
        } else {
          syncSource(source);
        }
      }
    };
    kick();
  }, [syncSource, enabled]);

  // Per-source auto-sync intervals.
  useEffect(() => {
    if (!enabled) return;

    for (const [source, cfg] of Object.entries(SOURCE_CONFIG)) {
      intervalRefs.current[source] = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        syncSource(source);
      }, cfg.interval);
    }

    return () => {
      for (const ref of Object.values(intervalRefs.current)) {
        if (ref) clearInterval(ref);
      }
    };
  }, [syncSource, enabled]);

  // Unmount cleanup — abort any live fetches.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const key of Object.keys(abortControllersRef.current)) {
        const ctrl = abortControllersRef.current[key];
        if (ctrl) { try { ctrl.abort(); } catch {} }
        abortControllersRef.current[key] = null;
      }
    };
  }, []);

  // Visibility-resume — opportunistically refresh stale sources on focus.
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const handler = () => {
      if (document.hidden) return;
      for (const [source, cfg] of Object.entries(SOURCE_CONFIG)) {
        const ts = lastFetchTsRefs.current[source];
        if (!ts || Date.now() - ts >= cfg.cacheTtl) syncSource(source);
      }
    };
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }, [syncSource, enabled]);

  // Cross-tab adoption — user + dept scoped so multiple users (or
  // multiple dept-scopes for the same super-admin) on one machine never
  // cross-pollinate caches.
  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || !msg.source) return;
      if (msg.source !== 'zendesk' && msg.source !== 'jira') return;
      const myEmail = (userEmailRef.current || '').toLowerCase();
      const theirEmail = (msg.userKey || '').toLowerCase();
      if ((myEmail || theirEmail) && myEmail !== theirEmail) return;
      const myDept = currentDeptIdRef.current || '';
      const theirDept = msg.deptKey || '';
      if ((myDept || theirDept) && myDept !== theirDept) return;
      if (!msg.ts || msg.ts <= (lastFetchTsRefs.current[msg.source] || 0)) return;

      const items = msg.items || [];
      if (items.length === 0) return;

      const synced = items.map(normalizeQueueItem);
      setTasks(prev => {
        if (syncCounts.current[msg.source] === 0 && prev.filter(t => t.source === msg.source).length === 0) {
          const other = prev.filter(t => t.source !== msg.source);
          return [...other, ...synced];
        }
        return mergeSourceIntoTasks(prev, synced, msg.source);
      });
      setSourceMeta(prev => ({ ...prev, [msg.source]: msg.meta || prev[msg.source] || null }));
      setSourceErrors(prev => ({ ...prev, [msg.source]: null }));
      setSourceLastSync(prev => ({ ...prev, [msg.source]: new Date(msg.ts).toISOString() }));
      setSourceLoading(prev => ({ ...prev, [msg.source]: false }));
      lastFetchTsRefs.current[msg.source] = msg.ts;
      syncCounts.current[msg.source] = (syncCounts.current[msg.source] || 0) + 1;
      firstSyncDoneRef.current[msg.source] = true;
      writeSourceCache(msg.source, items, msg.meta || null, userEmailRef.current, currentDeptIdRef.current).catch(() => {});
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, []);

  // Manual refresh (all sources) — bypasses in-flight so a hung sync can be
  // recovered via Force resync.
  const refresh = useCallback(() => {
    for (const source of Object.keys(SOURCE_CONFIG)) {
      syncSource(source, { bustCache: true, force: true });
    }
  }, [syncSource]);

  // Combined meta (preserved for callers that read .meta.syncedAt etc).
  // `truncated` flows through from the API per source so Queue.jsx can warn
  // when the listing is capped at the upstream safety limit (Zendesk Search
  // hard-caps at 1000 hits per query / Jira at MAX_ISSUES_PER_CLAUSE).
  const meta = useMemo(() => ({
    zendesk: {
      count: sourceMeta.zendesk?.count || 0,
      status: sourceMeta.zendesk?.status || 'unknown',
      error: sourceErrors.zendesk,
      truncated: !!sourceMeta.zendesk?.truncated,
      serverTotal: sourceMeta.zendesk?.serverTotal || null,
    },
    jira: {
      count: sourceMeta.jira?.count || 0,
      status: sourceMeta.jira?.status || 'unknown',
      error: sourceErrors.jira,
      truncated: !!sourceMeta.jira?.truncated,
    },
    syncedAt: sourceLastSync.zendesk && sourceLastSync.jira
      ? (sourceLastSync.zendesk > sourceLastSync.jira ? sourceLastSync.zendesk : sourceLastSync.jira)
      : (sourceLastSync.zendesk || sourceLastSync.jira),
    totalActive: tasks.filter(i => i.status !== 'resolved').length,
    totalResolved: tasks.filter(i => i.status === 'resolved').length,
  }), [sourceMeta, sourceErrors, sourceLastSync, tasks]);

  const loading = (sourceLoading.zendesk && tasks.filter(t => t.source === 'zendesk').length === 0) ||
                  (sourceLoading.jira && tasks.filter(t => t.source === 'jira').length === 0);

  const error = sourceErrors.zendesk && sourceErrors.jira
    ? `Zendesk: ${sourceErrors.zendesk}; Jira: ${sourceErrors.jira}`
    : null;

  const isRefreshing = sourceRefreshing.zendesk || sourceRefreshing.jira;
  const lastSync = meta.syncedAt;

  return {
    tasks,
    setTasks,
    meta,
    loading,
    isRefreshing,
    error,
    lastSync,
    refresh,
    isLive: !!(sourceLastSync.zendesk || sourceLastSync.jira) && !error,
    sources: {
      zendesk: {
        loading: sourceLoading.zendesk,
        isRefreshing: sourceRefreshing.zendesk,
        error: sourceErrors.zendesk,
        lastSync: sourceLastSync.zendesk,
        lastSyncAt: lastFetchTsRefs.current.zendesk || null,
        count: tasks.filter(t => t.source === 'zendesk').length,
        // `truncated` flips true when the backend's paginatedZendeskSearch
        // exited early at its safety cap with the server still indicating
        // more rows behind it. Surfacing this lets Queue.jsx warn the
        // viewer when the ticket listing is intentionally capped (Sarah
        // Suge 2026-05-11 feedback) so they aren't blind to hidden rows.
        truncated: !!sourceMeta.zendesk?.truncated,
        serverTotal: sourceMeta.zendesk?.serverTotal || null,
        retry: () => syncSource('zendesk', { bustCache: true, force: true }),
      },
      jira: {
        loading: sourceLoading.jira,
        isRefreshing: sourceRefreshing.jira,
        error: sourceErrors.jira,
        lastSync: sourceLastSync.jira,
        lastSyncAt: lastFetchTsRefs.current.jira || null,
        count: tasks.filter(t => t.source === 'jira').length,
        truncated: !!sourceMeta.jira?.truncated,
        retry: () => syncSource('jira', { bustCache: true, force: true }),
      },
    },
  };
}
