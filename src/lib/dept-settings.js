// ── Per-department app_settings helpers ────────────────────────────────────
// A few "one value for the team" settings (manager_on_call, team_lead_on_call,
// queue_priority_of_day) became per-department on 2026-06-04 ("each dept should
// have its own manager on call / banner ... stop copying HRX across depts").
//
// Each top-level dept stores its value under `<baseKey>:<deptId>`. The pre-
// multi-tenant rows live under the bare `<baseKey>` key and belong to the
// original HR Experience dept, so HRX inherits that value until it sets its
// own; every other dept starts from the caller-supplied default until a value
// is set for it.
//
// This is the single source of truth for the key format + the HRX inheritance
// rule, shared by the settings routes (display) AND their server-side consumers
// (urgent-assist MOC edit permission, HR-Hub TLOC auto-assign) so the "who is
// the MOC/TLOC for this dept" answer never drifts between surfaces.

import { query } from './db';

const HRX_SLUG = 'hr-experience';

export function deptSettingKey(baseKey, deptId) {
  return deptId ? `${baseKey}:${deptId}` : baseKey;
}

// Returns the raw app_settings row { value, updated_by, updated_at } for a
// dept-scoped setting, or null when neither the dept row nor the inherited HRX
// legacy row exists. Throws only on a real DB error — callers wrap as needed.
export async function readDeptSettingRow(baseKey, deptId, deptSlug) {
  const key = deptSettingKey(baseKey, deptId);
  let { rows } = await query(
    'SELECT value, updated_by, updated_at FROM app_settings WHERE key = $1',
    [key],
  );
  // HRX inherits the legacy global value until it sets its own dept value.
  if (rows.length === 0 && key !== baseKey && deptSlug === HRX_SLUG) {
    ({ rows } = await query(
      'SELECT value, updated_by, updated_at FROM app_settings WHERE key = $1',
      [baseKey],
    ));
  }
  return rows[0] || null;
}
