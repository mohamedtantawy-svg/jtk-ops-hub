// ── /api/v1/performance/templates/[id] ───────────────────────────────────────
// GET    — one template (managerial).
// PATCH  — edit name / criteria / weights / thresholds (perf-admin). Bumps
//          version so NEW reviews use the new shape; existing reviews keep
//          their stored computed scores (immutable).
// DELETE — archive (perf-admin).
import { NextResponse } from 'next/server';
import { requireRole } from '../../../../../../src/lib/auth-helpers';
import { query } from '../../../../../../src/lib/db';
import { canAdministerPerformance } from '../../../../../../src/lib/performance-admin';
import { PERF_MANAGERIAL_ROLES } from '../../../../../../src/lib/performance-constants';

function toClient(r) {
  return {
    id: r.id, orgNodeId: r.org_node_id, roleKey: r.role_key, name: r.name, version: r.version,
    weights: r.weights || { operations: 0.5, kpi: 0.3, growth: 0.2 },
    operationsCriteria: Array.isArray(r.operations_criteria) ? r.operations_criteria : [],
    growthCriteria: Array.isArray(r.growth_criteria) ? r.growth_criteria : [],
    opsThresholds: r.ops_thresholds || null, growthThresholds: r.growth_thresholds || null,
    isActive: r.is_active,
  };
}
function cleanCriteria(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set(); const out = [];
  for (const c of arr) {
    if (!c || typeof c !== 'object') continue;
    const key = String(c.key || c.label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const label = String(c.label || '').slice(0, 120).trim();
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, description: c.description ? String(c.description).slice(0, 600) : '' });
  }
  return out.slice(0, 40);
}

export async function GET(req, { params }) {
  const gate = requireRole(req, ...PERF_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { rows } = await query(
      `SELECT id, org_node_id, role_key, name, version, weights, operations_criteria,
              growth_criteria, ops_thresholds, growth_thresholds, is_active
         FROM perf_templates WHERE id = $1 AND is_archived = false LIMIT 1`, [id]);
    if (!rows[0]) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ template: toClient(rows[0]) });
  } catch (err) {
    console.error('[performance/templates/[id] GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const gate = requireRole(req, ...PERF_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await canAdministerPerformance(gate.user))) {
    return NextResponse.json({ error: 'Performance admin required' }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const sets = []; const values = [];
    if (typeof body.name === 'string' && body.name.trim()) { values.push(body.name.slice(0, 120).trim()); sets.push(`name = $${values.length}`); }
    if (body.weights && typeof body.weights === 'object') { values.push(JSON.stringify(body.weights)); sets.push(`weights = $${values.length}::jsonb`); }
    if (Array.isArray(body.operationsCriteria)) { values.push(JSON.stringify(cleanCriteria(body.operationsCriteria))); sets.push(`operations_criteria = $${values.length}::jsonb`); }
    if (Array.isArray(body.growthCriteria)) { values.push(JSON.stringify(cleanCriteria(body.growthCriteria))); sets.push(`growth_criteria = $${values.length}::jsonb`); }
    if (body.opsThresholds === null || Array.isArray(body.opsThresholds)) { values.push(body.opsThresholds ? JSON.stringify(body.opsThresholds) : null); sets.push(`ops_thresholds = $${values.length}::jsonb`); }
    if (body.growthThresholds === null || Array.isArray(body.growthThresholds)) { values.push(body.growthThresholds ? JSON.stringify(body.growthThresholds) : null); sets.push(`growth_thresholds = $${values.length}::jsonb`); }
    if (typeof body.isActive === 'boolean') { values.push(body.isActive); sets.push(`is_active = $${values.length}`); }
    if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    sets.push('version = version + 1', 'updated_at = NOW()');
    values.push(id);
    const { rows } = await query(
      `UPDATE perf_templates SET ${sets.join(', ')} WHERE id = $${values.length} AND is_archived = false
       RETURNING id, org_node_id, role_key, name, version, weights, operations_criteria, growth_criteria, ops_thresholds, growth_thresholds, is_active`,
      values);
    if (!rows[0]) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ template: toClient(rows[0]) });
  } catch (err) {
    console.error('[performance/templates/[id] PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const gate = requireRole(req, ...PERF_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await canAdministerPerformance(gate.user))) {
    return NextResponse.json({ error: 'Performance admin required' }, { status: 403 });
  }
  const { id } = await params;
  try {
    await query('UPDATE perf_templates SET is_archived = true, updated_at = NOW() WHERE id = $1', [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[performance/templates/[id] DELETE]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
