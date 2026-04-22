// ── PersonalChecklist ─────────────────────────────────────────────────────────
// Per-user checklist of lightweight tasks with title, description, and due date.
//
// Durability contract (data MUST NOT be lost across refreshes / deploys / tab
// churn / partial backend failures):
//   1. Every mutation writes synchronously to localStorage (primary fast path).
//   2. Every mutation also writes to IndexedDB (durable backup that survives
//      even if localStorage is evicted due to quota pressure).
//   3. On mount we read localStorage synchronously for instant paint, then
//      asynchronously rehydrate from IDB. Whichever version is NEWER wins so
//      we never overwrite newer data with stale data.
//   4. A BroadcastChannel syncs mutations across tabs in real time; a
//      `storage` event listener catches other tabs as a belt-and-braces backup.
//   5. Items migrated from the legacy {id,text,done} shape once on first read
//      and preserved forever — no data is ever dropped.
//   6. All writes are best-effort — any thrown error is caught and the app
//      keeps running; the user never sees their input vanish.
//
// Works for every role (Agent / Team Lead / Regional Manager / Admin/Director).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';

const LEGACY_KEY = 'ops_hub_checklist';
const SYNC_CHANNEL = 'ops_hub_checklist_sync';
const IDB_NAME = 'ops_hub_checklist';
const IDB_STORE = 'items';
const SCHEMA_VERSION = 2;

// Per-user storage key — protects checklists on shared machines
function storageKey(userEmail) {
  const e = (userEmail || '').toLowerCase().trim();
  return e ? `ops_hub_checklist_v2:${e}` : 'ops_hub_checklist_v2';
}

// Normalize an item from either the legacy shape {id,text,done} or the v2 shape
function migrateItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  if (typeof raw.title === 'string') {
    return {
      id: raw.id || now + Math.random(),
      title: raw.title,
      description: typeof raw.description === 'string' ? raw.description : '',
      dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : null,
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

// Read the legacy global key (old format) so existing users don't lose data
function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const items = parsed.map(migrateItem).filter(Boolean);
    return items.length ? items : null;
  } catch { return null; }
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

// ── Component ───────────────────────────────────────────────────────────────
const PersonalChecklist = ({ user }) => {
  const userEmail = user?.email || null;
  const key = storageKey(userEmail);
  const userKey = (userEmail || '').toLowerCase().trim() || 'anon';

  // Sync-read on mount for instant paint — never starts empty if data exists
  const [items, setItems] = useState(() => {
    const fromLS = readFromLS(key);
    if (fromLS && fromLS.items.length) return fromLS.items;
    const legacy = readLegacy();
    if (legacy && legacy.length) return legacy;
    return [];
  });
  const [lastWriteTs, setLastWriteTs] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [draft, setDraft] = useState({ title: '', description: '', dueDate: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const titleInputRef = useRef(null);
  const skipNextWriteRef = useRef(false); // set when we adopt a broadcast so we don't echo

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
    const item = {
      id: now + Math.random(),
      title,
      description: (draft.description || '').trim(),
      dueDate: draft.dueDate || null,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    setItems(prev => [...prev, item]);
    setDraft({ title: '', description: '', dueDate: '' });
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

  const remove = useCallback((id) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setExpandedId(curr => curr === id ? null : curr);
  }, []);

  const updateField = useCallback((id, field, value) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value, updatedAt: Date.now() } : i));
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const sorted = [...items].sort((a, b) => {
    // Incomplete first; within incomplete: overdue → today → dated → undated
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.dueDate || '';
    const bd = b.dueDate || '';
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    if (ad && bd) return ad.localeCompare(bd);
    return a.createdAt - b.createdAt;
  });
  const doneCount = items.filter(i => i.done).length;
  const overdueCount = items.filter(i => !i.done && i.dueDate && new Date(i.dueDate + 'T00:00:00') < new Date(todayISO() + 'T00:00:00')).length;

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #f3eff8, #EDE9FE)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-check2-square" style={{ fontSize: 14, color: '#7c3aed' }}></i>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>My Checklist</div>
          <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 1 }}>Your personal to-do list — saved locally and across tabs</div>
        </div>
        {items.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {overdueCount > 0 && <span title={`${overdueCount} overdue`} style={{ fontSize: 10, fontWeight: 700, color: '#d42d35', background: '#FEE2E2', padding: '2px 8px', borderRadius: 99 }}><i className="bi-exclamation-circle-fill" style={{ fontSize: 9, marginRight: 3 }}></i>{overdueCount}</span>}
            <span style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{doneCount}/{items.length}</span>
          </div>
        )}
      </div>

      {/* Items list */}
      <div style={{ padding: '6px 12px', maxHeight: 320, overflowY: 'auto' }}>
        {items.length === 0 && !showAddForm && (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: '#9e9e9e' }}>
            <i className="bi-list-check" style={{ fontSize: 22, display: 'block', marginBottom: 6, opacity: 0.4 }}></i>
            Track your daily tasks here
          </div>
        )}
        {sorted.map(item => {
          const due = formatDue(item.dueDate);
          const isExpanded = expandedId === item.id;
          return (
            <div key={item.id} style={{ borderBottom: '1px solid #f5f5f5', transition: 'background .15s' }}>
              {/* Row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 4px' }}>
                <button
                  onClick={() => toggle(item.id)}
                  aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
                  style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${item.done ? '#7c3aed' : '#d0d0d0'}`, background: item.done ? '#7c3aed' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, padding: 0, transition: 'all .15s' }}
                >
                  {item.done && <i className="bi-check" style={{ fontSize: 12, color: 'white' }}></i>}
                </button>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                >
                  <div style={{ fontSize: 13, color: item.done ? '#9e9e9e' : '#1b1b1b', textDecoration: item.done ? 'line-through' : 'none', fontWeight: 500, lineHeight: 1.35, wordBreak: 'break-word' }}>
                    {item.title}
                  </div>
                  {(item.description || due) && !isExpanded && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
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
              {/* Inline edit — title / description / due date */}
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
                  <textarea
                    value={item.description || ''}
                    onChange={e => updateField(item.id, 'description', e.target.value)}
                    placeholder="Description (optional)"
                    rows={2}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, fontFamily: 'inherit', outline: 'none', color: '#1b1b1b', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }}
                    onFocus={e => e.target.style.borderColor = '#7c3aed'}
                    onBlur={e => e.target.style.borderColor = '#e8e8e8'}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        })}
      </div>

      {/* Add area */}
      <div style={{ padding: '10px 16px 12px', borderTop: '1px solid #f5f5f5' }}>
        {!showAddForm ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={titleInputRef}
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              onKeyDown={quickAdd}
              placeholder="Add a task... (Enter to save)"
              style={{ flex: 1, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b' }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#e8e8e8'}
            />
            <button
              onClick={() => { if (draft.title.trim()) setShowAddForm(true); else titleInputRef.current?.focus(); }}
              title="Add details (description, due date)"
              style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#616161', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#7c3aed'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8'; e.currentTarget.style.color = '#616161'; }}
            >
              <i className="bi-sliders" style={{ fontSize: 12 }}></i>
            </button>
            <button
              onClick={() => add()}
              disabled={!draft.title.trim()}
              style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', background: draft.title.trim() ? '#7c3aed' : '#e8e8e8', color: draft.title.trim() ? 'white' : '#9e9e9e', fontSize: 12, fontWeight: 700, cursor: draft.title.trim() ? 'pointer' : 'default', transition: 'all .15s' }}
            >
              <i className="bi-plus" style={{ fontSize: 14 }}></i>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#fafaf9', padding: 10, borderRadius: 10, border: '1px solid #e8e8e8' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 11, color: '#9e9e9e', fontWeight: 600 }}>Due</label>
              <input
                type="date"
                value={draft.dueDate}
                onChange={e => setDraft(d => ({ ...d, dueDate: e.target.value }))}
                style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 12, outline: 'none', fontFamily: 'inherit', color: '#1b1b1b' }}
                onFocus={e => e.target.style.borderColor = '#7c3aed'}
                onBlur={e => e.target.style.borderColor = '#e8e8e8'}
              />
              <div style={{ flex: 1 }}></div>
              <button
                onClick={() => { setShowAddForm(false); setDraft({ title: '', description: '', dueDate: '' }); }}
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
    </div>
  );
};

export default PersonalChecklist;
