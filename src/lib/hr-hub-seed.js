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
import { HR_HUB_STATUSES, HR_HUB_STATUS_BY_ID } from '../data/hrHubStatus';

// Bump to 4 (2026-06-02): reconcile the seeded statuses row — append the two
// statuses the original seed omitted (pending_requester + rejected) and
// recolour any status still carrying a legacy machine-seeded colour to the
// canonical semantic palette in src/data/hrHubStatus.js (live-test D4/D5/I8/I10).
export const HR_HUB_SEED_VERSION = 4;

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

// Status lifecycle is uniform across all flows (decision 2026-05-02 — see
// HR_HUB_PLAN.md). Derived from the canonical list in src/data/hrHubStatus.js
// so the Settings panel, the list, and the drawer all seed/render the same
// six statuses + colours. The Settings panel only needs id/label/colour.
// Adding a status to the canonical list also requires extending the CHECK
// constraint on hr_hub_request.status (src/lib/migrate.js).
const DEFAULT_STATUSES = HR_HUB_STATUSES.map(s => ({ id: s.id, label: s.label, color: s.color }));

// Colours the original 4-status seed shipped (v1–v3). The v4 reconcile only
// recolours a status still carrying one of these — any other value is treated
// as a deliberate admin edit and left untouched.
const LEGACY_SEED_COLORS = new Set(['#1d4ed8', '#ed8d00', '#9e9e9e', '#29811e']);

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

  // Payment Refund (2026-06-02, Laura Llopis request) — a distinct
  // top-level flow for client payment refunds. Intake captures the
  // contract + client + both amounts + reason; the reason reuses the
  // canonical `summary` field id so it maps straight to the NOT NULL
  // summary column with no extra plumbing. The structured money/link
  // fields use the new `url` and `currency` field kinds (rendered by
  // CreateHrHubRequestModal's FieldInput) and persist to dedicated pr_*
  // columns. The root-cause + responsible-member assessment is captured
  // at the New -> In Progress transition in HrHubDetailPanel (not at
  // intake), so it has no field entry here.
  payment_refund: {
    label: 'Payment Refund',
    description: 'Log a client payment refund — contract, client, amounts, and reason; cause is assessed on triage.',
    fields: [
      { id: 'client_name',    label: 'Client Name',             kind: 'text',        required: true },
      { id: 'contract_link',  label: 'Contract Link',           kind: 'url',         required: true },
      { id: 'amount_usd',     label: 'Amount (USD)',            kind: 'currency',    required: true, symbol: '$' },
      { id: 'amount_local',   label: 'Amount (Local Currency)', kind: 'currency',    required: true },
      { id: 'local_currency', label: 'Local Currency Code',     kind: 'text',        required: true, placeholder: 'e.g. EUR' },
      { id: 'summary',        label: 'Reason for the Refund',   kind: 'rich_text',   required: true },
      { id: 'attachments',    label: 'Attachments',             kind: 'attachments', required: false },
    ],
    dropdowns: {},
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
 * v4 statuses reconcile. Brings an existing `statuses` row up to the
 * canonical six-status lifecycle WITHOUT clobbering admin edits:
 *   • append any canonical status missing from the row (e.g. the
 *     pending_requester + rejected the original seed never shipped), in
 *     canonical order;
 *   • recolour a status still carrying a known legacy machine-seeded colour
 *     to the canonical semantic colour. A colour that isn't in
 *     LEGACY_SEED_COLORS is treated as a deliberate admin edit and left as-is.
 * Labels are never touched (admins may have renamed e.g. Resolved → Done).
 * Returns 1 if the row changed, 0 otherwise (idempotent on re-run / fresh DB).
 */
async function applyStatusesReconcile(client, flow, version) {
  const { rows } = await client.query(
    `SELECT value_json FROM hr_hub_settings WHERE flow = $1 AND key = 'statuses'`,
    [flow],
  );
  // No row yet — the cold-boot INSERT pass already lands the full canonical
  // six (DEFAULT_STATUSES), so nothing to reconcile.
  if (rows.length === 0) return 0;

  const before = Array.isArray(rows[0].value_json) ? rows[0].value_json : [];
  let changed = false;

  // Copy + recolour legacy-seeded colours → canonical (pristine `before` kept
  // for the audit diff).
  const after = before.map((s) => {
    const canon = HR_HUB_STATUS_BY_ID[s.id];
    if (canon && typeof s.color === 'string'
        && LEGACY_SEED_COLORS.has(s.color.toLowerCase())
        && s.color.toLowerCase() !== canon.color.toLowerCase()) {
      changed = true;
      return { ...s, color: canon.color };
    }
    return { ...s };
  });

  // Append any canonical status missing from the row, in canonical order.
  const present = new Set(after.map((s) => s.id));
  for (const canon of HR_HUB_STATUSES) {
    if (!present.has(canon.id)) {
      after.push({ id: canon.id, label: canon.label, color: canon.color });
      changed = true;
    }
  }

  if (!changed) return 0;

  await client.query(
    `UPDATE hr_hub_settings
        SET value_json = $1::jsonb,
            updated_at = NOW()
      WHERE flow = $2 AND key = 'statuses'`,
    [JSON.stringify(after), flow],
  );
  await client.query(
    `INSERT INTO hr_hub_settings_history
       (flow, key, before_json, after_json, actor_email, actor_name)
     VALUES ($1, 'statuses', $2::jsonb, $3::jsonb, $4, $5)`,
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

    // Pass 3 — v4 statuses reconcile: append the two statuses the original
    // seed omitted (pending_requester + rejected) and recolour any legacy
    // machine-seeded colours to canonical, preserving genuine admin edits.
    // Guarded so it runs exactly once, when an env crosses from < 4 to 4.
    if (installedVersion < 4) {
      for (const flow of Object.keys(FLOWS)) {
        updated += await applyStatusesReconcile(client, flow, 4);
      }
    }
  });

  await setSeedVersion(HR_HUB_SEED_VERSION);
  return { skipped: false, version: HR_HUB_SEED_VERSION, inserted, updated };
}
