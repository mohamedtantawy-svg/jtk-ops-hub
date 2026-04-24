// ── useTeamMembers — single source of truth for the Team tab ────────────────
// Fetches the merged roster from /api/v1/team-members and exposes mutation
// helpers that persist to the DB. Falls back to the static TEAM_MEMBERS
// baseline if the API is unreachable so the view never renders empty.
//
// Exposes the same helper shape the rest of the codebase expects
// (membersByEmail, getDirectReports, getAllReports) so Team.jsx can drop in
// without rewiring its rendering logic.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../services/api';
import { TEAM_MEMBERS, hydrateRoster } from '../data/members';

// Shape-compat fallback: baseline TEAM_MEMBERS with defaulted metadata fields
// so consumers can read every property regardless of whether the API returned.
function baselineAsMerged() {
  return TEAM_MEMBERS.map(m => ({
    ...m,
    isNew: false,
    isDeleted: false,
    onLeave: false,
    lastLoginAt: null,
    loginCount: 0,
  }));
}

export function useTeamMembers() {
  const [members, setMembers] = useState(() => baselineAsMerged());
  const [loading, setLoading] = useState(true);
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
    if (!previous) return { ok: false, error: 'Member not found' };

    // Optimistic remove
    setMembers(prev => prev.filter(m => m.email.toLowerCase() !== lc));

    try {
      await apiFetch(`/team-members/${encodeURIComponent(lc)}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      // Roll back
      setMembers(prev => [...prev, previous]);
      return { ok: false, error: err.message || 'Failed to remove member' };
    }
  }, [members]);

  const toggleOnLeave = useCallback(async (email) => {
    const lc = email.toLowerCase();
    const member = members.find(m => m.email.toLowerCase() === lc);
    if (!member) return { ok: false, error: 'Member not found' };
    return updateMember(lc, { onLeave: !member.onLeave });
  }, [members, updateMember]);

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
    refetch: fetchMembers,
  };
}
