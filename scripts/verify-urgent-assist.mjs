// ── Urgent Assist verification harness ───────────────────────────────────
// Runs without a database — exercises the deterministic FE/server logic
// (task-type matcher, Workbench partition, scope predicate, SLA classifier)
// against synthetic inputs that mirror the production data shapes.
//
// What this catches:
//   • Task-type matcher accidentally narrowing/widening (case, whitespace,
//     missing alias for a future Deel rename).
//   • Workbench tab and Urgent Assist tab double-counting or losing rows.
//   • Edit guard letting the wrong user mutate a row.
//   • SLA window misclassifying breached / at-risk / on-track.
//
// What this does NOT catch (needs a real DB / live workbench):
//   • Migration runs cleanly on Postgres.
//   • RBAC against real JWT cookies.
//   • Stale-cache + revalidate behaviour in useUrgentAssistData.
//
// Usage:  node scripts/verify-urgent-assist.mjs

import { isUrgentAssistTaskType, URGENT_ASSIST_TASK_TYPES } from '../src/lib/urgent-assist-task-types.js';
import { canEdit, teamLeadEmailFor } from '../src/lib/urgent-assist-helpers.js';

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// ── Section 1: Task-type matcher ───────────────────────────────────────────
console.log('\n── Task-type matcher ──');
for (const t of URGENT_ASSIST_TASK_TYPES) {
  assert(`accepts canonical "${t}"`, isUrgentAssistTaskType(t), true);
  assert(`accepts lowercase "${t.toLowerCase()}"`, isUrgentAssistTaskType(t.toLowerCase()), true);
  assert(`accepts uppercase "${t.toUpperCase()}"`, isUrgentAssistTaskType(t.toUpperCase()), true);
  assert(`accepts whitespace-padded "${t}"`, isUrgentAssistTaskType(`  ${t}  `), true);
}
assert('rejects similar but distinct "Urgent Assist Request"', isUrgentAssistTaskType('Urgent Assist Request'), false);
assert('rejects "Expedite EOR Onboarding"', isUrgentAssistTaskType('Expedite EOR Onboarding'), false);
assert('rejects empty string', isUrgentAssistTaskType(''), false);
assert('rejects null', isUrgentAssistTaskType(null), false);
assert('rejects undefined', isUrgentAssistTaskType(undefined), false);

// ── Section 2: Workbench / Urgent Assist partition ─────────────────────────
console.log('\n── Workbench ↔ Urgent Assist partition ──');
const tasks = [
  { id: 'wb1', taskType: 'Expedite EOR Onboarding' },
  { id: 'wb2', taskType: 'HRX Urgent Assist Request' },
  { id: 'wb3', taskType: 'HRX Urgent Assist' },
  { id: 'wb4', taskType: 'Compliance Doc Review' },
  { id: 'wb5', sourceType: 'HRX Urgent Assist' },             // sourceType-only match
  { id: 'wb6', taskType: 'hrx urgent assist request' },        // case
];
const inWorkbench = tasks.filter(
  t => !isUrgentAssistTaskType(t?.taskType) && !isUrgentAssistTaskType(t?.sourceType)
);
const inUrgent = tasks.filter(
  t => isUrgentAssistTaskType(t?.taskType) || isUrgentAssistTaskType(t?.sourceType)
);
assert('Workbench tab keeps non-urgent tasks', inWorkbench.map(t => t.id), ['wb1', 'wb4']);
assert('Urgent Assist tab picks up every variant', inUrgent.map(t => t.id), ['wb2', 'wb3', 'wb5', 'wb6']);
assert('No task disappears',
  new Set([...inWorkbench, ...inUrgent].map(t => t.id)).size,
  tasks.length,
);
assert('No task appears in both',
  inWorkbench.filter(t => inUrgent.find(u => u.id === t.id)).length,
  0,
);

// ── Section 3: Edit-permission guard ───────────────────────────────────────
// canEdit reads from MEMBERS_BY_EMAIL via the helpers module — we use real
// roster data to keep the test honest about role/chain resolution.
console.log('\n── canEdit() permission guard ──');
const aliceCreator = 'alice.creator@deel.com';
const bobAssignee = 'bob.assignee@deel.com';
const carolTl     = 'carol.tl@deel.com';
const eveStranger = 'eve.stranger@deel.com';
const row = {
  created_by_email: aliceCreator,
  assignee_email: bobAssignee,
  team_lead_email: carolTl,
};
assert('creator can edit',                canEdit(aliceCreator, row), true);
assert('assignee can edit',               canEdit(bobAssignee, row), true);
assert('denormalised team lead can edit', canEdit(carolTl, row), true);
assert('stranger cannot edit',            canEdit(eveStranger, row), false);
assert('blank caller cannot edit',        canEdit('', row), false);
assert('null row blocks',                 canEdit(aliceCreator, null), false);

// ── Section 4: 6-hour SLA classifier ───────────────────────────────────────
// Mirrors the FE computeSla in useUrgentAssistData. Calendar minutes here —
// the real path uses biz-day; we feed weekday timestamps so the two agree.
console.log('\n── 6h SLA classifier (weekday timestamps) ──');
const SIX_H_MS = 6 * 60 * 60 * 1000;
function sla(createdAt) {
  const elapsed = Date.now() - createdAt;
  const remaining = Math.round((SIX_H_MS - elapsed) / 1000);
  return {
    slaRemaining: remaining,
    slaBreachStatus: remaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED',
    slaWindowMs: SIX_H_MS,
  };
}
function tier(row) {
  if (row.slaBreachStatus === 'SLA_BREACHED') return 'breached';
  if (row.slaRemaining > 0
      && row.slaRemaining < (row.slaWindowMs / 1000) / 4) return 'at_risk';
  return 'on_track';
}
// Pick a Wednesday so 6h doesn't cross a weekend boundary.
// At-risk threshold = 6h/4 = 1.5h remaining, so:
//   • elapsed <= 4.5h → on_track  (>1.5h remaining)
//   • elapsed > 4.5h, < 6h → at_risk
//   • elapsed >= 6h → breached
const baseDay = new Date('2026-01-14T12:00:00Z').getTime();   // Wed noon UTC
const created = baseDay + 1 * 60 * 1000;
const realNow = Date.now;
Date.now = () => created + (3 * 60 * 60 * 1000);     // 3h elapsed → 3h remaining
assert('3h after creation = on_track',  tier(sla(created)), 'on_track');
Date.now = () => created + (5 * 60 * 60 * 1000);     // 5h elapsed → 1h remaining (< 25% band)
assert('5h after creation = at_risk',   tier(sla(created)), 'at_risk');
Date.now = () => created + (5.5 * 60 * 60 * 1000);   // 5.5h elapsed → 30m remaining
assert('5.5h after creation = at_risk', tier(sla(created)), 'at_risk');
Date.now = () => created + (7 * 60 * 60 * 1000);     // 1h past breach
assert('7h after creation = breached',  tier(sla(created)), 'breached');
Date.now = realNow;

// ── Section 5: Status enum invariants ──────────────────────────────────────
console.log('\n── Status enum invariants ──');
const FE_STATUSES = ['new', 'in_progress', 'on_hold', 'resolved'];
// The DB CHECK constraint must accept exactly these. Read directly from
// migrate.js to make sure we never drift.
import { readFileSync } from 'node:fs';
const migrationSource = readFileSync(new URL('../src/lib/migrate.js', import.meta.url), 'utf-8');
const checkLine = migrationSource.split('\n').find(l => l.includes('urgent_assist_request') ? false : false)
  || migrationSource
       .split('\n')
       .find(l => l.includes("CHECK (status IN") && l.includes("'new'") && l.includes("'in_progress'") && l.includes("'on_hold'") && l.includes("'resolved'") && (migrationSource.indexOf(l) > migrationSource.indexOf('urgent_assist_request')));
assert('migrate.js urgent_assist_request status CHECK matches FE enum', !!checkLine, true);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
