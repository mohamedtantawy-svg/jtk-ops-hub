// ── useHideResolved (2026-05-22) ───────────────────────────────────────────
// Per-user "hide resolved tickets" toggle for the Queue (Zendesk / Jira /
// every Deel source panel). Persists across sessions via localStorage,
// keyed by email so impersonation / multi-account on one browser doesn't
// leak settings between identities.
//
// Why per-user, not per-team?
// ───────────────────────────
// Celine raised this for HRX + Workbench; the request was "remember the
// team preference" which in product context means "remember whether I
// chose to hide them, don't make me re-toggle on every page load". One
// agent might prefer the resolved tail for context, another wants it
// gone — splitting on email is the safest default. If a global per-team
// preference is wanted later, layer it on top of this hook.
//
// Default = false (show resolved) — matches existing behaviour so no
// user sees a surprise empty section after deploy.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_BASE = 'ops_hub_hide_resolved';

function storageKeyFor(userEmail) {
  if (!userEmail) return STORAGE_BASE;
  return `${STORAGE_BASE}:${String(userEmail).toLowerCase()}`;
}

function readStored(userEmail) {
  if (typeof window === 'undefined') return false;
  try {
    const v = window.localStorage.getItem(storageKeyFor(userEmail));
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

function writeStored(userEmail, next) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKeyFor(userEmail), next ? '1' : '0');
  } catch {
    /* localStorage unavailable — fall back to in-memory only */
  }
}

export function useHideResolved(userEmail) {
  // Lazy initialiser reads localStorage once on mount so cold-paint matches
  // the persisted preference. If userEmail flips later (impersonation flow)
  // the effect below re-reads.
  const [hideResolved, setHideResolvedState] = useState(() => readStored(userEmail));

  useEffect(() => {
    setHideResolvedState(readStored(userEmail));
  }, [userEmail]);

  const setHideResolved = useCallback((next) => {
    const v = !!next;
    setHideResolvedState(v);
    writeStored(userEmail, v);
  }, [userEmail]);

  const toggle = useCallback(() => {
    setHideResolvedState(prev => {
      const next = !prev;
      writeStored(userEmail, next);
      return next;
    });
  }, [userEmail]);

  return { hideResolved, setHideResolved, toggleHideResolved: toggle };
}
