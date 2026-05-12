// ── Memory watchdog ─────────────────────────────────────────────────────────
// Node-only utility extracted from instrumentation.js (2026-05-12). The
// watchdog logs pod RSS / heap every 60 s and warns at two thresholds
// (800 MiB soft, 950 MiB hard) so the next memory spike is timestamp-pinned
// in the pod logs without external profiling.
//
// Why this lives in its own file: instrumentation.js's `register()` runs in
// BOTH the Node and Edge runtimes (the Edge runtime invokes it for
// middleware). Edge doesn't have `process.memoryUsage`, and Turbopack's
// static analyser flags any direct reference as an Edge-incompat error —
// even with a runtime gate, the warning floods build output and (in some
// build modes) fails the build. Importing this file via a dynamic
// `await import(...)` inside the Node-only branch keeps the symbol out of
// the Edge bundle entirely, so the static analyser never sees it.
//
// Observation only — no GC forcing, no throwing. The actual caps that keep
// us under 1 GiB live in server-cache.js, deel-api.js's workbench
// projection / finished-tail cap, and the CONTRACT_DETAIL_CACHE bound.

export function startMemoryWatchdog() {
  const SOFT_RSS_MB = 800;
  const HARD_RSS_MB = 950;
  const tick = () => {
    try {
      const m = process.memoryUsage();
      const rssMB = Math.round(m.rss / (1024 * 1024));
      const heapMB = Math.round(m.heapUsed / (1024 * 1024));
      const extMB = Math.round((m.external || 0) / (1024 * 1024));
      if (rssMB >= HARD_RSS_MB) {
        console.warn(`[memory] OVER BUDGET — rss=${rssMB} MiB heap=${heapMB} MiB external=${extMB} MiB (target ceiling 1024 MiB)`);
      } else if (rssMB >= SOFT_RSS_MB) {
        console.warn(`[memory] approaching cap — rss=${rssMB} MiB heap=${heapMB} MiB external=${extMB} MiB`);
      } else {
        console.log(`[memory] rss=${rssMB} MiB heap=${heapMB} MiB external=${extMB} MiB`);
      }
    } catch {}
  };
  // First reading right after boot so a cold-start spike is recorded, then
  // every 60 s.
  setTimeout(tick, 5_000);
  setInterval(tick, 60_000).unref?.();
}
