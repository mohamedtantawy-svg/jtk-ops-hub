// ── adoptFetchedItems — should a background revalidation REPLACE the list? ──
//
// Every Deel-source data hook (onboarding, paused-onboarding, offboarding,
// amendments, redlines, workbench, incentive plans, immigration tasks/cases)
// is stale-while-revalidate: it paints the cached list, then a background poll
// fetches fresh data. Each hook guarded the replace with
//
//     if (force || fetched.length > 0 || itemsRef.current.length === 0) { setItems(fetched); ... }
//
// i.e. a background poll that came back EMPTY while we still held rows was
// dropped — a guard meant to stop a transient upstream blip from blanking a
// working queue (a Deel status-stream can 429 and yield a false-empty; see
// listAmendmentRequests' per-bucket `.catch` that swallows a failed bucket to
// []). But the guard was unconditional, so a row that LEGITIMATELY resolved
// upstream (e.g. the last item in your scope, or one reassigned away) stayed
// painted forever until a manual refresh, a cache wipe, or a hard reload —
// "tasks get stuck on Ops Hub until a hard refresh" (Insiya/Kinga, 2026-06-08;
// the amendment SLA-breach phantom). Background syncs never cleared it.
//
// This helper keeps the blip protection but BOUNDS it: a single empty poll is
// still preserved (could be a blip), but after EMPTY_ADOPT_THRESHOLD consecutive
// empty polls we trust the drain and clear the stale rows — roughly one extra
// ~5-min sync cycle, versus "never". A non-empty fetch, a user-forced refresh,
// or an already-empty list adopt immediately and reset the streak.
//
// Streaks are tracked per (source · user · dept) key in a module-level map so:
//   • a super-admin dept switch can't bleed one source's streak into another,
//   • the count survives the hook's re-renders without a per-instance ref, and
//   • multiple mounted consumers of the same source reach consensus (any one
//     of them seeing a non-empty fetch resets the shared streak).
// Entries are deleted as soon as a streak resets or fires, so the map stays
// bounded to the handful of (source,user,dept) tuples a session actually sees.

const _emptyStreaks = new Map();

export const EMPTY_ADOPT_THRESHOLD = 2;

export function shouldAdoptFetchedItems({ force, fetchedLength, currentLength, key, threshold = EMPTY_ADOPT_THRESHOLD }) {
  // Adopt immediately — and reset the streak — on a forced (user) refresh, a
  // non-empty fetch, or when we're holding nothing anyway.
  if (force || fetchedLength > 0 || currentLength === 0) {
    if (key) _emptyStreaks.delete(key);
    return true;
  }
  // Empty fetch while we still hold rows: real drain, or a transient blip?
  // Count consecutive empties; adopt once we've seen `threshold` in a row.
  const next = (key ? (_emptyStreaks.get(key) || 0) : 0) + 1;
  if (next >= threshold) {
    if (key) _emptyStreaks.delete(key);
    return true;
  }
  if (key) _emptyStreaks.set(key, next);
  return false;
}
