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
// - Concurrent refresh() calls are de-duped via an in-flight Promise ref
// - Cross-tab adoption: when another tab syncs, we pick up the broadcast
//   payload and skip our own network round-trip
// - Single combined tasks state — App.jsx can mutate via setTasks
// - Local mutations (snooze, reassign, resolve, created) are loaded from the
//   queueMutationStore so they survive page reload and are merged on top of
//   every sync within a bounded time window (LOCAL_MUTATION_WINDOW_MS) before
//   adopting the authoritative server value.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchQueueBySource } from '../services/integrationsApi';
import { MEMBERS } from '../data/members';
import { getQueueChannel, broadcastSync } from './queueSyncChannel';
import { loadMutations, applyMutationsToTasks, clearMutation, clearCreatedTask } from '../services/queueMutationStore';
import { idbGet, idbSet, idbDelete } from '../lib/idb-cache';

// How long a local mutation (reassign / resolve) wins over a diverging server
// value. After this window, the server wins so external changes become visible.
const LOCAL_MUTATION_WINDOW_MS = 5 * 60 * 1000;

// ── Per-source sync config ──────────────────────────────────────────────────
// Cache keys are the base — the actual localStorage key is user-scoped via
// cacheKeyFor() so that two different signed-in users on the same browser
// never inherit each other's server-scoped payload (was causing Jira counts
// to flash to 0 when switching accounts because the previous user's scoped
// cache hydrated before the new user's /queue call returned their own scope).
const SOURCE_CONFIG = {
  zendesk: { interval: 2 * 60 * 1000, cacheKey: 'ops_hub_queue_zendesk', cacheTtl: 2 * 60 * 1000 },
  jira:    { interval: 3 * 60 * 1000, cacheKey: 'ops_hub_queue_jira',    cacheTtl: 3 * 60 * 1000 },
};

function cacheKeyFor(source, userEmail) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  const lc = (userEmail || '').toLowerCase();
  return lc ? `${cfg.cacheKey}:${lc}` : cfg.cacheKey;
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
    // Per-task SLA override (minutes). Set by the backend on Jira items so
    // slaInfo() pins the threshold at 24h regardless of detected type.
    slaMinsOverride: Number.isFinite(item.slaMinsOverride) ? item.slaMinsOverride : null,
    // Secondary-visibility emails — HRX-owner custom fields + Reporter for
    // Jira. filterByAssignee() in src/lib/queue-scoping.js checks both the
    // primary assignee and this list.
    secondaryAssigneeEmails: Array.isArray(item.secondaryAssigneeEmails)
      ? item.secondaryAssigneeEmails.map(e => (e || '').toLowerCase()).filter(Boolean)
      : [],
    receivedAt,
    status: item.status || 'new',
    // Raw Zendesk status (new|open|pending|hold|solved|closed) — preserved
    // so the Detail page's status changer can light up "On hold" distinctly
    // from "Pending" even though both map to app-level 'waiting'.
    zdStatus: item.zdStatus || null,
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
    // Forward-compat slot for Phase 2 (editable custom fields). Backend
    // populates this when ticket-fields discovery lands; until then, the
    // Detail page renders "—" for unknown fields.
    customFields: item.customFields || null,
  };
}

// ── Read/write per-source IndexedDB cache ───────────────────────────────────
// Moved off localStorage (~5–10 MB cap, was triggering "Offline cache is full"
// on heavy Jira queues) onto IndexedDB (~50% of free disk space, multi-GB in
// practice). Same per-source per-user keys. Async — see the hydration effect
// below for how the queue table renders before the read resolves.
async function readSourceCache(source, userEmail) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  const key = cacheKeyFor(source, userEmail);
  // Migration: a previous version stored the cache in localStorage. On the
  // first read after this PR ships, copy any matching entry into IDB and
  // delete the localStorage copy so reads stay fast and the old data isn't
  // wasted. Best-effort; if anything throws we just fall through.
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

// Fields that are large but not needed to restore the queue view on reload.
// `body` is the raw ticket description (can be several KB per item).
// `aiSummary` and `suggestedReply` are always empty strings at persist time
// (generated lazily on demand) so they're pure wasted bytes. These fields
// are re-fetched from the live API the next time data is synced, so dropping
// them from the cache has zero visible effect on the user. Kept even after
// the IDB switch — smaller payloads write + read faster.
const CACHE_STRIP_FIELDS = ['body', 'aiSummary', 'suggestedReply'];

function slimForCache(items) {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    const slim = { ...item };
    for (const f of CACHE_STRIP_FIELDS) delete slim[f];
    return slim;
  });
}

async function writeSourceCache(source, items, meta, userEmail) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return;
  const key = cacheKeyFor(source, userEmail);
  const slim = slimForCache(items);
  await idbSet(key, { items: slim, meta, ts: Date.now() });
}

// ── Merge source sync into combined tasks (preserves local mutations) ───────
// Local-reassign and local-resolve are preserved ONLY while within
// LOCAL_MUTATION_WINDOW_MS of the recorded mutation timestamp. After that the
// server value wins, so external (admin-side) changes eventually become visible
// to everyone instead of being hidden forever.
function mergeSourceIntoTasks(currentTasks, syncedItems, source, callbacks = {}) {
  const syncMap = new Map();
  for (const item of syncedItems) syncMap.set(item.id, item);
  const now = Date.now();

  const result = [];
  const seen = new Set();

  for (const task of currentTasks) {
    if (task.source === source && syncMap.has(task.id)) {
      const synced = syncMap.get(task.id);
      seen.add(task.id);

      const reassignAge = task._locallyReassignedAt ? now - task._locallyReassignedAt : Infinity;
      const resolveAge  = task._locallyResolvedAt  ? now - task._locallyResolvedAt  : Infinity;

      const localReassigned = reassignAge < LOCAL_MUTATION_WINDOW_MS
        && task.assigneeEmail
        && task.assigneeEmail !== synced.assigneeEmail;

      const localResolved = resolveAge < LOCAL_MUTATION_WINDOW_MS
        && task.status === 'resolved'
        && synced.status !== 'resolved';

      // If the server has caught up with our local mutation, drop the stored
      // entry so stale timestamps don't linger in localStorage.
      if (task._locallyReassignedAt && task.assigneeEmail === synced.assigneeEmail) {
        callbacks.onReassignReconciled?.(task.id);
      }
      if (task._locallyResolvedAt && synced.status === 'resolved') {
        callbacks.onResolveReconciled?.(task.id);
      }

      result.push({
        ...synced,
        // Preserve local mutations — snooze
        snoozedUntil: task.snoozedUntil,
        snoozeLabel: task.snoozeLabel,
        prevStatus: task.prevStatus,
        _locallyReassignedAt: localReassigned ? task._locallyReassignedAt : null,
        _locallyResolvedAt:   localResolved   ? task._locallyResolvedAt   : null,
        _locallySnoozedAt:    task._locallySnoozedAt || null,
        status: task.snoozedUntil && task.status === 'waiting' ? 'waiting'
              : localResolved ? 'resolved'
              : synced.status,
        // Preserve local reassignment until the window elapses
        ...(localReassigned ? {
          assigneeId: task.assigneeId,
          assigneeEmail: task.assigneeEmail,
          assigneeName: task.assigneeName,
        } : {}),
      });
    } else if (task.source === source && !syncMap.has(task.id)) {
      // Task disappeared from source
      // Keep locally-created tasks (no _externalId) — they won't exist in the source
      if (task._locallyCreated) {
        result.push(task);
      } else if (task.status !== 'resolved') {
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

// ── Initial in-memory state ─────────────────────────────────────────────────
// Mutations live in localStorage and are tiny, so they're loaded sync at hook
// init. The big queue cache (IDB now, formerly localStorage) is loaded async
// in a useEffect below — see "IDB cache hydration" — so we never block first
// paint waiting for storage. The window between init and IDB resolving is
// ~10–50 ms in practice.
function loadInitialMutationsOnly(userEmail) {
  const { mutations, created } = loadMutations(userEmail);
  return applyMutationsToTasks([], mutations, created, {
    localReassignWindowMs: LOCAL_MUTATION_WINDOW_MS,
  });
}

// Async cache load — read every source from IDB (with localStorage migration
// inside readSourceCache) and assemble the same shape loadInitialTasks used
// to return. Called from the hydration effect; never blocks render.
async function loadCachedTasksAsync(userEmail) {
  const all = [];
  const seen = new Set();
  const meta = {};
  for (const source of Object.keys(SOURCE_CONFIG)) {
    const cached = await readSourceCache(source, userEmail);
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
  // Back-compat: previously called as useQueueSync(true). New call sites pass
  // { enabled, userEmail } so the mutation store can namespace per user.
  const { enabled, userEmail } = typeof arg === 'object' && arg !== null
    ? { enabled: arg.enabled ?? true, userEmail: arg.userEmail || null }
    : { enabled: !!arg, userEmail: null };

  // Initial state: just the local mutation store (small, sync). The IDB
  // cache hydrates a few ms later via the effect below.
  const initialMutationTasks = useMemo(() => loadInitialMutationsOnly(userEmail), [userEmail]);
  const [tasks, setTasks] = useState(initialMutationTasks);
  const [sourceMeta, setSourceMeta] = useState({});
  const [sourceErrors, setSourceErrors] = useState({});
  const [sourceLastSync, setSourceLastSync] = useState({});
  const [sourceLoading, setSourceLoading] = useState({ zendesk: true, jira: true });
  const [sourceRefreshing, setSourceRefreshing] = useState({ zendesk: false, jira: false });
  const syncCounts = useRef({ zendesk: 0, jira: 0 });
  const intervalRefs = useRef({});
  const inFlightRefs = useRef({ zendesk: null, jira: null });
  // Per-source AbortController so we can cancel an in-flight fetch on unmount
  // or when the consumer forces a retry. Without this, a slow response can
  // resolve after the component is gone and still mutate (stale) state.
  const abortControllersRef = useRef({ zendesk: null, jira: null });
  const mountedRef = useRef(true);
  const lastFetchTsRefs = useRef({ zendesk: 0, jira: 0 });
  // Tracks whether the very first sync for each source has completed.
  // Used by the IDB hydration effect: if a sync arrives BEFORE the IDB read
  // resolves (rare but possible on a fast network + slow IDB), the IDB data
  // is treated as already-superseded and discarded for that source.
  const firstSyncDoneRef = useRef({ zendesk: false, jira: false });
  const userEmailRef = useRef(userEmail);
  useEffect(() => { userEmailRef.current = userEmail; }, [userEmail]);

  // ── IDB cache hydration ────────────────────────────────────────────────
  // Reads the per-source cache from IndexedDB on mount and merges it into
  // state. Skipped per-source when a sync has already filled that source —
  // we never overwrite fresh server data with stale cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { tasks: cachedTasks, meta: cachedMeta } = await loadCachedTasksAsync(userEmail);
      if (cancelled || !mountedRef.current) return;
      if (cachedTasks.length === 0) return;

      const filteredTasks = cachedTasks.filter(t => !firstSyncDoneRef.current[t.source]);
      if (filteredTasks.length === 0) return;

      const { mutations, created } = loadMutations(userEmail);

      setTasks(prev => {
        // Merge cached items into whatever's already in state, dedup by id,
        // then re-apply the mutation store so user-local actions persist.
        const byId = new Map();
        for (const t of prev) byId.set(t.id, t);
        for (const t of filteredTasks) if (!byId.has(t.id)) byId.set(t.id, t);
        return applyMutationsToTasks([...byId.values()], mutations, created, {
          localReassignWindowMs: LOCAL_MUTATION_WINDOW_MS,
        });
      });

      // Surface meta + lastSync only for sources that haven't synced yet.
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
  }, [userEmail]);

  // Shared callbacks so mergeSourceIntoTasks can signal back when the server
  // caught up with a local mutation — we clear the stored entry so it doesn't
  // linger and confuse future hydrations.
  const mergeCallbacks = useMemo(() => ({
    onReassignReconciled: (taskId) => clearMutation(userEmailRef.current, taskId),
    onResolveReconciled:  (taskId) => clearMutation(userEmailRef.current, taskId),
  }), []);

  // Per-source sync function (with in-flight dedup)
  const syncSource = useCallback(async (source, opts = {}) => {
    if (!enabled) return null;
    if (inFlightRefs.current[source]) return inFlightRefs.current[source];

    // Abort any lingering controller for this source before starting a new
    // fetch — usually a no-op because of the in-flight dedup above, but if a
    // caller somehow slipped past (e.g., force-refresh during teardown) we
    // don't want two live controllers racing.
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
          // Guard: on a valid response that returns an empty list while we already
          // had cached rows for this source, keep the existing rows instead of
          // auto-resolving every task. Matches the Deel hooks' SWR contract.
          if (synced.length === 0 && prev.some(t => t.source === source)) {
            return prev;
          }
          if (syncCounts.current[source] === 0 && prev.filter(t => t.source === source).length === 0) {
            // First sync for this source with no prior cache — seed with synced
            // items then layer the mutation store on top so any stored snooze /
            // local-reassign / locally-created entries appear immediately.
            const otherTasks = prev.filter(t => t.source !== source);
            const seeded = [...otherTasks, ...synced];
            const { mutations, created } = loadMutations(userEmailRef.current);
            return applyMutationsToTasks(seeded, mutations, created, {
              localReassignWindowMs: LOCAL_MUTATION_WINDOW_MS,
            });
          }
          return mergeSourceIntoTasks(prev, synced, source, mergeCallbacks);
        });

        const meta = res?.meta || null;
        setSourceMeta(prev => ({ ...prev, [source]: meta }));
        setSourceErrors(prev => ({ ...prev, [source]: null }));
        setSourceLastSync(prev => ({ ...prev, [source]: new Date(now).toISOString() }));
        syncCounts.current[source] = (syncCounts.current[source] || 0) + 1;
        lastFetchTsRefs.current[source] = now;
        // Mark the first sync done so the IDB hydration effect knows to skip
        // this source if it lands later — never overwrite fresh data with cache.
        firstSyncDoneRef.current[source] = true;

        // Only persist & broadcast non-empty responses so a transient empty
        // payload never wipes the cache or other tabs. writeSourceCache is
        // async (IDB) but we don't await — fire-and-forget keeps the sync
        // path snappy; failures log but never block UI.
        if (rawItems.length > 0) {
          writeSourceCache(source, rawItems, meta, userEmailRef.current).catch(() => {});
          broadcastSync(source, rawItems, meta, userEmailRef.current);
        } else {
          // Still refresh the cache timestamp so TTL checks work.
          writeSourceCache(source, rawItems, meta, userEmailRef.current).catch(() => {});
        }
        return synced;
      } catch (err) {
        // Deliberate cancellation — caller moved on; don't surface it as an
        // error, don't clobber existing state, don't bump the error ticker.
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
  }, [enabled, mergeCallbacks]);

  // Initial fetch — fire both sources in parallel immediately, no stagger.
  // The server cache makes this cheap; the first paint is backed by the
  // localStorage cache so the user sees data instantly anyway.
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

  // Per-source auto-sync intervals
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

  // Unmount cleanup — mark as unmounted and abort any live fetches so the
  // response doesn't land on a dead component.
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

  // When the tab regains focus, opportunistically refresh any stale source.
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

  // Cross-tab adoption — user-scoped so different users on the same machine
  // never cross-pollinate each other's caches.
  useEffect(() => {
    const ch = getQueueChannel();
    if (!ch) return;
    const handler = (e) => {
      const msg = e.data;
      if (!msg || !msg.source) return;
      if (msg.source !== 'zendesk' && msg.source !== 'jira') return;
      // Reject broadcasts meant for a different signed-in user
      const myEmail = (userEmailRef.current || '').toLowerCase();
      const theirEmail = (msg.userKey || '').toLowerCase();
      if (myEmail && theirEmail && myEmail !== theirEmail) return;
      if (!msg.ts || msg.ts <= (lastFetchTsRefs.current[msg.source] || 0)) return;

      const items = msg.items || [];
      if (items.length === 0) return; // don't overwrite with empty

      const synced = items.map(normalizeQueueItem);
      setTasks(prev => {
        if (syncCounts.current[msg.source] === 0 && prev.filter(t => t.source === msg.source).length === 0) {
          const other = prev.filter(t => t.source !== msg.source);
          const seeded = [...other, ...synced];
          const { mutations, created } = loadMutations(userEmailRef.current);
          return applyMutationsToTasks(seeded, mutations, created, {
            localReassignWindowMs: LOCAL_MUTATION_WINDOW_MS,
          });
        }
        return mergeSourceIntoTasks(prev, synced, msg.source, mergeCallbacks);
      });
      setSourceMeta(prev => ({ ...prev, [msg.source]: msg.meta || prev[msg.source] || null }));
      setSourceErrors(prev => ({ ...prev, [msg.source]: null }));
      setSourceLastSync(prev => ({ ...prev, [msg.source]: new Date(msg.ts).toISOString() }));
      setSourceLoading(prev => ({ ...prev, [msg.source]: false }));
      lastFetchTsRefs.current[msg.source] = msg.ts;
      syncCounts.current[msg.source] = (syncCounts.current[msg.source] || 0) + 1;
      firstSyncDoneRef.current[msg.source] = true;
      // Persist async — don't block the broadcast handler.
      writeSourceCache(msg.source, items, msg.meta || null, userEmailRef.current).catch(() => {});
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, [mergeCallbacks]);

  // Manual refresh (all sources) — dedups internally so rapid clicks are safe
  const refresh = useCallback(() => {
    for (const source of Object.keys(SOURCE_CONFIG)) {
      syncSource(source, { bustCache: true });
    }
  }, [syncSource]);

  // Expose a helper so locally-created task clean-up can be triggered from
  // callers (e.g., when they delete or resolve a manual task).
  const forgetLocalCreated = useCallback((taskId) => {
    clearCreatedTask(userEmailRef.current, taskId);
  }, []);

  // Combined meta
  const meta = useMemo(() => ({
    zendesk: {
      count: sourceMeta.zendesk?.count || 0,
      status: sourceMeta.zendesk?.status || 'unknown',
      error: sourceErrors.zendesk,
    },
    jira: {
      count: sourceMeta.jira?.count || 0,
      status: sourceMeta.jira?.status || 'unknown',
      error: sourceErrors.jira,
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
    forgetLocalCreated,
    isLive: !!(sourceLastSync.zendesk || sourceLastSync.jira) && !error,
    sources: {
      zendesk: {
        loading: sourceLoading.zendesk,
        isRefreshing: sourceRefreshing.zendesk,
        error: sourceErrors.zendesk,
        lastSync: sourceLastSync.zendesk,
        lastSyncAt: lastFetchTsRefs.current.zendesk || null,
        count: tasks.filter(t => t.source === 'zendesk').length,
        retry: () => syncSource('zendesk', { bustCache: true }),
      },
      jira: {
        loading: sourceLoading.jira,
        isRefreshing: sourceRefreshing.jira,
        error: sourceErrors.jira,
        lastSync: sourceLastSync.jira,
        lastSyncAt: lastFetchTsRefs.current.jira || null,
        count: tasks.filter(t => t.source === 'jira').length,
        retry: () => syncSource('jira', { bustCache: true }),
      },
    },
  };
}
