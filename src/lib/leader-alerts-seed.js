// ── Leaders Alerts: default settings (categories, statuses, notification
//    policy) seeded on first boot. Mirrors hr-hub-seed.js shape.
//
// Why a seed: Alerts Admins edit categories / statuses / notification
// policy from the Settings panel without redeploying. The DB row is the
// source of truth at runtime; this file is only the cold-boot baseline.
// Every settings write also stamps `leader_alert_settings_history` for
// audit, so the seed never silently overrides an admin's edit — it only
// inserts when the key row is missing.
//
// Versioning: bump LEADER_ALERTS_SEED_VERSION when adding a key (or new
// option that should propagate even after the row already exists). The
// boot pass writes the version into `app_settings` and re-runs the seed
// exactly once per version bump. Existing manual edits to keys we don't
// touch are preserved.

import { query } from './db';

export const LEADER_ALERTS_SEED_VERSION = 2;

// Status lifecycle is uniform — see LEADER_ALERTS_PLAN.md decision log.
// Adding a status here also requires a matching update to the CHECK
// constraint on leader_alert.status.
const DEFAULT_STATUSES = [
  { id: 'new',         label: 'New',         color: '#1d4ed8' },
  { id: 'in_progress', label: 'In Progress', color: '#ed8d00' },
  { id: 'on_hold',     label: 'On Hold',     color: '#525252' },
  { id: 'resolved',    label: 'Resolved',    color: '#29811e' },
];

// Starting categories match the user's list (LEADER_ALERTS_PLAN.md §"The
// fields per alert"). Color + icon are referenced by the renderer; admins
// can edit them in the Settings panel.
const DEFAULT_CATEGORIES = [
  { id: 'operational_risk', label: 'Operational Risk', color: '#d97706', icon: 'bi-exclamation-triangle-fill' },
  { id: 'pain_point',       label: 'Pain Point',       color: '#dc2626', icon: 'bi-bandaid-fill' },
  { id: 'team_update',      label: 'Team Update',      color: '#15803d', icon: 'bi-people-fill' },
  { id: 'others',           label: 'Others',           color: '#6b7280', icon: 'bi-three-dots' },
  { id: 'country_update',   label: 'Country Update',   color: '#0369a1', icon: 'bi-globe2' },
  { id: 'upcoming_issue',   label: 'Upcoming Issue',   color: '#7c3aed', icon: 'bi-lightbulb-fill' },
  { id: 'achievement',      label: 'Achievement',      color: '#ec4899', icon: 'bi-trophy-fill' },
  { id: 'bug',              label: 'Bug',              color: '#ea580c', icon: 'bi-bug-fill' },
];

// Notification policy — drives the matrix in LEADER_ALERTS_PLAN.md.
// Settings panel toggles each field. Defaults below = "tiered" approach:
// only Critical fan-outs to all managers, mentions always notify, comment
// chatter only reaches followers + commenters.
const DEFAULT_NOTIFICATIONS = {
  newAlertCriticalToAllManagers: true,
  newAlertHighBell:              false,
  newAlertMediumLowBell:         false,
  mentionBell:                   true,
  mentionToast:                  true,
  statusChangeBell:              true,
  newCommentBell:                true,
  reactionBell:                  false,
  ackBell:                       false,
  sidebarBadgeMinSeverity:       'medium',   // only count alerts ≥ this severity in the sidebar badge
  mentionOverridesMute:          true,
};

async function getSeedVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = 'leader_alerts_seed_version'`,
    );
    return rows[0]?.value ? Number(rows[0].value) : 0;
  } catch {
    return 0;
  }
}

async function setSeedVersion(version) {
  await query(
    `INSERT INTO app_settings (key, value)
     VALUES ('leader_alerts_seed_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(version)],
  );
}

/**
 * Insert default settings rows for categories / statuses / notifications.
 * Existing rows are preserved — admin edits never get clobbered. A version
 * marker in app_settings prevents repeat work across pod boots.
 */
export async function seedLeaderAlertsSettingsIfNeeded() {
  const installedVersion = await getSeedVersion();
  if (installedVersion >= LEADER_ALERTS_SEED_VERSION) {
    return { skipped: true, version: installedVersion };
  }

  const rows = [
    { key: 'categories',    value: DEFAULT_CATEGORIES },
    { key: 'statuses',      value: DEFAULT_STATUSES },
    { key: 'notifications', value: DEFAULT_NOTIFICATIONS },
  ];

  let inserted = 0;
  for (const r of rows) {
    const result = await query(
      `INSERT INTO leader_alert_settings (key, value_json, updated_by_email)
       VALUES ($1, $2::jsonb, NULL)
       ON CONFLICT (key) DO NOTHING`,
      [r.key, JSON.stringify(r.value)],
    );
    if (result.rowCount > 0) inserted++;
  }

  // v1 → v2: the original Pain Point seed shipped `bi-heart-fill`, which
  // reads as "love" rather than pain. Replace it with `bi-bandaid-fill`
  // on existing rows, but ONLY where the v1 default is still in place —
  // any admin edit (different icon, renamed label, recoloured) is left
  // untouched. Other categories are not touched.
  let painPointIconUpdated = 0;
  if (installedVersion < 2) {
    const { rows: catRows } = await query(
      `SELECT value_json FROM leader_alert_settings WHERE key = 'categories'`,
    );
    const cats = catRows[0]?.value_json;
    if (Array.isArray(cats)) {
      let changed = false;
      const next = cats.map((c) => {
        if (c && c.id === 'pain_point' && c.icon === 'bi-heart-fill') {
          changed = true;
          return { ...c, icon: 'bi-bandaid-fill' };
        }
        return c;
      });
      if (changed) {
        await query(
          `UPDATE leader_alert_settings SET value_json = $1::jsonb WHERE key = 'categories'`,
          [JSON.stringify(next)],
        );
        painPointIconUpdated = 1;
      }
    }
  }

  await setSeedVersion(LEADER_ALERTS_SEED_VERSION);
  return { skipped: false, version: LEADER_ALERTS_SEED_VERSION, inserted, painPointIconUpdated };
}

// Re-exported so other modules (composer defaults, settings panel reset)
// can read the canonical baseline.
export { DEFAULT_STATUSES, DEFAULT_CATEGORIES, DEFAULT_NOTIFICATIONS };
