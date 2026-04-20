// ── Role-accuracy harness ──────────────────────────────────────────────────
// Runs the real src/lib/queue-scoping.js against the real hierarchy in
// src/data/members.js + src/data/countryOwners.js. Asserts every case the
// user specified. Exits with non-zero on any failure.
//
// Usage:  node scripts/verify-queue-scoping.mjs

import {
  filterByAssignee,
  filterByCountry,
  getVisibleEmails,
  getVisibleCountries,
  scopeZendeskTickets,
  scopeOffboardingCases,
  scopeOnboardingPeople,
  scopeAmendmentRequests,
  scopeRedlineRequests,
  scopeWorkbenchTasks,
  isAdminUser,
} from '../src/lib/queue-scoping.js';
import { TEAM_MEMBERS, getDirectReports, getAllReports } from '../src/data/members.js';
import { OWNER_COUNTRIES } from '../src/data/countryOwners.js';

let failed = 0;
let passed = 0;

function assert(label, actual, expected) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assertSize(label, set, size) {
  assert(label, set.size, size);
}

function assertHas(label, set, value) {
  assert(label, set.has(value), true);
}

function assertMissing(label, set, value) {
  assert(label, set.has(value), false);
}

// ── Roles from real data ────────────────────────────────────────────────────
const admin = { email: 'mohamed.tantawy@deel.com', role: 'admin' };
const rmKristina = { email: 'kristina.fomina@deel.com', role: 'regional_manager' };
const tlJose = { email: 'jose.ruales@deel.com', role: 'team_lead' };
const agentAlex = { email: 'alexandra.apsychou@deel.com', role: 'agent' };

// ── 1. getVisibleEmails ─────────────────────────────────────────────────────
console.log('\n── Visible emails per role ──');
assertSize('admin sees all 104 members', getVisibleEmails(admin), TEAM_MEMBERS.length);

const rmEmails = getVisibleEmails(rmKristina);
assertHas('RM Kristina sees self', rmEmails, 'kristina.fomina@deel.com');
assertHas('RM Kristina sees TL Jose (direct report)', rmEmails, 'jose.ruales@deel.com');
assertHas('RM Kristina sees Alexandra (TL Jose\'s report)', rmEmails, 'alexandra.apsychou@deel.com');
assertHas('RM Kristina sees TL Ljubica', rmEmails, 'ljubica.andjelic@deel.com');
assertHas('RM Kristina sees Aline (Ljubica\'s report)', rmEmails, 'aline.galletyer@deel.com');
assertMissing('RM Kristina does NOT see admin Mohamed', rmEmails, 'mohamed.tantawy@deel.com');
assertMissing('RM Kristina does NOT see RM Megan', rmEmails, 'megan.lawrence@deel.com');
assertMissing('RM Kristina does NOT see Megan\'s report Alaetra', rmEmails, 'alaetra.wilkerson@deel.com');

const tlEmails = getVisibleEmails(tlJose);
assertHas('TL Jose sees self', tlEmails, 'jose.ruales@deel.com');
assertHas('TL Jose sees direct report Alexandra', tlEmails, 'alexandra.apsychou@deel.com');
assertHas('TL Jose sees direct report Anne', tlEmails, 'anne.sanmartin@deel.com');
assertHas('TL Jose sees direct report Carolina', tlEmails, 'carolina.ferreira@deel.com');
assertMissing('TL Jose does NOT see manager Kristina', tlEmails, 'kristina.fomina@deel.com');
assertMissing('TL Jose does NOT see peer TL Ljubica', tlEmails, 'ljubica.andjelic@deel.com');
assertMissing('TL Jose does NOT see Aline (Ljubica\'s report)', tlEmails, 'aline.galletyer@deel.com');

const agentEmails = getVisibleEmails(agentAlex);
assertSize('Agent Alexandra sees exactly 1 email (self)', agentEmails, 1);
assertHas('Agent Alexandra sees self', agentEmails, 'alexandra.apsychou@deel.com');
assertMissing('Agent Alexandra does NOT see manager Jose', agentEmails, 'jose.ruales@deel.com');

// ── 2. getVisibleCountries ──────────────────────────────────────────────────
console.log('\n── Visible countries per role ──');
const adminCountries = getVisibleCountries(admin);
console.log(`  Admin country set size: ${adminCountries.size} (all countries owned by anyone)`);

const rmCountries = getVisibleCountries(rmKristina);
console.log(`  RM Kristina country set size: ${rmCountries.size}`);

const tlCountries = getVisibleCountries(tlJose);
console.log(`  TL Jose country set size: ${tlCountries.size}`);
// TL sees own countries + direct reports' countries
const expectedTlCountries = new Set();
for (const e of [tlJose.email, ...getDirectReports(tlJose.email).map(r => r.email.toLowerCase())]) {
  const owned = OWNER_COUNTRIES.get(e);
  if (owned) for (const c of owned) expectedTlCountries.add(c);
}
assert('TL Jose sees exactly the union of his + reports\' countries', tlCountries.size, expectedTlCountries.size);

const agentCountries = getVisibleCountries(agentAlex);
const expectedAgentCountries = OWNER_COUNTRIES.get('alexandra.apsychou@deel.com') || new Set();
assert('Agent Alexandra sees only her own owned countries', agentCountries.size, expectedAgentCountries.size);

// ── 3. Assignee-based filter (ZD / Jira / Offb / Workbench) ────────────────
console.log('\n── Assignee-mode filter ──');
const sampleItems = [
  { id: 'A', assigneeEmail: 'alexandra.apsychou@deel.com', country: 'ES' },     // Alexandra's
  { id: 'B', assigneeEmail: 'jose.ruales@deel.com', country: 'FR' },             // Jose's
  { id: 'C', assigneeEmail: 'kristina.fomina@deel.com', country: 'DE' },         // Kristina's
  { id: 'D', assigneeEmail: 'mohamed.tantawy@deel.com', country: 'US' },         // Admin's
  { id: 'E', assigneeEmail: 'megan.lawrence@deel.com', country: 'CA' },          // Other RM's
  { id: 'F', assigneeEmail: 'alaetra.wilkerson@deel.com', country: 'CA' },       // Megan's report
  { id: 'G', assigneeEmail: null, country: 'ES' },                               // Unassigned, Spain
  { id: 'H', assigneeEmail: null, country: 'VN' },                               // Unassigned, Vietnam
  { id: 'I', assigneeEmail: null, country: null },                               // Unassigned no country
];

const adminIds = filterByAssignee(sampleItems, admin).map(i => i.id).sort();
assert('Admin sees every item (A-I)', adminIds, ['A','B','C','D','E','F','G','H','I']);

const rmIds = filterByAssignee(sampleItems, rmKristina).map(i => i.id).sort();
// RM Kristina's subtree: herself, Jose, Ljubica, Mina (direct reports — team_leads)
//  + their reports. Alexandra is Jose's report → yes. Alaetra is Megan's report → no.
const rmExpected = ['A', 'B', 'C'];
// Unassigned ES — does Kristina's subtree include ES ownership? Depends on data.
if (rmCountries.has('ES')) rmExpected.push('G');
if (rmCountries.has('VN')) rmExpected.push('H');
assert('RM Kristina sees subtree assignees + unassigned where country matches', rmIds, rmExpected.sort());

const tlIds = filterByAssignee(sampleItems, tlJose).map(i => i.id).sort();
const tlExpected = ['A', 'B'];
if (tlCountries.has('ES')) tlExpected.push('G');
if (tlCountries.has('VN')) tlExpected.push('H');
assert('TL Jose sees self + direct reports + unassigned in team countries', tlIds, tlExpected.sort());

const agentIds = filterByAssignee(sampleItems, agentAlex).map(i => i.id).sort();
// Agent sees only items assigned to her
assert('Agent Alexandra sees only her own items (strict assignee)', agentIds, ['A']);

// ── 4. Country-based filter (Onb / Paused / Amd / Red) ─────────────────────
console.log('\n── Country-mode filter ──');
const countryItems = [
  { id: 'P', country: 'ES' },
  { id: 'Q', country: 'FR' },
  { id: 'R', country: 'US' },
  { id: 'S', country: 'DE' },
  { id: 'T', country: 'VN' },
  { id: 'U', countryCode: 'JP' }, // Alternative field name
  { id: 'V', country: null },
];

assert('Admin sees all country items (incl. missing country as admin)', filterByCountry(countryItems, admin).length, countryItems.length);

// RM, TL, Agent each see only items in their country set
const rmCountryIds = filterByCountry(countryItems, rmKristina).map(i => i.id).sort();
const tlCountryIds = filterByCountry(countryItems, tlJose).map(i => i.id).sort();
const agentCountryIds = filterByCountry(countryItems, agentAlex).map(i => i.id).sort();

const countryMatchFor = (set) => countryItems.filter(i => {
  const cc = (i.country || i.countryCode || '').toUpperCase();
  return cc && set.has(cc);
}).map(i => i.id).sort();

assert('RM Kristina country filter matches her country set', rmCountryIds, countryMatchFor(rmCountries));
assert('TL Jose country filter matches his country set', tlCountryIds, countryMatchFor(tlCountries));
assert('Agent Alexandra country filter matches her country set', agentCountryIds, countryMatchFor(agentCountries));

// ── 5. Named wrappers all work ─────────────────────────────────────────────
console.log('\n── Named wrapper consistency ──');
assert('scopeZendeskTickets delegates to filterByAssignee',       scopeZendeskTickets(sampleItems, tlJose).length, filterByAssignee(sampleItems, tlJose).length);
assert('scopeOffboardingCases delegates to filterByAssignee',     scopeOffboardingCases(sampleItems, tlJose).length, filterByAssignee(sampleItems, tlJose).length);
assert('scopeWorkbenchTasks delegates to filterByAssignee',       scopeWorkbenchTasks(sampleItems, tlJose).length, filterByAssignee(sampleItems, tlJose).length);
assert('scopeOnboardingPeople delegates to filterByCountry',      scopeOnboardingPeople(countryItems, tlJose).length, filterByCountry(countryItems, tlJose).length);
assert('scopeAmendmentRequests delegates to filterByCountry',     scopeAmendmentRequests(countryItems, tlJose).length, filterByCountry(countryItems, tlJose).length);
assert('scopeRedlineRequests delegates to filterByCountry',       scopeRedlineRequests(countryItems, tlJose).length, filterByCountry(countryItems, tlJose).length);

// ── 6. Critical spec: agents see their tasks only on ZD/JR/Terminations ────
console.log('\n── Agent spec — strict assignee-only for ZD/JR/Terminations ──');
// Agent's assignee-scoped queues never include unassigned rows, even when
// country matches. This was a pre-existing bug in Offboarding.
const agentOffb = scopeOffboardingCases([
  { id: '1', assigneeEmail: 'alexandra.apsychou@deel.com', country: 'ES' },
  { id: '2', assigneeEmail: null, country: 'ES' }, // unassigned in own country — must NOT be visible
  { id: '3', assigneeEmail: 'someone.else@deel.com', country: 'ES' },
], agentAlex).map(i => i.id).sort();
assert('Agent sees only items assigned to them on Offboarding (no country fallback)', agentOffb, ['1']);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────`);
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
if (failed > 0) process.exit(1);
