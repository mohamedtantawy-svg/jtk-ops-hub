// ── Command Center settings (exec-tunable, 2026-06-03) ──────────────────────
// Server-side store for the executive-tunable knobs that drive the Command
// Center rollups: Health Score weights, the HR Hub ageing thresholds (breach /
// at-risk days), the capacity load bands, and the default volume window. Stored
// as a single JSON blob in app_settings.command_center_settings, merged over
// defaults so a partial/absent row is always safe. 30 s in-memory cache.

import { query } from './db';

export const CC_SETTINGS_KEY = 'command_center_settings';

export const CC_SETTINGS_DEFAULTS = Object.freeze({
  healthWeights: { backlog: 40, resolution: 30, urgent: 15, staffing: 15 },
  slaBreachDays: 7,   // open HR Hub older than this = breached
  slaAtRiskDays: 2,   // open between this and slaBreachDays = at-risk
  capacityGood: 2,    // open-per-person >= this = "good" load band
  capacityHigh: 5,    // open-per-person >= this = "high" load band
  volumeDays: 30,     // default trend window (7 / 30 / 90)
});

let _cache = null;
let _cacheTs = 0;
const TTL_MS = 30_000;

function _merge(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    healthWeights: { ...CC_SETTINGS_DEFAULTS.healthWeights, ...(s.healthWeights && typeof s.healthWeights === 'object' ? s.healthWeights : {}) },
    slaBreachDays: num(s.slaBreachDays, CC_SETTINGS_DEFAULTS.slaBreachDays),
    slaAtRiskDays: num(s.slaAtRiskDays, CC_SETTINGS_DEFAULTS.slaAtRiskDays),
    capacityGood: num(s.capacityGood, CC_SETTINGS_DEFAULTS.capacityGood),
    capacityHigh: num(s.capacityHigh, CC_SETTINGS_DEFAULTS.capacityHigh),
    volumeDays: num(s.volumeDays, CC_SETTINGS_DEFAULTS.volumeDays),
  };
}

export function bustCommandCenterSettingsCache() { _cache = null; _cacheTs = 0; }

export async function getCommandCenterSettings() {
  if (_cache && Date.now() - _cacheTs < TTL_MS) return _cache;
  if (!process.env.DATABASE_URL) return { ...CC_SETTINGS_DEFAULTS };
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = $1`, [CC_SETTINGS_KEY]);
    const raw = rows[0]?.value;
    const stored = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};
    _cache = _merge(stored);
    _cacheTs = Date.now();
    return _cache;
  } catch (err) {
    console.warn('[cc-settings] read failed:', err.message);
    return { ...CC_SETTINGS_DEFAULTS };
  }
}

// Persist a partial patch, clamped to sane ranges. Returns the merged settings.
export async function setCommandCenterSettings(patch) {
  const cur = await getCommandCenterSettings();
  const next = _merge({ ...cur, ...(patch && typeof patch === 'object' ? patch : {}) });

  // Clamp / sanitise so a bad input can't break the rollups or the UI.
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  next.slaBreachDays = clampInt(next.slaBreachDays, 1, 60);
  next.slaAtRiskDays = clampInt(next.slaAtRiskDays, 0, next.slaBreachDays);
  next.capacityGood = clampInt(next.capacityGood, 0, 50);
  next.capacityHigh = clampInt(next.capacityHigh, next.capacityGood, 200);
  next.volumeDays = [7, 30, 90].includes(Math.round(next.volumeDays)) ? Math.round(next.volumeDays) : 30;
  for (const k of ['backlog', 'resolution', 'urgent', 'staffing']) {
    next.healthWeights[k] = clampInt(next.healthWeights[k], 0, 100);
  }

  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [CC_SETTINGS_KEY, JSON.stringify(next), 'command-center'],
  );
  _cache = next;
  _cacheTs = Date.now();
  return next;
}
