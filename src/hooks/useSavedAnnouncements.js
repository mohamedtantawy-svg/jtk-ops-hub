// ── useSavedAnnouncements ────────────────────────────────────────────────
// Per-user "save for later" bookmarks for announcements. Storage is
// client-only (no API) because the saved list is a personal preference,
// not a shared collaboration artefact — every user curates their own.
//
// Storage: user-scoped localStorage under `ops_hub_saved_announcements:<email>`
// (lowercased) — same pattern as PersonalChecklist / useTaskNotes so two
// users on the same machine don't bleed into each other.
//
// Cross-tab sync via BroadcastChannel `ops_hub_saved_announcements_sync`.
// Messages carry `userEmail` so a tab logged in as user A discards updates
// from a tab logged in as user B.
//
// Exposes:
//   • savedIds:  Set<number|string>
//   • isSaved(id) → boolean
//   • toggleSave(id) → void
//   • count: number

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const BASE_KEY = 'ops_hub_saved_announcements';
const CHANNEL_NAME = 'ops_hub_saved_announcements_sync';

function storageKeyFor(userEmail) {
  const lc = (userEmail || '').toLowerCase();
  return lc ? `${BASE_KEY}:${lc}` : BASE_KEY;
}

function readSaved(userEmail) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userEmail));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSaved(userEmail, ids) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKeyFor(userEmail), JSON.stringify(ids));
  } catch {
    // Quota exceeded or storage disabled — best-effort.
  }
}

let _channel = null;
let _channelFailed = false;
function getChannel() {
  if (_channel) return _channel;
  if (_channelFailed) return null;
  if (typeof BroadcastChannel === 'undefined') { _channelFailed = true; return null; }
  try { _channel = new BroadcastChannel(CHANNEL_NAME); return _channel; }
  catch { _channelFailed = true; return null; }
}

export function useSavedAnnouncements(userEmail) {
  const emailLc = (userEmail || '').toLowerCase();
  const [savedIds, setSavedIds] = useState(() => new Set(readSaved(emailLc)));
  const savedRef = useRef(savedIds);
  useEffect(() => { savedRef.current = savedIds; }, [savedIds]);

  // Re-hydrate when the viewer changes (login swap, impersonation toggle).
  useEffect(() => {
    setSavedIds(new Set(readSaved(emailLc)));
  }, [emailLc]);

  // Cross-tab adoption — discard messages from other users on the same machine.
  useEffect(() => {
    const ch = getChannel();
    if (!ch) return undefined;
    const onMessage = (e) => {
      const msg = e?.data;
      if (!msg || msg.userEmail !== emailLc) return;
      if (!Array.isArray(msg.ids)) return;
      setSavedIds(new Set(msg.ids));
    };
    ch.addEventListener('message', onMessage);
    return () => ch.removeEventListener('message', onMessage);
  }, [emailLc]);

  const persist = useCallback((nextSet) => {
    const arr = [...nextSet];
    setSavedIds(nextSet);
    writeSaved(emailLc, arr);
    const ch = getChannel();
    try { ch?.postMessage({ userEmail: emailLc, ids: arr, ts: Date.now() }); } catch {}
  }, [emailLc]);

  const toggleSave = useCallback((id) => {
    if (id === null || id === undefined) return;
    const cur = savedRef.current;
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persist(next);
  }, [persist]);

  const isSaved = useCallback((id) => {
    if (id === null || id === undefined) return false;
    return savedRef.current.has(id);
  }, []);

  const count = useMemo(() => savedIds.size, [savedIds]);

  return { savedIds, isSaved, toggleSave, count };
}
