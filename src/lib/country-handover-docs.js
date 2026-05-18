// ── Country Handover Docs — server helpers ───────────────────────────────
// Shared utilities used by the 5 country-handover-docs API routes:
//   • permission gates (canRead / canEdit)
//   • the editable-field allow-list
//   • the per-row sanitizer that strips nulls + coerces types out of pg
//
// Authoritative storage lives in country_handover_docs (per-country) and
// country_handover_doc_history (audit log). See HANDOVER_TEMPLATE_REVAMP_PLAN.md
// §3 + §7 for the data model and permission rationale.

import { query } from './db';
import { canAdministerHrHub } from './hr-hub-admin';
import { isAdminUser } from './queue-scoping';
import { getOwnedCountries } from '../data/countryOwners';

// Fields the PATCH route is allowed to write. Anything outside this set is
// silently ignored — country_code / status / id are managed by dedicated
// routes (POST :cc/publish for status, seed for id, route param for
// country_code) so the editor can't accidentally rename a country or flip
// publish state via PATCH.
export const EDITABLE_FIELDS = Object.freeze([
  // §1 Overview
  'scope_responsibilities',
  'prepared_by_email',
  'signatory',
  'official_languages',
  'wet_ink_required',
  'payroll_cycle',
  'payroll_cutoff_date',
  'stakeholders',
  // §2 Payroll & Stakeholders
  'slack_channel_name',
  'country_validation_url',
  'onboarding_buffer',
  // §3 Onboarding
  'pre_onboarding_steps',
  'manual_start_date_push',
  'onboarding_team_handles',
  'onboarding_guide_url',
  'country_specific_onboarding',
  // §4 Post-Onboarding
  'post_onboarding_steps',
  // §5 Amendments
  'legal_amendment_handover_url',
  'amendments_country_notes',
  // §6 Offboarding
  'termination_process',
  'termination_handover_url',
  'resignation_process',
  // §7 Benefits
  'benefits',
  // §8 Employment verification
  'evl_template_url',
  'evl_process_description',
  'evl_sop_urls',
  // §9 Country-specific
  'visas_supported',
  'pto_sop_urls',
  'pto_key_aspects',
  'pto_carry_over_rules',
  'other_country_processes',
  // §10 FAQs
  'faqs',
  // Misc
  'docs_folder_url',
]);

const EDITABLE_FIELDS_SET = new Set(EDITABLE_FIELDS);

// Fields whose value is JSON (TEXT[] / JSONB) — used by the diff builder so
// it serialises arrays once instead of stringifying them N times.
const ARRAY_FIELDS = new Set([
  'official_languages',
  'evl_sop_urls',
  'pto_sop_urls',
]);
const JSONB_FIELDS = new Set([
  'stakeholders',
  'pre_onboarding_steps',
  'benefits',
  'faqs',
]);

const VALID_PAYROLL_CYCLE = new Set(['on_cycle', 'off_cycle']);

export function isValidCountryCode(cc) {
  return typeof cc === 'string' && /^[A-Za-z]{2}$/.test(cc);
}

export function normaliseCountryCode(cc) {
  return isValidCountryCode(cc) ? cc.toUpperCase() : null;
}

// ── Permission gates ──────────────────────────────────────────────────────
// canEdit: country owner (per team_member_countries) OR HR Hub admin OR
// full admin. canRead: published docs are org-readable; draft / archived
// docs require edit rights (so unfinished drafts stay invisible to
// non-owners). Both helpers are intentionally async because canAdministerHrHub
// hits the override flag — caching that lookup is the helper's job.
export async function canEditCountryHandoverDoc(user, countryCode) {
  if (!user?.email) return false;
  if (isAdminUser(user)) return true;
  if (await canAdministerHrHub(user)) return true;
  const owned = getOwnedCountries(user.email);
  const cc = normaliseCountryCode(countryCode);
  return Boolean(cc && owned.has(cc));
}

export async function canReadCountryHandoverDoc(user, doc) {
  if (!user?.email || !doc) return false;
  if (doc.status === 'published') return true;
  return canEditCountryHandoverDoc(user, doc.country_code);
}

// ── Row mappers ───────────────────────────────────────────────────────────
// pg returns TEXT[] as JS arrays and JSONB as parsed objects, which is what
// the FE wants. We coerce DATE/TIMESTAMPTZ to ISO strings on the way out so
// the response is stable across pg client versions.
export function rowToDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    country_code: row.country_code,
    scope_responsibilities: row.scope_responsibilities,
    prepared_by_email: row.prepared_by_email,
    signatory: row.signatory,
    official_languages: row.official_languages || [],
    wet_ink_required: row.wet_ink_required,
    payroll_cycle: row.payroll_cycle,
    payroll_cutoff_date: row.payroll_cutoff_date,
    stakeholders: row.stakeholders || [],
    slack_channel_name: row.slack_channel_name,
    country_validation_url: row.country_validation_url,
    onboarding_buffer: row.onboarding_buffer,
    pre_onboarding_steps: row.pre_onboarding_steps || [],
    manual_start_date_push: row.manual_start_date_push,
    onboarding_team_handles: row.onboarding_team_handles,
    onboarding_guide_url: row.onboarding_guide_url,
    country_specific_onboarding: row.country_specific_onboarding,
    post_onboarding_steps: row.post_onboarding_steps,
    legal_amendment_handover_url: row.legal_amendment_handover_url,
    amendments_country_notes: row.amendments_country_notes,
    termination_process: row.termination_process,
    termination_handover_url: row.termination_handover_url,
    resignation_process: row.resignation_process,
    benefits: row.benefits || [],
    evl_template_url: row.evl_template_url,
    evl_process_description: row.evl_process_description,
    evl_sop_urls: row.evl_sop_urls || [],
    visas_supported: row.visas_supported,
    pto_sop_urls: row.pto_sop_urls || [],
    pto_key_aspects: row.pto_key_aspects,
    pto_carry_over_rules: row.pto_carry_over_rules,
    other_country_processes: row.other_country_processes,
    faqs: row.faqs || [],
    docs_folder_url: row.docs_folder_url,
    status: row.status,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    updated_by_email: row.updated_by_email,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// ── Input validation ──────────────────────────────────────────────────────
// Returns { values: { field: coerced }, errors: { field: 'message' } }.
// Unknown fields are skipped silently; known fields with bad shape get a
// per-field error so the editor can highlight the offending input.
export function coerceUpdateBody(body) {
  const values = {};
  const errors = {};
  if (!body || typeof body !== 'object') {
    return { values, errors };
  }
  for (const key of Object.keys(body)) {
    if (!EDITABLE_FIELDS_SET.has(key)) continue;
    const raw = body[key];
    if (raw === undefined) continue;

    if (raw === null) {
      values[key] = null;
      continue;
    }

    if (ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(raw)) { errors[key] = 'expected array of strings'; continue; }
      values[key] = raw.map(v => String(v ?? '').trim()).filter(Boolean);
      continue;
    }

    if (JSONB_FIELDS.has(key)) {
      if (!Array.isArray(raw)) { errors[key] = 'expected array'; continue; }
      values[key] = raw;
      continue;
    }

    if (key === 'wet_ink_required' || key === 'onboarding_team_handles' || key === 'visas_supported') {
      if (typeof raw !== 'boolean') { errors[key] = 'expected boolean'; continue; }
      values[key] = raw;
      continue;
    }

    if (key === 'payroll_cycle') {
      const s = String(raw).trim();
      if (!s) { values[key] = null; continue; }
      if (!VALID_PAYROLL_CYCLE.has(s)) {
        errors[key] = `expected one of ${[...VALID_PAYROLL_CYCLE].join(' | ')}`;
        continue;
      }
      values[key] = s;
      continue;
    }

    // Everything else is text (URL inputs included — the FE validates the
    // https:// shape; the API doesn't reject so we can paste a draft).
    values[key] = typeof raw === 'string' ? raw : String(raw);
  }
  return { values, errors };
}

// Build a minimal diff between the row pre-update and the values being
// written. Stable JSON encoding for arrays/objects so { a, b } !== { b, a }
// is treated as a change.
export function buildDiff(prevRow, nextValues) {
  const diff = {};
  for (const key of Object.keys(nextValues)) {
    const from = prevRow ? prevRow[key] : undefined;
    const to = nextValues[key];
    if (deepEqual(from, to)) continue;
    diff[key] = { from: from === undefined ? null : from, to: to === undefined ? null : to };
  }
  return diff;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

// ── Audit log writer ──────────────────────────────────────────────────────
// Inserts one country_handover_doc_history row. Skips if diff is empty so
// a no-op PATCH doesn't pollute history.
export async function writeHistory({ docId, countryCode, editorEmail, diff, comment }) {
  if (!docId || !diff || Object.keys(diff).length === 0) return null;
  const cc = normaliseCountryCode(countryCode);
  const { rows } = await query(
    `INSERT INTO country_handover_doc_history (doc_id, country_code, edited_by_email, diff, comment)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, edited_at`,
    [docId, cc, editorEmail || null, JSON.stringify(diff), comment || null],
  );
  return rows[0];
}
