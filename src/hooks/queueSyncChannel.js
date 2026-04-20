// ── Shared cross-tab channel for queue sync events ──────────────────────────
// All Queue source hooks (zendesk, jira, onboarding, paused onboarding,
// offboarding, amendments, redlines, workbench) post on successful fetch so
// sibling tabs can adopt the result without re-hitting the network.
//
// Message shape: { source, items, meta?, ts, userKey? }
// `userKey` is a lowercase email so receivers for a different signed-in user
// on the same machine can ignore broadcasts that don't belong to them — the
// server now scopes /queue per user, so payloads differ by role.
//
// Gracefully degrades: if BroadcastChannel is unavailable (SSR, old browsers,
// or a security context that blocks it), getQueueChannel returns null and
// callers no-op.
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_NAME = 'ops_hub_queue_sync';

let channel = null;
let initFailed = false;

function tryInit() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    initFailed = true;
    return null;
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    initFailed = false;
    return channel;
  } catch {
    channel = null;
    initFailed = true;
    return null;
  }
}

export function getQueueChannel() {
  if (channel) return channel;
  if (initFailed) return null;
  return tryInit();
}

// Reset the singleton — next getQueueChannel() will re-init. Called by
// broadcastSync() when postMessage throws so we recover from a closed channel.
function resetChannel() {
  try { channel?.close(); } catch {}
  channel = null;
  initFailed = false;
}

/**
 * Post a sync event to sibling tabs.
 * @param {string} source — 'zendesk' | 'jira' | 'onboarding' | ...
 * @param {any[]} items — the raw items array from the sync response
 * @param {any} meta — optional meta object
 * @param {string|null} userEmail — current signed-in user's email (for scoping)
 */
export function broadcastSync(source, items, meta = null, userEmail = null) {
  const ch = getQueueChannel();
  if (!ch) return;
  const userKey = (userEmail || '').toLowerCase() || null;
  try {
    ch.postMessage({ source, items, meta, ts: Date.now(), userKey });
  } catch {
    // Channel may have been closed by the browser (back-forward cache, memory
    // pressure). Reset so the next broadcast can re-init.
    resetChannel();
  }
}
