// ── Urgent Assist task-type matcher ────────────────────────────────────────
// Single source of truth for "which Deel workbench task types belong on the
// Urgent Assist tab". Imported by:
//   • src/components/queue/Queue.jsx → filters Workbench rows OUT so they
//     don't double-list under both Workbench and Urgent Assist.
//   • src/hooks/useUrgentAssistData.js → filters Workbench rows IN to merge
//     them with the manual urgent_assist_request rows from Postgres.
//
// Match is case-insensitive and trim-tolerant. Add new aliases here if the
// Deel admin team renames the task type or introduces a sibling — both
// sides of the filter pick it up automatically.

export const URGENT_ASSIST_TASK_TYPES = [
  'HRX Urgent Assist Request',
  'HRX Urgent Assist',
];

const NORMALISED = new Set(URGENT_ASSIST_TASK_TYPES.map(s => s.toLowerCase().trim()));

/**
 * Returns true when the given task-type label belongs on the Urgent Assist
 * tab. Accepts the raw upstream string (typically `taskType` from
 * useWorkbenchData / normalizeWorkbench).
 */
export function isUrgentAssistTaskType(taskType) {
  if (!taskType) return false;
  return NORMALISED.has(String(taskType).toLowerCase().trim());
}
