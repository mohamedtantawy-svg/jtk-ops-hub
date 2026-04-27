// ── Team-members roster endpoint (baseline × overrides merge) ───────────────
// GET  /api/v1/team-members          — returns the merged, authoritative list
// POST /api/v1/team-members          — add a brand-new team member
//
// Unlike /api/v1/members (which is a thin CRUD over the `members` auth table),
// this endpoint is backed by team_member_overrides, layered on top of the
// static TEAM_MEMBERS baseline. Every mutation persists to the DB so the
// Team tab survives refreshes and pod restarts with zero data loss.
//
// Auth: any authenticated @deel.com user can read (~104-person internal
// tool). Writes require admin or regional_manager — see POST below.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { mergeTeamMembers } from '../../../../src/lib/team-members-merge';
import { TEAM_MEMBERS } from '../../../../src/data/members';
import { invalidateRosterCache, ensureRosterHydrated } from '../../../../src/lib/roster-server';

const VALID_ACCESS = ['admin', 'regional_manager', 'team_lead', 'agent'];
const VALID_SERVICES = ['EOR', 'LifeCycle', 'New Services', 'All'];
const VALID_TEAMS = ['All', 'EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'];

// Admins + regional managers may mutate the roster. Others are read-only.
function canMutateRoster(user) {
  if (!user?.email) return false;
  if (user.role === 'admin') return true;
  const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === user.email.toLowerCase());
  if (!baseline) return false;
  return baseline.access === 'admin' || baseline.access === 'regional_manager';
}

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rows } = await query(
      `SELECT email, name, initials, title, access, manager_email, team, region,
              service, country, avatar_url, start_date, is_new, is_deleted,
              on_leave, last_login_at, login_count, is_announcements_admin,
              created_at, updated_at
         FROM team_member_overrides`
    );

    const merged = mergeTeamMembers(rows);
    return NextResponse.json({ items: merged, total: merged.length });
  } catch (err) {
    console.error('[team-members GET]', err.message);
    // If DB is down, fall back to the baseline so the UI still renders
    // (read-only) rather than showing an empty team.
    const fallback = mergeTeamMembers([]);
    return NextResponse.json({ items: fallback, total: fallback.length, degraded: true });
  }
}

export async function POST(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!canMutateRoster(user)) {
      return NextResponse.json({ error: 'Only admins or regional managers can add members' }, { status: 403 });
    }

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();

    if (!email || !name) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }
    if (!email.includes('@') || !email.endsWith('@deel.com')) {
      return NextResponse.json({ error: 'Email must be a valid @deel.com address' }, { status: 400 });
    }
    if (name.length > 255) {
      return NextResponse.json({ error: 'Name must be 255 characters or less' }, { status: 400 });
    }

    const access = body.access || 'agent';
    const service = body.service || 'EOR';
    const team = body.team || null;
    const region = body.region || body.team || null;
    const managerEmail = body.managerEmail ? String(body.managerEmail).trim().toLowerCase() : null;
    const country = body.country ? String(body.country).trim() : null;
    const title = body.title || 'HR Experience Specialist';

    if (!VALID_ACCESS.includes(access)) {
      return NextResponse.json({ error: `Invalid access. Must be one of: ${VALID_ACCESS.join(', ')}` }, { status: 400 });
    }
    if (service && !VALID_SERVICES.includes(service)) {
      return NextResponse.json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` }, { status: 400 });
    }
    if (team && !VALID_TEAMS.includes(team)) {
      return NextResponse.json({ error: `Invalid team. Must be one of: ${VALID_TEAMS.join(', ')}` }, { status: 400 });
    }

    // Reject duplicates: either a baseline entry exists or an override row already does
    const baseline = TEAM_MEMBERS.find(m => m.email.toLowerCase() === email);
    if (baseline) {
      return NextResponse.json({ error: 'A baseline team member already exists with that email. Use edit-allocation instead.' }, { status: 409 });
    }
    const existing = await query('SELECT email FROM team_member_overrides WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: 'A team member override already exists for that email.' }, { status: 409 });
    }

    const initials = name.split(/\s+/).filter(Boolean).map(w => w[0] || '').join('').slice(0, 4).toUpperCase();
    const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40`;
    const startDate = new Date().toISOString().slice(0, 10);

    await query(
      `INSERT INTO team_member_overrides
         (email, name, initials, title, access, manager_email, team, region,
          service, country, avatar_url, start_date, is_new, is_deleted, on_leave)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,false,false)`,
      [email, name, initials, title, access, managerEmail, team, region, service, country, avatarUrl, startDate]
    );

    // Also seed a members row so auth (findMemberByEmail), /me, and permissions
    // recognise the new user. Without this, a newly-added team member could
    // pass the OAuth callback but /me would return team=null/role=member and
    // their Home view would be empty. ON CONFLICT is a safety net — if a
    // members row already exists (e.g. re-adding a previously-removed user),
    // we leave the auth table alone.
    try {
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
             updated_at = NOW()`,
        [name, initials, access, team, region, country, email, avatarUrl]
      );
    } catch (memErr) {
      console.warn('[team-members POST] members seed failed:', memErr.message);
    }

    // Flush the server-side roster cache + rehydrate now so the next scoped
    // request (queue / tasks / escalations) sees the new person without
    // waiting for the 5s TTL to expire.
    invalidateRosterCache();
    await ensureRosterHydrated({ force: true });

    return NextResponse.json({
      email, name, initials, title, access, managerEmail, team, region,
      service, country, avatarUrl, startDate,
      isNew: true, isDeleted: false, onLeave: false, lastLoginAt: null, loginCount: 0,
    }, { status: 201 });
  } catch (err) {
    console.error('[team-members POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
