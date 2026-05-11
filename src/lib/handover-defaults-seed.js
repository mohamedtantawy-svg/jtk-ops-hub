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

export const HANDOVER_DEFAULTS_VERSION = 1;
const VERSION_KEY = 'handover_defaults_seed_version';

const DEFAULT_TEMPLATE_NAME = 'Standard HRX handover checklist';
const DEFAULT_SETTINGS_NAME = 'Global default';

// Items reflect what an HRX operator actually needs to hand over before
// going OOO. Order matters — these render top-to-bottom in the wizard.
// Required items block submit if unchecked; optional items don't.
const DEFAULT_CHECKLIST_ITEMS = [
  { id: 'active_tickets',     label: 'Active tickets shared with coverer + status briefing',     required: true,  hint: 'Workspace + Queue rows; flag anything in-flight with the customer' },
  { id: 'onboardings',        label: 'Open onboarding / paused onboarding cases listed',         required: true,  hint: 'Including any that are blocked on Deel / EOR' },
  { id: 'offboardings',       label: 'Open offboarding cases handed over',                       required: true,  hint: 'Especially those with payroll cut-off implications' },
  { id: 'amendments',         label: 'In-flight amendments + redlines briefed',                  required: true,  hint: 'Country-owner queue items the coverer should see' },
  { id: 'urgent_assist',      label: 'Urgent Assist threads acknowledged + handed over',         required: true,  hint: 'Both yours and any you were second on' },
  { id: 'escalations',        label: 'Open escalations / Leaders Hub items shared',              required: false, hint: 'For managers — surface any unresolved manager-level threads' },
  { id: 'slack_threads',      label: 'Critical Slack threads flagged to coverer',                required: true,  hint: 'Account-level chats, customer DMs, channel pings' },
  { id: 'pending_approvals',  label: 'Pending approvals / countersigns listed',                  required: true,  hint: 'Hide-task, amendments, EOR documents — anything awaiting your sign-off' },
  { id: 'hr_hub_followups',   label: 'HR Hub requests you authored or assignee on',              required: false, hint: 'So the coverer knows what to expect responses on' },
  { id: 'inbox_zero_email',   label: 'Email inbox triaged + auto-responder set',                 required: true,  hint: 'Auto-respond to externals, internals get a forward to the coverer' },
  { id: 'meetings_calendar',  label: 'Calendar reviewed — meetings declined or coverer added',   required: true,  hint: 'Coverer attends in your place where ownership matters' },
  { id: 'eor_compliance',     label: 'EOR / compliance deadlines noted',                         required: false, hint: 'Country-specific cut-offs falling in the OOO window' },
];

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
