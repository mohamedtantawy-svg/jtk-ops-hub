// ── Team-members baseline × override merge helper ───────────────────────────
// The Team tab's source of truth is a layered merge:
//
//   baseline (TEAM_MEMBERS static array from src/data/members.js)
//     → 104 hardcoded people, the single source the rest of the app reads
//   overrides (team_member_overrides DB table, keyed by email)
//     → per-field nulls mean "use baseline"; is_new rows are entirely new
//     → is_deleted rows mask a baseline entry out of the merged list
//   logins (member_logins DB table, keyed by email)
//     → last_seen_at = real activity (FE heartbeat); the badge column
//     → last_login_at = actual auth event timestamp
//     → login_count = lifetime auth event counter
//
// This module is imported by the /api/v1/team-members routes and by any
// server-side code that needs the current, authoritative roster (not just
// the frozen baseline).
//
// The merged shape matches the client-side TEAM_MEMBERS entries so downstream
// consumers (Team view, useTeamMembers hook, org helpers) can treat it as a
// drop-in replacement.

import { TEAM_MEMBERS } from '../data/members';

function _toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v && typeof v.toISOString === 'function') return v.toISOString();
  return null;
}

// Convert a DB override row (snake_case) to the client shape (camelCase).
function normaliseOverrideRow(row) {
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    initials: row.initials,
    title: row.title,
    access: row.access,
    managerEmail: row.manager_email,
    team: row.team,
    region: row.region,
    service: row.service,
    country: row.country,
    avatarUrl: row.avatar_url,
    startDate: row.start_date
      ? (typeof row.start_date === 'string'
          ? row.start_date
          : row.start_date.toISOString().slice(0, 10))
      : null,
    isNew: row.is_new === true,
    isDeleted: row.is_deleted === true,
    onLeave: row.on_leave === true,
    // Additive per-user permissions (Director can grant from the Team tab).
    isAnnouncementsAdmin: row.is_announcements_admin === true,
    isAccessAdmin: row.is_access_admin === true,
    isHrHubAdmin: row.is_hr_hub_admin === true,
    isLeaderAlertsAdmin: row.is_leader_alerts_admin === true,
    // Org Tab (Phase 0): org_node_id is nullable during the migration window
    // — null means the merge consumer falls back to `team` for grouping until
    // Phase 6 retires the legacy column.
    orgNodeId: row.org_node_id || null,
  };
}

// Build the lookup map of member_logins rows (snake_case from DB) keyed by
// lowercased email. Missing rows ⇒ user has never been seen → null fields.
function buildLoginsMap(loginRows = []) {
  const m = new Map();
  for (const r of loginRows) {
    if (!r?.email) continue;
    m.set(String(r.email).toLowerCase(), {
      lastSeenAt:  _toIso(r.last_seen_at),
      lastLoginAt: _toIso(r.last_login_at),
      loginCount:  Number.isFinite(r.login_count) ? r.login_count : 0,
    });
  }
  return m;
}

const EMPTY_LOGIN = { lastSeenAt: null, lastLoginAt: null, loginCount: 0 };

// Apply non-null override fields on top of a baseline entry, then attach
// login activity from the member_logins map.
function applyOverride(base, override, loginsByEmail) {
  const login = loginsByEmail.get(String(base.email).toLowerCase()) || EMPTY_LOGIN;
  if (!override) return {
    ...base,
    isNew: false, isDeleted: false, onLeave: false,
    ...login,
    isAnnouncementsAdmin: false,
    isAccessAdmin: false,
    isHrHubAdmin: false,
    isLeaderAlertsAdmin: false,
    orgNodeId: null,
  };
  const merged = { ...base };
  // Only overwrite when the override has a non-null value for the field.
  const fields = ['name', 'initials', 'title', 'access', 'managerEmail', 'team', 'region', 'service', 'country', 'avatarUrl', 'startDate'];
  for (const f of fields) {
    if (override[f] !== null && override[f] !== undefined) {
      merged[f] = override[f];
    }
  }
  // Status/metadata fields come straight from the override row.
  merged.isNew = override.isNew;
  merged.isDeleted = override.isDeleted;
  merged.onLeave = override.onLeave;
  // Login activity comes from member_logins, NOT team_member_overrides.
  // The legacy override columns are still dual-written for transition
  // safety but we no longer read them.
  merged.lastSeenAt  = login.lastSeenAt;
  merged.lastLoginAt = login.lastLoginAt;
  merged.loginCount  = login.loginCount;
  merged.isAnnouncementsAdmin = override.isAnnouncementsAdmin === true;
  merged.isAccessAdmin = override.isAccessAdmin === true;
  merged.isHrHubAdmin = override.isHrHubAdmin === true;
  merged.isLeaderAlertsAdmin = override.isLeaderAlertsAdmin === true;
  merged.orgNodeId = override.orgNodeId || null;
  return merged;
}

// Build the top-level "department" name for every member by walking the
// org_nodes parent_id chain up from their orgNodeId. Top-level depts are
// rows with `kind='department' AND parent_id IS NULL`. A member placed
// under a sub-team still resolves to the dept at the head of the chain.
// Capped at 16 hops as a defence against accidental cycles (the schema
// doesn't enforce a DAG).
//
// 2026-05-29 (Beata Sroda incident): the Access Control panel had its
// Department dropdown read from a hardcoded literal in _buildAccessMap,
// so it never reflected real placement and never persisted. This helper
// gives that panel the truth so its dropdown can default to the live
// dept the member is actually placed under.
function buildOrgNodeLookup(orgNodes = []) {
  const map = new Map();
  for (const n of orgNodes) {
    if (!n || !n.id) continue;
    map.set(String(n.id), {
      parentId: n.parent_id || n.parentId || null,
      name: n.name,
      kind: n.kind,
    });
  }
  return map;
}

function resolveTopDept(nodeId, nodeMap) {
  if (!nodeId || !nodeMap || nodeMap.size === 0) return null;
  let cur = nodeMap.get(String(nodeId));
  let depth = 0;
  while (cur && cur.parentId && depth < 16) {
    const parent = nodeMap.get(String(cur.parentId));
    if (!parent) break;
    cur = parent;
    depth += 1;
  }
  if (cur && cur.kind === 'department' && !cur.parentId) return cur.name;
  return null;
}

/**
 * Merge baseline TEAM_MEMBERS with override rows + member_logins activity.
 *
 * @param {Array} overrideRows — rows from team_member_overrides (snake_case)
 * @param {Array} [loginRows]  — rows from member_logins (snake_case);
 *                                callers that haven't migrated yet pass [] /
 *                                omit and every member's login fields are null
 *                                (used to mean "Never seen"). Migrated callers
 *                                pass the SELECT result so the merge has the
 *                                authoritative activity timestamps.
 * @param {Array} [orgNodes]   — rows from org_nodes (id, parent_id, kind, name);
 *                                used to derive a member's top-level dept via
 *                                parent walk on their orgNodeId. Omit / pass []
 *                                and every member ships with department=null
 *                                (callers can still fall back at the FE layer).
 * @returns {Array} merged member list (camelCase), deleted entries filtered out
 */
export function mergeTeamMembers(overrideRows = [], loginRows = [], orgNodes = []) {
  // Build override lookup keyed by email
  const byEmail = new Map();
  for (const row of overrideRows) {
    const normalised = normaliseOverrideRow(row);
    if (normalised) byEmail.set(normalised.email.toLowerCase(), normalised);
  }
  const loginsByEmail = buildLoginsMap(loginRows);
  const orgNodeLookup = buildOrgNodeLookup(orgNodes);

  const merged = [];
  const seenEmails = new Set();

  // 1. Baseline pass — apply overrides, skip soft-deletes
  for (const base of TEAM_MEMBERS) {
    const emailLc = base.email.toLowerCase();
    seenEmails.add(emailLc);
    const override = byEmail.get(emailLc);
    if (override?.isDeleted) continue;          // soft-deleted → hide
    const row = applyOverride(base, override, loginsByEmail);
    row.department = resolveTopDept(row.orgNodeId, orgNodeLookup);
    merged.push(row);
  }

  // 2. Brand-new members pass — emails not in baseline
  for (const [emailLc, override] of byEmail.entries()) {
    if (seenEmails.has(emailLc)) continue;       // already handled above
    if (override.isDeleted) continue;             // hard-deleted new row → skip
    if (!override.isNew) continue;                // defensive: shouldn't happen
    const login = loginsByEmail.get(emailLc) || EMPTY_LOGIN;
    // For a brand-new row everything comes from the override — fill defaults
    // for any missing field so downstream renderers don't choke on undefined.
    merged.push({
      email: override.email,
      name: override.name || override.email,
      initials: override.initials || override.email.slice(0, 2).toUpperCase(),
      title: override.title || 'HR Experience Specialist',
      access: override.access || 'agent',
      managerEmail: override.managerEmail || null,
      team: override.team || null,
      region: override.region || override.team || null,
      service: override.service || 'EOR',
      country: override.country || null,
      avatarUrl: override.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(override.name || override.email)}&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40`,
      startDate: override.startDate || new Date().toISOString().slice(0, 10),
      isNew: true,
      isDeleted: false,
      onLeave: override.onLeave,
      lastSeenAt:  login.lastSeenAt,
      lastLoginAt: login.lastLoginAt,
      loginCount:  login.loginCount,
      isAnnouncementsAdmin: override.isAnnouncementsAdmin === true,
      isAccessAdmin: override.isAccessAdmin === true,
      isHrHubAdmin: override.isHrHubAdmin === true,
      isLeaderAlertsAdmin: override.isLeaderAlertsAdmin === true,
      orgNodeId: override.orgNodeId || null,
      department: resolveTopDept(override.orgNodeId || null, orgNodeLookup),
    });
  }

  return merged;
}

export { normaliseOverrideRow };
