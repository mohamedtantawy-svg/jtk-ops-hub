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

import { query, withTransaction } from './db';

export const HR_HUB_SEED_VERSION = 2;

// Per-version deltas — applied additively on each version bump so live
// envs pick up new dropdown options without clobbering admin edits.
// Each delta only ADDS missing items; if an admin removed an item we
// don't ship in a delta, that removal stays. If an admin already added
// one of the items we're shipping (e.g. they pre-seeded "Quotes" via
// the Settings panel), the union dedupes silently.
//
// Bump HR_HUB_SEED_VERSION + add a new entry here when you need to
// extend the cold-boot dropdown list in production. Keep cold-boot
// FLOWS in sync so a fresh DB lands on the same place as a delta-
// patched one.
const SEED_DELTAS = {
  2: {
    hr_request: {
      'dropdowns.function_area_add': [
        'Quotes', 'Benefits', 'Pension', 'Time-Off - PTO',
        'Redlines', 'Global Mobility',
      ],
      // request_type cascades for the new function-areas. Only set when
      // the function-area key is missing from the existing object — we
      // never override an admin-customised cascade.
      'dropdowns.request_type_add': {
        Quotes:            ['Other Requests'],
        Benefits:          ['Other Requests'],
        Pension:           ['Other Requests'],
        'Time-Off - PTO':  ['Other Requests'],
        Redlines:          ['Other Requests'],
        'Global Mobility': ['Other Requests'],
      },
    },
  },
};

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
      // Function-area menu mirrors the wider taxonomy operators used on
      // Slack request workflows so HR Hub is at least as expressive.
      // Order intentionally puts the workflow-specific menu first
      // (Quotes…Global Mobility per the 2026-05-05 ticket) and keeps the
      // legacy options at the end so historical requests don't orphan.
      function_area: [
        'Quotes', 'Onboarding', 'Resignation', 'Termination',
        'Benefits', 'Pension', 'Time-Off - PTO', 'Amendments',
        'Redlines', 'Global Mobility',
        'Country Specific', 'Collaboration with Teams', 'Looker',
      ],
      // Cascading: each function_area key maps to the request_type options.
      // New menu entries default to ['Other Requests']; admins can refine
      // per-area types via the Settings panel without touching this file.
      request_type: {
        Quotes:                     ['Other Requests'],
        Onboarding:                 ['Countersign EA', 'Deposit Increase', 'Other Requests'],
        Resignation:                ['Cancel / re-start offboarding (edit end date)'],
        Termination:                ['Cancel / re-start offboarding (edit end date)', 'Other Requests'],
        Benefits:                   ['Other Requests'],
        Pension:                    ['Other Requests'],
        'Time-Off - PTO':           ['Other Requests'],
        Amendments:                 ['Deposit Increase', 'Other Requests'],
        Redlines:                   ['Other Requests'],
        'Global Mobility':          ['Other Requests'],
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
 * Apply a single SEED_DELTAS entry to one flow's `dropdowns` row.
 * Purely additive: union arrays, fill in missing object keys. Admin
 * removals + customisations are preserved. Writes a row to
 * hr_hub_settings_history with actor='system:seed-vN' for audit.
 *
 * Returns 1 if the row changed, 0 otherwise (no-op if every item is
 * already present, e.g. on a re-run after a partial deploy).
 */
async function applyDropdownDelta(client, flow, delta, version) {
  const { rows } = await client.query(
    `SELECT value_json FROM hr_hub_settings WHERE flow = $1 AND key = 'dropdowns'`,
    [flow],
  );
  if (rows.length === 0) {
    // No dropdowns row yet — the cold-boot INSERT pass will land the
    // full FLOWS map (which already includes the new items).
    return 0;
  }

  const before = rows[0].value_json || {};
  const after = { ...before };
  let changed = false;

  // function_area: array union, preserving original order, then
  // appending only the missing additions in delta order.
  const faAdd = delta['dropdowns.function_area_add'];
  if (Array.isArray(faAdd) && faAdd.length > 0) {
    const existing = Array.isArray(after.function_area) ? after.function_area : [];
    const present = new Set(existing);
    const toAdd = faAdd.filter(item => !present.has(item));
    if (toAdd.length > 0) {
      after.function_area = [...existing, ...toAdd];
      changed = true;
    }
  }

  // request_type: object key fill — only set when the function-area
  // key is missing. Admin-customised cascades stay untouched.
  const rtAdd = delta['dropdowns.request_type_add'];
  if (rtAdd && typeof rtAdd === 'object') {
    const existing = (after.request_type && typeof after.request_type === 'object')
      ? { ...after.request_type } : {};
    let rtChanged = false;
    for (const [fa, types] of Object.entries(rtAdd)) {
      if (!(fa in existing)) {
        existing[fa] = types;
        rtChanged = true;
      }
    }
    if (rtChanged) {
      after.request_type = existing;
      changed = true;
    }
  }

  if (!changed) return 0;

  await client.query(
    `UPDATE hr_hub_settings
        SET value_json = $1::jsonb,
            updated_at = NOW()
      WHERE flow = $2 AND key = 'dropdowns'`,
    [JSON.stringify(after), flow],
  );
  await client.query(
    `INSERT INTO hr_hub_settings_history
       (flow, key, before_json, after_json, actor_email, actor_name)
     VALUES ($1, 'dropdowns', $2::jsonb, $3::jsonb, $4, $5)`,
    [
      flow,
      JSON.stringify(before),
      JSON.stringify(after),
      `system:seed-v${version}`,
      'HR Hub Seed',
    ],
  );
  return 1;
}

/**
 * Insert default settings rows (statuses / fields / dropdowns / auto_assign)
 * for every flow. Existing rows are preserved — admin edits never get
 * clobbered. A version marker in app_settings prevents repeat work across
 * pod boots.
 *
 * On version bump, applies SEED_DELTAS additively to existing rows so
 * production picks up new dropdown options without a destructive reseed.
 */
export async function seedHrHubSettingsIfNeeded() {
  const installedVersion = await getSeedVersion();
  if (installedVersion >= HR_HUB_SEED_VERSION) {
    return { skipped: true, version: installedVersion };
  }

  let inserted = 0;
  let updated = 0;
  await withTransaction(async (client) => {
    // Pass 1 — cold-boot baseline. INSERT … ON CONFLICT DO NOTHING so
    // existing rows stay intact (admin edits preserved).
    for (const [flow, cfg] of Object.entries(FLOWS)) {
      const rows = [
        { key: 'statuses',    value: DEFAULT_STATUSES },
        { key: 'fields',      value: cfg.fields },
        { key: 'dropdowns',   value: cfg.dropdowns },
        { key: 'auto_assign', value: cfg.auto_assign },
        { key: 'meta',        value: { label: cfg.label, description: cfg.description } },
      ];
      for (const r of rows) {
        const result = await client.query(
          `INSERT INTO hr_hub_settings (flow, key, value_json, updated_by_email)
           VALUES ($1, $2, $3::jsonb, NULL)
           ON CONFLICT (flow, key) DO NOTHING`,
          [flow, r.key, JSON.stringify(r.value)],
        );
        if (result.rowCount > 0) inserted++;
      }
    }

    // Pass 2 — versioned deltas. Walk every version between installed+1
    // and current, applying each delta additively to existing rows.
    for (let v = installedVersion + 1; v <= HR_HUB_SEED_VERSION; v++) {
      const delta = SEED_DELTAS[v];
      if (!delta) continue;
      for (const [flow, flowDelta] of Object.entries(delta)) {
        updated += await applyDropdownDelta(client, flow, flowDelta, v);
      }
    }
  });

  await setSeedVersion(HR_HUB_SEED_VERSION);
  return { skipped: false, version: HR_HUB_SEED_VERSION, inserted, updated };
}
