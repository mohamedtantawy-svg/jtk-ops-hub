// ── /api/v1/performance/templates ────────────────────────────────────────────
// Role-specific evaluation templates for the caller's department.
// GET  — list active templates for the current dept (managerial roles).
// POST — create a template (perf-admin / admin).
import { NextResponse } from 'next/server';
import { requireRole } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';
import { canAdministerPerformance } from '../../../../../src/lib/performance-admin';
import { PERF_MANAGERIAL_ROLES } from '../../../../../src/lib/performance-constants';

function toClient(r) {
  return {
    id: r.id,
    orgNodeId: r.org_node_id,
    roleKey: r.role_key,
    name: r.name,
    version: r.version,
    weights: r.weights || { operations: 0.5, kpi: 0.3, growth: 0.2 },
    operationsCriteria: Array.isArray(r.operations_criteria) ? r.operations_criteria : [],
    growthCriteria: Array.isArray(r.growth_criteria) ? r.growth_criteria : [],
    opsThresholds: r.ops_thresholds || null,
    growthThresholds: r.growth_thresholds || null,
    isActive: r.is_active,
  };
}

function cleanCriteria(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
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

export async function GET(req) {
  const gate = requireRole(req, ...PERF_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const deptId = await getCurrentDeptId(gate.user, req);
    const { rows } = await query(
      `SELECT id, org_node_id, role_key, name, version, weights, operations_criteria,
              growth_criteria, ops_thresholds, growth_thresholds, is_active
         FROM perf_templates
        WHERE is_archived = false AND ($1::uuid IS NULL OR org_node_id = $1)
        ORDER BY name ASC`,
      [deptId || null],
    );
    return NextResponse.json({ templates: rows.map(toClient), deptId: deptId || null });
  } catch (err) {
    console.error('[performance/templates GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const gate = requireRole(req, ...PERF_MANAGERIAL_ROLES);
  if (!gate.authorized) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await canAdministerPerformance(gate.user))) {
    return NextResponse.json({ error: 'Performance admin required' }, { status: 403 });
  }
  try {
    const deptId = await getCurrentDeptId(gate.user, req);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '').slice(0, 120).trim();
    const roleKey = String(body.roleKey || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name || !roleKey) return NextResponse.json({ error: 'name and roleKey are required' }, { status: 400 });
    const w = body.weights && typeof body.weights === 'object' ? body.weights : { operations: 0.5, kpi: 0.3, growth: 0.2 };
    const { rows } = await query(
      `INSERT INTO perf_templates (org_node_id, role_key, name, version, weights, operations_criteria, growth_criteria)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5::jsonb, $6::jsonb)
       RETURNING id, org_node_id, role_key, name, version, weights, operations_criteria, growth_criteria, ops_thresholds, growth_thresholds, is_active`,
      [deptId || null, roleKey, name, JSON.stringify(w),
       JSON.stringify(cleanCriteria(body.operationsCriteria)), JSON.stringify(cleanCriteria(body.growthCriteria))],
    );
    return NextResponse.json({ template: toClient(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[performance/templates POST]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
