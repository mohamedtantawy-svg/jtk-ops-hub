// ── Memory watchdog ─────────────────────────────────────────────────────────
// Node-only utility extracted from instrumentation.js (2026-05-12). The
// watchdog logs pod RSS / heap every 60 s and warns when RSS approaches the
// actual cgroup memory limit so a memory spike is timestamp-pinned in the
// pod logs without external profiling.
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
// us under cgroup live in server-cache.js, deel-api.js's workbench
// projection / finished-tail cap, and the CONTRACT_DETAIL_CACHE bound.
//
// 2026-05-19: thresholds now derive from the actual cgroup memory limit
// instead of a hardcoded 1024 MiB. The 4 GiB pod limit (canonical helm
// chart default) was producing a flood of `OVER BUDGET` lines at every
// tick even when RSS was nowhere near the cgroup ceiling; the real signal
// (approaching the kill threshold) was drowned out.

import { readFileSync } from 'node:fs';

const SOFT_RATIO = 0.70;  // approach-cap warning band starts at 70 % of limit
const HARD_RATIO = 0.85;  // OVER BUDGET starts at 85 % of limit
const FALLBACK_LIMIT_MB = 1024;

// Resolve the cgroup memory limit at module load. cgroup v2 exposes
// `/sys/fs/cgroup/memory.max` (returns "max" when unlimited or an integer
// byte count). cgroup v1 exposes `/sys/fs/cgroup/memory/memory.limit_in_bytes`
// (returns a very large integer when unlimited). Both files are readable
// without any special caps inside a normal container. If neither is
// present (local dev, non-Linux), fall back to MEMORY_LIMIT_MIB env var,
// then to a 1024 MiB default.
function _resolveLimitMiB() {
  // 1. cgroup v2
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (raw && raw !== 'max') {
      const bytes = Number(raw);
      if (Number.isFinite(bytes) && bytes > 0) {
        return Math.round(bytes / (1024 * 1024));
      }
    }
  } catch {}

  // 2. cgroup v1
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
    const bytes = Number(raw);
    // Linux uses ~9.2e18 (2^63 - 1, rounded to page size) as the "no limit"
    // sentinel on v1. Anything above ~64 GiB on Ops Hub pods is unrealistic
    // and almost certainly means "no limit" — fall through to env / default.
    if (Number.isFinite(bytes) && bytes > 0 && bytes < 64 * 1024 * 1024 * 1024) {
      return Math.round(bytes / (1024 * 1024));
    }
  } catch {}

  // 3. Env override (mostly for local dev / tests)
  const envMib = Number(process.env.MEMORY_LIMIT_MIB);
  if (Number.isFinite(envMib) && envMib > 0) {
    return Math.round(envMib);
  }

  // 4. Default
  return FALLBACK_LIMIT_MB;
}

export function startMemoryWatchdog() {
  const limitMiB = _resolveLimitMiB();
  const softMiB = Math.round(limitMiB * SOFT_RATIO);
  const hardMiB = Math.round(limitMiB * HARD_RATIO);

  console.log(
    `[memory] watchdog armed — cgroup limit=${limitMiB} MiB, ` +
    `soft=${softMiB} MiB (${Math.round(SOFT_RATIO * 100)}%), ` +
    `hard=${hardMiB} MiB (${Math.round(HARD_RATIO * 100)}%)`,
  );

  const tick = () => {
    try {
      const m = process.memoryUsage();
      const rssMB = Math.round(m.rss / (1024 * 1024));
      const heapMB = Math.round(m.heapUsed / (1024 * 1024));
      const extMB = Math.round((m.external || 0) / (1024 * 1024));
      if (rssMB >= hardMiB) {
        console.warn(`[memory] OVER BUDGET — rss=${rssMB} MiB heap=${heapMB} MiB external=${extMB} MiB (cgroup limit ${limitMiB} MiB)`);
      } else if (rssMB >= softMiB) {
        console.warn(`[memory] approaching cap — rss=${rssMB} MiB heap=${heapMB} MiB external=${extMB} MiB (cgroup limit ${limitMiB} MiB)`);
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
