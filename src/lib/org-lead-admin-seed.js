// ── Org lead-as-admin seed (Phase 10b — 2026-05-20) ────────────────────────
// Helper invoked when a department is created (POST /api/v1/org/nodes) and
// from the org default-seed backfill on existing departments. Makes the
// dept's `lead_email` a real member of that dept with admin power.
//
// Three idempotent writes:
//   1. team_member_overrides — UPSERT (email, org_node_id, access='admin').
//      is_new=true when the email isn't in the static baseline AND has no
//      pre-existing override row. Existing rows preserve their is_new flag.
//      The legacy `team` column is NEVER touched here — queue scoping for
//      the existing ~84 HRX agents reads `team`, so cross-dept restructure
//      operations must only mutate `org_node_id`.
//   2. org_node_admins — INSERT (node_id, email), ON CONFLICT DO NOTHING.
//      Grants delegated edit power for the dept + every descendant.
//   3. org_audit — append-only 'node.lead_seeded' row.
//
// Caller controls when to invoke. Safe to call repeatedly; safe to call on
// a lead that's already seeded; safe to call on a baseline user (just sets
// their org_node_id + flips access to admin).

import { query } from './db';
import { TEAM_MEMBERS } from '../data/members';

function isInBaseline(email) {
  if (!email) return false;
  const lc = String(email).toLowerCase();
  return TEAM_MEMBERS.some(m => m.email.toLowerCase() === lc);
}

/**
 * Seed a lead as the admin of an org node.
 *
 * @param {Object} args
 * @param {string} args.nodeId      — UUID of the org_nodes row.
 * @param {string} args.leadEmail   — Email of the lead. Lowercased on use.
 * @param {string} [args.actorEmail] — Email of the user triggering the
 *                                     seed; defaults to 'system-seed' when
 *                                     called from the boot-time backfill.
 * @returns {Promise<{email,org_node_id,access,delegated_admin_granted,was_in_baseline}>}
 */
export async function ensureLeadIsDeptAdmin({ nodeId, leadEmail, actorEmail }) {
  if (!nodeId) return { skipped: true, reason: 'missing nodeId' };
  const emailLc = String(leadEmail || '').trim().toLowerCase();
  if (!emailLc) return { skipped: true, reason: 'missing leadEmail' };
  const actorLc = actorEmail ? String(actorEmail).toLowerCase() : 'system-seed';

  // 1. team_member_overrides UPSERT — move the lead onto this dept + grant
  //    admin access. `is_new` only matters on first insert; the ON CONFLICT
  //    branch leaves it alone so historical is_new flags survive re-seeds.
  const isBaseline = isInBaseline(emailLc);
  await query(
    `INSERT INTO team_member_overrides (email, org_node_id, access, is_new, is_deleted)
     VALUES ($1, $2, 'admin', $3, false)
     ON CONFLICT (email) DO UPDATE
       SET org_node_id = EXCLUDED.org_node_id,
           access      = 'admin',
           is_deleted  = false,
           updated_at  = NOW()`,
    [emailLc, nodeId, !isBaseline],
  );

  // 2. Delegated admin row — gives edit power on this subtree even when
  //    Phase 11 narrows global `access='admin'` to per-dept scope.
  const grantRes = await query(
    `INSERT INTO org_node_admins (node_id, email, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (node_id, email) DO NOTHING`,
    [nodeId, emailLc, actorLc],
  );

  // 3. Append-only audit so the action shows up in the Org Audit drawer.
  await query(
    `INSERT INTO org_audit
       (actor_email, action, target_kind, target_id, after_json, metadata)
     VALUES ($1, 'node.lead_seeded', 'node', $2, $3::jsonb, $4::jsonb)`,
    [
      actorLc,
      nodeId,
      JSON.stringify({ email: emailLc, org_node_id: nodeId, access: 'admin' }),
      JSON.stringify({
        was_in_baseline: isBaseline,
        delegated_admin_granted: grantRes.rowCount > 0,
      }),
    ],
  );

  return {
    email: emailLc,
    org_node_id: nodeId,
    access: 'admin',
    delegated_admin_granted: grantRes.rowCount > 0,
    was_in_baseline: isBaseline,
  };
}
