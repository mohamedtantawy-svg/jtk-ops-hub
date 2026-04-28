// ── originalAssigneeStore ─────────────────────────────────────────────────
// Per-user persistent record of "tickets I have taken over from someone".
//
// When an agent (often a TL or a teammate covering OOO) reassigns a ticket to
// themselves, we record the *previous* assignee as the "original". Trish's
// 2026-04-28 ask: "Fernanda goes on leave → her tickets are reassigned to me
// → when she comes back I want to bulk-reassign them back."
//
// Why a separate store from queueMutationStore:
//   • mutations expire after 24h. Coverage windows last weeks. We need a
//     longer-lived record that survives reloads, broadcasts, and well past
//     the 5-minute server-wins cutoff.
//   • the 'original' is set ONCE — first reassign wins. Later reassigns
//     don't overwrite it. That way "Trish → Lehi → Trish" still remembers
//     the original = Fernanda.
//   • the entry is cleared automatically when the ticket lands back on the
//     original assignee (so the "Reassign back" affordance stops appearing
//     once the loop is closed).
// ─────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'ops_hub_original_assignees';

function storageKey(userEmail) {
  const u = (userEmail || '').toLowerCase() || 'anonymous';
  return `${STORAGE_PREFIX}:${u}`;
}

function readStore(userEmail) {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(userEmail));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(userEmail, store) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userEmail), JSON.stringify(store));
  } catch {
    // Quota / private mode — silent; the in-memory consumer still works.
  }
}

/**
 * Record the original assignee for a ticket if not already tracked. Returns
 * the entry that ended up in the store (either the new one or the existing
 * one — first-reassign-wins).
 *
 * Skipped when:
 *   • the previous assignee is empty / unknown (no point — there's nobody
 *     to revert to)
 *   • the new assignee equals the previous one (no-op reassign)
 *   • the ticket has already been recorded (don't overwrite the original)
 */
export function recordOriginalAssignee(userEmail, ticketId, prevAssignee, newAssigneeEmail) {
  if (!ticketId || !prevAssignee?.email) return null;
  const prevEmailLc = String(prevAssignee.email).toLowerCase();
  const newEmailLc = String(newAssigneeEmail || '').toLowerCase();
  if (prevEmailLc === newEmailLc) return null;

  const store = readStore(userEmail);
  if (store[ticketId]) return store[ticketId]; // first-write-wins

  const entry = {
    originalAssigneeEmail: prevEmailLc,
    originalAssigneeName: prevAssignee.name || prevAssignee.email,
    takenOverAt: new Date().toISOString(),
  };
  store[ticketId] = entry;
  writeStore(userEmail, store);
  return entry;
}

/** Look up the recorded original (or null). */
export function getOriginalAssignee(userEmail, ticketId) {
  if (!ticketId) return null;
  const store = readStore(userEmail);
  return store[ticketId] || null;
}

/**
 * Drop the entry. Call after the ticket is reassigned back to the original
 * (so the "Reassign back" UI hides), or when the user dismisses the record
 * intentionally.
 */
export function clearOriginalAssignee(userEmail, ticketId) {
  if (!ticketId) return;
  const store = readStore(userEmail);
  if (!store[ticketId]) return;
  delete store[ticketId];
  writeStore(userEmail, store);
}

/**
 * Read every tracked entry. Used by the Queue's bulk-back button to know
 * which selected tickets have a recorded original.
 */
export function getAllOriginals(userEmail) {
  return readStore(userEmail);
}

/** Wipe all entries for the current user — called on logout. */
export function clearAllOriginalAssignees(userEmail) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(storageKey(userEmail)); } catch {}
}

/**
 * Wipe every per-user bucket. Used by the global logout cleanup that
 * doesn't know which user was last signed in.
 */
export function clearAllOriginalAssigneesEverywhere() {
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
