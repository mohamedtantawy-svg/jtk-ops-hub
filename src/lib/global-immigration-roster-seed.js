// ── Global Immigration roster seed (Phase 14 — 2026-05-20) ─────────────────
// One-shot bootstrap of mohamed's 67-person Global Immigration roster (from
// the "Deelers Information May 20 2026" CSV he provided). UPSERTs a
// team_member_overrides row per person with:
//
//   • email
//   • name + initials (derived from email prefix)
//   • manager_email (from CSV)
//   • access tier per the locked rule:
//       - A manager whose reports include OTHER managers = regional_manager
//       - A manager whose reports are all leaf agents    = team_lead
//       - A leaf person (no reports)                     = agent
//       - derek.house (dept lead, already seeded by Phase 10b)            = admin
//   • org_node_id = Global Immigration UUID (so isolation lights up
//                   immediately on first request)
//   • is_new = true (these emails are not in the HRX static baseline)
//   • service = 'New Services' (Immigration work is non-EOR)
//   • title = 'Immigration Experience Specialist' (placeholder; admin can
//             update via Team tab post-deploy)
//
// HRX-no-impact: confirmed every email in this list is NEW (none appear in
// src/data/members.js). The legacy `team` column is left null — Global
// Immigration's isolation works through org_node_id; setting the legacy
// `team` would risk leakage into HRX queue scoping for the ~84 HRX agents.
//
// Idempotent via the `global_immigration_roster_seed_version` sentinel in
// app_settings — bumps to v2 only if mohamed asks for a refresh after the
// initial seed. UPSERT semantics on each row means a re-run is safe.

import { query } from './db';

const SEED_VERSION = 1;
const SEED_KEY = 'global_immigration_roster_seed_version';
const GLOBAL_IMMIGRATION_SLUG = 'global-immigration';
const DEFAULT_TITLE = 'Immigration Experience Specialist';
const DEFAULT_SERVICE = 'New Services';

// The 67-row roster from the CSV. derek.house is intentionally OMITTED — he
// was seeded as the dept admin by Phase 10b's ensureLeadIsDeptAdmin when
// Global Immigration was created with leadEmail=derek.house.
// Access tier derived deterministically from the CSV: a manager's tier is
// 'regional_manager' iff at least one of their reports is also a manager;
// otherwise 'team_lead'. Everyone else is 'agent'.
const ROSTER = [
  // ── Regional Manager (her reports include other managers) ──────────────
  { email: 'adriana.diez@deel.com',        manager: 'derek.house@deel.com',         access: 'regional_manager' },

  // ── Team Leads (manage only leaf agents) ───────────────────────────────
  { email: 'beata.sroda@deel.com',         manager: 'derek.house@deel.com',         access: 'team_lead' },
  { email: 'carla.plata@deel.com',         manager: 'derek.house@deel.com',         access: 'team_lead' },
  { email: 'greta.klevinskiene@deel.com',  manager: 'derek.house@deel.com',         access: 'team_lead' },
  { email: 'madiha.azam@deel.com',         manager: 'derek.house@deel.com',         access: 'team_lead' },
  { email: 'julian.meneilley@deel.com',    manager: 'adriana.diez@deel.com',        access: 'team_lead' },
  { email: 'neethu.harilal@deel.com',      manager: 'adriana.diez@deel.com',        access: 'team_lead' },
  { email: 'paula.schlitt@deel.com',       manager: 'adriana.diez@deel.com',        access: 'team_lead' },

  // ── Agents reporting directly to derek (= individual contributors at
  //    the dept-lead level, no further drill-down) ────────────────────────
  { email: 'brygida.duszynska@deel.com',   manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'elaine.kok@deel.com',          manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'jane.lee@deel.com',            manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'kara.guan@deel.com',           manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'katy.siu@deel.com',            manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'marcin.farganus@deel.com',     manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'pam.chen@deel.com',            manager: 'derek.house@deel.com',         access: 'agent' },
  { email: 'taylor.marshall@deel.com',     manager: 'derek.house@deel.com',         access: 'agent' },

  // ── Agents reporting to adriana (directly under the regional manager) ──
  { email: 'patrick.chang@deel.com',       manager: 'adriana.diez@deel.com',        access: 'agent' },
  { email: 'paulina.hermosillo@deel.com',  manager: 'adriana.diez@deel.com',        access: 'agent' },

  // ── Beata's team (10 agents) ───────────────────────────────────────────
  { email: 'catalina.oyarzo@deel.com',     manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'darragh.cull@deel.com',        manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'eliane.suarez@deel.com',       manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'facundo.berdini@deel.com',     manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'jacob.mgiba@deel.com',         manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'jaikishan.bhatia@deel.com',    manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'katherine.cruzat@deel.com',    manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'sadaf.afaq@deel.com',          manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'salima.talata@deel.com',       manager: 'beata.sroda@deel.com',         access: 'agent' },
  { email: 'sheryl.saniel@deel.com',       manager: 'beata.sroda@deel.com',         access: 'agent' },

  // ── Carla's team (4 agents) ────────────────────────────────────────────
  { email: 'chahat.sharma@deel.com',       manager: 'carla.plata@deel.com',         access: 'agent' },
  { email: 'guillermo.harrsch@deel.com',   manager: 'carla.plata@deel.com',         access: 'agent' },
  { email: 'luna.lu@deel.com',             manager: 'carla.plata@deel.com',         access: 'agent' },
  { email: 'valentina.rojas@deel.com',     manager: 'carla.plata@deel.com',         access: 'agent' },

  // ── Greta's team (15 agents) ───────────────────────────────────────────
  { email: 'ashley.acevedo@deel.com',      manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'breno.freire@deel.com',        manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'charlotte.gachon@deel.com',    manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'clare.macmillanbell@deel.com', manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'dahiana.plazas@deel.com',      manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'fran.logiudice@deel.com',      manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'hanna.sirnio@deel.com',        manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'lopez.daniel@deel.com',        manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'maria.badaloni@deel.com',      manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'nailya.becker@deel.com',       manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'nesreen.starkey@deel.com',     manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'olga.sotiriou@deel.com',       manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'safa.hadami@deel.com',         manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'stefan.poliakov@deel.com',     manager: 'greta.klevinskiene@deel.com',  access: 'agent' },
  { email: 'victoria.albuquerque@deel.com', manager: 'greta.klevinskiene@deel.com', access: 'agent' },

  // ── Madiha's team (5 agents) ───────────────────────────────────────────
  { email: 'callum.middleton@deel.com',    manager: 'madiha.azam@deel.com',         access: 'agent' },
  { email: 'mashael.aljassim@deel.com',    manager: 'madiha.azam@deel.com',         access: 'agent' },
  { email: 'mohammed.alhashemi@deel.com',  manager: 'madiha.azam@deel.com',         access: 'agent' },
  { email: 'nura.alieva@deel.com',         manager: 'madiha.azam@deel.com',         access: 'agent' },
  { email: 'sophia.aziz@deel.com',         manager: 'madiha.azam@deel.com',         access: 'agent' },

  // ── Julian's team (8 agents) ───────────────────────────────────────────
  { email: 'erica.wiessner@deel.com',      manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'heejin.jeon@deel.com',         manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'iara.haertel@deel.com',        manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'kevin.omeye@deel.com',         manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'leah.mcrae@deel.com',          manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'maite.bocutti@deel.com',       manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'seyi.faronbi@deel.com',        manager: 'julian.meneilley@deel.com',    access: 'agent' },
  { email: 'valentin.malvasi@deel.com',    manager: 'julian.meneilley@deel.com',    access: 'agent' },

  // ── Neethu's team (3 agents) ───────────────────────────────────────────
  { email: 'aniket.dutta@deel.com',        manager: 'neethu.harilal@deel.com',      access: 'agent' },
  { email: 'maria.soto@deel.com',          manager: 'neethu.harilal@deel.com',      access: 'agent' },
  { email: 'ricky.espana@deel.com',        manager: 'neethu.harilal@deel.com',      access: 'agent' },

  // ── Paula's team (4 agents) ────────────────────────────────────────────
  { email: 'antonella.baletto@deel.com',   manager: 'paula.schlitt@deel.com',       access: 'agent' },
  { email: 'arjun.kamath@deel.com',        manager: 'paula.schlitt@deel.com',       access: 'agent' },
  { email: 'max.rizza@deel.com',           manager: 'paula.schlitt@deel.com',       access: 'agent' },
  { email: 'pragnya.sudheendra@deel.com',  manager: 'paula.schlitt@deel.com',       access: 'agent' },
];

// Derive a display name from the email prefix. "adriana.diez" → "Adriana Diez".
// The "lopez.daniel" case (Spanish surname-first convention) renders as
// "Lopez Daniel" — admin can correct individual names via the Team tab.
function emailToName(email) {
  const prefix = String(email || '').split('@')[0];
  return prefix
    .split('.')
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// Two-letter initials from the email prefix. "adriana.diez" → "AD".
function emailToInitials(email) {
  const parts = String(email || '').split('@')[0].split('.').filter(Boolean);
  return parts.map(p => p.charAt(0).toUpperCase()).join('').slice(0, 3);
}

export async function seedGlobalImmigrationRosterIfNeeded() {
  // ── Version-marker check (idempotent on re-run) ──────────────────────────
  let currentVersion = 0;
  try {
    const { rows } = await query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SEED_KEY],
    );
    if (rows[0]?.value) {
      const v = typeof rows[0].value === 'object' ? rows[0].value.version : rows[0].value;
      currentVersion = Number(v) || 0;
    }
  } catch { /* app_settings may not exist yet — fall through */ }
  if (currentVersion >= SEED_VERSION) {
    return { skipped: true, currentVersion };
  }

  // ── Resolve Global Immigration UUID by slug ──────────────────────────────
  let deptId;
  try {
    const { rows } = await query(
      `SELECT id FROM org_nodes WHERE slug = $1 AND is_archived = false LIMIT 1`,
      [GLOBAL_IMMIGRATION_SLUG],
    );
    deptId = rows[0]?.id;
  } catch (err) {
    console.warn('[gix-roster] Global Immigration lookup failed:', err.message);
  }
  if (!deptId) {
    // Dept doesn't exist on this env (e.g. test DBs without the dept set up).
    // Mark the sentinel as done so the seed doesn't retry on every boot.
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, 'system-seed', NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [SEED_KEY, JSON.stringify({ version: SEED_VERSION, skipped: 'no-gix-dept' })],
    );
    return { skipped: true, reason: 'Global Immigration not found' };
  }

  // ── UPSERT each roster member ────────────────────────────────────────────
  let inserted = 0;
  let failed = 0;
  for (const m of ROSTER) {
    const emailLc = String(m.email).toLowerCase();
    const managerLc = m.manager ? String(m.manager).toLowerCase() : null;
    const name = emailToName(emailLc);
    const initials = emailToInitials(emailLc);
    try {
      await query(
        `INSERT INTO team_member_overrides
           (email, name, initials, title, access, manager_email, service, org_node_id, is_new, is_deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false)
         ON CONFLICT (email) DO UPDATE
           SET name           = COALESCE(team_member_overrides.name, EXCLUDED.name),
               initials       = COALESCE(team_member_overrides.initials, EXCLUDED.initials),
               title          = COALESCE(team_member_overrides.title, EXCLUDED.title),
               access         = EXCLUDED.access,
               manager_email  = EXCLUDED.manager_email,
               service        = COALESCE(team_member_overrides.service, EXCLUDED.service),
               org_node_id    = EXCLUDED.org_node_id,
               is_deleted     = false,
               updated_at     = NOW()`,
        [
          emailLc, name, initials, DEFAULT_TITLE, m.access, managerLc, DEFAULT_SERVICE, deptId,
        ],
      );
      inserted += 1;
    } catch (err) {
      console.warn(`[gix-roster] failed to seed ${emailLc}:`, err.message);
      failed += 1;
    }
  }

  // ── Audit row ────────────────────────────────────────────────────────────
  try {
    await query(
      `INSERT INTO org_audit
         (actor_email, action, target_kind, target_id, after_json, metadata)
       VALUES ('system-seed', 'dept.roster_seeded', 'node', $1, $2::jsonb, $3::jsonb)`,
      [
        deptId,
        JSON.stringify({ slug: GLOBAL_IMMIGRATION_SLUG, deptId }),
        JSON.stringify({
          version: SEED_VERSION,
          inserted,
          failed,
          roster_size: ROSTER.length,
          source: 'Deelers Information May 20 2026.csv',
        }),
      ],
    );
  } catch (err) {
    console.warn('[gix-roster] audit insert failed:', err.message);
  }

  // ── Mark sentinel ────────────────────────────────────────────────────────
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, 'system-seed', NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [SEED_KEY, JSON.stringify({ version: SEED_VERSION })],
  );

  return {
    skipped: false,
    version: SEED_VERSION,
    deptId,
    inserted,
    failed,
    roster_size: ROSTER.length,
  };
}

// Exported for the verifier so it can assert tier counts deterministically
// without parsing the file.
export const ROSTER_SUMMARY = {
  size: ROSTER.length,
  byAccess: ROSTER.reduce((acc, m) => {
    acc[m.access] = (acc[m.access] || 0) + 1;
    return acc;
  }, {}),
};
