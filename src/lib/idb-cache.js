// ── Async key/value cache backed by IndexedDB ────────────────────────────────
// Replaces localStorage for the per-source queue payloads. localStorage's
// ~5–10 MB per-origin cap was triggering the "Offline cache is full" banner
// on heavy Jira queues. IDB defaults to ~50% of free disk space — multi-GB
// in practice, so quota-exceeded becomes a non-issue.
//
// Same shape we used on localStorage:
//   key   → arbitrary string (e.g. `queue:zendesk:user@deel.com`)
//   value → arbitrary JSON-serialisable object (the cache record)
//
// All operations are async + best-effort: a failed get/set returns null/
// false rather than throwing, so the caller can fall through to live fetch
// without breaking the queue. SSR safe (returns null when indexedDB is
// undefined).
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'ops-hub-cache';
const DB_VERSION = 1;
const STORE = 'kv';

let _dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('No IndexedDB'));
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Force a fresh handle on the next call after an unexpected close
      // (private browsing, OS storage eviction, etc.).
      db.onclose = () => { _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
    // Some Firefox flavours fire `onblocked` if another tab holds an old
    // version. Treat it as failure; caller falls through.
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error('IndexedDB open blocked'));
    };
  });
  return _dbPromise;
}

async function withStore(mode, fn) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB tx aborted'));
    });
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn(`[idb-cache] ${mode} failed:`, err?.message);
    }
    return null;
  }
}

export async function idbGet(key) {
  const result = await withStore('readonly', (store) => store.get(key));
  return result?.value ?? null;
}

export async function idbSet(key, value) {
  await withStore('readwrite', (store) => store.put({ key, value, ts: Date.now() }));
  return true;
}

export async function idbDelete(key) {
  await withStore('readwrite', (store) => store.delete(key));
  return true;
}

// Useful for testing / forced cache reset; not in the hot path.
export async function idbClear() {
  await withStore('readwrite', (store) => store.clear());
  return true;
}

// ── localStorage → IDB migration helper ─────────────────────────────────────
// Used by data hooks (useSlackData, useOnboardingData, …) that previously
// stored their per-user cache in localStorage. On the first read after this
// PR ships, look for the legacy key, copy it into IDB, delete the old key.
// Best-effort throughout — every step has a guarded fallback so a misbehaving
// browser can't break the data path.
export async function idbGetWithMigration(key) {
  const idbHit = await idbGet(key);
  if (idbHit !== null && idbHit !== undefined) return idbHit;
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed) {
      await idbSet(key, parsed);
      try { localStorage.removeItem(key); } catch {}
    }
    return parsed;
  } catch {
    return null;
  }
}
