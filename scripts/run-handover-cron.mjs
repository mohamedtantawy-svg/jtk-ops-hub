#!/usr/bin/env node
// Local dev runner for the handover cron endpoints (Phase 4 of
// HANDOVERS_PLAN.md). Equivalent to the k8s CronJob — useful for
// driving the state machine on a dev pod or smoke-testing a fresh
// reminder window without waiting 15 minutes.
//
// Usage:
//   CRON_SECRET=… node scripts/run-handover-cron.mjs            # both
//   CRON_SECRET=… node scripts/run-handover-cron.mjs lifecycle  # one
//   CRON_SECRET=… node scripts/run-handover-cron.mjs reminders  # one
//
// Env:
//   CRON_SECRET  required — must match the env var the server reads
//   API_BASE     optional — defaults to http://localhost:3000/api/v1

const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error('CRON_SECRET env var is required');
  process.exit(2);
}

const target = (process.argv[2] || 'both').toLowerCase();
const valid = new Set(['lifecycle', 'reminders', 'both']);
if (!valid.has(target)) {
  console.error(`Unknown target "${target}". Pick one of: lifecycle, reminders, both`);
  process.exit(2);
}

async function hit(name) {
  const url = `${BASE}/handovers/cron/${name}`;
  process.stdout.write(`▶ POST ${url}\n`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    },
  });
  const ms = Date.now() - t0;
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    console.error(`✖ ${name} failed (${res.status}, ${ms}ms): ${JSON.stringify(body)}`);
    return false;
  }
  console.log(`✓ ${name} ok (${ms}ms): ${JSON.stringify(body)}`);
  return true;
}

const targets = target === 'both' ? ['lifecycle', 'reminders'] : [target];
let allOk = true;
for (const t of targets) {
  const ok = await hit(t);
  allOk = allOk && ok;
}
process.exit(allOk ? 0 : 1);
