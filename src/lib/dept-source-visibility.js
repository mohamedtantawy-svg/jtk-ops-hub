// ── Per-department queue-source visibility — single source of truth ─────────
// Three surfaces must always agree on "which queues does the current
// department surface?":
//   • the Queue tab row              (src/components/queue/Queue.jsx)
//   • the home "By Source" card      (src/components/views/BriefingView.jsx)
//   • the Queue unified-sync popover (src/hooks/useQueueUnifiedSync.js →
//                                     src/components/queue/UnifiedSyncButton.jsx)
// Before this module the gate lived inline in Queue.jsx only; the By Source
// card and the sync popover each had ad-hoc logic and drifted — GIX showed
// 3 of its 5 sources in By Source and all 11 sources in the popover. Mistake
// #52: keep these in lockstep.
//
// Model (established by Queue.jsx Phase 14.1, 2026-05-20):
//   • Zendesk + Jira are available to EVERY department — never gated. The
//     route layer dispatches the right per-dept token; they are intentionally
//     NOT part of the visibleSources profile.
//   • Paused Onboarding rides the `onboarding` flag (no flag of its own).
//   • Every other Deel source is gated by visibleSources[<camelKey>] === true.
//   • While the dept context is still loading (cold paint), everything shows —
//     mirrors the "let unknown ids through until /dept-scope/current resolves"
//     carve-out so cached data never flickers and HRX (which sees everything)
//     is unaffected.

// Maps a source key from ANY surface's namespace — Queue tab ids + By Source
// counts (snake_case), sync `sources` ids (camelCase) — to its visibleSources
// flag. Keys ABSENT here (zendesk, jira) are always-on.
export const SOURCE_TO_VISIBILITY_KEY = {
  onboarding: 'onboarding',
  paused_onboarding: 'onboarding',
  pausedOnboarding: 'onboarding',
  offboarding: 'offboarding',
  amendments: 'amendments',
  redlines: 'redlines',
  incentive_plans: 'incentivePlans',
  incentivePlans: 'incentivePlans',
  workbench: 'workbench',
  immigration_tasks: 'immigrationTasks',
  immigrationTasks: 'immigrationTasks',
  immigration_cases: 'immigrationCases',
  immigrationCases: 'immigrationCases',
};

// Canonical queue-source keys (snake_case) in display order. Used by the
// "By Source" card to seed every queue the dept surfaces at 0 — so e.g. GIX's
// Jira renders "0" instead of vanishing — before layering real counts on top.
export const ALL_QUEUE_SOURCE_KEYS = [
  'zendesk', 'jira', 'onboarding', 'offboarding', 'amendments',
  'redlines', 'workbench', 'incentive_plans', 'immigration_tasks',
  'immigration_cases',
];

/**
 * True when `sourceKey` should be shown for a department whose resolved
 * visibleSources map is `visibleSources`. Pass the useCurrentDept `loading`
 * flag so cold paint fails open (show all) until the dept profile resolves.
 *
 * @param {string} sourceKey       key in any surface's namespace (snake or camel)
 * @param {object|null} visibleSources  the dept-scope visibleSources map
 * @param {boolean} loading        useCurrentDept().loading — show all while true
 * @returns {boolean}
 */
export function isDeptSourceVisible(sourceKey, visibleSources, loading = false) {
  if (loading) return true;
  const key = SOURCE_TO_VISIBILITY_KEY[sourceKey];
  if (!key) return true; // zendesk / jira / unknown → always-on
  return visibleSources?.[key] === true;
}
