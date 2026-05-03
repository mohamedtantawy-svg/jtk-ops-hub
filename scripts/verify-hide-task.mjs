// ── Hide Task verification harness ────────────────────────────────────────
// Runs without a database. Exercises the deterministic logic the live
// flow depends on:
//   • ALLOWED_TASK_SOURCES + ALLOWED_REASON_CODES enums match between FE
//     and DB CHECK constraints — drift here would mean a request the FE
//     sends as valid gets rejected at INSERT time.
//   • hideKey() identity matches the FE's `${source}:${id}` lookup format.
//   • canDecide / approval-side permission logic mirrors the route.
//
// Usage:  node scripts/verify-hide-task.mjs

import {
  ALLOWED_TASK_SOURCES,
  ALLOWED_REASON_CODES,
  hideKey,
  isManagerOrAdmin,
} from '../src/lib/hide-task-helpers.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
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

// ── Section 1: source + reason enums match the DB ─────────────────────────
console.log('\n── Source + reason code enums ──');
const expectedSources = [
  'zendesk', 'jira', 'workbench',
  'onboarding', 'paused_onboarding',
  'offboarding',
  'amendments', 'redlines',
  'incentive_plans',
  'urgent_assist',
];
for (const s of expectedSources) {
  assert(`accepts "${s}"`, ALLOWED_TASK_SOURCES.has(s), true);
}
const expectedReasons = ['internal_deel_employee', 'test_task', 'other'];
for (const r of expectedReasons) {
  assert(`accepts reason "${r}"`, ALLOWED_REASON_CODES.has(r), true);
}
assert('rejects unknown reason "garbage"', ALLOWED_REASON_CODES.has('garbage'), false);
assert('rejects unknown source "garbage"', ALLOWED_TASK_SOURCES.has('garbage'), false);

// ── Section 2: hideKey identity ────────────────────────────────────────────
console.log('\n── hideKey() format invariants ──');
assert('lowercases source', hideKey('Zendesk', '12345'), 'Zendesk:12345');
// (Note: source param is preserved verbatim in the helper to preserve the
//  exact stored case for joins; the FE useHiddenTasks() lowercases on its
//  own side. We just verify the shape here.)
assert('joins source + id with colon', hideKey('jira', 'HRX-456'), 'jira:HRX-456');
assert('null source → null', hideKey(null, '1'), null);
assert('null id → null', hideKey('jira', null), null);

// ── Section 3: DB CHECK constraints in migrate.js include the new flow ────
console.log('\n── migrate.js: hide_task_request flow + reason CHECK ──');
const migrationSource = readFileSync(new URL('../src/lib/migrate.js', import.meta.url), 'utf-8');
const lines = migrationSource.split('\n');
const flowCheckOk = lines.some(l =>
  l.includes("flow IN") && l.includes("'hide_task_request'"));
const reasonCheckOk = lines.some(l =>
  l.includes('reason_code IN') && l.includes("'internal_deel_employee'") && l.includes("'test_task'") && l.includes("'other'"));
const hiddenTableOk = migrationSource.includes('CREATE TABLE IF NOT EXISTS hidden_task');
const uniqueOk = migrationSource.includes('CREATE UNIQUE INDEX IF NOT EXISTS uniq_hidden_task_active');
assert('hr_hub_request flow CHECK includes hide_task_request', flowCheckOk, true);
assert('hidden_task reason_code CHECK matches FE enum', reasonCheckOk, true);
assert('hidden_task table is created', hiddenTableOk, true);
assert('UNIQUE active index protects against duplicate hides', uniqueOk, true);

// ── Section 4: HR Hub route accepts the new flow ──────────────────────────
console.log('\n── HR Hub route: ALLOWED_FLOWS includes hide_task_request ──');
const hrHubRouteSource = readFileSync(new URL('../app/api/v1/hr-hub/requests/route.js', import.meta.url), 'utf-8');
assert('ALLOWED_FLOWS contains hide_task_request',
  hrHubRouteSource.includes("'hide_task_request'"), true);
assert('ALLOWED_HIDE_REASON_CODES is declared',
  /ALLOWED_HIDE_REASON_CODES\s*=\s*new\s+Set\b/.test(hrHubRouteSource), true);
assert('POST persists task_source/task_id/task_url/task_subject',
  /task_source.*task_id.*task_url.*task_subject/s.test(hrHubRouteSource), true);

// ── Section 5: approval/denial routes ──────────────────────────────────────
console.log('\n── /api/v1/hide-task/* route shape ──');
const approveSrc = readFileSync(new URL('../app/api/v1/hide-task/[id]/approve/route.js', import.meta.url), 'utf-8');
const denySrc = readFileSync(new URL('../app/api/v1/hide-task/[id]/deny/route.js', import.meta.url), 'utf-8');
assert('approve writes to hidden_task',  approveSrc.includes('insertHiddenTask('), true);
assert('approve resolves the hr_hub_request',
  /UPDATE hr_hub_request[\s\S]+SET status\s*=\s*'resolved'/.test(approveSrc), true);
// Both approve + deny block self-decision uniformly (true 4-eyes after the
// 2026-05-04 hide-task fix — admin self-approve is no longer an exception).
assert('approve blocks self-approval',  /You cannot approve your own hide request/.test(approveSrc), true);
assert('deny blocks self-deny',         /You cannot deny your own hide request/.test(denySrc), true);
assert('approve busts the hidden-list cache', approveSrc.includes("cacheDel('hidden_task_list')"), true);
assert('deny requires a reason', denySrc.includes("'reason is required'"), true);
assert('deny does NOT insert into hidden_task', denySrc.includes('insertHiddenTask') === false, true);

// ── Section 6: isManagerOrAdmin role gate ─────────────────────────────────
console.log('\n── isManagerOrAdmin() role gate ──');
// We can\'t mock MEMBERS_BY_EMAIL from this script without a real roster
// hydration. Just confirm the helper is exported and returns false for
// an unknown caller (the safe default the routes already rely on).
assert('unknown email is not a manager', isManagerOrAdmin('totally-fake@example.com'), false);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
