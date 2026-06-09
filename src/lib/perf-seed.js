// ── Historical performance seed (Phase G, 2026-06-09) ───────────────────────
// Loads data/perf_historical_seed.json (the HRX Performance + Leaders sheets,
// pre-computed into one row per member-month: ops/kpi/growth tiers 1–5 +
// weighted + overall) and writes one FINALIZED, LOCKED, source='import'
// perf_reviews row each, so the moment the Performance tab ships everyone sees
// their real Oct-2025 → May-2026 history (trend lines, bands, distributions).
//
// Resolution: member + manager names → emails via resolveEmailByName against
// the LIVE roster (ensureRosterHydrated first). Records whose member name can't
// be resolved to a current roster email are skipped + logged (never guessed).
// Idempotent: a SEED_VERSION sentinel gates the whole pass, and each insert is
// ON CONFLICT (member_email, period_month, period_year) DO NOTHING so a re-run
// (or a manager who already created a live review for that month) never clobbers
// real data. Multi-pod safe via the sentinel.
import fs from 'fs';
import path from 'path';
import { query } from './db';
import { ensureRosterHydrated } from './roster-server';
import { MEMBERS_BY_EMAIL } from '../data/members';
import { resolveEmailByName } from '../utils/normalizeSourceRows';
import { bandForScore } from './performance-constants';

const SEED_KEY = 'perf_historical_seed_version';
const SEED_VERSION = 1;

async function getStoredVersion() {
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = $1 LIMIT 1`, [SEED_KEY]);
    const v = rows[0]?.value;
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && v.version != null) return Number(v.version) || 0;
    const n = Number(v); return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

async function setStoredVersion(version, stats) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SEED_KEY, JSON.stringify({ version, ...stats })]);
}

function loadRecords() {
  try {
    const p = path.join(process.cwd(), 'data', 'perf_historical_seed.json');
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn('[perf-seed] could not read seed file:', err?.message);
    return [];
  }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export async function seedPerfHistoricalIfNeeded() {
  const current = await getStoredVersion();
  if (current >= SEED_VERSION) return { reseeded: false, version: SEED_VERSION };

  await ensureRosterHydrated({ force: true });
  const records = loadRecords();
  if (records.length === 0) { await setStoredVersion(SEED_VERSION, { inserted: 0 }); return { reseeded: true, inserted: 0 }; }

  let inserted = 0, skippedNoEmail = 0, conflicts = 0, failed = 0;
  const unresolved = new Set();

  for (const r of records) {
    const memberEmail = (resolveEmailByName(r.member) || '').toLowerCase();
    if (!memberEmail || !MEMBERS_BY_EMAIL[memberEmail]) { skippedNoEmail++; if (r.member) unresolved.add(r.member); continue; }
    const m = MEMBERS_BY_EMAIL[memberEmail];
    const managerEmail = (resolveEmailByName(r.manager) || '').toLowerCase();
    const mgr = managerEmail ? MEMBERS_BY_EMAIL[managerEmail] : null;

    const month = Number(r.month), year = Number(r.year);
    if (!month || !year) { failed++; continue; }
    const overall = num(r.overall) != null ? Math.round(num(r.overall)) : Math.round(num(r.weighted) || 0);
    const band = bandForScore(overall).label;
    // Stamp the review as of the last day of its month (noon UTC) for a sane
    // finalized_at ordering on the trend charts.
    const finalizedAt = new Date(Date.UTC(year, month, 0, 12, 0, 0)).toISOString();
    const externalId = `${memberEmail}|${year}-${String(month).padStart(2, '0')}`;

    try {
      const res = await query(
        `INSERT INTO perf_reviews
           (org_node_id, period_month, period_year, member_email, member_name, member_id,
            manager_email, manager_name, sentiment, operations, kpi, growth,
            weighted_score, overall_score, band, status, is_locked, source, external_id,
            finalized_at, finalized_by_email, created_by_email, updated_by_email)
         VALUES
           ($1,$2,$3,$4,$5,
            (SELECT id FROM members WHERE LOWER(email)=$4 LIMIT 1),
            $6,$7,$8,$9,$10,$11,$12,$13,$14,'finalized',true,'import',$15,$16,$17,'import','import')
         ON CONFLICT (member_email, period_month, period_year) DO NOTHING`,
        [m.orgNodeId || null, month, year, memberEmail, m.name || r.member,
         managerEmail || null, mgr?.name || r.manager || null,
         num(r.sentiment), num(r.operations), num(r.kpi), num(r.growth),
         num(r.weighted), overall, band, externalId, finalizedAt, managerEmail || 'import']);
      if (res.rowCount > 0) inserted++; else conflicts++;
    } catch (err) {
      failed++;
      console.warn('[perf-seed] insert failed for', r.member, year + '-' + month, ':', err?.message);
    }
  }

  const stats = { inserted, skippedNoEmail, conflicts, failed, total: records.length, unresolvedNames: unresolved.size };
  await setStoredVersion(SEED_VERSION, stats);
  console.log('[perf-seed] historical seed done:', JSON.stringify(stats));
  if (unresolved.size > 0) {
    console.log('[perf-seed] unresolved member names (sample):', [...unresolved].slice(0, 20).join(' | '));
  }
  return { reseeded: true, ...stats };
}
