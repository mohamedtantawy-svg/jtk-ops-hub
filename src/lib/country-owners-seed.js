// ── Country-ownership seed ──────────────────────────────────────────────────
// One-shot seeder for team_member_countries. Reads the parsed CSV
// (src/data/csv_country_owners_seed.json — generated from the
// "Countries by Person Role" Deel spreadsheet) and inserts a row for every
// (countryCode, ownerEmail) pair where the owner name resolves to an HRX
// team member we know about. Only fires when the table is empty so manual
// edits via the Team-tab UI are never overwritten.
//
// Name resolution mirrors normalizeSourceRows.js — accent-stripped, lower-
// cased, whitespace-collapsed, with a "first|last" fallback for rows that
// include a middle name in the spreadsheet (e.g. "Jessica Sabrina Czech").
// Names that don't resolve to a current HRX member are skipped silently
// — the export endpoint surfaces those gaps so admins can backfill manually.

import { query } from './db';
import { TEAM_MEMBERS } from '../data/members';
import { mergeTeamMembers } from './team-members-merge';
import seed from '../data/csv_country_owners_seed.json' with { type: 'json' };

function stripAccents(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeName(s) {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(name) {
  return normalizeName(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

// Build the lookup maps from the merged roster (baseline TEAM_MEMBERS +
// active overrides). Soft-deleted rows are skipped — we don't want to
// re-seed a country onto someone who left.
async function buildNameLookup() {
  let overrideRows = [];
  try {
    const { rows } = await query(
      `SELECT email, name, initials, title, access, manager_email, team, region,
              service, country, avatar_url, start_date, is_new, is_deleted,
              on_leave, last_login_at, login_count, is_announcements_admin,
              is_access_admin, created_at, updated_at
         FROM team_member_overrides`,
    );
    overrideRows = rows;
  } catch (err) {
    // If overrides aren't queryable yet (cold DB on first migration run),
    // fall back to baseline TEAM_MEMBERS only — the seed still hits the
    // most common HRX names.
    console.warn('[country-owners-seed] overrides query failed, using baseline only:', err?.message);
  }

  const merged = mergeTeamMembers(overrideRows).filter(m => !m.isDeleted);
  // exact, accent-stripped, whitespace-collapsed, "first|last" — same
  // hierarchy as resolveEmailByName in normalizeSourceRows.js.
  const exact = new Map();
  const stripped = new Map();
  const collapsed = new Map();
  const firstLast = new Map();
  for (const m of merged) {
    if (!m.email || !m.name) continue;
    const email = m.email.toLowerCase();
    const lower = m.name.toLowerCase();
    const stripLower = stripAccents(lower);
    const collapsedKey = stripLower.replace(/\s+/g, '');
    if (!exact.has(lower)) exact.set(lower, email);
    if (!stripped.has(stripLower)) stripped.set(stripLower, email);
    if (!collapsed.has(collapsedKey)) collapsed.set(collapsedKey, email);
    const tokens = tokenize(m.name);
    if (tokens.length >= 2) {
      const flKey = `${tokens[0]}|${tokens[tokens.length - 1]}`;
      if (!firstLast.has(flKey)) firstLast.set(flKey, email);
    }
  }
  return { exact, stripped, collapsed, firstLast };
}

function resolveEmailFromSeedName(seedName, lookup) {
  if (!seedName) return '';
  const lower = seedName.toLowerCase();
  const stripLower = stripAccents(lower);
  let hit = lookup.exact.get(lower);
  if (hit) return hit;
  hit = lookup.stripped.get(stripLower);
  if (hit) return hit;
  hit = lookup.collapsed.get(stripLower.replace(/\s+/g, ''));
  if (hit) return hit;
  const tokens = tokenize(seedName);
  if (tokens.length >= 2) {
    hit = lookup.firstLast.get(`${tokens[0]}|${tokens[tokens.length - 1]}`);
    if (hit) return hit;
  }
  return '';
}

/**
 * Seed team_member_countries from the CSV, but ONLY when the table is empty.
 * Returns { seeded: number, missingOwners: string[], totalCountries: number }.
 * Idempotent: subsequent runs find a non-empty table and no-op.
 */
export async function seedCountryOwnersIfEmpty() {
  let existing;
  try {
    existing = await query('SELECT COUNT(*)::int AS n FROM team_member_countries');
  } catch (err) {
    console.warn('[country-owners-seed] count query failed:', err?.message);
    return { seeded: 0, skipped: true };
  }
  if ((existing?.rows?.[0]?.n || 0) > 0) {
    return { seeded: 0, skipped: true };
  }

  const lookup = await buildNameLookup();
  const missingOwners = new Set();
  const inserts = [];
  for (const [cc, names] of Object.entries(seed)) {
    for (const name of names) {
      const email = resolveEmailFromSeedName(name, lookup);
      if (email) {
        inserts.push({ email, cc: cc.toUpperCase() });
      } else {
        missingOwners.add(name);
      }
    }
  }

  if (inserts.length === 0) {
    console.log(`[country-owners-seed] nothing to seed (no resolvable owner names)`);
    return { seeded: 0, missingOwners: [...missingOwners], totalCountries: Object.keys(seed).length };
  }

  // Bulk insert via parameterised values; ON CONFLICT DO NOTHING so a
  // CSV row with a duplicate (email, country) pair just dedupes silently.
  const valuesSql = inserts.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = inserts.flatMap(r => [r.email, r.cc]);
  try {
    await query(
      `INSERT INTO team_member_countries (email, country_code) VALUES ${valuesSql}
         ON CONFLICT (email, country_code) DO NOTHING`,
      params,
    );
    console.log(`[country-owners-seed] inserted ${inserts.length} (email, country) pairs across ${Object.keys(seed).length} countries; ${missingOwners.size} CSV names unresolved`);
    return {
      seeded: inserts.length,
      missingOwners: [...missingOwners],
      totalCountries: Object.keys(seed).length,
    };
  } catch (err) {
    console.error('[country-owners-seed] insert failed:', err?.message);
    return { seeded: 0, error: err?.message, totalCountries: Object.keys(seed).length };
  }
}
