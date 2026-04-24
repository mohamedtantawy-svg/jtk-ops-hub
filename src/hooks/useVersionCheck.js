// ── useVersionCheck ──────────────────────────────────────────────────────────
// Detects when the server has been rolled to a new deploy and exposes a
// `hasUpdate` flag + a `reload` helper.
//
// ## Why this exists
// Before this hook, users had to clear their browser cache (sometimes multiple
// times) after a deploy to see the new code — the HTML shell was being served
// stale and kept pointing at old /_next/static/ bundles. We addressed the
// cache headers in next.config.js so fresh loads pick up the new shell, but
// users who leave the tab open for hours still sit on the old bundle forever.
//
// ## How it works
// 1. On mount, fetch /api/v1/version. Treat that response as "my version"
//    for the lifetime of this tab — this is intentional: the initial fetch
//    matches whatever code is currently running in the browser, because it
//    was served by the same pod that delivered the HTML shell (or a replica
//    running the same image, which is tag-pinned).
// 2. Poll every POLL_INTERVAL_MS. Also poll on window focus and on the
//    `online` event — both are cheap and catch the common case where a
//    laptop lid has been closed for a while.
// 3. If the server's `version` differs from the first-seen value, flip
//    `hasUpdate` to true and stop polling (banner stays up until the user
//    reloads or dismisses).
//
// ## Why polling + focus rather than websockets / SSE
// Polling a 2-byte JSON endpoint every 60s is ~1.5 MB/month per user of
// idle traffic. Building a push channel for something that only needs to
// fire on a deploy (a few times a week at most) would be massive overkill.
//
// ## Failure modes
// - Network error: silently swallow, try again on the next tick. We don't
//   want a transient blip (airport wifi) to pop the banner.
// - APP_VERSION unset on the server (returns "unknown"): treat as a no-op.
//   This happens in local dev — don't pester developers with reload banners.

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const POLL_INTERVAL_MS = 60_000; // 60s — covers most "I left the tab open" cases without being chatty
const VERSION_ENDPOINT = '/api/v1/version';

export function useVersionCheck() {
  // The version that was running when this tab first loaded. Sticky for the
  // tab lifetime — once set, we only compare incoming versions against this.
  const baselineVersionRef = useRef(null);

  // Exposed state for the UI. `latestVersion` is the newest SHA we've seen
  // from the server (may equal baseline until a deploy happens).
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState(null);

  // Tracks whether we've already flipped into the "update available" state
  // so we stop polling — no point hammering the endpoint once the banner
  // is already up.
  const detectedRef = useRef(false);

  const fetchVersion = useCallback(async () => {
    if (detectedRef.current) return;
    try {
      const res = await fetch(VERSION_ENDPOINT, {
        cache: 'no-store',
        // Explicit credentials:'same-origin' to avoid cookies leaking to a
        // CDN or being stripped by a fetch adapter default.
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = await res.json();
      const serverVersion = data?.version || null;
      if (!serverVersion || serverVersion === 'unknown') return;

      // First successful fetch: lock in baseline.
      if (!baselineVersionRef.current) {
        baselineVersionRef.current = serverVersion;
        setLatestVersion(serverVersion);
        return;
      }

      if (serverVersion !== baselineVersionRef.current) {
        // Deploy detected. Flip the flag and stop polling.
        detectedRef.current = true;
        setLatestVersion(serverVersion);
        setHasUpdate(true);
      }
    } catch {
      // Swallow — transient network errors shouldn't raise a banner.
    }
  }, []);

  useEffect(() => {
    // Kick off the first fetch immediately so the baseline is established
    // before any subsequent poll.
    fetchVersion();

    const intervalId = setInterval(fetchVersion, POLL_INTERVAL_MS);

    // Focus/online handlers are cheap and catch the case where a user
    // re-opens a tab that's been idle for hours — ideally we detect the
    // new deploy within seconds of them coming back rather than waiting
    // for the next interval.
    const onFocus = () => fetchVersion();
    const onOnline = () => fetchVersion();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [fetchVersion]);

  // Hard-reload that also attempts to purge the Cache Storage API (used by
  // service workers / some PWA wrappers). We don't currently register a
  // service worker, but this is belt-and-braces for the case where a browser
  // extension or future PWA upgrade is caching on our behalf.
  const reload = useCallback(async () => {
    try {
      if (typeof caches !== 'undefined' && caches?.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Non-fatal — the reload below will still pick up the new shell
      // because next.config.js sets `no-store` on HTML responses.
    }
    // Pass `true` legacy argument for Firefox (no-op in Chrome/Safari).
    try { window.location.reload(true); } catch { window.location.reload(); }
  }, []);

  return {
    hasUpdate,
    baselineVersion: baselineVersionRef.current,
    latestVersion,
    reload,
  };
}
