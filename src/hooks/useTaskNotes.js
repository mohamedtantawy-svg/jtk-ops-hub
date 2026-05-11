// ── useTaskNotes ──────────────────────────────────────────────────────────
// Per-user personal notes attached to any queue row by a stable
// `${source}:${id}` key. The key is derived from the row's source + id
// (e.g. `onboarding:abc123`, `zendesk:18234`) which is the same identifier
// the row's taskUrl encodes, so notes survive every queue re-sync — the
// hook never reads sync results, it only stores text keyed by a row's
// stable identity.
//
// Storage: user-scoped localStorage under `ops_hub_task_notes:<email>`.
// Cross-tab sync via BroadcastChannel `ops_hub_task_notes_sync` — adopts
// updates only when `msg.userEmail` matches the current viewer so two
// users on the same device don't bleed notes into each other.
//
// The hook exposes:
//   • notes:   { [key]: { text, updatedAt } }  — full map (rarely needed)
//   • hasNote(source, id) → boolean
//   • getNote(source, id) → string ('' when missing)
//   • setNote(source, id, text)
//   • removeNote(source, id)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const BASE_KEY = 'ops_hub_task_notes';
const CHANNEL_NAME = 'ops_hub_task_notes_sync';
const MAX_NOTE_LENGTH = 5000;

function storageKeyFor(userEmail) {
  const lc = (userEmail || '').toLowerCase();
  return lc ? `${BASE_KEY}:${lc}` : BASE_KEY;
}

function rowKey(source, id) {
  if (!source || !id) return null;
  return `${String(source).toLowerCase()}:${String(id)}`;
}

function readNotes(userEmail) {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userEmail));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeNotes(userEmail, next) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKeyFor(userEmail), JSON.stringify(next));
  } catch {
    // Quota exceeded or storage disabled — swallow. The in-memory state
    // still holds the value for the session.
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

export function useTaskNotes(userEmail) {
  const emailLc = (userEmail || '').toLowerCase();
  const [notes, setNotes] = useState(() => readNotes(emailLc));
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Re-hydrate when the viewer changes (login swap, impersonation toggle).
  useEffect(() => {
    setNotes(readNotes(emailLc));
  }, [emailLc]);

  // Cross-tab adoption — discard messages from other users.
  useEffect(() => {
    const ch = getChannel();
    if (!ch) return undefined;
    const onMessage = (e) => {
      const msg = e?.data;
      if (!msg || msg.userEmail !== emailLc) return;
      if (!msg.notes || typeof msg.notes !== 'object') return;
      setNotes(msg.notes);
    };
    ch.addEventListener('message', onMessage);
    return () => ch.removeEventListener('message', onMessage);
  }, [emailLc]);

  const persist = useCallback((next) => {
    setNotes(next);
    writeNotes(emailLc, next);
    const ch = getChannel();
    try { ch?.postMessage({ userEmail: emailLc, notes: next, ts: Date.now() }); } catch {}
  }, [emailLc]);

  const hasNote = useCallback((source, id) => {
    const key = rowKey(source, id);
    if (!key) return false;
    const entry = notesRef.current[key];
    return !!(entry && entry.text && entry.text.trim());
  }, []);

  const getNote = useCallback((source, id) => {
    const key = rowKey(source, id);
    if (!key) return '';
    const entry = notesRef.current[key];
    return (entry && entry.text) || '';
  }, []);

  const setNote = useCallback((source, id, text) => {
    const key = rowKey(source, id);
    if (!key) return;
    const trimmed = String(text || '').slice(0, MAX_NOTE_LENGTH);
    if (!trimmed.trim()) {
      // Empty text → delete the entry so the icon clears.
      const next = { ...notesRef.current };
      delete next[key];
      persist(next);
      return;
    }
    persist({
      ...notesRef.current,
      [key]: { text: trimmed, updatedAt: new Date().toISOString() },
    });
  }, [persist]);

  const removeNote = useCallback((source, id) => {
    const key = rowKey(source, id);
    if (!key) return;
    if (!notesRef.current[key]) return;
    const next = { ...notesRef.current };
    delete next[key];
    persist(next);
  }, [persist]);

  return useMemo(() => ({
    notes,
    hasNote,
    getNote,
    setNote,
    removeNote,
    maxLength: MAX_NOTE_LENGTH,
  }), [notes, hasNote, getNote, setNote, removeNote]);
}

export const TASK_NOTES_MAX_LENGTH = MAX_NOTE_LENGTH;
