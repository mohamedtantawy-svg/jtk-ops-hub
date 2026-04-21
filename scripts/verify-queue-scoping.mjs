// ── Role-accuracy harness ──────────────────────────────────────────────────
// Runs the real src/lib/queue-scoping.js against the real hierarchy in
// src/data/members.js + src/data/countryOwners.js. Asserts every case the
// user specified. Exits with non-zero on any failure.
//
// Usage:  node scripts/verify-queue-scoping.mjs

import {
  filterByAssignee,
  filterByCountry,
  filterByCountryOrAssignee,
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
// After the 2026-04-21 rewrite: Onboarding / Paused Onboarding / Offboarding /
// Amendments / Redlines all route through filterByCountryOrAssignee (country
// owner chain OR assignee chain). ZD / Jira / Workbench stay assignee-only.
console.log('\n── Named wrapper consistency ──');
assert('scopeZendeskTickets delegates to filterByAssignee',           scopeZendeskTickets(sampleItems, tlJose).length,    filterByAssignee(sampleItems, tlJose).length);
assert('scopeWorkbenchTasks delegates to filterByAssignee',           scopeWorkbenchTasks(sampleItems, tlJose).length,    filterByAssignee(sampleItems, tlJose).length);
assert('scopeOffboardingCases delegates to filterByCountryOrAssignee', scopeOffboardingCases(sampleItems, tlJose).length, filterByCountryOrAssignee(sampleItems, tlJose).length);
assert('scopeOnboardingPeople delegates to filterByCountryOrAssignee', scopeOnboardingPeople(countryItems, tlJose).length, filterByCountryOrAssignee(countryItems, tlJose).length);
assert('scopeAmendmentRequests delegates to filterByCountryOrAssignee', scopeAmendmentRequests(countryItems, tlJose).length, filterByCountryOrAssignee(countryItems, tlJose).length);
assert('scopeRedlineRequests delegates to filterByCountryOrAssignee',  scopeRedlineRequests(countryItems, tlJose).length, filterByCountryOrAssignee(countryItems, tlJose).length);

// ── 6. Country-OR-assignee union semantics ─────────────────────────────────
// Core spec: a row is visible if EITHER path matches, and the union is
// strictly additive (no row visible under a single-mode filter disappears
// when we switch to combined).
console.log('\n── filterByCountryOrAssignee union semantics ──');

// 6a. Union ≥ country-only and ≥ assignee-only, for every role.
for (const [label, user] of [
  ['admin', admin], ['RM Kristina', rmKristina], ['TL Jose', tlJose], ['agent Alexandra', agentAlex],
]) {
  const items = [
    { id: 'c1', assigneeEmail: 'someone@deel.com', country: 'ES' },
    { id: 'c2', assigneeEmail: 'alexandra.apsychou@deel.com', country: 'NO_SUCH_COUNTRY' }, // assignee path only
    { id: 'c3', assigneeEmail: null, country: 'ES' },                                        // country path only
    { id: 'c4', assigneeEmail: 'alexandra.apsychou@deel.com', country: 'ES' },               // both paths
    { id: 'c5', assigneeEmail: 'unrelated@deel.com', country: 'NO_SUCH_COUNTRY' },           // neither
  ];
  const countryOnly  = filterByCountry(items, user).length;
  const assigneeOnly = filterByAssignee(items, user).length;
  const combined     = filterByCountryOrAssignee(items, user).length;
  assert(`${label}: combined ≥ country-only`,  combined >= countryOnly,  true);
  assert(`${label}: combined ≥ assignee-only`, combined >= assigneeOnly, true);
}

// 6b. Agent sees self-assigned items AND items in countries they own — the
//     previous strict "no country fallback" behavior is gone by design.
const agentCombined = scopeOffboardingCases([
  { id: '1', assigneeEmail: 'alexandra.apsychou@deel.com', country: 'ES' },   // assigned to her
  { id: '2', assigneeEmail: null, country: 'ES' },                            // unassigned in ES
  { id: '3', assigneeEmail: 'someone.else@deel.com', country: 'ES' },         // assigned to someone else, in ES
  { id: '4', assigneeEmail: null, country: 'NO_SUCH_COUNTRY' },               // nothing matches
  { id: '5', assigneeEmail: 'alexandra.apsychou@deel.com', country: null },   // assigned to her, no country
], agentAlex).map(i => i.id).sort();
const agentOwnsES = agentCountries.has('ES');
const expectedAgentCombined = agentOwnsES
  ? ['1', '2', '3', '5'].sort() // assignee + country(ES) paths both surface
  : ['1', '5'].sort();           // only assignee path
assert(`Agent on country-OR-assignee: ${agentOwnsES ? 'owns ES → sees ES + assigned' : 'not ES owner → assigned only'}`, agentCombined, expectedAgentCombined);

// 6c. Dedup: an item that matches BOTH paths is returned once.
const dedupeItems = [
  { id: 'dup', assigneeEmail: tlJose.email, country: [...tlCountries][0] || 'ES' },
];
assert('combined filter dedupes items matching both paths', filterByCountryOrAssignee(dedupeItems, tlJose).length, 1);

// 6d. Items with neither country nor assignee match → invisible (except admin).
const noMatchItems = [{ id: 'x', assigneeEmail: 'unrelated@deel.com', country: 'NO_SUCH_COUNTRY' }];
assert('TL sees no items that match neither path',      filterByCountryOrAssignee(noMatchItems, tlJose).length, 0);
assert('RM sees no items that match neither path',      filterByCountryOrAssignee(noMatchItems, rmKristina).length, 0);
assert('agent sees no items that match neither path',   filterByCountryOrAssignee(noMatchItems, agentAlex).length, 0);
assert('admin sees ALL items via combined (early exit)', filterByCountryOrAssignee(noMatchItems, admin).length, 1);

// ── 7. Assignee-only queues (ZD/Jira/Workbench) — unchanged spec ───────────
console.log('\n── Assignee-only queues keep strict assignee spec ──');
// Agent still sees only self-assigned items on ZD/Jira/Workbench — no country
// fallback for these queues per spec ("visibility based on assignee").
const agentWorkbench = scopeWorkbenchTasks([
  { id: 'w1', assigneeEmail: 'alexandra.apsychou@deel.com', country: 'ES' },
  { id: 'w2', assigneeEmail: null, country: 'ES' }, // unassigned in own country — agents DON'T see
  { id: 'w3', assigneeEmail: 'someone.else@deel.com', country: 'ES' },
], agentAlex).map(i => i.id).sort();
assert('Agent sees only own items on Workbench (no country fallback)', agentWorkbench, ['w1']);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────`);
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
if (failed > 0) process.exit(1);
