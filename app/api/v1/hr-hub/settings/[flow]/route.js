// ── /api/v1/hr-hub/settings/[flow] ──────────────────────────────────────────
// GET  — read the full settings bundle for one flow (statuses, fields,
//        dropdowns, auto_assign, meta). Anyone authenticated.
// PUT  — bulk update one or more keys for a flow. HR Hub Admin only.
//        Body: { statuses?, fields?, dropdowns?, auto_assign? } — keys
//        omitted from the body are left untouched. Each changed key
//        also writes a row to hr_hub_settings_history with a JSON diff.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { memberByEmail, isHrHubAdmin } from '../../../../../../src/lib/hr-hub-helpers';

const ALLOWED_FLOWS = new Set(['hr_request', 'hr_reporting', 'escalation_zero', 'feedback', 'payment_refund']);
const EDITABLE_KEYS = new Set(['statuses', 'fields', 'dropdowns', 'auto_assign']);

export async function GET(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { flow } = await params;
  if (!ALLOWED_FLOWS.has(flow)) return NextResponse.json({ error: `Invalid flow: ${flow}` }, { status: 400 });

  const { rows } = await query(
    `SELECT key, value_json, updated_by_email, updated_at
       FROM hr_hub_settings WHERE flow = $1`,
    [flow],
  );
  const out = {};
  for (const r of rows) {
    out[r.key] = {
      value: r.value_json,
      updatedByEmail: r.updated_by_email,
      updatedAt: r.updated_at,
    };
  }
  return NextResponse.json({ flow, settings: out });
}

export async function PUT(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  if (!(await isHrHubAdmin(user))) {
    return NextResponse.json({ error: 'Forbidden — HR Hub Admin power required' }, { status: 403 });
  }

  const { flow } = await params;
  if (!ALLOWED_FLOWS.has(flow)) return NextResponse.json({ error: `Invalid flow: ${flow}` }, { status: 400 });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const callerEmail = String(user.email).toLowerCase();
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  // Pre-fetch existing values so the audit-history diff is accurate.
  const { rows: existingRows } = await query(
    `SELECT key, value_json FROM hr_hub_settings WHERE flow = $1`, [flow],
  );
  const existing = Object.fromEntries(existingRows.map(r => [r.key, r.value_json]));

  const writes = [];
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_KEYS.has(key)) continue;            // silently ignore unknown keys
    if (value === undefined) continue;
    writes.push({ key, value });
  }
  if (writes.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const audit = [];
  await withTransaction(async (client) => {
    for (const w of writes) {
      await client.query(
        `INSERT INTO hr_hub_settings (flow, key, value_json, updated_by_email, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (flow, key) DO UPDATE
           SET value_json = EXCLUDED.value_json,
               updated_by_email = EXCLUDED.updated_by_email,
               updated_at = NOW()`,
        [flow, w.key, JSON.stringify(w.value), callerEmail],
      );
      audit.push({ key: w.key, before: existing[w.key] ?? null, after: w.value });
    }
    for (const a of audit) {
      await client.query(
        `INSERT INTO hr_hub_settings_history
           (flow, key, before_json, after_json, actor_email, actor_name)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
        [
          flow, a.key,
          a.before == null ? null : JSON.stringify(a.before),
          a.after == null ? null : JSON.stringify(a.after),
          callerEmail, callerName,
        ],
      );
    }
  });

  return NextResponse.json({ ok: true, changed: writes.length, keys: writes.map(w => w.key) });
}
