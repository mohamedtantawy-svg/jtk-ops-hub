// ── Team-members baseline × override merge helper ───────────────────────────
// The Team tab's source of truth is a layered merge:
//
//   baseline (TEAM_MEMBERS static array from src/data/members.js)
//     → 104 hardcoded people, the single source the rest of the app reads
//   overrides (team_member_overrides DB table, keyed by email)
//     → per-field nulls mean "use baseline"; is_new rows are entirely new
//     → is_deleted rows mask a baseline entry out of the merged list
//     → last_login_at is bumped on every successful auth
//
// This module is imported by the /api/v1/team-members routes and by any
// server-side code that needs the current, authoritative roster (not just
// the frozen baseline).
//
// The merged shape matches the client-side TEAM_MEMBERS entries so downstream
// consumers (Team view, useTeamMembers hook, org helpers) can treat it as a
// drop-in replacement.

import { TEAM_MEMBERS } from '../data/members';

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
    lastLoginAt: row.last_login_at
      ? (typeof row.last_login_at === 'string'
          ? row.last_login_at
          : row.last_login_at.toISOString())
      : null,
    loginCount: row.login_count || 0,
    // Additive per-user permissions (Director can grant from the Team tab).
    isAnnouncementsAdmin: row.is_announcements_admin === true,
    isAccessAdmin: row.is_access_admin === true,
    isHrHubAdmin: row.is_hr_hub_admin === true,
  };
}

// Apply non-null override fields on top of a baseline entry.
function applyOverride(base, override) {
  if (!override) return {
    ...base,
    isNew: false, isDeleted: false, onLeave: false, lastLoginAt: null, loginCount: 0,
    isAnnouncementsAdmin: false,
    isAccessAdmin: false,
    isHrHubAdmin: false,
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
  merged.lastLoginAt = override.lastLoginAt;
  merged.loginCount = override.loginCount;
  merged.isAnnouncementsAdmin = override.isAnnouncementsAdmin === true;
  merged.isAccessAdmin = override.isAccessAdmin === true;
  merged.isHrHubAdmin = override.isHrHubAdmin === true;
  return merged;
}

/**
 * Merge baseline TEAM_MEMBERS with override rows.
 *
 * @param {Array} overrideRows — rows from team_member_overrides (snake_case)
 * @returns {Array} merged member list (camelCase), deleted entries filtered out
 */
export function mergeTeamMembers(overrideRows = []) {
  // Build override lookup keyed by email
  const byEmail = new Map();
  for (const row of overrideRows) {
    const normalised = normaliseOverrideRow(row);
    if (normalised) byEmail.set(normalised.email.toLowerCase(), normalised);
  }

  const merged = [];
  const seenEmails = new Set();

  // 1. Baseline pass — apply overrides, skip soft-deletes
  for (const base of TEAM_MEMBERS) {
    const emailLc = base.email.toLowerCase();
    seenEmails.add(emailLc);
    const override = byEmail.get(emailLc);
    if (override?.isDeleted) continue;          // soft-deleted → hide
    merged.push(applyOverride(base, override));
  }

  // 2. Brand-new members pass — emails not in baseline
  for (const [emailLc, override] of byEmail.entries()) {
    if (seenEmails.has(emailLc)) continue;       // already handled above
    if (override.isDeleted) continue;             // hard-deleted new row → skip
    if (!override.isNew) continue;                // defensive: shouldn't happen
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
      lastLoginAt: override.lastLoginAt,
      loginCount: override.loginCount,
      isAnnouncementsAdmin: override.isAnnouncementsAdmin === true,
    });
  }

  return merged;
}

export { normaliseOverrideRow };
