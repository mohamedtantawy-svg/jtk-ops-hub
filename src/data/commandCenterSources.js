// ── Command Center Source Registry ──────────────────────────────────────────
// THE single declarative manifest of every department-scoped data source the
// executive Command Center rolls up. This is the contract that keeps the
// Command Center connected to — and in sync with — every department.
//
// GOVERNANCE RULE (also encoded in .claude/skills/ops-hub-improvement/SKILL.md
// §3.18): whenever you ADD, RENAME, RETIRE, or RE-SCOPE a department-scoped data
// source anywhere in the app, you MUST update this registry in the SAME change
// AND extend the matching Command Center rollup/report. The Phase 8 Self-Audit
// panel reconciles this registry against live org_nodes + dept-integrations and
// flags anything missing — but the registry is the source of truth it audits
// against, so a stale registry hides drift. Keep it current.
//
// `deptDimension`:
//   • 'org_node_id'       — internal table carries org_node_id; roll up via a
//                           GROUP BY over the dept subtree.
//   • 'dept-integrations' — external/queue source gated per-dept by slug in
//                           src/lib/dept-integrations.js (visibleDeelSourcesFor);
//                           only aggregate the sources a dept has enabled.
//   • 'derived'           — computed from other sources (no own table).
//
// `phase` records which Command Center build phase wires the rollup, so the
// Self-Audit can tell "not built yet" apart from "built but drifted".

export const COMMAND_CENTER_SOURCES = [
  // ── Internal, org_node_id-scoped tables (fast GROUP BY rollups) ───────────
  { key: 'hr_hub',          label: 'HR Hub requests',      table: 'hr_hub_request',        deptDimension: 'org_node_id',       kpis: ['open', 'byStatus', 'breaches', 'resolvedRate'], phase: 2 },
  { key: 'leader_alerts',   label: 'Leaders Alerts',       table: 'leader_alert',          deptDimension: 'org_node_id',       kpis: ['open', 'critical'],                            phase: 6 },
  { key: 'urgent_assist',   label: 'Urgent Assist',        table: 'urgent_assist_request', deptDimension: 'org_node_id',       kpis: ['open', 'aging'],                               phase: 6 },
  { key: 'escalations',     label: 'Escalations',          table: 'escalations',           deptDimension: 'org_node_id',       kpis: ['open', 'aging'],                               phase: 6 },
  { key: 'time_off',        label: 'OOO / time-off',       table: 'time_off_events',       deptDimension: 'org_node_id',       kpis: ['outNow', 'upcoming'],                          phase: 5 },
  { key: 'handovers',       label: 'Handovers / coverage', table: 'handovers',             deptDimension: 'org_node_id',       kpis: ['active', 'coverageGaps'],                      phase: 5 },
  { key: 'work_tasks',      label: 'Work tasks',           table: 'work_tasks',            deptDimension: 'org_node_id',       kpis: ['open', 'overdue'],                             phase: 3 },
  { key: 'announcements',   label: 'Announcements',        table: 'announcements',         deptDimension: 'org_node_id',       kpis: ['ackRate'],                                     phase: 5 },

  // ── External / queue sources (per-dept enablement via dept-integrations) ──
  { key: 'zendesk',         label: 'Zendesk tickets',      table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla', 'responseTime', 'resolvedRate'], phase: 2 },
  { key: 'jira',            label: 'Jira tickets',         table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'aging'],                               phase: 2 },
  { key: 'workbench',       label: 'Workbench tasks',      table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'onboarding',      label: 'Onboarding',           table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla', 'paused'],                       phase: 2 },
  { key: 'offboarding',     label: 'Offboarding',          table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'amendments',      label: 'Amendments',           table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'redlines',        label: 'Redlines',             table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'incentive_plans', label: 'Incentive Plans',      table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'active_eor',      label: 'Active EOR',           table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'immigration_tasks', label: 'Immigration Tasks',  table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },
  { key: 'immigration_cases', label: 'Immigration Cases',  table: null,                    deptDimension: 'dept-integrations', kpis: ['open', 'sla'],                                 phase: 2 },

  // ── People / org structure (org_nodes + team_member_overrides) ────────────
  { key: 'headcount',       label: 'Headcount',            table: 'team_member_overrides', deptDimension: 'org_node_id',       kpis: ['headcount'],                                   phase: 0 },
  { key: 'vacancies',       label: 'Vacant roles',         table: 'org_vacant_roles',      deptDimension: 'org_node_id',       kpis: ['vacancies'],                                   phase: 1 },
  { key: 'activity',        label: 'Member activity',      table: 'member_logins',         deptDimension: 'derived',           kpis: ['lastSeen'],                                    phase: 5 },

  // ── Derived executive metrics ─────────────────────────────────────────────
  { key: 'health',          label: 'Health Score',         table: null,                    deptDimension: 'derived',           kpis: ['composite'],                                   phase: 1 },
  { key: 'capacity',        label: 'Capacity / load',      table: 'capacity_settings',     deptDimension: 'org_node_id',       kpis: ['loadPerMember', 'signal'],                     phase: 4 },
  { key: 'productivity',    label: 'Productivity',         table: null,                    deptDimension: 'derived',           kpis: ['resolvedByCategory'],                          phase: 3 },
];

// The Deel-source keys whose per-dept enablement is read from
// dept-integrations.js (visibleDeelSourcesFor). Kept here so the Phase 8
// Self-Audit can diff "enabled on a dept" vs "represented in a CC rollup".
// NOTE: these use the camelCase shape of dept-integrations' deelSources map
// (watch the snake_case vs camelCase mismatch flagged in skill mistake #52).
export const COMMAND_CENTER_DEEL_SOURCE_KEYS = [
  'onboarding', 'offboarding', 'amendments', 'redlines', 'incentivePlans',
  'workbench', 'immigrationTasks', 'immigrationCases', 'activeEor',
];

// Sources whose rollup is expected to be live by the end of a given phase.
export function commandCenterSourcesThroughPhase(phase) {
  return COMMAND_CENTER_SOURCES.filter(s => s.phase <= phase);
}
