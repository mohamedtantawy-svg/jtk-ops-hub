// ── queueMutationStore ───────────────────────────────────────────────────────
// Frontend-only persistence layer for Queue tasks that the backend doesn't
// (yet) own as first-class state:
//
//   • Snooze (snoozedUntil / snoozeLabel / prevStatus)
//   • Local-resolve (user marked it resolved in this app before the source
//     system caught up)
//   • Local-reassign (user reassigned in this app, annotated with timestamp
//     so the merge guard can adopt the server value once the window elapses)
//   • Locally-created tasks (manual entries that don't come back from ZD/JR)
//
// Keeping this in a separate file means:
//   • App.jsx / Queue.jsx call one small API to record mutations
//   • useQueueSync hydrates + rehydrates from the same place on mount
//   • localStorage persistence survives reload so the user never sees their
//     snooze / resolve silently rolled back
//
// The store is keyed per-user so a user-switch doesn't inherit someone else's
// pending mutations.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'ops_hub_queue_mutations';

// Entries expire after 24 hours to keep the store bounded. Anything older than
// this is either already reconciled with the server or no longer relevant.
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(userEmail) {
  const u = (userEmail || '').toLowerCase() || 'anonymous';
  return `${STORAGE_PREFIX}:${u}`;
}

function readStore(userEmail) {
  if (typeof localStorage === 'undefined') return { mutations: {}, created: [] };
  try {
    const raw = localStorage.getItem(storageKey(userEmail));
    if (!raw) return { mutations: {}, created: [] };
    const parsed = JSON.parse(raw);
    return {
      mutations: parsed.mutations || {},
      created: Array.isArray(parsed.created) ? parsed.created : [],
    };
  } catch {
    return { mutations: {}, created: [] };
  }
}

function writeStore(userEmail, store) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userEmail), JSON.stringify(store));
  } catch {
    // Quota exceeded or private mode — swallow; in-memory state still works
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the full stored state for a user. Callers rehydrate from this on mount.
 * Returns { mutations: {[taskId]: {...fields}}, created: [task, ...] }.
 *
 * Mutation fields can include:
 *   status, snoozedUntil, snoozeLabel, prevStatus,
 *   assigneeEmail, assigneeId, assigneeName,
 *   _locallyReassignedAt, _locallyResolvedAt, _locallySnoozedAt
 */
export function loadMutations(userEmail) {
  const { mutations, created } = readStore(userEmail);
  const now = Date.now();
  // Drop stale entries so the store doesn't grow forever
  const freshMutations = {};
  for (const [id, entry] of Object.entries(mutations)) {
    const latest = Math.max(
      entry._locallyReassignedAt || 0,
      entry._locallyResolvedAt || 0,
      entry._locallySnoozedAt || 0,
      entry.snoozedUntil || 0,
    );
    if (!latest || now - latest < ENTRY_TTL_MS) freshMutations[id] = entry;
  }
  const freshCreated = created.filter(t => {
    const ts = t._createdAt ? new Date(t._createdAt).getTime() : 0;
    return !ts || now - ts < ENTRY_TTL_MS;
  });
  return { mutations: freshMutations, created: freshCreated };
}

/**
 * Record (or extend) a mutation for a task. Merges with any existing entry so
 * sequential actions (e.g. snooze then reassign) stack rather than clobber.
 */
export function recordMutation(userEmail, taskId, fields) {
  if (!taskId) return;
  const store = readStore(userEmail);
  const prev = store.mutations[taskId] || {};
  store.mutations[taskId] = { ...prev, ...fields };
  writeStore(userEmail, store);
}

/**
 * Clear a mutation entry — use when the server has authoritatively taken over
 * (e.g., the ticket now shows 'resolved' in Zendesk, so our local-resolve can
 * drop without causing a visual regression).
 */
export function clearMutation(userEmail, taskId) {
  const store = readStore(userEmail);
  if (store.mutations[taskId]) {
    delete store.mutations[taskId];
    writeStore(userEmail, store);
  }
}

/**
 * Record a locally-created task so it survives a page reload.
 */
export function recordCreatedTask(userEmail, task) {
  if (!task || !task.id) return;
  const store = readStore(userEmail);
  // Deduplicate: replace any existing entry with the same id
  const filtered = store.created.filter(t => t.id !== task.id);
  filtered.unshift({ ...task, _createdAt: task._createdAt || new Date().toISOString() });
  store.created = filtered.slice(0, 100); // hard cap, defense-in-depth
  writeStore(userEmail, store);
}

/**
 * Remove a locally-created task — use when the server has absorbed it (e.g.,
 * on the next sync it appears in the Zendesk/Jira payload) or the user
 * resolved/deleted it.
 */
export function clearCreatedTask(userEmail, taskId) {
  const store = readStore(userEmail);
  const filtered = store.created.filter(t => t.id !== taskId);
  if (filtered.length !== store.created.length) {
    store.created = filtered;
    writeStore(userEmail, store);
  }
}

/**
 * Wipe the entire store for a user. Called on logout so the next user doesn't
 * inherit pending mutations.
 */
export function clearAllMutations(userEmail) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(storageKey(userEmail)); } catch {}
}

/**
 * Nuke every per-user mutation bucket. Used by the logout cleanup when we
 * don't know which email was last signed in.
 */
export function clearAllMutationsEverywhere() {
  if (typeof localStorage === 'undefined') return;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

/**
 * Merge stored mutations onto a fresh list of tasks. Pure; returns a new array.
 *
 *   • Applies per-task field overrides (snooze/resolve/reassign)
 *   • Prepends locally-created tasks that don't already appear in the list
 *   • Drops mutations whose timestamp is older than WINDOW_MS (so stale
 *     local state doesn't mask an external reassign forever)
 */
export function applyMutationsToTasks(tasks, mutations, created, opts = {}) {
  const windowMs = opts.localReassignWindowMs ?? 5 * 60 * 1000;
  const now = Date.now();
  const byId = new Map();
  for (const t of tasks) byId.set(t.id, t);

  const merged = tasks.map(t => {
    const m = mutations?.[t.id];
    if (!m) return t;
    let next = { ...t };
    // Snooze: always preserve (snooze is app-internal; no external source)
    if (m.snoozedUntil && m.snoozedUntil > now) {
      next.status = 'waiting';
      next.snoozedUntil = m.snoozedUntil;
      next.snoozeLabel = m.snoozeLabel || null;
      next.prevStatus = m.prevStatus || next.prevStatus || null;
      next._locallySnoozedAt = m._locallySnoozedAt || null;
    }
    // Local-resolve: preserve within the window; drop if server has resolved it
    // or if the window has elapsed (let server value win).
    if (m.status === 'resolved' && m._locallyResolvedAt) {
      const ageMs = now - m._locallyResolvedAt;
      if (t.status !== 'resolved' && ageMs < windowMs) {
        next.status = 'resolved';
        next._locallyResolvedAt = m._locallyResolvedAt;
      }
    }
    // Local-reassign: preserve within the window
    if (m.assigneeEmail && m._locallyReassignedAt) {
      const ageMs = now - m._locallyReassignedAt;
      if (ageMs < windowMs && t.assigneeEmail !== m.assigneeEmail) {
        next.assigneeEmail = m.assigneeEmail;
        if (m.assigneeId != null) next.assigneeId = m.assigneeId;
        if (m.assigneeName) next.assigneeName = m.assigneeName;
        next._locallyReassignedAt = m._locallyReassignedAt;
      }
    }
    return next;
  });

  // Add locally-created tasks that aren't in the synced list yet
  const additions = [];
  for (const t of created || []) {
    if (!byId.has(t.id)) additions.push({ ...t, _locallyCreated: true });
  }
  return [...additions, ...merged];
}
