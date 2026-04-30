// ── Business-day time helpers ──────────────────────────────────────────────
// All Queue SLAs use a "business day" clock: Saturday and Sunday do not
// elapse. Each weekday counts as a full 24-hour day. Holidays are NOT
// excluded (per current spec). Computation runs in the user's local TZ —
// "weekend" is naturally a local concept and the SLA is rendered to the
// same person whose Date object reads the day-of-week, so they stay aligned.
//
// Two primitives:
//   • elapsedBizMs(fromMs, toMs) → ms of weekday-only time between two
//     timestamps. SLA breach checks: compare against the SLA window in ms.
//   • addBizMs(fromMs, bizMs) → wall-clock timestamp when a SLA window
//     elapses, given a start timestamp. Useful when we want to render a
//     concrete "due at" time later.
//
// Walks day-by-day (one iteration per local midnight) so a 14-day SLA is
// at most ~21 iterations. Cheap, no external deps, predictable.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function nextLocalMidnight(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

function isWeekend(ts) {
  const day = new Date(ts).getDay();
  return day === 0 || day === 6;
}

/**
 * Total business-day milliseconds between `fromMs` (inclusive) and `toMs`
 * (exclusive). Saturday and Sunday contribute zero. Returns 0 when
 * `toMs <= fromMs` (clamped — never negative, never NaN).
 */
export function elapsedBizMs(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  if (toMs <= fromMs) return 0;
  let elapsed = 0;
  let cursor = fromMs;
  while (cursor < toMs) {
    const nextMidnight = nextLocalMidnight(cursor);
    const segEnd = Math.min(toMs, nextMidnight);
    if (!isWeekend(cursor)) elapsed += segEnd - cursor;
    cursor = nextMidnight;
  }
  return elapsed;
}

/**
 * Wall-clock timestamp at which `bizMs` business-day-milliseconds will have
 * elapsed starting from `fromMs`. Skips weekends. If `fromMs` itself lands
 * on a weekend, the clock starts ticking at the next Monday 00:00 local.
 */
export function addBizMs(fromMs, bizMs) {
  if (!Number.isFinite(fromMs)) return Number.NaN;
  if (!Number.isFinite(bizMs) || bizMs <= 0) return fromMs;
  let remaining = bizMs;
  let cursor = fromMs;
  while (remaining > 0) {
    const nextMidnight = nextLocalMidnight(cursor);
    if (!isWeekend(cursor)) {
      const dayRem = nextMidnight - cursor;
      if (dayRem >= remaining) return cursor + remaining;
      remaining -= dayRem;
    }
    cursor = nextMidnight;
  }
  return cursor;
}

/** Convenience: business-day minutes between two timestamps. */
export function elapsedBizMinutes(fromMs, toMs) {
  return Math.floor(elapsedBizMs(fromMs, toMs) / 60000);
}

/** Convenience: business-day seconds remaining until SLA breach. */
export function bizSecondsRemaining(startMs, slaMs, nowMs = Date.now()) {
  if (!Number.isFinite(startMs) || !Number.isFinite(slaMs)) return null;
  const elapsed = elapsedBizMs(startMs, nowMs);
  return Math.round((slaMs - elapsed) / 1000);
}

export const BIZ_DAY_MS = DAY_MS;
