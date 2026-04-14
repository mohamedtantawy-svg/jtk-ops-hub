// ── useQueueSync hook ───────────────────────────────────────────────────────
// Fetches unified queue from the backend (/api/v1/queue) and auto-syncs
// every SYNC_INTERVAL ms. Returns normalized tasks ready for the Queue view.
//
// Architecture:
// - External systems (Zendesk + Jira) are the source of truth
// - The backend aggregates and normalizes both into a single feed
// - This hook polls and updates the task state
// - Local state (snooze, notes) is preserved across syncs
// - Tickets that disappear from sync = resolved in source system
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchQueue } from '../services/integrationsApi';
import { MEMBERS } from '../data/members';
import { ADMIN_EMAILS } from '../data/adminEmails';

const SYNC_INTERVAL = 3 * 60 * 1000; // 3 minutes
const INITIAL_DELAY = 500; // small delay on mount to not block first paint

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

  const receivedAt = createdAt
    ? createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Try to resolve assignee to a MEMBERS entry (by email)
  const member = item.assigneeEmail
    ? MEMBERS.find(m => m.email === item.assigneeEmail)
    : null;

  return {
    id: item.id,
    _beId: null, // no backend UUID — external system is source of truth
    _externalId: item.externalId,
    source: item.source || 'zendesk',
    subject: item.subject || '',
    body: item.description || '',
    assigneeId: member ? member.id : null,
    assigneeEmail: item.assigneeEmail || null,
    assigneeName: item.assigneeName || (member ? member.name : null),
    country: '', // not available from external systems directly
    minutesAgo,
    updatedMinsAgo,
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
    // Preserve empty values — AI features to come later
    aiSummary: '',
    suggestedReply: '',
    // Snooze state — preserved across syncs via merge logic
    snoozedUntil: null,
    snoozeLabel: null,
    prevStatus: null,
  };
}

// ── Merge sync results with current state ────────────────────────────────────
// Preserves local state (snooze, escalation) while updating external data
function mergeSyncResults(current, synced) {
  const currentMap = new Map();
  for (const t of current) {
    currentMap.set(t.id, t);
  }

  const syncedMap = new Map();
  for (const t of synced) {
    syncedMap.set(t.id, t);
  }

  const result = [];
  const seen = new Set();

  // Update existing + add new from sync
  for (const [id, syncTask] of syncedMap) {
    seen.add(id);
    const existing = currentMap.get(id);

    if (existing) {
      // Merge: external data wins, but preserve local overrides
      result.push({
        ...syncTask,
        // Preserve local snooze state (if user snoozed in the app)
        snoozedUntil: existing.snoozedUntil,
        snoozeLabel: existing.snoozeLabel,
        prevStatus: existing.prevStatus,
        // If snoozed locally, keep waiting status
        status: existing.snoozedUntil && existing.status === 'waiting'
          ? 'waiting'
          : syncTask.status,
      });
    } else {
      // New ticket from sync
      result.push(syncTask);
    }
  }

  // Mark tickets that disappeared from sync as resolved
  for (const [id, existing] of currentMap) {
    if (!seen.has(id)) {
      // Only mark as resolved if it wasn't already resolved or manually created
      if (existing.status !== 'resolved' && existing.source !== 'manual') {
        result.push({ ...existing, status: 'resolved' });
      }
      // Don't include already-resolved tickets that are gone from sync
      // They naturally phase out
    }
  }

  return result;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useQueueSync(enabled = true) {
  const [tasks, setTasks] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const syncCount = useRef(0);
  const intervalRef = useRef(null);

  const sync = useCallback(async () => {
    if (!enabled) return;

    try {
      const res = await fetchQueue();
      const synced = (res?.items || []).map(normalizeQueueItem);

      setTasks(prev => {
        // First sync: just set the data
        if (prev.length === 0 && syncCount.current === 0) {
          return synced;
        }
        // Subsequent syncs: merge to preserve local state
        return mergeSyncResults(prev, synced);
      });

      setMeta(res?.meta || null);
      setLastSync(new Date().toISOString());
      setError(null);
      syncCount.current += 1;
    } catch (err) {
      console.warn('[useQueueSync] Sync failed:', err.message);
      setError(err.message);
      // Don't clear existing tasks on error — keep showing last known state
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Initial fetch
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const timer = setTimeout(sync, INITIAL_DELAY);
    return () => clearTimeout(timer);
  }, [sync, enabled]);

  // Auto-sync interval
  useEffect(() => {
    if (!enabled) return;

    intervalRef.current = setInterval(sync, SYNC_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [sync, enabled]);

  // Manual refresh (force, bypasses cache)
  const refresh = useCallback(() => {
    setLoading(true);
    return sync();
  }, [sync]);

  return {
    tasks,
    setTasks, // exposed so App.jsx can apply local mutations (snooze, reassign, etc.)
    meta,
    loading,
    error,
    lastSync,
    refresh,
    isLive: !!lastSync && !error,
  };
}
