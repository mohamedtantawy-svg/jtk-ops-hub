// ── useQueueUnifiedSync ─────────────────────────────────────────────────────
// Single aggregator for every Queue data source (tickets + Deel admin data).
// Consumers get:
//   • Per-source state (items / loading / error / lastSyncAt / retry)
//   • A unified `meta` object driving the UnifiedSyncButton
//   • A single `refreshAll()` entry point (safe to spam — each source dedups
//     concurrent calls via its in-flight Promise ref)
//   • A 30s `nowTick` so "Synced X min ago" updates without each component
//     wiring its own setInterval
//
// Mounted inside Queue.jsx. The ticket feed (`queueSync`) is owned by App.jsx
// — we receive it as a prop rather than re-mounting it here.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useOnboardingData } from './useOnboardingData';
import { usePausedOnboardingData } from './usePausedOnboardingData';
import { useOffboardingData } from './useOffboardingData';
import { useChangeRequestData } from './useChangeRequestData';
import { useWorkbenchData } from './useWorkbenchData';
import { useIncentivePlansData } from './useIncentivePlansData';

const TICK_MS = 30_000;

function isoToMs(iso) {
  if (!iso) return null;
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function useQueueUnifiedSync({ queueSync, enabled = true, userEmail = null } = {}) {
  // Plumb the signed-in user's email into every source hook so each one can
  // namespace its localStorage cache per-user (prevents cross-user bleed-
  // through when multiple people sign into the same browser) and reject
  // BroadcastChannel messages from other users on the same machine.
  const onboardingData = useOnboardingData(enabled, userEmail);
  const pausedOnboardingData = usePausedOnboardingData(enabled, userEmail);
  const offboardingData = useOffboardingData(enabled, userEmail);
  const changeRequestData = useChangeRequestData(enabled, userEmail);
  const workbenchData = useWorkbenchData(enabled, userEmail);
  const incentivePlansData = useIncentivePlansData(enabled, userEmail);

  // ── Shared "now" tick — one 30s timer powers every "X min ago" label ─────
  // Pauses while the tab is hidden so we don't wake the CPU for nothing;
  // fires a one-shot when the tab becomes visible again to refresh labels.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    let id = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        setNowTick(Date.now());
      }, TICK_MS);
    };
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) setNowTick(Date.now());
    };
    start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      if (id) clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // ── Offline detection ────────────────────────────────────────────────────
  // We DO NOT trust navigator.onLine on its own — it flips to false on VPN
  // reconnects, WiFi hops, OS network-stack glitches, and some corporate
  // proxies, while HTTP requests continue to work. Treat it as a hint only.
  // Ground truth comes from whether any source has actually synced recently
  // (see `meta` below).
  const [navReportsOffline, setNavReportsOffline] = useState(() =>
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? !navigator.onLine : false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setNavReportsOffline(false);
    const off = () => setNavReportsOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ── Per-source descriptor (normalized shape) ─────────────────────────────
  const sources = useMemo(() => {
    const zd = queueSync?.sources?.zendesk;
    const jr = queueSync?.sources?.jira;
    return {
      zendesk: {
        id: 'zendesk',
        label: 'Zendesk',
        count: zd?.count ?? 0,
        loading: !!zd?.loading,
        isRefreshing: !!zd?.isRefreshing,
        error: zd?.error || null,
        lastSyncAt: zd?.lastSyncAt ?? isoToMs(zd?.lastSync),
        truncated: !!zd?.truncated,
        serverTotal: zd?.serverTotal || null,
        retry: zd?.retry || queueSync?.refresh,
      },
      jira: {
        id: 'jira',
        label: 'Jira',
        count: jr?.count ?? 0,
        loading: !!jr?.loading,
        isRefreshing: !!jr?.isRefreshing,
        error: jr?.error || null,
        lastSyncAt: jr?.lastSyncAt ?? isoToMs(jr?.lastSync),
        truncated: !!jr?.truncated,
        retry: jr?.retry || queueSync?.refresh,
      },
      onboarding: {
        id: 'onboarding',
        label: 'Onboarding',
        count: onboardingData.items?.length ?? 0,
        loading: !!onboardingData.loading,
        isRefreshing: !!onboardingData.isRefreshing,
        error: onboardingData.error || null,
        lastSyncAt: onboardingData.lastSyncAt ?? null,
        retry: onboardingData.refresh,
      },
      pausedOnboarding: {
        id: 'pausedOnboarding',
        label: 'Paused Onboarding',
        count: pausedOnboardingData.items?.length ?? 0,
        loading: !!pausedOnboardingData.loading,
        isRefreshing: !!pausedOnboardingData.isRefreshing,
        error: pausedOnboardingData.error || null,
        lastSyncAt: pausedOnboardingData.lastSyncAt ?? null,
        retry: pausedOnboardingData.refresh,
      },
      offboarding: {
        id: 'offboarding',
        label: 'Offboarding',
        count: offboardingData.items?.length ?? 0,
        loading: !!offboardingData.loading,
        isRefreshing: !!offboardingData.isRefreshing,
        error: offboardingData.error || null,
        lastSyncAt: offboardingData.lastSyncAt ?? null,
        retry: offboardingData.refresh,
      },
      amendments: {
        id: 'amendments',
        label: 'Amendments',
        count: changeRequestData.amendments?.length ?? 0,
        loading: !!changeRequestData.loading,
        isRefreshing: !!changeRequestData.isRefreshing,
        error: changeRequestData.error || null,
        lastSyncAt: changeRequestData.lastSyncAt ?? null,
        retry: changeRequestData.refresh,
      },
      redlines: {
        id: 'redlines',
        label: 'Redlines',
        count: changeRequestData.redlines?.length ?? 0,
        loading: !!changeRequestData.loading,
        isRefreshing: !!changeRequestData.isRefreshing,
        error: changeRequestData.error || null,
        lastSyncAt: changeRequestData.lastSyncAt ?? null,
        retry: changeRequestData.refresh,
      },
      workbench: {
        id: 'workbench',
        label: 'Workbench',
        count: workbenchData.tasks?.length ?? 0,
        loading: !!workbenchData.loading,
        isRefreshing: !!workbenchData.isRefreshing,
        error: workbenchData.error || null,
        lastSyncAt: workbenchData.lastSyncAt ?? null,
        retry: workbenchData.refresh,
      },
      incentivePlans: {
        id: 'incentivePlans',
        label: 'Incentive Plans',
        count: incentivePlansData.items?.length ?? 0,
        loading: !!incentivePlansData.loading,
        isRefreshing: !!incentivePlansData.isRefreshing,
        error: incentivePlansData.error || null,
        lastSyncAt: incentivePlansData.lastSyncAt ?? null,
        retry: incentivePlansData.refresh,
      },
    };
  }, [
    queueSync?.sources?.zendesk, queueSync?.sources?.jira, queueSync?.refresh,
    onboardingData.items, onboardingData.loading, onboardingData.isRefreshing,
    onboardingData.error, onboardingData.lastSyncAt, onboardingData.refresh,
    pausedOnboardingData.items, pausedOnboardingData.loading, pausedOnboardingData.isRefreshing,
    pausedOnboardingData.error, pausedOnboardingData.lastSyncAt, pausedOnboardingData.refresh,
    offboardingData.items, offboardingData.loading, offboardingData.isRefreshing,
    offboardingData.error, offboardingData.lastSyncAt, offboardingData.refresh,
    changeRequestData.amendments, changeRequestData.redlines, changeRequestData.loading,
    changeRequestData.isRefreshing, changeRequestData.error, changeRequestData.lastSyncAt,
    changeRequestData.refresh,
    workbenchData.tasks, workbenchData.loading, workbenchData.isRefreshing,
    workbenchData.error, workbenchData.lastSyncAt, workbenchData.refresh,
    incentivePlansData.items, incentivePlansData.loading, incentivePlansData.isRefreshing,
    incentivePlansData.error, incentivePlansData.lastSyncAt, incentivePlansData.refresh,
  ]);

  // ── Aggregated meta for the UnifiedSyncButton ────────────────────────────
  // A successful sync within RECENT_SYNC_MS proves HTTP works and overrides
  // any `navigator.onLine = false` false-positive. Same for an in-flight
  // refresh — if a request is currently on the wire, we're clearly online.
  //
  // Freshness model (2026-05-01 second pass): the badge state used to be
  // driven by a single `oldestSyncAt` aggregate, which meant any one
  // source falling out of the window flipped the whole badge to red even
  // when 6/7 sources were healthy and the slow one was already refreshing
  // in the background. Now we score each source individually and the
  // badge reads the per-source mix:
  //   • fresh    → data <= WARN_AFTER_MS old, OR currently refreshing
  //                (a background poll on a stale source is "the system
  //                is fixing it" — show live, don't panic).
  //   • aging    → data WARN..STALE old, not refreshing.
  //   • stale    → data > STALE_AFTER_MS old, not refreshing.
  //   • failing  → last sync errored (regardless of timestamp).
  // The button renders a state machine on top of those counts.
  const RECENT_SYNC_MS = 2 * 60 * 1000;     // 2 minutes — offline corroboration window
  const WARN_AFTER_MS  = 7  * 60 * 1000;    // default soft threshold per source
  const STALE_AFTER_MS = 10 * 60 * 1000;    // default hard threshold per source
  // Per-source overrides — sources whose natural cycle is longer than the
  // default 5-min cache TTL deserve a wider tolerance before the badge
  // surfaces them. Offboarding's parallel-by-status scan takes ~52s and
  // the cache TTL is 5 min, so 2 missed cycles + slack ≈ 15 min before
  // it counts as stale (and 12 min before it counts as aging — keeps the
  // warn/stale ratio at the same 4:5 the defaults use).
  const STALE_AFTER_BY_SOURCE = {
    offboarding: 15 * 60 * 1000,
  };
  const WARN_AFTER_BY_SOURCE = {
    offboarding: 12 * 60 * 1000,
  };
  const meta = useMemo(() => {
    const list = Object.values(sources);
    const timestamps = list.map(s => s.lastSyncAt).filter(t => typeof t === 'number' && t > 0);
    const lastSyncAt = timestamps.length ? Math.max(...timestamps) : null;
    const oldestSyncAt = timestamps.length ? Math.min(...timestamps) : null;
    const isAnyRefreshing = list.some(s => s.isRefreshing);
    const isAnyLoading = list.some(s => s.loading);
    const sourceErrors = list.filter(s => s.error);
    const hasEverSynced = !!lastSyncAt;

    // Per-source freshness scoring against the SAME thresholds the badge
    // uses, so the button can answer "is this source fresh / aging /
    // stale / failing right now?" in one place without re-deriving.
    const now = nowTick;
    let freshSourceCount = 0;
    let agingSourceCount = 0;
    let staleSourceCount = 0;
    let refreshingStaleSourceCount = 0;     // stale-but-refreshing — counts as fresh
    const staleSources = [];                // sources that are stale AND not refreshing
    const agingSources = [];                // 7..10 min, not refreshing
    for (const s of list) {
      const ts = typeof s.lastSyncAt === 'number' ? s.lastSyncAt : null;
      const ageMs = ts ? now - ts : Infinity;
      const isRefreshing = !!s.isRefreshing;
      const warnMs = WARN_AFTER_BY_SOURCE[s.id] ?? WARN_AFTER_MS;
      const staleMs = STALE_AFTER_BY_SOURCE[s.id] ?? STALE_AFTER_MS;
      if (ageMs <= warnMs) {
        freshSourceCount++;
      } else if (ageMs <= staleMs) {
        if (isRefreshing) {
          // Aging but the system is already on it — count as fresh.
          freshSourceCount++;
        } else {
          agingSourceCount++;
          agingSources.push(s);
        }
      } else {
        if (isRefreshing) {
          refreshingStaleSourceCount++;
          freshSourceCount++;             // stale-but-refreshing → live for badge purposes
        } else {
          staleSourceCount++;
          staleSources.push(s);
        }
      }
    }
    const totalSources = list.length;
    const allStale = totalSources > 0 && staleSourceCount === totalSources;
    const allFailing = totalSources > 0 && sourceErrors.length === totalSources;
    const anyStale = staleSourceCount > 0;
    const anyAging = agingSourceCount > 0;

    // Corroborated offline: navigator hint must agree with actual evidence.
    const recentlySynced = !!(lastSyncAt && (now - lastSyncAt) < RECENT_SYNC_MS);
    const isOffline = navReportsOffline && !recentlySynced && !isAnyRefreshing;

    return {
      lastSyncAt,
      oldestSyncAt,
      isAnyLoading,
      isAnyRefreshing,
      isAnyError: sourceErrors.length > 0,
      sourceErrors,
      hasEverSynced,
      isOffline,
      // Per-source freshness aggregates — drive the badge state machine.
      totalSources,
      freshSourceCount,
      agingSourceCount,
      staleSourceCount,
      refreshingStaleSourceCount,
      staleSources,                         // for tooltip / dropdown context
      agingSources,
      anyStale,
      anyAging,
      allStale,
      allFailing,
    };
  }, [sources, navReportsOffline, nowTick]);

  // ── Self-correct the navigator hint when we have proof of connectivity ──
  // If any source just completed a sync successfully, the browser's opinion
  // that we're offline is objectively wrong. Reset navReportsOffline so we
  // don't flip back to "Offline" as soon as the 2-minute window lapses.
  useEffect(() => {
    if (navReportsOffline && meta.lastSyncAt && (Date.now() - meta.lastSyncAt) < 10_000) {
      setNavReportsOffline(false);
    }
  }, [meta.lastSyncAt, navReportsOffline]);

  // ── Refresh all sources ──────────────────────────────────────────────────
  // Each underlying hook de-dupes concurrent refresh() calls via an in-flight
  // Promise ref, so firing all seven here never double-fetches a source.
  const refreshAll = useCallback(() => {
    try { queueSync?.refresh?.(); } catch {}
    try { onboardingData.refresh(); } catch {}
    try { pausedOnboardingData.refresh(); } catch {}
    try { offboardingData.refresh(); } catch {}
    try { changeRequestData.refresh(); } catch {}
    try { workbenchData.refresh(); } catch {}
    try { incentivePlansData.refresh(); } catch {}
  }, [queueSync, onboardingData, pausedOnboardingData, offboardingData, changeRequestData, workbenchData, incentivePlansData]);

  return {
    onboardingData,
    pausedOnboardingData,
    offboardingData,
    changeRequestData,
    workbenchData,
    incentivePlansData,
    sources,
    meta,
    refreshAll,
    nowTick,
  };
}
