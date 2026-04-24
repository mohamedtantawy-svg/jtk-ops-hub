// ── /api/v1/me — session revalidation endpoint ─────────────────────────────
// Source of truth for the current user's profile. Previously this read from
// the `members` table and fell back to JWT claims. Two production bugs
// exposed how fragile that was:
//
//   1. `members` was populated from a stale seed (e.g. Duygu stored as
//      role='regional_mgr' team='ALL' instead of team_lead/EMEA) and never
//      re-synced with Team-tab edits → team-lead/regional-mgr home views
//      rendered empty.
//   2. Users added via the Team tab that weren't seeded into `members`
//      would get team=null / role=member from JWT fallback → permission
//      checks failed silently.
//
// Fix: /me now treats the Team-tab merged roster (baseline ×
// team_member_overrides) as the authoritative profile, same dataset the
// Team view reads. We still look up the `members` row for its `id`/
// `lead_id` (used as FK in audit tables), but every user-visible field
// (role, team, region, country, name, avatar) comes from the merged roster.
// Role names are normalised so legacy `regional_mgr`/`lead` values from
// the old seed still satisfy the app's `regional_manager`/`team_lead`
// checks.

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { mergeTeamMembers } from '../../../../src/lib/team-members-merge';

// Map legacy/short role names used by the old seed into the canonical
// long-form the rest of the app expects. Without this, users with
// role='regional_mgr' in `members` fail all `=== 'regional_manager'`
// permission checks throughout the codebase.
function normaliseRole(role) {
  if (!role) return null;
  const r = String(role).toLowerCase();
  if (r === 'regional_mgr') return 'regional_manager';
  if (r === 'lead') return 'team_lead';
  return r;
}

export async function GET(req) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const emailLc = authUser.email.toLowerCase();
    let membersRow = null;     // for FK id + created_at etc
    let mergedEntry = null;    // authoritative profile (baseline × override)

    try {
      if (process.env.DATABASE_URL) {
        const { query } = await import('../../../../src/lib/db');

        // Opportunistic announcements promotion — keeps the pipeline moving
        // even when nobody's actively loading the announcements view.
        try {
          const { promoteDueScheduled } = await import('../../../../src/lib/announcementFlow');
          await promoteDueScheduled();
        } catch (e) {
          console.warn('[me] promoteDueScheduled failed:', e.message);
        }

        // 1. Members row (for FK id, lead_id, timestamps). May be absent.
        try {
          const { rows } = await query(
            'SELECT id, name, initials, role, team, region, country, lead_id, email, avatar_url, is_active, created_at, updated_at FROM members WHERE email = $1',
            [emailLc]
          );
          if (rows.length > 0) membersRow = rows[0];
        } catch (mErr) {
          console.warn('[me] members lookup failed:', mErr.message);
        }

        // 2. Full override rows → merge with baseline to get the exact same
        //    profile the Team view renders. This is the single source of
        //    truth for role/team/region/country/name/avatar.
        try {
          const { rows: ovRows } = await query(
            `SELECT email, name, initials, title, access, manager_email, team, region,
                    service, country, avatar_url, start_date, is_new, is_deleted,
                    on_leave, last_login_at, login_count
               FROM team_member_overrides`
          );
          const merged = mergeTeamMembers(ovRows);
          mergedEntry = merged.find(m => m.email.toLowerCase() === emailLc) || null;
        } catch (ovErr) {
          console.warn('[me] override merge failed:', ovErr.message);
        }

        // 3. Touch last_login_at so existing JWT sessions backfill the
        //    "Never logged in" badge. INSERT bumps count=1, UPDATE only
        //    refreshes the timestamp so /me hits don't inflate the counter.
        try {
          await query(
            `INSERT INTO team_member_overrides (email, last_login_at, login_count)
             VALUES ($1, NOW(), 1)
             ON CONFLICT (email) DO UPDATE
             SET last_login_at = NOW(),
                 updated_at    = NOW()`,
            [emailLc]
          );
        } catch (touchErr) {
          console.warn('[me] last_login touch failed:', touchErr.message);
        }

        // 4. Lazy-backfill `members` from the merged profile so other code
        //    paths that still read `members` (legacy permission checks,
        //    task assignee FK joins, etc.) see the correct values on next
        //    read. This repairs drift caused by the old seed and by
        //    pre-fix Team edits that didn't sync back. Best-effort — any
        //    failure here shouldn't affect the /me response.
        if (mergedEntry) {
          const desiredRole = normaliseRole(mergedEntry.access) || 'agent';
          const desiredTeam = mergedEntry.team || null;
          const desiredRegion = mergedEntry.region || null;
          const desiredCountry = mergedEntry.country || null;
          const desiredName = mergedEntry.name || null;
          const desiredInitials = mergedEntry.initials || null;
          const desiredAvatar = mergedEntry.avatarUrl || null;

          const driftsFromMembers = !membersRow
            || normaliseRole(membersRow.role) !== desiredRole
            || membersRow.team !== desiredTeam
            || membersRow.region !== desiredRegion
            || membersRow.country !== desiredCountry
            || membersRow.name !== desiredName;

          if (driftsFromMembers) {
            try {
              const { query } = await import('../../../../src/lib/db');
              await query(
                `INSERT INTO members (name, initials, role, team, region, country, email, avatar_url, is_active)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
                 ON CONFLICT (email) DO UPDATE
                 SET name = EXCLUDED.name,
                     initials = EXCLUDED.initials,
                     role = EXCLUDED.role,
                     team = EXCLUDED.team,
                     region = EXCLUDED.region,
                     country = EXCLUDED.country,
                     avatar_url = EXCLUDED.avatar_url,
                     is_active = true,
                     updated_at = NOW()
                 RETURNING id, name, initials, role, team, region, country, lead_id, email, avatar_url, is_active, created_at, updated_at`,
                [desiredName, desiredInitials, desiredRole, desiredTeam, desiredRegion, desiredCountry, emailLc, desiredAvatar]
              ).then(r => { if (r.rows[0]) membersRow = r.rows[0]; }).catch(() => {});
            } catch (bfErr) {
              console.warn('[me] members backfill failed:', bfErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[me] DB block failed, using JWT claims:', err.message);
    }

    // ── Response shape: merged roster wins, members provides FK id ─────────
    if (mergedEntry) {
      const role = normaliseRole(mergedEntry.access) || 'agent';
      return NextResponse.json({
        id: membersRow?.id ?? 0,
        name: mergedEntry.name || authUser.name || authUser.email,
        initials: mergedEntry.initials || null,
        role,
        team: mergedEntry.team || null,
        region: mergedEntry.region || null,
        country: mergedEntry.country || null,
        leadId: membersRow?.lead_id ?? null,
        email: emailLc,
        avatarUrl: mergedEntry.avatarUrl || null,
        isActive: membersRow?.is_active ?? true,
        createdAt: membersRow?.created_at ?? null,
        updatedAt: membersRow?.updated_at ?? null,
      });
    }

    // No merged entry (user outside Team roster) — fall back to the plain
    // members row if any, else JWT claims. This preserves access for admins
    // or service accounts that exist in `members` but not in the Team view.
    if (membersRow) {
      return NextResponse.json({
        id: membersRow.id,
        name: membersRow.name,
        initials: membersRow.initials,
        role: normaliseRole(membersRow.role),
        team: membersRow.team,
        region: membersRow.region,
        country: membersRow.country,
        leadId: membersRow.lead_id,
        email: membersRow.email,
        avatarUrl: membersRow.avatar_url,
        isActive: membersRow.is_active,
        createdAt: membersRow.created_at,
        updatedAt: membersRow.updated_at,
      });
    }

    // Last-resort JWT fallback — intentionally leaves team/region null so
    // downstream permission filters fail closed rather than silently
    // defaulting to a team the user isn't actually on.
    const nameParts = (authUser.name || emailLc.split('@')[0]).split(' ');
    const initials = nameParts.map(p => p.charAt(0).toUpperCase()).slice(0, 2).join('');
    return NextResponse.json({
      id: authUser.id || 0,
      name: authUser.name || emailLc.split('@')[0],
      initials,
      role: normaliseRole(authUser.role) || 'member',
      team: null,
      region: null,
      country: null,
      leadId: null,
      email: emailLc,
      avatarUrl: null,
      isActive: true,
      createdAt: null,
      updatedAt: null,
    });
  } catch (err) {
    console.error('[me]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
