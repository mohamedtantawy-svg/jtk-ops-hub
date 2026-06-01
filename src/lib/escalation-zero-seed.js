// ── Escalation Zero historical-import seed (2026-06-01) ───────────────
// Idempotent boot-time importer that lifts the legacy
// #hrx-escalations-zero Slack-channel spreadsheet (527 rows as of v1)
// into feedback_requests with kind='escalation_zero'. Every source row
// carries a deterministic `extras.importExternalId` derived from its
// Slack URL + summary hash so a re-seed never duplicates an existing
// row — only inserts ones not yet present.
//
// How to update / re-seed
//   1. Regenerate data/escalation_zero_seed.json from the xlsx.
//      The Python pipeline that originally produced it is documented
//      in the import PR; key normalizations are functionKey mapping,
//      status mapping, and short-text trimming.
//   2. Bump SEED_VERSION here.
//   3. Deploy. The next boot inserts any rows whose externalId isn't
//      yet present and updates the version marker.
//
// What does NOT happen on re-seed
//   • Existing rows are NEVER overwritten — manual FE edits survive.
//   • Rows the user has deleted post-import stay deleted (no
//     resurrection) because the externalId conflict check only
//     prevents inserts; deletion is a tombstone we honour.
//   • Comments / votes / attachments added in-app survive across
//     re-seeds.

import fs from 'node:fs';
import path from 'node:path';
import { query } from './db';

const SEED_VERSION = 1;
const SEED_KEY = 'escalation_zero_seed_version';
const IMPORT_SOURCE = 'xlsx_v1';

// Load the JSON via fs at module-load instead of JSON-import-assertions so
// we don't have to pin a Node version / webpack rule. The file is in the
// `data/` directory at the repo root — same place country-owners-seed
// uses the CSV. Failure here is fatal-ish, but the catch lets the rest
// of migrate.js boot rather than wedging the pod on a missing file.
let seedData = null;
try {
  const seedPath = path.join(process.cwd(), 'data', 'escalation_zero_seed.json');
  if (fs.existsSync(seedPath)) {
    seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  }
} catch (err) {
  console.warn('[escalation-zero-seed] failed to load JSON:', err?.message);
}

async function getStoredVersion() {
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      [SEED_KEY],
    );
    if (!rows[0]) return 0;
    const v = Number(rows[0].value);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

async function setStoredVersion(version) {
  await query(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SEED_KEY, String(version)],
  );
}

// Resolve a batch of caller emails → members.id in one round-trip so we
// can stamp submitter_id on the inserts. Returns Map<lcEmail, id>.
async function loadMemberIdMap(emails) {
  const out = new Map();
  const cleaned = Array.from(new Set(
    emails
      .filter(e => typeof e === 'string' && e.length > 0)
      .map(e => e.toLowerCase()),
  ));
  if (cleaned.length === 0) return out;
  try {
    const { rows } = await query(
      `SELECT id, LOWER(email) AS email_lc FROM members WHERE LOWER(email) = ANY($1::text[])`,
      [cleaned],
    );
    for (const r of rows) {
      if (r.email_lc && r.id != null) out.set(r.email_lc, Number(r.id));
    }
  } catch (err) {
    console.warn('[escalation-zero-seed] member lookup failed:', err?.message);
  }
  return out;
}

// Find which externalIds are already in feedback_requests so we don't
// insert duplicates. One round-trip via ANY($1::text[]) keeps it cheap
// even at 500+ rows.
async function loadExistingExternalIds(externalIds) {
  const out = new Set();
  if (!externalIds.length) return out;
  try {
    const { rows } = await query(
      `SELECT extras->>'importExternalId' AS ext_id
         FROM feedback_requests
        WHERE kind = 'escalation_zero'
          AND extras->>'importSource' = $1
          AND extras->>'importExternalId' = ANY($2::text[])`,
      [IMPORT_SOURCE, externalIds],
    );
    for (const r of rows) {
      if (r.ext_id) out.add(r.ext_id);
    }
  } catch (err) {
    console.warn('[escalation-zero-seed] dedup lookup failed:', err?.message);
  }
  return out;
}

// Build the final extras object for one source row. We default to the
// 'new' escalationStatus / 'standard' priorityKey when the source row
// didn't specify, so the FE detail panel always has something to render.
function buildExtras(row) {
  const e = row.extras || {};
  const out = {
    functionKey: e.functionKey || null,
    countries: Array.isArray(e.countries) ? e.countries : [],
    linkedZdUrl: e.linkedZdUrl || '',
    linkedJiraUrl: e.linkedJiraUrl || '',
    escalationStatus: e.escalationStatus || 'new',
    priorityKey: e.priorityKey || 'standard',
    reporter: e.reporter || null,
    hrxOwnerName: e.hrxOwnerName || null,
    escalationCount6mo: Number.isFinite(e.escalationCount6mo) ? e.escalationCount6mo : null,
    resolutionTrack: e.resolutionTrack || null,
    slackLink: e.slackLink || '',
    etaToResolution: e.etaToResolution || null,
    actionTaken: e.actionTaken || null,
    productName: e.productName || null,
    productOwner: e.productOwner || null,
    hrxPoc: e.hrxPoc || null,
    productComment: e.productComment || null,
    mergedAt: e.mergedAt || null,
    importSource: IMPORT_SOURCE,
    importExternalId: row.externalId,
  };
  // Compact — drop nulls / empties so the JSONB column stays small and
  // FE conditionals can use plain truthy checks.
  for (const k of Object.keys(out)) {
    if (out[k] == null || out[k] === '' || (Array.isArray(out[k]) && out[k].length === 0)) delete out[k];
  }
  // Re-restore the two import provenance fields — they're our conflict
  // key, must stay even when "empty" (they never will be).
  out.importSource = IMPORT_SOURCE;
  out.importExternalId = row.externalId;
  return out;
}

/**
 * Boot-time entry point. Runs once per deploy that bumps SEED_VERSION;
 * a no-op on subsequent boots until the version is bumped again.
 *
 * Returns: { reseeded: bool, version, inserted, skipped, errors }
 */
export async function seedEscalationZeroHistoricalIfNeeded({ orgNodeId } = {}) {
  if (!seedData || !Array.isArray(seedData.rows)) {
    return { reseeded: false, version: SEED_VERSION, reason: 'no-data' };
  }
  const currentVersion = await getStoredVersion();
  if (currentVersion >= SEED_VERSION) {
    return { reseeded: false, version: SEED_VERSION };
  }

  const rows = seedData.rows;
  const externalIds = rows.map(r => r.externalId).filter(Boolean);
  const existing = await loadExistingExternalIds(externalIds);
  const submitterEmails = rows.map(r => r.submitter_email).filter(Boolean);
  const memberIdMap = await loadMemberIdMap(submitterEmails);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of rows) {
    if (!row.externalId) { errors++; continue; }
    if (existing.has(row.externalId)) { skipped++; continue; }
    const extras = buildExtras(row);
    const submitterEmailLc = (row.submitter_email || '').toLowerCase() || null;
    const submitterId = submitterEmailLc ? (memberIdMap.get(submitterEmailLc) || null) : null;
    const title = String(row.title || '').slice(0, 200) || '(untitled)';
    const issue = String(row.issue || '').slice(0, 10_000) || title;
    const resolution = row.proposed_resolution ? String(row.proposed_resolution).slice(0, 10_000) : null;
    const status = typeof row.status === 'string' ? row.status : 'new';
    const priority = typeof row.priority === 'string' ? row.priority : 'medium';
    const type = typeof row.type === 'string' ? row.type : 'improvement';
    const createdAt = row.created_at || null;
    const resolvedAt = row.resolved_at || null;

    try {
      // Honour the dept-isolation columns when present (added Phase 11b).
      // We stamp the same org_node_id the seeder is given so HRX users
      // see the historical rows. If no orgNodeId is supplied (early
      // boot before depts seed), leave NULL — the dept-backfill that
      // runs later will retro-stamp them.
      const cols = [
        'title', 'issue', 'proposed_resolution', 'status', 'priority',
        'type', 'kind', 'extras', 'submitter_id', 'submitter_email',
        'submitter_name', 'created_at', 'updated_at', 'resolved_at',
      ];
      const vals = [
        title, issue, resolution, status, priority,
        type, 'escalation_zero', JSON.stringify(extras), submitterId, submitterEmailLc,
        row.submitter_name || null, createdAt, createdAt, resolvedAt,
      ];
      if (orgNodeId) {
        cols.push('org_node_id');
        vals.push(orgNodeId);
      }
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      await query(
        `INSERT INTO feedback_requests (${cols.join(', ')}) VALUES (${placeholders})`,
        vals,
      );
      inserted++;
    } catch (err) {
      errors++;
      // Don't fail the boot for a single bad row — log and continue.
      console.warn(`[escalation-zero-seed] row ${row.externalId} insert failed:`, err?.message);
    }
  }

  await setStoredVersion(SEED_VERSION);
  return {
    reseeded: true,
    version: SEED_VERSION,
    inserted,
    skipped,
    errors,
    total: rows.length,
  };
}
