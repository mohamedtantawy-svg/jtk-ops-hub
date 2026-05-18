// ── Handover defaults — settings preset + checklist template ──────────────
// Mirrors leader-alerts-seed.js / hr-hub-seed.js. Inserts one global
// `handover_settings` row + one global `handover_checklist_templates`
// row on first boot so the wizard's checklist step has something to
// pre-fill out of the box.
//
// Versioning: bump HANDOVER_DEFAULTS_VERSION whenever the global default
// items list changes AND you want new installs / unchanged tenants to
// pick up the edits. The seed is additive — an admin's edits to either
// row via the Settings panel (Phase 5) are never overwritten because the
// seed only INSERTs when the row is absent.
//
// Why two rows: the settings row points at the template via
// default_template_id, so the wizard can look up "what template applies
// to this user's scope" without joining handover_checklist_templates
// every time. Both rows have scope='global' for v1; per-region / per-team
// rows arrive in Phase 5 when the Settings UI ships.

import { query } from './db';

// Bumped to 2 on 2026-05-18 (Phase C of HANDOVER_TEMPLATE_REVAMP_PLAN.md):
// the v1 items list was a generic 12-item checklist; the team uses a
// 16-item HRX SOP. The migration paths are handled in `migrate.js` after
// this seed runs — submitted handovers keep their v1 snapshot; unsubmitted
// drafts get their `handover_checklist_items` refreshed in-place.
export const HANDOVER_DEFAULTS_VERSION = 2;
const VERSION_KEY = 'handover_defaults_seed_version';

const DEFAULT_TEMPLATE_NAME = 'HRX OOO handover SOP';
const DEFAULT_SETTINGS_NAME = 'Global default';

// HRX SOP — translated verbatim from the team's "OOO handover SOP" doc
// into actionable pre-vacation steps (HANDOVER_TEMPLATE_REVAMP_PLAN.md
// §4.1). 16 required items + 2 optional override items. Ordering matches
// the SOP doc sections so a team member can scan top-to-bottom and recognise
// the items in the order they'd otherwise do them.
const DEFAULT_CHECKLIST_ITEMS = [
  // a) Backup Awareness
  { id: 'backup_identified',       label: 'Backup team member identified',                                            required: true,  hint: 'Communicate the specific countries you are handing over' },
  { id: 'country_faq_shared',      label: 'Country FAQ doc(s) shared with backup',                                    required: true,  hint: 'See your Country Handover Doc — section 10' },
  { id: 'critical_tasks_flagged',  label: 'Critical tasks / deadlines flagged to backup',                             required: true,  hint: 'Urgent terminations, project deadlines, outstanding client comms' },
  // b) Google Calendar
  { id: 'google_calendar_ooo',     label: 'Marked OOO in Google Calendar',                                            required: true },
  // c) Workbench
  { id: 'workbench_offline',       label: 'Workbench status set to Offline',                                          required: true,  hint: 'Profile → Status (top right) → Offline' },
  // d) Zendesk
  { id: 'zendesk_ooo',             label: 'Zendesk profile toggled to Out of Office',                                 required: true,  hint: 'Profile icon → View profile → Toggle OOO' },
  // e) Jira & Slack visibility
  { id: 'jira_ooo',                label: 'Jira OOO set via Out-of-Office Assistant',                                 required: true },
  { id: 'hrx_workflow_submitted',  label: 'HRX / GIX handover request submitted in the Slack workflow',               required: true,  hint: 'Submit at least 1 hour before your follower logs off' },
  { id: 'slack_status',            label: 'Slack status updated with backup details',                                 required: true },
  { id: 'calendar_meetings',       label: 'Calendar meetings rescheduled or coverer added',                           required: true,  hint: 'Including Cal.com bookings' },
  { id: 'country_channels_backup', label: 'Backup added to country Slack channels',                                   required: true },
  { id: 'email_autoresponder',     label: 'Email autoresponder set with backup contact',                              required: true },
  // 3. Task Management
  { id: 'tickets_reassigned',      label: 'Open / on-hold / pending Zendesk + Workbench tickets reassigned to backup',required: true },
  { id: 'jira_reassigned',         label: 'Open / on-hold / pending Jira tickets reassigned (incl. HRX responsible)', required: true,  hint: 'Offboarding tickets: update the HRX responsible field on the right' },
  { id: 'tickets_notes_added',     label: 'Internal notes / context added to handed-over tickets',                    required: true },
  // 4. Country team notification
  { id: 'country_team_notified',   label: 'Country Slack channel(s) notified of vacation + backup',                   required: true },
  // Optional overrides — kept for non-HRX teams that still use this surface
  { id: 'escalations_shared',      label: 'Open escalations / Leaders Hub items shared',                              required: false, hint: 'For managers — surface any unresolved manager-level threads' },
  { id: 'hr_hub_followups',        label: 'HR Hub requests you authored or are assignee on',                          required: false, hint: 'So the coverer knows what to expect responses on' },
];

// Items present in v1 but dropped in v2. The migration in `migrate.js`
// keeps these on existing draft `handover_checklist_items` rows with a
// retired-marker note so the wizard renders them visually distinct
// instead of silently dropping the user's progress. New drafts won't see
// these (they're not in DEFAULT_CHECKLIST_ITEMS above).
export const RETIRED_V1_ITEM_IDS = Object.freeze([
  'active_tickets',
  'onboardings',
  'offboardings',
  'amendments',
  'urgent_assist',
  'escalations',          // renamed → escalations_shared (optional)
  'slack_threads',
  'pending_approvals',
  'inbox_zero_email',
  'meetings_calendar',
  'eor_compliance',
]);

// Item-id remaps for the migration: a key that maps to a value means
// "preserve the completed state from the legacy item under the new id".
// Anything not in this map and not in DEFAULT_CHECKLIST_ITEMS is treated
// as retired and gets the marker note instead.
export const V1_TO_V2_ITEM_REMAP = Object.freeze({
  // No 1:1 semantic renames in v2 — most v1 items are now subsumed by
  // tickets_reassigned + jira_reassigned + slack_status. Only the
  // `hr_hub_followups` id survives as-is (still optional in v2).
});

export const DEFAULT_CHECKLIST_ITEMS_V2 = DEFAULT_CHECKLIST_ITEMS;

async function getStoredVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [VERSION_KEY],
    );
    const v = rows[0]?.value?.version;
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

async function setStoredVersion(version) {
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
    [VERSION_KEY, JSON.stringify({ version }), 'handover-defaults-seed'],
  );
}

/**
 * Idempotent boot seed. Inserts the global default template + settings
 * row when neither already exists. Returns { skipped } | { reseeded:
 * true, template_id, settings_id }.
 */
export async function seedHandoverDefaultsIfNeeded() {
  const currentVersion = await getStoredVersion();
  if (currentVersion >= HANDOVER_DEFAULTS_VERSION) {
    return { skipped: true, version: HANDOVER_DEFAULTS_VERSION };
  }

  await query('BEGIN');
  try {
    // Default template — only insert if no default template exists at
    // global scope. Admin edits via Settings (Phase 5) will mark a new
    // row is_default=true; we never overwrite their pick.
    const existingTemplate = await query(
      `SELECT id FROM handover_checklist_templates
        WHERE scope = 'global' AND is_default = true
        LIMIT 1`,
    );
    let templateId = existingTemplate.rows[0]?.id || null;
    if (!templateId) {
      const ins = await query(
        `INSERT INTO handover_checklist_templates
           (name, description, scope, items, is_default, created_by_email)
         VALUES ($1, $2, 'global', $3::jsonb, TRUE, 'handover-defaults-seed')
         RETURNING id`,
        [
          DEFAULT_TEMPLATE_NAME,
          'Seeded baseline. Edit in Settings → Handovers (Phase 5).',
          JSON.stringify(DEFAULT_CHECKLIST_ITEMS),
        ],
      );
      templateId = ins.rows[0]?.id;
    } else if (HANDOVER_DEFAULTS_VERSION > currentVersion) {
      // Phase C 2026-05-18: refresh the existing default template's items
      // to the v2 SOP list. We DON'T touch the template's name/description
      // here because admins may have personalised either via Settings.
      // Re-seeding is gated on the version bump, so a manual `items` edit
      // outside the version-bump window is preserved across boots.
      await query(
        `UPDATE handover_checklist_templates
            SET items = $1::jsonb,
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(DEFAULT_CHECKLIST_ITEMS), templateId],
      );
    }

    // Default settings preset — single global row pinned to the
    // template. Manager-approval and coverer-acceptance both default
    // true (HANDOVERS_PLAN.md §20 decisions).
    const existingSettings = await query(
      `SELECT id FROM handover_settings
        WHERE scope = 'global' AND is_default = true
        LIMIT 1`,
    );
    let settingsId = existingSettings.rows[0]?.id || null;
    if (!settingsId) {
      const ins = await query(
        `INSERT INTO handover_settings
           (name, scope, default_template_id, is_default)
         VALUES ($1, 'global', $2, TRUE)
         RETURNING id`,
        [DEFAULT_SETTINGS_NAME, templateId],
      );
      settingsId = ins.rows[0]?.id;
    }

    await setStoredVersion(HANDOVER_DEFAULTS_VERSION);
    await query('COMMIT');

    console.log(
      `[handover-defaults-seed] v${HANDOVER_DEFAULTS_VERSION}: ` +
      `template=${templateId} settings=${settingsId} ` +
      `(was v${currentVersion})`,
    );
    return {
      reseeded: true,
      template_id: templateId,
      settings_id: settingsId,
      version: HANDOVER_DEFAULTS_VERSION,
    };
  } catch (err) {
    try { await query('ROLLBACK'); } catch {}
    console.error('[handover-defaults-seed] failed:', err?.message);
    return { skipped: false, error: err?.message, version: HANDOVER_DEFAULTS_VERSION };
  }
}
