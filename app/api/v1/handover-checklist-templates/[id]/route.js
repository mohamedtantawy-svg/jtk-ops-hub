// ── /api/v1/handover-checklist-templates/:id ──────────────────────────
// PATCH  — edit fields (name / description / items / is_default / scope)
// DELETE — remove (cannot delete the global default)

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageHandoverSettings } from '../../../../../src/lib/handover-admin';

async function requireAdmin(req) {
  const user = getAuthUser(req);
  if (!user.email) return { error: 'Unauthorized', status: 401 };
  if (!(await canManageHandoverSettings(user))) return { error: 'Forbidden', status: 403 };
  return { user };
}

function sanitiseItems(input) {
  if (!Array.isArray(input)) return null;
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

export async function PATCH(req, ctx) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sets = [];
  const params = [];
  let p = 1;
  if (typeof body?.name === 'string') {
    sets.push(`name = $${p++}`); params.push(body.name.trim().slice(0, 200));
  }
  if (typeof body?.description === 'string' || body?.description === null) {
    sets.push(`description = $${p++}`); params.push(body.description);
  }
  if (typeof body?.scope === 'string') {
    sets.push(`scope = $${p++}`); params.push(body.scope);
  }
  if ('scope_value' in (body || {})) {
    sets.push(`scope_value = $${p++}`); params.push(body.scope_value || null);
  }
  if (Array.isArray(body?.items)) {
    sets.push(`items = $${p++}::jsonb`); params.push(JSON.stringify(sanitiseItems(body.items)));
  }
  if (typeof body?.is_default === 'boolean') {
    sets.push(`is_default = $${p++}`); params.push(body.is_default);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const item = await withTransaction(async (client) => {
      if (body?.is_default === true) {
        await client.query(
          `UPDATE handover_checklist_templates SET is_default = FALSE
            WHERE is_default = TRUE AND scope = 'global' AND id <> $1`,
          [id],
        );
      }
      const r = await client.query(
        `UPDATE handover_checklist_templates SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
        params,
      );
      if (r.rows.length === 0) throw Object.assign(new Error('Not found'), { status: 404 });
      return r.rows[0];
    });
    return NextResponse.json({ item });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handover-checklist-templates PATCH]', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status });
  }
}

export async function DELETE(req, ctx) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const { rows } = await query(
      `SELECT id, is_default, scope FROM handover_checklist_templates WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (rows[0].is_default && rows[0].scope === 'global') {
      return NextResponse.json({
        error: 'Cannot delete the global default — promote another template first',
      }, { status: 409 });
    }
    await query(`DELETE FROM handover_checklist_templates WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[handover-checklist-templates DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
