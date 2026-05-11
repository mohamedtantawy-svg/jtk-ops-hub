// ── /api/v1/handover-settings ─────────────────────────────────────────
// GET  — list all configuration presets (admin only)
// POST — create a new preset
//
// Phase 5 of HANDOVERS_PLAN.md. The Settings panel CRUDs these rows so
// regional managers can ship per-region / per-team configurations
// without redeploying.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { canManageHandoverSettings } from '../../../../src/lib/handover-admin';

async function requireAdmin(req) {
  const user = getAuthUser(req);
  if (!user.email) return { error: 'Unauthorized', status: 401 };
  if (!(await canManageHandoverSettings(user))) return { error: 'Forbidden', status: 403 };
  return { user };
}

export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { rows } = await query(
      `SELECT id, name, scope, scope_value,
              reminder_48h_enabled, reminder_24h_enabled, reminder_handback_enabled,
              manager_approval_required, coverer_acceptance_required,
              min_days_to_trigger, allow_country_split,
              default_template_id, is_default,
              created_at, updated_at
         FROM handover_settings
        ORDER BY is_default DESC, scope ASC, name ASC`,
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error('[handover-settings GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const VALID_SCOPES = new Set(['global', 'region', 'team']);

export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const name = String(body?.name || '').trim().slice(0, 200);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const scope = VALID_SCOPES.has(body?.scope) ? body.scope : 'global';
  const scopeValue = scope === 'global' ? null : (body?.scope_value || null);
  try {
    const { rows } = await query(
      `INSERT INTO handover_settings
         (name, scope, scope_value,
          reminder_48h_enabled, reminder_24h_enabled, reminder_handback_enabled,
          manager_approval_required, coverer_acceptance_required,
          min_days_to_trigger, allow_country_split,
          default_template_id, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        name, scope, scopeValue,
        body?.reminder_48h_enabled !== false,
        body?.reminder_24h_enabled !== false,
        body?.reminder_handback_enabled !== false,
        body?.manager_approval_required !== false,
        body?.coverer_acceptance_required !== false,
        Number.isFinite(body?.min_days_to_trigger) ? body.min_days_to_trigger : 1,
        body?.allow_country_split !== false,
        body?.default_template_id || null,
        body?.is_default === true,
      ],
    );
    return NextResponse.json({ item: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[handover-settings POST]', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
