// ── HR Hub: per-flow default settings (statuses, fields, dropdowns,
//    auto-assign rules) seeded on first boot.
//
// Why a seed: HR Hub Admins edit these values from the Settings panel
// without redeploying. The DB row is the source of truth at runtime;
// this file is only the cold-boot baseline. Every settings write also
// stamps `hr_hub_settings_history` for audit, so the seed never
// silently overrides an admin's edit — it only inserts when the
// (flow, key) row is missing.
//
// Versioning: bump HR_HUB_SEED_VERSION when adding a new key (e.g.
// extra dropdown option) that should propagate even after the row
// already exists. The boot pass writes the version into `app_settings`
// and re-runs the seed exactly once per version bump. Existing manual
// edits to keys we *don't* touch are preserved.

import { query } from './db';

export const HR_HUB_SEED_VERSION = 1;

// Status lifecycle is uniform across all 4 flows (decision 2026-05-02
// — see HR_HUB_PLAN.md). Adding a status here also requires a
// matching update to the CHECK constraint on hr_hub_request.status.
const DEFAULT_STATUSES = [
  { id: 'new',         label: 'New',         color: '#1d4ed8' },
  { id: 'in_progress', label: 'In Progress', color: '#ed8d00' },
  { id: 'on_hold',     label: 'On Hold',     color: '#9e9e9e' },
  { id: 'resolved',    label: 'Resolved',    color: '#29811e' },
];

// Per-flow field map. `id` is the DB column on hr_hub_request (or a
// JSON-key inside extra_json if we extend later); `kind` drives the
// composer renderer. The Settings panel can rename labels and add/
// remove dropdown options without touching this file.
const FLOWS = {
  hr_request: {
    label: 'HR Request',
    description: 'Operational requests that need GM/MOC actioning.',
    fields: [
      { id: 'function_area', label: 'Related Function', kind: 'dropdown', required: true, source: 'dropdowns.function_area' },
      { id: 'request_type',  label: 'Request Type',     kind: 'dropdown_dependent', required: true, source: 'dropdowns.request_type', dependsOn: 'function_area' },
      { id: 'summary',       label: 'Summary',          kind: 'rich_text', required: true },
      { id: 'links',         label: 'Relevant Links',   kind: 'url_list', required: false },
      { id: 'attachments',   label: 'Attachments',      kind: 'attachments', required: false },
    ],
    dropdowns: {
      function_area: [
        'Onboarding', 'Amendments', 'Termination', 'Resignation',
        'Country Specific', 'Collaboration with Teams', 'Looker',
      ],
      // Cascading: each function_area key maps to the request_type options.
      request_type: {
        Onboarding:   ['Countersign EA', 'Deposit Increase', 'Other Requests'],
        Amendments:   ['Deposit Increase', 'Other Requests'],
        Termination:  ['Cancel / re-start offboarding (edit end date)', 'Other Requests'],
        Resignation:  ['Cancel / re-start offboarding (edit end date)'],
        'Country Specific':         ['Other Requests'],
        'Collaboration with Teams': ['Other Requests'],
        Looker:                     ['Generate a report'],
      },
    },
    auto_assign: [],   // configurable later in Stage 6
  },

  hr_reporting: {
    label: 'HR Reporting',
    description: 'Bugs, escalations, mass events, quality issues.',
    fields: [
      { id: 'report_type',   label: 'Report Type',      kind: 'dropdown', required: true, source: 'dropdowns.report_type' },
      { id: 'function_area', label: 'Related Function', kind: 'dropdown', required: true, source: 'dropdowns.function_area' },
      { id: 'links',         label: 'Link',             kind: 'url_list', required: false },
      { id: 'summary',       label: 'Report Summary',   kind: 'rich_text', required: true },
      { id: 'cc_email',      label: 'cc',               kind: 'auto_manager', required: false }, // auto-populated from team-directory
      { id: 'attachments',   label: 'Attachments',      kind: 'attachments', required: false },
    ],
    dropdowns: {
      report_type: [
        'Report a Bug',
        'Report an Escalation / Possible Escalation',
        'Report a Quality Issue',
        'Report Collaboration Issues',
        'Report Mass Onboarding',
        'Report Mass Off-boarding',
        'Report an urgent termination follow-up',
        'Report something else',
      ],
      function_area: [
        'Onboarding', 'Amendments', 'Termination', 'Resignation',
        'Workbench', 'Redlines', 'Zendesk', 'Benefits', 'Data',
        'Suspicious Amendment', 'Collaboration with Teams',
      ],
    },
    auto_assign: [],
  },

  escalation_zero: {
    label: 'Escalation Zero',
    description: 'Strategic improvements, process gaps, product feedback.',
    fields: [
      { id: 'summary',        label: 'Summary',          kind: 'rich_text', required: true },
      { id: 'ideal_solution', label: 'Ideal Solution',   kind: 'rich_text', required: true },
      { id: 'function_area',  label: 'Related Function', kind: 'dropdown',  required: true, source: 'dropdowns.function_area' },
      { id: 'attachments',    label: 'Attachments',      kind: 'attachments', required: false },
    ],
    dropdowns: {
      // The richest taxonomy across the HRX ecosystem — used as the
      // master function list across the app.
      function_area: [
        'Onboarding', 'Amendments', 'Termination', 'Resignation',
        'Contract Ending', 'EOR Quotes', 'Redlines',
        'Time Off', 'Time Tracking', 'Health Benefits', 'Benefits',
        'Country Compliance', 'Employment Letters', 'Proof of Employment',
        'Incentive Plans',
        'Internal Tools', 'Knowledge Management', 'Quality Control',
        'Reporting and SLAs', 'Risk & Escalations', 'Announcements',
        'Project Management (MHR)',
      ],
    },
    auto_assign: [],
  },

  // Ops Hub Feedback — placeholder so the table has a row per flow on
  // first boot. Field shape is mirrored from the existing feedback_requests
  // table; the real merge happens in Stage 5 with a data migration so we
  // don't duplicate effort here.
  feedback: {
    label: 'Ops Hub Feedback',
    description: 'Feedback on the Ops Hub app itself.',
    fields: [
      { id: 'title',                label: 'Title',               kind: 'text',      required: true },
      { id: 'request_type',         label: 'Type',                kind: 'dropdown',  required: true, source: 'dropdowns.request_type' },
      { id: 'function_area',        label: 'Area',                kind: 'dropdown',  required: false, source: 'dropdowns.function_area' },
      { id: 'summary',              label: 'Issue / Idea',        kind: 'rich_text', required: true },
      { id: 'ideal_solution',       label: 'Proposed Resolution', kind: 'rich_text', required: false },
      { id: 'attachments',          label: 'Attachments',         kind: 'attachments', required: false },
    ],
    dropdowns: {
      request_type:  ['bug', 'improvement', 'question'],
      function_area: ['queue', 'briefing', 'announcements', 'team', 'auth', 'perf', 'other'],
    },
    auto_assign: [],
  },
};

async function getSeedVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = 'hr_hub_seed_version'`,
    );
    return rows[0]?.value ? Number(rows[0].value) : 0;
  } catch {
    return 0;
  }
}

async function setSeedVersion(version) {
  await query(
    `INSERT INTO app_settings (key, value)
     VALUES ('hr_hub_seed_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(version)],
  );
}

/**
 * Insert default settings rows (statuses / fields / dropdowns / auto_assign)
 * for every flow. Existing rows are preserved — admin edits never get
 * clobbered. A version marker in app_settings prevents repeat work across
 * pod boots.
 */
export async function seedHrHubSettingsIfNeeded() {
  const installedVersion = await getSeedVersion();
  if (installedVersion >= HR_HUB_SEED_VERSION) {
    return { skipped: true, version: installedVersion };
  }

  let inserted = 0;
  for (const [flow, cfg] of Object.entries(FLOWS)) {
    const rows = [
      { key: 'statuses',    value: DEFAULT_STATUSES },
      { key: 'fields',      value: cfg.fields },
      { key: 'dropdowns',   value: cfg.dropdowns },
      { key: 'auto_assign', value: cfg.auto_assign },
      { key: 'meta',        value: { label: cfg.label, description: cfg.description } },
    ];
    for (const r of rows) {
      const result = await query(
        `INSERT INTO hr_hub_settings (flow, key, value_json, updated_by_email)
         VALUES ($1, $2, $3::jsonb, NULL)
         ON CONFLICT (flow, key) DO NOTHING`,
        [flow, r.key, JSON.stringify(r.value)],
      );
      if (result.rowCount > 0) inserted++;
    }
  }

  await setSeedVersion(HR_HUB_SEED_VERSION);
  return { skipped: false, version: HR_HUB_SEED_VERSION, inserted };
}
