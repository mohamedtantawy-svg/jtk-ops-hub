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
import { TEAM_MEMBERS, hydrateRoster } from '../data/members';
import { hydrateOwnerCountries } from '../data/countryOwners';

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

function cacheKey() {
  if (typeof localStorage === 'undefined') return null;
  try { return `${CACHE_KEY_BASE}:${(localStorage.getItem('ops_hub_logged_in_email') || '').toLowerCase()}`; }
  catch { return CACHE_KEY_BASE; }
}

function readCache() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (parsed.ts && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.items;
  } catch { return null; }
}

function writeCache(items) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(cacheKey(), JSON.stringify({ items, ts: Date.now() })); } catch {}
}

export function useTeamMembers() {
  // Initial state: cached items if present (instant paint with real
  // lastSeenAt values), otherwise the static baseline. The fetch in the
  // mount effect below revalidates either way.
  const [members, setMembers] = useState(() => readCache() || baselineAsMerged());
  // `loading` is true only when we don't have cached data — the first paint
  // from cache is treated as "ready" so the Team view doesn't flash a
  // spinner over real data.
  const [loading, setLoading] = useState(() => !readCache());
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

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
        writeCache(data.items);
        setError(null);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // Keep the baseline — the view still works for read-only callers.
      setError(err);
      console.warn('[useTeamMembers] fetch failed, using baseline:', err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

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
    setMembers(prev => [...prev, optimistic]);

    try {
      const saved = await apiFetch('/team-members', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMembers(prev => prev.map(m => m.email.toLowerCase() === email ? { ...optimistic, ...saved } : m));
      return { ok: true, member: saved };
    } catch (err) {
      // Roll back the optimistic insert and refetch to resync.
      setMembers(prev => prev.filter(m => m.email.toLowerCase() !== email));
      fetchMembers();
      return { ok: false, error: err.message || 'Failed to add member' };
    }
  }, [fetchMembers]);

  const updateMember = useCallback(async (email, patch) => {
    const lc = email.toLowerCase();
    const previous = members.find(m => m.email.toLowerCase() === lc);
    if (!previous) return { ok: false, error: 'Member not found' };

    // Optimistic
    setMembers(prev => prev.map(m => m.email.toLowerCase() === lc ? { ...m, ...patch } : m));

    try {
      const saved = await apiFetch(`/team-members/${encodeURIComponent(lc)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMembers(prev => prev.map(m => m.email.toLowerCase() === lc ? { ...m, ...saved } : m));
      return { ok: true, member: saved };
    } catch (err) {
      // Roll back the optimistic patch
      setMembers(prev => prev.map(m => m.email.toLowerCase() === lc ? previous : m));
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
      setMembers(prev => prev.filter(m => m.email.toLowerCase() !== lc));
    }

    try {
      await apiFetch(`/team-members/${encodeURIComponent(lc)}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      if (previous) {
        // Roll back the optimistic remove
        setMembers(prev => [...prev, previous]);
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

    setMembers(prev => prev.map(m => m.email.toLowerCase() === lc ? { ...m, countries: cleaned } : m));

    try {
      const saved = await apiFetch(`/team-members/${encodeURIComponent(lc)}/countries`, {
        method: 'PUT',
        body: JSON.stringify({ countries: cleaned }),
      });
      const finalCountries = Array.isArray(saved?.countries) ? saved.countries : cleaned;
      setMembers(prev => prev.map(m => m.email.toLowerCase() === lc ? { ...m, countries: finalCountries } : m));
      return { ok: true, countries: finalCountries };
    } catch (err) {
      setMembers(prev => prev.map(m => m.email.toLowerCase() === lc ? previous : m));
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
