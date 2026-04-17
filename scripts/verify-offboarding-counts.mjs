// One-off verification: fetch offboarding list directly from Deel admin API
// and print counts. Mirrors the same filter logic as listOffboardingCases.
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// Admin endpoint needs a JWT session token from admin.deel.network.
// Prefer DEEL_ADMIN_TOKEN, fall back to DEEL_API_KEY for convenience.
const token = ((process.env.DEEL_ADMIN_TOKEN || process.env.DEEL_API_KEY || '').trim()).replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '');
if (token.split('.').length !== 3) {
  console.error('ERROR: No valid admin JWT. Set DEEL_ADMIN_TOKEN in .env.local to an admin.deel.network session JWT (copy the x-auth-token header from a terminations_v3 request in DevTools).');
  process.exit(2);
}
// Admin endpoint lives on a different host than the default REST v2 base in .env.local.
const base = 'https://api-prod-admin.letsdeel.com';

const ACTIONABLE = [
  'AwaitingAssignee',
  'AwaitingCSMReview',
  'AwaitingLegalReview',
  'AwaitingClientReview',
  'AwaitingDocumentSharingForClientApproval',
  'AwaitingDocumentSharingForEmployeeApproval',
  'AwaitingFinalPayrollDecision',
  'OffboardingPayments',
  'Documents#EMPLOYEE_NOTIFICATION',
  'Documents#DOCUMENTS_CONFIRMATION',
  'Documents#EMPLOYEE_SIGNATURE',
  'Unenrollment',
];
const CLOSED = new Set(['COMPLETED', 'DONE', 'CANCELLED', 'CANCELED', 'AWAITING_REFUND']);

function buildUrl(cursor) {
  // Admin API expects literal `[]` in keys (not URL-encoded).
  const parts = ['limit=50'];
  for (const s of ACTIONABLE) parts.push(`terminationFlowStatuses[]=${encodeURIComponent(s)}`);
  if (cursor) parts.push(`cursor=${encodeURIComponent(cursor)}`);
  return `${base}/admin/eor/terminations_v3?${parts.join('&')}`;
}

async function fetchPage(cursor) {
  const res = await fetch(buildUrl(cursor), {
    headers: {
      'x-auth-token': token,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: 'https://admin.deel.network',
      Referer: 'https://admin.deel.network/',
      'x-app-host': 'app.deel.com',
      'x-proxy-to': 'payments',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

const t0 = Date.now();
const all = [];
const seen = new Set();
let cursor = null;
let page = 0;
let serverTotal = null;
const MAX_PAGES = 40;

while (page < MAX_PAGES) {
  const data = await fetchPage(cursor);
  if (serverTotal === null) serverTotal = data?.count?.total ?? null;
  for (const t of data.terminations || []) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      all.push(t);
    }
  }
  cursor = data.cursor || null;
  page++;
  process.stderr.write(`page ${page}: got ${data.terminations?.length || 0} (running total ${all.length}, server says ${serverTotal})\n`);
  if (!cursor) break;
}

const filtered = all.filter(c => {
  const s = (c.status || '').toUpperCase();
  if (CLOSED.has(s)) return false;
  if (c.isDuplicate === true) return false;
  return true;
});

const byType = { Termination: 0, 'Resignation (Employee)': 0, 'Resignation (Client)': 0, Other: 0 };
for (const c of filtered) {
  const t = (c.type || '').toUpperCase();
  if (c.requestData?.isEmployeeResignation) byType['Resignation (Employee)']++;
  else if (t.includes('RESIGNATION')) byType['Resignation (Client)']++;
  else if (t === 'TERMINATION') byType.Termination++;
  else byType.Other++;
}

const byAdminStatus = {};
for (const c of filtered) {
  const s = c.status || '(none)';
  byAdminStatus[s] = (byAdminStatus[s] || 0) + 1;
}

const distinctTopTypes = {};
for (const c of filtered) {
  const t = c.type || '(none)';
  distinctTopTypes[t] = (distinctTopTypes[t] || 0) + 1;
}

console.log(JSON.stringify({
  pages_fetched: page,
  hit_page_cap: page >= MAX_PAGES && !!cursor,
  server_count_total: serverTotal,
  raw_records_before_filter: all.length,
  final_deduped_total: filtered.length,
  by_type: byType,
  by_admin_status: byAdminStatus,
  by_top_level_type_field: distinctTopTypes,
  elapsed_ms: Date.now() - t0,
}, null, 2));
