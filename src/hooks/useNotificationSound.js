// ── useNotificationSound — per-user "play a chime on new notification" pref
// Defaults OFF (opt-in). Persisted to a user-scoped localStorage key so a
// login swap on a shared machine doesn't leak the preference. Plays a short
// two-tone chime via Web Audio when `unreadCount` rises — no audio asset
// shipping, no MIME / CSP surprises. Throttled so a burst of N arrivals in
// the same poll cycle plays one chime, not N. The first 5 seconds after
// mount are a silent grace window so cache hydration / first poll don't
// chime — only genuine post-mount increases trigger sound.
// ──────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

const LS_KEY_BASE = 'ops_hub_notif_sound_enabled';
const THROTTLE_MS = 2000;
const MOUNT_GRACE_MS = 5000;

function lsKeyFor(email) {
  const lc = (email || '').toLowerCase();
  return lc ? `${LS_KEY_BASE}:${lc}` : LS_KEY_BASE;
}

function readPref(email) {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(lsKeyFor(email)) === '1'; }
  catch { return false; }
}

function writePref(email, on) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(lsKeyFor(email), on ? '1' : '0'); } catch {}
}

function playChime() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx;
  try { ctx = new AC(); } catch { return; }
  const now = ctx.currentTime;
  const tone = (freq, start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.15, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  };
  tone(660, 0,    0.10);
  tone(880, 0.08, 0.14);
  setTimeout(() => { try { ctx.close(); } catch {} }, 500);
}

export function useNotificationSound({ unreadCount, userEmail }) {
  const [enabled, setEnabledState] = useState(() => readPref(userEmail));

  useEffect(() => { setEnabledState(readPref(userEmail)); }, [userEmail]);

  const lastSeenCountRef = useRef(typeof unreadCount === 'number' ? unreadCount : 0);
  const lastChimeAtRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  useEffect(() => {
    const prev = lastSeenCountRef.current;
    lastSeenCountRef.current = unreadCount;
    if (!enabledRef.current) return;
    if (typeof unreadCount !== 'number') return;
    if (unreadCount <= prev) return;
    if (Date.now() - mountTimeRef.current < MOUNT_GRACE_MS) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = Date.now();
    if (now - lastChimeAtRef.current < THROTTLE_MS) return;
    lastChimeAtRef.current = now;
    try { playChime(); } catch {}
  }, [unreadCount]);

  const setEnabled = useCallback((on) => {
    setEnabledState(on);
    writePref(userEmail, on);
    if (on) {
      // Preview chime doubles as the user-gesture unlock for Web Audio so
      // the first real arrival actually rings on Chrome's autoplay policy.
      lastChimeAtRef.current = Date.now();
      try { playChime(); } catch {}
    }
  }, [userEmail]);

  return { enabled, setEnabled };
}
