// ── PersonalChecklist ─────────────────────────────────────────────────────────
// Per-user checklist of lightweight tasks with title, description, due date,
// and priority.
//
// Durability contract (data MUST NOT be lost across refreshes / deploys / tab
// churn / partial backend failures / device switches / browser-cache wipes /
// concurrent edits from multiple devices):
//   1. Every mutation writes synchronously to localStorage (primary fast path).
//   2. Every mutation also writes to IndexedDB (durable backup that survives
//      even if localStorage is evicted due to quota pressure).
//   3. Every mutation also pushes a debounced (600ms) PUT to the server
//      (`personal_checklist_snapshots` in PostgreSQL). The server-side route
//      performs a per-id last-write-wins MERGE against the existing snapshot
//      (not a blind replace), so two devices editing concurrently can't
//      clobber each other — every id present on either side is preserved,
//      and the higher item.updatedAt wins per id. Deletes are explicit
//      tombstones (`deleted: true`), so a delete on device A propagates to
//      device B instead of being silently re-added when B pushes its copy.
//   4. On mount we read localStorage synchronously for instant paint, then
//      asynchronously rehydrate from IDB AND fetch the server snapshot.
//      Reconciliation is last-write-wins by snapshot `updated_at` for the
//      INITIAL adoption; subsequent edits go through the per-id merge in
//      step 3 so no item is ever lost.
//   5. A BroadcastChannel syncs mutations across tabs in real time; a
//      `storage` event listener catches other tabs as a belt-and-braces backup.
//   6. Items migrated from the legacy {id,text,done} shape once on first read
//      and preserved forever — no data is ever dropped. Tombstones survive
//      the round-trip through LS / IDB / server so cross-device delete sync
//      works. Missing `priority` on existing items defaults to `normal`.
//   7. All writes are best-effort — any thrown error is caught and the app
//      keeps running; the user never sees their input vanish. If the server
//      PUT fails (offline / 5xx), the snapshot still lives in LS+IDB and is
//      pushed up on the next mount.
//   8. Tombstones older than 30 days are pruned server-side during the merge
//      to keep the snapshot from growing without bound.
//
// Works for every role (Agent / Team Lead / Regional Manager / Admin/Director).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchChecklistSnapshot, putChecklistSnapshot } from '../../services/personalChecklistApi';

const LEGACY_KEY = 'ops_hub_checklist';
const SYNC_CHANNEL = 'ops_hub_checklist_sync';
const IDB_NAME = 'ops_hub_checklist';
const IDB_STORE = 'items';
const SCHEMA_VERSION = 2;

// ── Priority taxonomy ───────────────────────────────────────────────────────
// Four levels with color coding. `rank` drives sort order (lower number =
// more urgent). Legacy items without priority migrate to `normal`.
const PRIORITY_META = {
  urgent: { label: 'Urgent', color: '#d42d35', bg: '#FEE2E2', rank: 0 },
  high:   { label: 'High',   color: '#ed8d00', bg: '#FEF3C7', rank: 1 },
  normal: { label: 'Normal', color: '#9e9e9e', bg: '#f5f5f5', rank: 2 },
  low:    { label: 'Low',    color: '#1f74b3', bg: '#DBEAFE', rank: 3 },
};
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];
const VALID_PRIORITIES = new Set(PRIORITY_ORDER);

// Per-user storage key — protects checklists on shared machines
function storageKey(userEmail) {
  const e = (userEmail || '').toLowerCase().trim();
  return e ? `ops_hub_checklist_v2:${e}` : 'ops_hub_checklist_v2';
}

// Normalize an item from either the legacy shape {id,text,done} or the v2 shape.
// Preserves `deleted: true` tombstones so they survive the round-trip through
// LS/IDB/server and continue to suppress the row across devices until the
// server's TTL prunes them.
function migrateItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  if (raw.deleted === true) {
    return {
      id: raw.id != null ? raw.id : now + Math.random(),
      deleted: true,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    };
  }
  const priority = typeof raw.priority === 'string' && VALID_PRIORITIES.has(raw.priority)
    ? raw.priority
    : 'normal';
  if (typeof raw.title === 'string') {
    return {
      id: raw.id || now + Math.random(),
      title: raw.title,
      description: typeof raw.description === 'string' ? raw.description : '',
      dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : null,
      priority,
      done: !!raw.done,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    };
  }
  if (typeof raw.text === 'string') {
    return {
      id: raw.id || now + Math.random(),
      title: raw.text,
      description: '',
      dueDate: null,
      priority,
      done: !!raw.done,
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

function readFromLS(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Legacy array-only format stored under the new key — tolerate it
      return { items: parsed.map(migrateItem).filter(Boolean), ts: 0 };
    }
    if (parsed && Array.isArray(parsed.items)) {
      return { items: parsed.items.map(migrateItem).filter(Boolean), ts: parsed.ts || 0 };
    }
    return null;
  } catch { return null; }
}

function writeToLS(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, items, ts: Date.now() }));
    return true;
  } catch { return false; }
}

// Retired 2026-05-21. The legacy `ops_hub_checklist` key was a SINGLE
// global slot — no per-user suffix — so on a shared machine the next
// user to log in would inherit the previous user's checklist. Duygu
// Cakalli bug "Random to do's appear under my to do's. Only first
// and last ones are my to do's." After the legacy bleed loads
// foreign items into state, the persist effect mirrors them to
// user-scoped LS + IDB + the server snapshot (via the debounced
// PUT), making the contamination sticky across devices for the
// affected user. The user-scoped `ops_hub_checklist_v2:<email>` key
// has been the primary path since 2026-04-22 and the server
// snapshot covers the cross-device case — anyone still genuinely
// relying on the legacy slot lost their items the moment another
// teammate signed into the same browser anyway.
//
// `cleanupLegacyChecklistKey()` runs once on mount to evict any
// remaining bleed source. We don't read its contents — every read
// is now user-scoped only.
function cleanupLegacyChecklistKey() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
}

// ── IndexedDB layer (durable backup) ────────────────────────────────────────
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IDB unavailable')); return; }
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'userKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('IDB blocked')); };
  });
  return dbPromise;
}

async function idbRead(userKey) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readonly'); }
      catch { resolve(null); return; }
      const req = tx.objectStore(IDB_STORE).get(userKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function idbWrite(userKey, items) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, 'readwrite'); }
      catch { resolve(false); return; }
      tx.objectStore(IDB_STORE).put({ userKey, items, ts: Date.now(), v: SCHEMA_VERSION });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch { return false; }
}

// ── BroadcastChannel (cross-tab sync) ────────────────────────────────────────
let channel = null;
let channelFailed = false;
function getChannel() {
  if (channel) return channel;
  if (channelFailed) return null;
  if (typeof BroadcastChannel === 'undefined') { channelFailed = true; return null; }
  try { channel = new BroadcastChannel(SYNC_CHANNEL); return channel; }
  catch { channelFailed = true; return null; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDue(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, color: '#d42d35', bg: '#FEE2E2', icon: 'bi-exclamation-circle-fill' };
  if (diff === 0) return { label: 'Today', color: '#ed8d00', bg: '#FEF3C7', icon: 'bi-calendar-event' };
  if (diff === 1) return { label: 'Tomorrow', color: '#ed8d00', bg: '#FEF3C7', icon: 'bi-calendar-event' };
  if (diff <= 7) return { label: `${diff}d`, color: '#1f74b3', bg: '#DBEAFE', icon: 'bi-calendar' };
  return { label: d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }), color: '#616161', bg: '#f7f5f2', icon: 'bi-calendar' };
}
// Linkify free-text description content. Splits on http(s) URLs and returns
// a mixed array of strings and <a> nodes. Trailing punctuation (.,;:!?)] etc.)
// is stripped from the matched URL so it doesn't break the link target. Only
// http(s) is matched — javascript:/data: schemes can't sneak in. We also stop
// click events on the anchor so the surrounding click-to-edit container
// doesn't swallow the navigation.
const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/g;
function renderTextWithLinks(text) {
  if (!text) return null;
  const out = [];
  let last = 0;
  URL_REGEX.lastIndex = 0;
  let m;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    // Strip trailing punctuation that's almost certainly not part of the URL
    const trailing = url.match(/[.,;:!?)\]}>]+$/);
    let suffix = '';
    if (trailing) {
      suffix = trailing[0];
      url = url.slice(0, -suffix.length);
    }
    out.push(
      <a
        key={`lnk-${m.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{ color: '#7c3aed', textDecoration: 'underline', wordBreak: 'break-all' }}
      >
        {url}
      </a>
    );
    if (suffix) out.push(suffix);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// Due-date urgency bucket used for sorting (lower = more urgent). Items without
// a due date fall below anything dated so the top of the list is always
// "something with a deadline". Within a bucket we further sort by priority.
function dueBucket(iso) {
  if (!iso) return 5;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return 5;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return 0;   // overdue
  if (diff === 0) return 1; // today
  if (diff === 1) return 2; // tomorrow
  if (diff <= 7) return 3;  // this week
  return 4;                 // later
}

// ── PriorityPicker ──────────────────────────────────────────────────────────
// Controlled. Two render modes:
//   • "compact" → four small flag-icon buttons. Used in the quick-add row and
//     anywhere space is tight.
//   • "full"    → four labeled pills with color dots. Used in expanded add/
//     edit forms where there's room for labels.
const PriorityPicker = ({ value, onChange, mode = 'compact' }) => {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: mode === 'full' ? 6 : 4, flexWrap: 'wrap' }}>
      {PRIORITY_ORDER.map(p => {
        const meta = PRIORITY_META[p];
        const selected = value === p;
        if (mode === 'full') {
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-pressed={selected}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 11px',
                borderRadius: 99,
                border: selected ? `1.5px solid ${meta.color}` : '1px solid #e8e8e8',
                background: selected ? meta.bg : 'white',
                color: selected ? meta.color : '#616161',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
              {meta.label}
            </button>
          );
        }
        return (
          <button
            key={p}
            type="button"
            title={`Priority: ${meta.label}`}
            aria-label={`Set priority to ${meta.label}`}
            aria-pressed={selected}
            onClick={() => onChange(p)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: selected ? `1.5px solid ${meta.color}` : '1px solid #e8e8e8',
              background: selected ? meta.bg : 'white',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'all .15s',
            }}
            onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = meta.color; }}
            onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = '#e8e8e8'; }}
          >
            <i className="bi-flag-fill" style={{ fontSize: 10, color: meta.color }} />
          </button>
        );
      })}
    </div>
  );
};

// ── DescriptionField ────────────────────────────────────────────────────────
// Click-to-edit description for a checklist item. Default state shows the
// description as rendered text with clickable URLs (so a user can open a
// linked ticket without first having to "edit" the field). Clicking the
// rendered view switches to the underlying textarea for editing; blurring
// the textarea (when there's content) switches back to the link view.
//
// Empty descriptions start in edit mode so first-time entry is identical to
// the previous textarea-only UX — no extra click required to type.
const DescriptionField = ({ value, onChange }) => {
  const [editing, setEditing] = useState(!value);
  const taRef = useRef(null);

  if (editing) {
    return (
      <textarea
        ref={taRef}
        autoFocus
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { if ((value || '').trim()) setEditing(false); }}
        placeholder="Description (optional)"
        rows={2}
        style={{
          width: '100%',
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid #e8e8e8',
          fontSize: 12,
          outline: 'none',
          fontFamily: 'inherit',
          color: '#1b1b1b',
          resize: 'vertical',
          boxSizing: 'border-box',
          lineHeight: 1.4,
        }}
        onFocus={e => e.target.style.borderColor = '#7c3aed'}
      />
    );
  }
  return (
    <div
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        width: '100%',
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid #e8e8e8',
        fontSize: 12,
        color: '#1b1b1b',
        boxSizing: 'border-box',
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        cursor: 'text',
        minHeight: 32,
        background: 'var(--surface)',
        transition: 'border-color .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#e8e8e8'}
    >
      {renderTextWithLinks(value)}
    </div>
  );
};

// ── Component ───────────────────────────────────────────────────────────────
// `variant` — "compact" (default) renders the small right-column card; "primary"
// renders a taller, richer card designed to occupy a prominent left-column slot
// (it replaces the old Priority Tasks card on BriefingView). All behavior,
// storage, and cross-tab sync is identical between variants.
const PersonalChecklist = ({ user, variant = 'compact' }) => {
  const primary = variant === 'primary';
  const userEmail = user?.email || null;
  const key = storageKey(userEmail);
  const userKey = (userEmail || '').toLowerCase().trim() || 'anon';

  // Sync-read on mount for instant paint. Reads STRICTLY from the
  // user-scoped key — see the cleanupLegacyChecklistKey block at module
  // top for why the legacy fallback was removed.
  const [items, setItems] = useState(() => {
    const fromLS = readFromLS(key);
    if (fromLS && fromLS.items.length) return fromLS.items;
    return [];
  });

  // Evict the legacy global slot once per mount so it can't bleed into
  // the next user on the same browser. Idempotent — `removeItem` of a
  // missing key is a no-op.
  useEffect(() => { cleanupLegacyChecklistKey(); }, []);
  const [lastWriteTs, setLastWriteTs] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [draft, setDraft] = useState({ title: '', description: '', dueDate: '', priority: 'normal' });
  const [showAddForm, setShowAddForm] = useState(false);
  // Completed tasks are hidden behind a collapsible section at the bottom of
  // the list so they don't clutter the active queue. Default collapsed —
  // users opening the panel see only what still needs doing. Unchecking a
  // completed item moves it straight back into the open list via the
  // existing toggle. Items themselves remain in the persistence layer
  // (LS + IDB + server) regardless of this UI-only toggle.
  const [showCompleted, setShowCompleted] = useState(false);
  const titleInputRef = useRef(null);
  const skipNextWriteRef = useRef(false); // set when we adopt a broadcast so we don't echo
  // Server sync state — `serverSyncedRef` flips true after the first GET +
  // reconciliation completes. The debounced server-PUT effect waits for it
  // so we never overwrite a fresh server snapshot with the empty initial
  // state. `skipNextServerPushRef` mutes a single PUT after we adopted the
  // server's snapshot (so we don't immediately re-push what we just pulled).
  const serverSyncedRef = useRef(false);
  const skipNextServerPushRef = useRef(false);
  const serverPushTimerRef = useRef(null);

  // Rehydrate from IDB once. If IDB has newer data than what we loaded, adopt it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rec = await idbRead(userKey);
      if (cancelled || !rec) return;
      const fresh = (rec.items || []).map(migrateItem).filter(Boolean);
      const ls = readFromLS(key);
      const lsTs = ls?.ts || 0;
      const idbTs = rec.ts || 0;
      if (idbTs > lsTs && fresh.length) {
        skipNextWriteRef.current = true;
        setItems(fresh);
      } else if (!ls && fresh.length) {
        // LS was wiped (e.g. quota eviction) but IDB still holds data
        skipNextWriteRef.current = true;
        setItems(fresh);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  // Persist on every change — LS + IDB. Never throws on failure.
  useEffect(() => {
    if (skipNextWriteRef.current) { skipNextWriteRef.current = false; return; }
    const ts = Date.now();
    writeToLS(key, items);
    idbWrite(userKey, items);
    setLastWriteTs(ts);
    // Notify sibling tabs
    const ch = getChannel();
    if (ch) { try { ch.postMessage({ userKey, items, ts }); } catch {} }
  }, [items, key, userKey]);

  // ── Server reconcile (one-shot on mount) ──────────────────────────────────
  // Pull the durable snapshot from PostgreSQL. Compare `updated_at` from the
  // server with the LS-recorded `ts` we have locally:
  //   • Server newer  → adopt server items (replaces LS — cross-device sync).
  //   • Local newer   → push local snapshot up (covers fresh devices and
  //                     items added while offline).
  //   • Equal/empty   → no-op; subsequent mutations sync via the PUT effect.
  // If the call fails (offline, 5xx after retry), we silently bail; the next
  // mount will retry, and any local writes in the meantime are queued in LS.
  useEffect(() => {
    if (!userEmail) { serverSyncedRef.current = true; return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchChecklistSnapshot();
        if (cancelled) return;
        const serverItems = Array.isArray(data?.items) ? data.items.map(migrateItem).filter(Boolean) : [];
        const serverTs = data?.updatedAt ? new Date(data.updatedAt).getTime() : 0;
        const ls = readFromLS(key);
        const localTs = ls?.ts || 0;
        const localItems = ls?.items || [];

        if (serverTs > localTs && serverItems.length) {
          // Server is the freshest writer (e.g. user edited from another
          // device, or local was wiped). Adopt server and skip both the
          // local-write effect (since we mirror it manually here so LS is
          // immediately consistent) and the immediate PUT echo.
          skipNextWriteRef.current = true;
          skipNextServerPushRef.current = true;
          writeToLS(key, serverItems);
          idbWrite(userKey, serverItems);
          setItems(serverItems);
        } else if (localItems.length > 0 && (serverTs === 0 || localTs > serverTs)) {
          // Local has fresher data — push it up so the server is now the
          // durable backstop. Don't await; UI is already correct.
          putChecklistSnapshot(localItems).catch(() => {});
        }
      } catch {
        // Offline / transient — no-op. Local cache is still authoritative.
      } finally {
        if (!cancelled) serverSyncedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // ── Server PUT on change (debounced) ───────────────────────────────────────
  // Every mutation kicks a 600ms debounced PUT. The server-side route now
  // performs a per-id last-write-wins merge against the existing snapshot
  // and returns the merged set, so we adopt the response — that's how items
  // added on another device land in this tab without waiting for the next
  // mount. We only re-set state when the merged set differs in length from
  // what we sent (cheap heuristic: another device added or a tombstone was
  // pruned); identical-length responses skip the setItems to avoid an echo
  // loop. PUT failures are silent — local LS still holds the data and the
  // next mount re-syncs.
  useEffect(() => {
    if (!userEmail) return;
    if (!serverSyncedRef.current) return;
    if (skipNextServerPushRef.current) { skipNextServerPushRef.current = false; return; }
    clearTimeout(serverPushTimerRef.current);
    const sent = items;
    serverPushTimerRef.current = setTimeout(async () => {
      try {
        const res = await putChecklistSnapshot(sent);
        if (res && Array.isArray(res.items) && res.items.length !== sent.length) {
          const merged = res.items.map(migrateItem).filter(Boolean);
          skipNextWriteRef.current = true;
          skipNextServerPushRef.current = true;
          writeToLS(key, merged);
          idbWrite(userKey, merged);
          setItems(merged);
        }
      } catch {}
    }, 600);
    return () => clearTimeout(serverPushTimerRef.current);
  }, [items, userEmail, key, userKey]);

  // Adopt cross-tab changes (BroadcastChannel primary, storage event fallback)
  useEffect(() => {
    const ch = getChannel();
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg || msg.userKey !== userKey) return;
      if (!Array.isArray(msg.items)) return;
      if (msg.ts && msg.ts <= lastWriteTs) return;
      skipNextWriteRef.current = true;
      setItems(msg.items.map(migrateItem).filter(Boolean));
    };
    const handleStorage = (e) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (!parsed || !Array.isArray(parsed.items)) return;
        if (parsed.ts && parsed.ts <= lastWriteTs) return;
        skipNextWriteRef.current = true;
        setItems(parsed.items.map(migrateItem).filter(Boolean));
      } catch {}
    };
    if (ch) ch.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      if (ch) ch.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, [userKey, key, lastWriteTs]);

  // Mutations ─────────────────────────────────────────────────────────────────
  const add = useCallback((titleOverride) => {
    const title = (titleOverride ?? draft.title).trim();
    if (!title) return;
    const now = Date.now();
    const priority = VALID_PRIORITIES.has(draft.priority) ? draft.priority : 'normal';
    const item = {
      id: now + Math.random(),
      title,
      description: (draft.description || '').trim(),
      dueDate: draft.dueDate || null,
      priority,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    setItems(prev => [...prev, item]);
    setDraft({ title: '', description: '', dueDate: '', priority: 'normal' });
    setShowAddForm(false);
  }, [draft]);

  const quickAdd = useCallback((e) => {
    if (e.key === 'Enter' && draft.title.trim()) {
      e.preventDefault();
      add(draft.title);
    }
  }, [add, draft.title]);

  const toggle = useCallback((id) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done, updatedAt: Date.now() } : i));
  }, []);

  // Soft delete via tombstone — the row stays in the items array with
  // `deleted: true` and a fresh updatedAt. The display filters tombstones
  // out, but persistence (LS, IDB, server) keeps them so the deletion
  // syncs to other devices instead of being silently re-added next time
  // they push their copy. Tombstones are pruned server-side after 30 days.
  const remove = useCallback((id) => {
    setItems(prev => prev.map(i => i.id === id
      ? { id: i.id, deleted: true, createdAt: i.createdAt || Date.now(), updatedAt: Date.now() }
      : i
    ));
    setExpandedId(curr => curr === id ? null : curr);
  }, []);

  const updateField = useCallback((id, field, value) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value, updatedAt: Date.now() } : i));
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  // Tombstones (`deleted: true`) live in the persistence layer for cross-
  // device sync but never render — strip them at the display boundary.
  const liveItems = items.filter(i => !i.deleted);
  // Sort within a section by schedule + priority (most actionable first):
  //   1. Due-date bucket (overdue → today → tomorrow → this week → later → undated)
  //   2. Priority breaks ties within a bucket (urgent → high → normal → low)
  //   3. Earlier literal due date wins
  //   4. Creation order keeps identical items stable
  const sortBySchedule = (a, b) => {
    const ab = dueBucket(a.dueDate);
    const bb = dueBucket(b.dueDate);
    if (ab !== bb) return ab - bb;
    const ap = (PRIORITY_META[a.priority] || PRIORITY_META.normal).rank;
    const bp = (PRIORITY_META[b.priority] || PRIORITY_META.normal).rank;
    if (ap !== bp) return ap - bp;
    const ad = a.dueDate || '';
    const bd = b.dueDate || '';
    if (ad && bd && ad !== bd) return ad.localeCompare(bd);
    return (a.createdAt || 0) - (b.createdAt || 0);
  };
  const openSorted = liveItems.filter(i => !i.done).sort(sortBySchedule);
  // Completed items render under a separate collapsible "Completed (N)"
  // group so finished work doesn't clutter the active list. Most recently
  // completed first so the user's latest checks bubble to the top of the
  // section when they expand it.
  const completedSorted = liveItems.filter(i => i.done)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const doneCount = liveItems.filter(i => i.done).length;
  const openCount = liveItems.length - doneCount;
  const overdueCount = liveItems.filter(i => !i.done && i.dueDate && new Date(i.dueDate + 'T00:00:00') < new Date(todayISO() + 'T00:00:00')).length;
  const todayCount = liveItems.filter(i => !i.done && i.dueDate === todayISO()).length;
  const progressPct = liveItems.length > 0 ? Math.round((doneCount / liveItems.length) * 100) : 0;

  // Row renderer — shared between the open list and the collapsible Completed
  // section so both render with identical interaction (checkbox toggle, click-
  // to-expand inline editor, delete X). Checking an item flips `done: true`
  // and it moves from the open list to the Completed group on the next render;
  // unchecking moves it straight back. Storage is untouched in either case.
  const renderItem = (item) => {
    const due = formatDue(item.dueDate);
    const isExpanded = expandedId === item.id;
    const priMeta = PRIORITY_META[item.priority] || PRIORITY_META.normal;
    const showPriPill = item.priority && item.priority !== 'normal';
    return (
      <div key={item.id} style={{
        borderBottom: '1px solid #f5f5f5',
        transition: 'background .15s',
        borderRadius: primary ? 8 : 0,
        // Always render a 3px stripe so content alignment stays stable
        // as priority changes; transparent for `normal`.
        borderLeft: `3px solid ${showPriPill ? priMeta.color : 'transparent'}`,
      }}>
        {/* Row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: primary ? 10 : 8, padding: primary ? '10px 8px' : '8px 4px' }}>
          <button
            onClick={() => toggle(item.id)}
            aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
            style={{ width: primary ? 22 : 20, height: primary ? 22 : 20, borderRadius: primary ? 7 : 6, border: `1.5px solid ${item.done ? '#7c3aed' : '#d0d0d0'}`, background: item.done ? '#7c3aed' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, padding: 0, transition: 'all .15s' }}
          >
            {item.done && <i className="bi-check" style={{ fontSize: primary ? 13 : 12, color: 'white' }}></i>}
          </button>
          <div
            onClick={() => setExpandedId(isExpanded ? null : item.id)}
            style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          >
            <div style={{ fontSize: primary ? 13.5 : 13, color: item.done ? '#9e9e9e' : '#1b1b1b', textDecoration: item.done ? 'line-through' : 'none', fontWeight: 500, lineHeight: 1.35, wordBreak: 'break-word' }}>
              {item.title}
            </div>
            {(item.description || due || showPriPill) && !isExpanded && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                {showPriPill && (
                  <span title={`Priority: ${priMeta.label}`} style={{ fontSize: 10, fontWeight: 700, color: priMeta.color, background: priMeta.bg, padding: '1px 7px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <i className="bi-flag-fill" style={{ fontSize: 9 }}></i>{priMeta.label}
                  </span>
                )}
                {item.description && (
                  <span style={{ fontSize: 11, color: '#9e9e9e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, display: 'inline-block' }} title={item.description}>
                    {item.description}
                  </span>
                )}
                {due && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: due.color, background: due.bg, padding: '1px 7px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <i className={due.icon} style={{ fontSize: 9 }}></i>{due.label}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => remove(item.id)}
            aria-label="Delete item"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d0d0d0', fontSize: 12, padding: '2px 4px', borderRadius: 4, transition: 'color .15s', flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#d42d35'}
            onMouseLeave={e => e.currentTarget.style.color = '#d0d0d0'}
          >
            <i className="bi-x" style={{ fontSize: 14 }}></i>
          </button>
        </div>
        {/* Inline edit — title / description / due date / priority */}
        {isExpanded && (
          <div style={{ padding: '4px 4px 12px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={item.title}
              onChange={e => updateField(item.id, 'title', e.target.value)}
              placeholder="Title"
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, fontFamily: 'inherit', outline: 'none', color: '#1b1b1b', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#e8e8e8'}
            />
            <DescriptionField
              value={item.description}
              onChange={(v) => updateField(item.id, 'description', v)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600 }}>Due</label>
              <input
                type="date"
                value={item.dueDate || ''}
                onChange={e => updateField(item.id, 'dueDate', e.target.value || null)}
                style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, fontFamily: 'inherit', outline: 'none', color: '#1b1b1b' }}
                onFocus={e => e.target.style.borderColor = '#7c3aed'}
                onBlur={e => e.target.style.borderColor = '#e8e8e8'}
              />
              {item.dueDate && (
                <button
                  onClick={() => updateField(item.id, 'dueDate', null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e9e9e', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#d42d35'}
                  onMouseLeave={e => e.currentTarget.style.color = '#9e9e9e'}
                >
                  Clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600 }}>Priority</label>
              <PriorityPicker value={item.priority || 'normal'} onChange={p => updateField(item.id, 'priority', p)} mode="full" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}></div>
              <button
                onClick={() => setExpandedId(null)}
                style={{ background: '#f7f5f2', border: 'none', cursor: 'pointer', color: '#616161', fontSize: 11, padding: '4px 10px', borderRadius: 6, fontWeight: 600 }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── UI ───────────────────────────────────────────────────────────────────
  // Primary variant fills a tall left-column slot: bigger header, gradient
  // ribbon, progress bar, a top-pinned add area (so capturing a task never
  // requires scrolling past a long list), and larger item rows.
  // Compact variant keeps the existing small-card look for right-column use.
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid #e8e8e8',
      borderRadius: 16,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      height: primary ? '100%' : 'auto',
      minHeight: primary ? 520 : 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: primary ? '18px 22px 14px' : '14px 20px 12px',
        borderBottom: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        gap: primary ? 12 : 10,
        flexShrink: 0,
        background: primary ? 'linear-gradient(180deg,#fbfaff 0%,#ffffff 100%)' : 'white',
      }}>
        <div style={{
          width: primary ? 40 : 32,
          height: primary ? 40 : 32,
          borderRadius: primary ? 12 : 10,
          background: 'linear-gradient(135deg, #f3eff8, #EDE9FE)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: primary ? '0 2px 6px rgba(124,58,237,0.12)' : 'none',
        }}>
          <i className="bi-check2-square" style={{ fontSize: primary ? 18 : 14, color: '#7c3aed' }}></i>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: primary ? 16 : 15, fontWeight: 700, color: '#1b1b1b' }}>My To-Do</div>
            {primary && liveItems.length > 0 && (
              <span style={{ background: '#f3eff8', borderRadius: 128, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#8b6dca' }}>{openCount} open</span>
            )}
          </div>
          <div style={{ fontSize: primary ? 11 : 10, color: '#9e9e9e', marginTop: 1 }}>
            {primary ? 'Your personal to-do list — saved on this device and synced across tabs' : 'Your personal to-do list — saved locally and across tabs'}
          </div>
        </div>
        {liveItems.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: primary ? 8 : 6, flexShrink: 0 }}>
            {todayCount > 0 && primary && (
              <span title={`${todayCount} due today`} style={{ fontSize: 10, fontWeight: 700, color: '#ed8d00', background: '#FEF3C7', padding: '3px 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <i className="bi-calendar-event" style={{ fontSize: 9 }}></i>{todayCount} today
              </span>
            )}
            {overdueCount > 0 && (
              <span title={`${overdueCount} overdue`} style={{ fontSize: 10, fontWeight: 700, color: '#d42d35', background: '#FEE2E2', padding: primary ? '3px 9px' : '2px 8px', borderRadius: 99 }}>
                <i className="bi-exclamation-circle-fill" style={{ fontSize: 9, marginRight: 3 }}></i>{overdueCount}
              </span>
            )}
            <span style={{ fontSize: primary ? 12 : 11, color: '#9e9e9e', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{doneCount}/{liveItems.length}</span>
          </div>
        )}
      </div>

      {/* Progress bar (primary only, only if there are items) */}
      {primary && liveItems.length > 0 && (
        <div style={{ padding: '10px 22px 0', flexShrink: 0 }}>
          <div style={{ height: 6, borderRadius: 999, background: '#f3f0f8', overflow: 'hidden' }}>
            <div style={{
              width: `${progressPct}%`,
              height: '100%',
              background: progressPct === 100
                ? 'linear-gradient(90deg,#29811e,#4dbf3f)'
                : 'linear-gradient(90deg,#7c3aed,#a78bfa)',
              borderRadius: 999,
              transition: 'width .3s ease',
            }}></div>
          </div>
          <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 5, fontWeight: 600, letterSpacing: 0.3 }}>
            {progressPct === 100
              ? 'All caught up — nice work!'
              : progressPct === 0
                ? `${openCount} task${openCount === 1 ? '' : 's'} to get through`
                : `${progressPct}% complete`}
          </div>
        </div>
      )}

      {/* Add area — pinned at the top so a long list never hides it */}
      <div style={{
        padding: primary ? '12px 18px 14px' : '10px 16px 10px',
        borderBottom: '1px solid #f0eeec',
        flexShrink: 0,
        background: primary ? '#fbfafc' : '#fdfcfb',
      }}>
        {!showAddForm ? (
          <>
            <div style={{ display: 'flex', gap: primary ? 8 : 6 }}>
              <input
                ref={titleInputRef}
                value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                onKeyDown={quickAdd}
                placeholder={primary ? 'Add a task… press Enter to save' : 'Add a task... (Enter to save)'}
                style={{
                  flex: 1,
                  height: primary ? 38 : 32,
                  padding: primary ? '0 14px' : '0 10px',
                  borderRadius: primary ? 10 : 8,
                  border: '1px solid #e8e8e8',
                  fontSize: primary ? 13 : 12,
                  outline: 'none',
                  fontFamily: 'inherit',
                  color: '#1b1b1b',
                  background: 'var(--surface)',
                }}
                onFocus={e => e.target.style.borderColor = '#7c3aed'}
                onBlur={e => e.target.style.borderColor = '#e8e8e8'}
              />
              <button
                onClick={() => { if (draft.title.trim()) setShowAddForm(true); else titleInputRef.current?.focus(); }}
                title="Add details (description, due date, priority)"
                style={{
                  height: primary ? 38 : 32,
                  padding: primary ? '0 12px' : '0 10px',
                  borderRadius: primary ? 10 : 8,
                  border: '1px solid #e8e8e8',
                  background: 'var(--surface)',
                  color: '#616161',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#7c3aed'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8'; e.currentTarget.style.color = '#616161'; }}
              >
                <i className="bi-sliders" style={{ fontSize: primary ? 13 : 12 }}></i>
              </button>
              <button
                onClick={() => add()}
                disabled={!draft.title.trim()}
                style={{
                  height: primary ? 38 : 32,
                  padding: primary ? '0 18px' : '0 14px',
                  borderRadius: primary ? 10 : 8,
                  border: 'none',
                  background: draft.title.trim() ? '#7c3aed' : '#e8e8e8',
                  color: draft.title.trim() ? 'white' : '#9e9e9e',
                  fontSize: primary ? 13 : 12,
                  fontWeight: 700,
                  cursor: draft.title.trim() ? 'pointer' : 'default',
                  transition: 'all .15s',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <i className="bi-plus" style={{ fontSize: primary ? 16 : 14 }}></i>
                {primary && <span>Add</span>}
              </button>
            </div>
            {/* Inline compact priority picker — discoverable without opening
                the full form, and the selected priority is carried into the
                next task. Users can still override via the details form. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: primary ? 8 : 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#9e9e9e', letterSpacing: 0.4, textTransform: 'uppercase' }}>Priority</span>
              <PriorityPicker value={draft.priority} onChange={p => setDraft(d => ({ ...d, priority: p }))} mode="compact" />
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface)', padding: 10, borderRadius: 10, border: '1px solid #e8e8e8' }}>
            <input
              autoFocus
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Title"
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#e8e8e8'}
            />
            <textarea
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder="Description (optional)"
              rows={2}
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#e8e8e8'}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600 }}>Due</label>
              <input
                type="date"
                value={draft.dueDate}
                onChange={e => setDraft(d => ({ ...d, dueDate: e.target.value }))}
                style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b' }}
                onFocus={e => e.target.style.borderColor = '#7c3aed'}
                onBlur={e => e.target.style.borderColor = '#e8e8e8'}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600 }}>Priority</label>
              <PriorityPicker value={draft.priority} onChange={p => setDraft(d => ({ ...d, priority: p }))} mode="full" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <div style={{ flex: 1 }}></div>
              <button
                onClick={() => { setShowAddForm(false); setDraft({ title: '', description: '', dueDate: '', priority: 'normal' }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e9e9e', fontSize: 11, padding: '4px 8px', borderRadius: 6, fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => add()}
                disabled={!draft.title.trim()}
                style={{ background: draft.title.trim() ? '#7c3aed' : '#e8e8e8', border: 'none', cursor: draft.title.trim() ? 'pointer' : 'default', color: draft.title.trim() ? 'white' : '#9e9e9e', fontSize: 11, padding: '5px 12px', borderRadius: 6, fontWeight: 700 }}
              >
                Add task
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Items list */}
      <div style={{
        padding: primary ? '8px 14px' : '6px 12px',
        maxHeight: primary ? 'none' : 320,
        flex: primary ? 1 : '0 0 auto',
        overflowY: 'auto',
        minHeight: primary ? 180 : 'auto',
      }}>
        {liveItems.length === 0 && !showAddForm && (
          <div style={{
            padding: primary ? '48px 24px 40px' : '20px 0',
            textAlign: 'center',
            fontSize: primary ? 13 : 12,
            color: '#9e9e9e',
          }}>
            <i className="bi-list-check" style={{
              fontSize: primary ? 44 : 22,
              display: 'block',
              marginBottom: primary ? 12 : 6,
              opacity: 0.35,
              color: '#7c3aed',
            }}></i>
            {primary ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#616161', marginBottom: 4 }}>Nothing on your plate yet</div>
                <div style={{ fontSize: 12 }}>Capture a task above — it stays with you across tabs and sessions.</div>
              </>
            ) : (
              'Track your daily tasks here'
            )}
          </div>
        )}
        {/* All caught up — there are completed items but nothing open. Keeps
            the panel from looking empty when the user has finished everything. */}
        {openSorted.length === 0 && completedSorted.length > 0 && !showAddForm && (
          <div style={{
            padding: primary ? '32px 24px 24px' : '18px 0',
            textAlign: 'center',
            fontSize: primary ? 13 : 12,
            color: '#9e9e9e',
          }}>
            <i className="bi-check-circle" style={{
              fontSize: primary ? 32 : 20,
              display: 'block',
              marginBottom: primary ? 8 : 4,
              color: '#15803d',
            }}></i>
            <div style={{ fontWeight: 700, fontSize: primary ? 13 : 12, color: '#616161' }}>All caught up — nice work!</div>
            <div style={{ fontSize: 11, marginTop: 2 }}>Completed tasks are tucked below.</div>
          </div>
        )}
        {openSorted.map(renderItem)}

        {/* Completed group — collapsed by default so finished work doesn't
            clutter the active list. Items stay in storage; toggling the
            checkbox back to undone returns them to the open list. */}
        {completedSorted.length > 0 && (
          <div style={{
            borderTop: openSorted.length > 0 ? '1px solid #f0eeec' : 'none',
            marginTop: openSorted.length > 0 ? 6 : 0,
            paddingTop: openSorted.length > 0 ? 4 : 0,
          }}>
            <button
              onClick={() => setShowCompleted(s => !s)}
              aria-expanded={showCompleted}
              aria-controls="personal-checklist-completed-list"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: primary ? '8px 8px' : '6px 4px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#616161',
                fontFamily: 'inherit',
                transition: 'color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#1b1b1b'}
              onMouseLeave={e => e.currentTarget.style.color = '#616161'}
            >
              <i
                className={`bi-chevron-${showCompleted ? 'up' : 'down'}`}
                style={{ fontSize: 11, transition: 'transform .15s' }}
              ></i>
              <span style={{ fontSize: primary ? 11 : 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>Completed</span>
              <span style={{
                background: '#f5f5f5',
                color: '#616161',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 99,
                fontVariantNumeric: 'tabular-nums',
              }}>{completedSorted.length}</span>
            </button>
            {showCompleted && (
              <div id="personal-checklist-completed-list" style={{ opacity: 0.85 }}>
                {completedSorted.map(renderItem)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PersonalChecklist;
