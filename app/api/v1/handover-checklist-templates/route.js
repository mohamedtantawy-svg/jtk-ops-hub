// ── /api/v1/handover-checklist-templates ──────────────────────────────
// GET  — list all templates (admin only)
// POST — create a new template (admin only)

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
      `SELECT id, name, description, scope, scope_value, items, is_default,
              created_by_email, created_at, updated_at
         FROM handover_checklist_templates
        ORDER BY is_default DESC, name ASC`,
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error('[handover-checklist-templates GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const VALID_SCOPES = new Set(['global', 'region', 'team']);

function sanitiseItems(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 100)
    .map(it => ({
      id: String(it?.id || '').slice(0, 80) || `item_${Math.random().toString(36).slice(2, 8)}`,
      label: String(it?.label || '').slice(0, 500),
      required: it?.required !== false,
      hint: typeof it?.hint === 'string' ? it.hint.slice(0, 500) : '',
    }))
    .filter(it => it.label);
}

export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const name = String(body?.name || '').trim().slice(0, 200);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const scope = VALID_SCOPES.has(body?.scope) ? body.scope : 'global';
  const scopeValue = scope === 'global' ? null : (body?.scope_value || null);
  const items = sanitiseItems(body?.items);
  try {
    const { rows } = await query(
      `INSERT INTO handover_checklist_templates
         (name, description, scope, scope_value, items, is_default, created_by_email)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING *`,
      [name, body?.description || null, scope, scopeValue, JSON.stringify(items),
       body?.is_default === true, auth.user.email.toLowerCase()],
    );
    return NextResponse.json({ item: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[handover-checklist-templates POST]', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
