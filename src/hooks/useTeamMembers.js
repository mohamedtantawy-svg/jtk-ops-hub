// ── useTeamMembers — single source of truth for the Team tab ────────────────
// Fetches the merged roster from /api/v1/team-members and exposes mutation
// helpers that persist to the DB. Falls back to the static TEAM_MEMBERS
// baseline if the API is unreachable so the view never renders empty.
//
// Performance: the previous fetch is cached in localStorage so subsequent
// mounts paint with the real "last seen" timestamps instantly instead of
// flashing "Never seen" for every row until the network round-trip
// returns. Cache is user-scoped so different signed-in users on the same
// machine don't see each other's snapshot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../services/api';
import { TEAM_MEMBERS, hydrateRoster, markLiveRosterFetched } from '../data/members';
import { hydrateOwnerCountries } from '../data/countryOwners';
import { useCurrentDeptId, getCurrentDeptIdSync } from '../lib/current-dept-storage';

// Shape-compat fallback: baseline TEAM_MEMBERS with defaulted metadata fields
// so consumers can read every property regardless of whether the API returned.
function baselineAsMerged() {
  return TEAM_MEMBERS.map(m => ({
    ...m,
    isNew: false,
    isDeleted: false,
    onLeave: false,
    lastSeenAt: null,
    lastLoginAt: null,
    loginCount: 0,
  }));
}

// ── localStorage SWR cache ─────────────────────────────────────────────────
const CACHE_KEY_BASE = 'ops_hub_team_members_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Phase 11+ instant-switch (2026-05-21): cache is per user AND per dept so
// the roster shown in HRX (84 HRX members) and GIX (67 GIX members) don't
// stomp each other when mohamed switches the picker. Without this, the
// last-fetched roster wins regardless of dept and the Team tab + Org
// surfaces + Briefing Team Summary all flash the wrong people.
function cacheKey(deptIdArg) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const email = (localStorage.getItem('ops_hub_logged_in_email') || '').toLowerCase();
    const u = email ? `:${email}` : '';
    const did = (deptIdArg !== undefined) ? deptIdArg : getCurrentDeptIdSync();
    const d = did ? `:${did}` : ':no-dept';
    return `${CACHE_KEY_BASE}${u}${d}`;
  } catch { return CACHE_KEY_BASE; }
}

function readCache(deptIdArg) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(deptIdArg));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.items;
  } catch { return null; }
}

// One-shot legacy-cache read. Used ONLY for the initial useState seed so
// existing users get an instant hydrated roster on first load after the
// PR #751 dept-cache refactor — without this, every existing manager
// (Insiya / Sarah / Megan / etc.) gets a new-key cache miss, initialises
// to the static TEAM_MEMBERS baseline (where many managers are tagged
// `access: 'agent'` from before the override table existed), resolves
// perms to at_agent, and gets flipped into AgentHome by the home-routing
// effect BEFORE the live /team-members fetch lands. The legacy data is
// the user's pre-deploy view; for super-admins who may have switched
// depts the data is whatever dept they were last in, which is still
// safer than the baseline because (a) the very next /team-members fetch
// overrides it with the current-dept payload, and (b) we deliberately
// do NOT use this fallback on dept-switch refetches — only at mount.
function readLegacyCacheOnce() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const email = (localStorage.getItem('ops_hub_logged_in_email') || '').toLowerCase();
    const key = email ? `${CACHE_KEY_BASE}:${email}` : CACHE_KEY_BASE;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.items;
  } catch { return null; }
}

function writeCache(deptIdArg, items) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(cacheKey(deptIdArg), JSON.stringify({ items, ts: Date.now() })); } catch {}
}

export function useTeamMembers() {
  // Initial state: cached items if present (instant paint with real
  // lastSeenAt values), otherwise fall back to the pre-PR #751 user-only
  // cache so existing users don't lose their hydrated roster on the
  // first load after deploy. Last resort: static baseline. The fetch
  // in the mount effect below revalidates either way.
  const initialDeptId = getCurrentDeptIdSync();
  const initialCached = readCache(initialDeptId) || readLegacyCacheOnce();
  const [members, setMembers] = useState(() => initialCached || baselineAsMerged());
  // `loading` is true only when we don't have cached data — the first paint
  // from cache is treated as "ready" so the Team view doesn't flash a
  // spinner over real data.
  const [loading, setLoading] = useState(() => !initialCached);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  // Phase 11+ instant-switch (2026-05-21): roster is per-dept. Switching
  // dept must swap cache namespaces and refetch.
  const currentDeptId = useCurrentDeptId();
  const currentDeptIdRef = useRef(currentDeptId);
  useEffect(() => { currentDeptIdRef.current = currentDeptId; }, [currentDeptId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchMembers = useCallback(async () => {
    try {
      const data = await apiFetch('/team-members');
      if (!mountedRef.current) return;
      if (Array.isArray(data?.items)) {
        setMembers(data.items);
        writeCache(currentDeptIdRef.current, data.items);
        setError(null);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // Keep the baseline — the view still works for read-only callers.
      setError(err);
      console.warn('[useTeamMembers] fetch failed, using baseline:', err.message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        // Signal that the live fetch landed (success OR fail) so App.jsx's
        // home-routing effect can stop deferring even when the response
        // happens to be structurally identical to the static baseline
        // (hydrateRoster no-ops in that case → rosterVersion stays at 0).
        markLiveRosterFetched();
      }
    }
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  // On dept change, swap to the target dept's cached roster (if any) and
  // refetch. This is what makes the chip-switch land on the right people
  // instantly when the user has visited the dept before.
  //
  // 2026-05-21 fix: distinguish "the dept just resolved on initial mount"
  // (null → real UUID after /dept-scope/current lands) from "the user
  // ACTUALLY switched dept via the chip" (real UUID → different real
  // UUID). Only the latter should reset members to the new dept's
  // cache — initial resolution should leave the useState initializer's
  // legacy-cache fallback intact so managers don't briefly flip to
  // AgentHome before the live /team-members fetch lands.
  const didFirstDeptEffectRef = useRef(false);
  const prevDeptIdRef = useRef(currentDeptId);
  useEffect(() => {
    const prevDeptId = prevDeptIdRef.current;
    prevDeptIdRef.current = currentDeptId;
    // First effect invocation on mount — just fetch, don't touch members.
    if (!didFirstDeptEffectRef.current) {
      didFirstDeptEffectRef.current = true;
      fetchMembers();
      return;
    }
    // Initial null → real-dept transition: the dept is just resolving,
    // not the user switching. Refetch so the new dept's payload lands,
    // but DON'T reset members — the legacy-cache fallback is correct
    // for the (typically single) dept this user belongs to.
    if (!prevDeptId && currentDeptId) {
      fetchMembers();
      return;
    }
    // Real dept switch (HRX → GIX, GIX → HRX, ...): reset to the new
    // dept's persisted cache so the chip flip paints instantly with
    // the right people.
    const cached = readCache(currentDeptId);
    if (cached) {
      setMembers(cached);
      setLoading(false);
    } else {
      setMembers(baselineAsMerged());
      setLoading(true);
    }
    fetchMembers();
  }, [currentDeptId, fetchMembers]);

  // ── Cross-session refresh ─────────────────────────────────────────────
  // The hook used to fetch on mount only, so a country / manager edit made
  // by Admin A in one browser stayed invisible to every other open session
  // (Insiya's, the affected agent's, the agent's old/new manager's, …)
  // until they manually reloaded. That stranded stale OWNER_COUNTRIES +
  // direct-report trees client-side and made cross-team scope changes
  // look like "the bug" (Mohamed + Insiya, 2026-05-18). Refetch on:
  //   • visibilitychange (user tabs back in)
  //   • window focus (user clicks back into the tab)
  //   • a soft 5-minute interval (safety net for users who never tab out)
  // All gated on document.visibilityState === 'visible' so background tabs
  // don't hammer the endpoint.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchMembers();
      }
    };
    const onVis = () => { if (document.visibilityState === 'visible') fetchMembers(); };
    const onFocus = () => fetchMembers();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
    }
    const intervalId = setInterval(refreshIfVisible, 5 * 60 * 1000);
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
      }
      clearInterval(intervalId);
    };
  }, [fetchMembers]);

  // ── Hydrate the module-level roster whenever `members` changes ────────
  // This is the bridge that makes Team-tab edits (add, move, access-change,
  // remove) visible to every static import of members.js in the app:
  // scope-helpers, queue-scoping, Briefing / Queue / Home memos. The
  // hydrateRoster helper no-ops on structural equality, so identical refetches
  // don't trigger unnecessary re-renders downstream.
  useEffect(() => {
    hydrateRoster(members);
    // Same bridge for country ownership: the API response ships
    // `countries: string[]` per member. Only hydrate when at least one
    // member carries a non-empty `countries` array — otherwise we'd clobber
    // the static fallback (or a previously-hydrated map) with an empty
    // one during a network failure or a baseline cold paint, leaving Queue
    // scoping with no country ownership at all.
    const junction = [];
    let anyCountries = false;
    for (const m of members) {
      if (!Array.isArray(m?.countries) || m.countries.length === 0) continue;
      anyCountries = true;
      for (const cc of m.countries) {
        junction.push({ email: m.email, country_code: cc });
      }
    }
    if (anyCountries) hydrateOwnerCountries(junction);
  }, [members]);

  // ── Derived lookups (memoised) ────────────────────────────────────────
  const membersByEmail = useMemo(() => {
    const map = {};
    for (const m of members) map[m.email.toLowerCase()] = m;
    return map;
  }, [members]);

  const getDirectReports = useCallback((email) => {
    if (!email) return [];
    const e = email.toLowerCase();
    return members.filter(m => (m.managerEmail || '').toLowerCase() === e);
  }, [members]);

  const getAllReports = useCallback((email) => {
    if (!email) return [];
    const reports = new Set();
    const queue = [email.toLowerCase()];
    while (queue.length > 0) {
      const mgr = queue.shift();
      for (const m of members) {
        if ((m.managerEmail || '').toLowerCase() === mgr && !reports.has(m.email)) {
          reports.add(m.email);
          queue.push(m.email);
        }
      }
    }
    return [...reports];
  }, [members]);

  // ── Mutations: optimistic local update + persist + refetch on error ─────
  const addMember = useCallback(async (payload) => {
    // Optimistic: add a placeholder while the POST flies.
    const email = (payload.email || '').trim().toLowerCase();
    const name = (payload.name || '').trim();
    const initials = name.split(/\s+/).filter(Boolean).map(w => w[0] || '').join('').slice(0, 4).toUpperCase();
    const optimistic = {
      email,
      name,
      initials,
      title: payload.title || 'HR Experience Specialist',
      access: payload.access || 'agent',
      managerEmail: payload.managerEmail || null,
      team: payload.team || null,
      region: payload.region || payload.team || null,
      service: payload.service || 'EOR',
      country: payload.country || null,
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name || email)}&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40`,
      startDate: new Date().toISOString().slice(0, 10),
      isNew: true,
      isDeleted: false,
      onLeave: false,
      lastSeenAt: null,
      lastLoginAt: null,
      loginCount: 0,
    };
    setMembers(prev => {
      const next = [...prev, optimistic];
      writeCache(currentDeptIdRef.current, next);
      return next;
    });

    try {
      const saved = await apiFetch('/team-members', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMembers(prev => {
        const next = prev.map(m => m.email.toLowerCase() === email ? { ...optimistic, ...saved } : m);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
      return { ok: true, member: saved };
    } catch (err) {
      // Roll back the optimistic insert and refetch to resync.
      setMembers(prev => {
        const next = prev.filter(m => m.email.toLowerCase() !== email);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
      fetchMembers();
      return { ok: false, error: err.message || 'Failed to add member' };
    }
  }, [fetchMembers]);

  const updateMember = useCallback(async (email, patch) => {
    const lc = email.toLowerCase();
    const previous = members.find(m => m.email.toLowerCase() === lc);
    if (!previous) return { ok: false, error: 'Member not found' };

    // Optimistic
    setMembers(prev => {
      const next = prev.map(m => m.email.toLowerCase() === lc ? { ...m, ...patch } : m);
      writeCache(currentDeptIdRef.current, next);
      return next;
    });

    try {
      const saved = await apiFetch(`/team-members/${encodeURIComponent(lc)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMembers(prev => {
        const next = prev.map(m => m.email.toLowerCase() === lc ? { ...m, ...saved } : m);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
      return { ok: true, member: saved };
    } catch (err) {
      // Roll back the optimistic patch
      setMembers(prev => {
        const next = prev.map(m => m.email.toLowerCase() === lc ? previous : m);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
      return { ok: false, error: err.message || 'Failed to update member' };
    }
  }, [members]);

  const removeMember = useCallback(async (email) => {
    const lc = email.toLowerCase();
    const previous = members.find(m => m.email.toLowerCase() === lc);
    // Don't bail on missing local state — the row may still exist in the DB
    // even when it's filtered out of the merged result (e.g. a shell row
    // from the auth-flow dual-write where is_new=false hides it from the
    // mergeTeamMembers second pass, or a soft-deleted row). Without this,
    // an admin trying to clean up a stale FE-only userAccessMap entry hit
    // "Member not found" while the server happily holds the row that
    // makes a later POST fail with "already exists". Let the server be
    // the source of truth.
    if (previous) {
      // Optimistic remove
      setMembers(prev => {
        const next = prev.filter(m => m.email.toLowerCase() !== lc);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
    }

    try {
      await apiFetch(`/team-members/${encodeURIComponent(lc)}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      if (previous) {
        // Roll back the optimistic remove
        setMembers(prev => {
          const next = [...prev, previous];
          writeCache(currentDeptIdRef.current, next);
          return next;
        });
      }
      return { ok: false, error: err.message || 'Failed to remove member' };
    }
  }, [members]);

  const toggleOnLeave = useCallback(async (email) => {
    const lc = email.toLowerCase();
    const member = members.find(m => m.email.toLowerCase() === lc);
    if (!member) return { ok: false, error: 'Member not found' };
    return updateMember(lc, { onLeave: !member.onLeave });
  }, [members, updateMember]);

  // Replace the country-ownership set for a member. Validates locally,
  // posts the full set, then syncs the optimistic update with the server's
  // canonical reply. Roll back on error so the UI doesn't drift.
  const setCountries = useCallback(async (email, countries) => {
    const lc = email.toLowerCase();
    const previous = members.find(m => m.email.toLowerCase() === lc);
    if (!previous) return { ok: false, error: 'Member not found' };

    const cleaned = Array.from(new Set(
      (Array.isArray(countries) ? countries : [])
        .map(c => (typeof c === 'string' ? c.trim().toUpperCase() : ''))
        .filter(c => /^[A-Z]{2}$/.test(c)),
    )).sort();

    setMembers(prev => {
      const next = prev.map(m => m.email.toLowerCase() === lc ? { ...m, countries: cleaned } : m);
      writeCache(currentDeptIdRef.current, next);
      return next;
    });

    try {
      const saved = await apiFetch(`/team-members/${encodeURIComponent(lc)}/countries`, {
        method: 'PUT',
        body: JSON.stringify({ countries: cleaned }),
      });
      const finalCountries = Array.isArray(saved?.countries) ? saved.countries : cleaned;
      setMembers(prev => {
        const next = prev.map(m => m.email.toLowerCase() === lc ? { ...m, countries: finalCountries } : m);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
      return { ok: true, countries: finalCountries };
    } catch (err) {
      setMembers(prev => {
        const next = prev.map(m => m.email.toLowerCase() === lc ? previous : m);
        writeCache(currentDeptIdRef.current, next);
        return next;
      });
      return { ok: false, error: err.message || 'Failed to save countries' };
    }
  }, [members]);

  return {
    members,
    membersByEmail,
    loading,
    error,
    getDirectReports,
    getAllReports,
    addMember,
    updateMember,
    removeMember,
    toggleOnLeave,
    setCountries,
    refetch: fetchMembers,
  };
}
