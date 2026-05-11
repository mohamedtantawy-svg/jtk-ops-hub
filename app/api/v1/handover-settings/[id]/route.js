// ── /api/v1/handover-settings/:id ─────────────────────────────────────
// PATCH  — edit a config preset (admin only)
// DELETE — remove a preset (admin only; the global default cannot be
//          deleted without first promoting a different row to default)

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

const ALLOWED_FIELDS = new Set([
  'name', 'scope', 'scope_value',
  'reminder_48h_enabled', 'reminder_24h_enabled', 'reminder_handback_enabled',
  'manager_approval_required', 'coverer_acceptance_required',
  'min_days_to_trigger', 'allow_country_split',
  'default_template_id', 'is_default',
]);

export async function PATCH(req, ctx) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sets = [];
  const params = [];
  let p = 1;
  for (const [k, v] of Object.entries(body || {})) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    sets.push(`${k} = $${p++}`);
    params.push(v);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  params.push(id);

  try {
    // If is_default is being set to true, demote every other global
    // default in a single transaction so there's always exactly one
    // global-scope default row.
    const item = await withTransaction(async (client) => {
      if (body?.is_default === true) {
        await client.query(
          `UPDATE handover_settings SET is_default = FALSE
            WHERE is_default = TRUE AND scope = 'global' AND id <> $1`,
          [id],
        );
      }
      const r = await client.query(
        `UPDATE handover_settings SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
        params,
      );
      if (r.rows.length === 0) {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }
      return r.rows[0];
    });
    return NextResponse.json({ item });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handover-settings PATCH]', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status });
  }
}

export async function DELETE(req, ctx) {
  const auth = await requireAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const { rows } = await query(
      `SELECT id, is_default, scope FROM handover_settings WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (rows[0].is_default && rows[0].scope === 'global') {
      return NextResponse.json({
        error: 'Cannot delete the global default — promote another preset first',
      }, { status: 409 });
    }
    await query(`DELETE FROM handover_settings WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[handover-settings DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
