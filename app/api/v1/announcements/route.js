import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { isApprover } from '../../../../src/data/approvers';
import { isAnnouncementsAdmin, canManageAnnouncements } from '../../../../src/lib/announcements-admin';
import { MEMBERS_BY_EMAIL } from '../../../../src/data/members';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { getCurrentDeptId } from '../../../../src/lib/dept-scope';
import {
  VALID_TARGETS,
  publishFromRequest,
  normalizePayload,
  promoteDueScheduled,
} from '../../../../src/lib/announcementFlow';

// Resolve a caller's scoping profile — their members.id and team — from any
// of the three identity sources, in order of freshness:
//   1. team_member_overrides (DB) — authoritative for override-only users
//      and for anyone whose team was re-assigned via the Team tab.
//   2. members (DB) — the 20-row seed baseline. Has a real id, useful for
//      legacy reporting that still keys off numeric ids.
//   3. TEAM_MEMBERS baseline (static JS) — the 104-person roster shipped
//      with the bundle. Catches everyone the DB doesn't know about yet.
//
// Without all three, non-seed users (most of the 104-person roster) saw
// callerTeam=null, which made matchesAudience() drop every region-targeted
// announcement — the "some users see no banners" bug.
async function resolveCallerProfile(email) {
  const emailLc = String(email || '').trim().toLowerCase();
  if (!emailLc) return { id: null, team: null, access: null };

  let id = null;
  let team = null;
  let access = null;
  try {
    const { rows } = await query(
      `SELECT m.id AS member_id, m.team AS member_team, o.team AS override_team,
              m.access AS member_access, o.access AS override_access
         FROM (SELECT $1::text AS email) c
         LEFT JOIN members m ON LOWER(m.email) = c.email
         LEFT JOIN team_member_overrides o ON LOWER(o.email) = c.email`,
      [emailLc]
    );
    if (rows.length > 0) {
      id = rows[0].member_id || null;
      team = rows[0].override_team || rows[0].member_team || null;
      access = rows[0].override_access || rows[0].member_access || null;
    }
  } catch (_) { /* DB blip — fall through to static baseline */ }

  if (!team || !access) {
    const baseline = MEMBERS_BY_EMAIL[emailLc];
    if (baseline) {
      if (!team) team = baseline.team || null;
      if (!access) access = baseline.access || null;
    }
  }
  return { id, team, access };
}

const LEADER_ACCESS = new Set(['team_lead', 'regional_manager', 'admin']);

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Hydrate so resolveCallerProfile()'s MEMBERS_BY_EMAIL baseline fallback
    // sees Team-tab-added members. Without this, a freshly-added member whose
    // override row has team=null AND who isn't in TEAM_MEMBERS would resolve
    // to callerTeam=null, dropping every region-targeted announcement from
    // their feed.
    await ensureRosterHydrated();

    // Lazy-promote any scheduled rows whose time has arrived.
    await promoteDueScheduled();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const target = searchParams.get('target');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    // Resolve caller's profile up-front — we need team + id to build the
    // audience filter into the SQL WHERE (see below).
    const profile = await resolveCallerProfile(user.email);
    let callerTeam = profile.team;
    let callerId = profile.id || (user.id && Number(user.id) > 0 ? Number(user.id) : null);
    const callerAccess = String(profile.access || user.role || '').toLowerCase();
    const callerIsLeader = LEADER_ACCESS.has(callerAccess);
    const callerEmailLc = String(user.email).toLowerCase();

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    // Phase 11b (2026-05-20): hard dept isolation. Every read scopes to the
    // caller's currentDeptId (super-admin's cookie wins if set; everyone
    // else resolves to their own top-level dept). HRX-no-impact: after the
    // Phase 11a backfill every existing announcement has org_node_id = HRX,
    // so HRX agents resolve to HRX and see exactly today's feed. New depts
    // start empty.
    const currentDeptId = await getCurrentDeptId(user, req);
    if (currentDeptId) {
      whereSql += ` AND org_node_id = $${idx++}`;
      params.push(currentDeptId);
    } else {
      // No dept resolvable → user has no top-level org placement → see nothing.
      // This is the safe failure mode (deny rather than leak).
      whereSql += ` AND 1=0`;
    }

    if (status) {
      const statuses = status.split(',');
      whereSql += ` AND status = ANY($${idx++})`;
      params.push(statuses);
    } else {
      // Default: hide scheduled rows from the audience feed. Approvers can
      // opt in via ?status=scheduled on the Approval Queue.
      whereSql += ` AND status <> 'scheduled'`;
    }
    if (target) { whereSql += ` AND target = $${idx++}`; params.push(target); }

    // Push the audience gate into SQL for non-admins. Previously this ran in
    // JS after LIMIT/OFFSET, which meant a non-admin's page of 100 could
    // return <100 rows AND `total` over-counted (it reflected the unfiltered
    // set). Now count + pagination operate on the audience-filtered set so
    // the UI never shows a phantom "page 5 of 10" that can't actually be
    // reached. Admins (and per-user announcements admins) bypass — they
    // see everything for moderation. Authors always see their own
    // announcements regardless of target.
    const isAnnAdmin = await isAnnouncementsAdmin(user.email);
    if (user.role !== 'admin' && !isAnnAdmin) {
      const audienceClauses = [
        `(target IS NULL OR target = 'all' OR target = 'global')`,
      ];
      if (callerTeam) {
        const teamLc = String(callerTeam).toLowerCase();
        audienceClauses.push(`LOWER(target) = $${idx++}`);
        params.push(teamLc);
        if (teamLc === 'latam + nam') {
          audienceClauses.push(`LOWER(target) IN ('nam', 'latam', 'americas')`);
        }
        if (teamLc === 'nam' || teamLc === 'latam' || teamLc === 'latam + nam') {
          audienceClauses.push(`LOWER(target) = 'americas'`);
        }
      }
      // Leaders rollup — TLs, RMs, Admins all see leaders-only broadcasts.
      if (callerIsLeader) {
        audienceClauses.push(`LOWER(target) = 'leaders'`);
      }
      // Tag-group audience — join via mention_group_member on the
      // group_id stored in target_group_id. NULL target_group_id rows
      // (every region-targeted announcement) trivially fail the EXISTS
      // so this only adds the group-membership branch.
      audienceClauses.push(`(target = 'group' AND target_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM mention_group_member mgm
           WHERE mgm.group_id = announcements.target_group_id
             AND LOWER(mgm.member_email) = $${idx++}
        ))`);
      params.push(callerEmailLc);
      if (callerId) {
        audienceClauses.push(`author_id = $${idx++}`);
        params.push(callerId);
      }
      whereSql += ` AND (${audienceClauses.join(' OR ')})`;
    }

    const countSql = 'SELECT COUNT(*) FROM announcements' + whereSql;
    const dataSql = `SELECT id, type, title, body, target, target_group_id,
                            priority, is_popup, image_url, link,
                            status, author_id, pinned, sound_key, sent_at, scheduled_for,
                            poll,
                            created_at, updated_at
                       FROM announcements${whereSql}
                      ORDER BY pinned DESC, COALESCE(sent_at, created_at) DESC
                      LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    // Audience filtering is now in SQL; keep the result as-is.
    const filtered = rows;

    // Read canonical acks from announcement_acks table (source of truth).
    // We return BOTH user_ids (legacy) AND lowercased emails — the frontend
    // prefers email-based matching because the static MEMBERS array's id is
    // only an array-position index, which can drift from the DB's members.id
    // (re-seeds, deletes, manual inserts). Emails are stable.
    const announcementIds = filtered.map(r => r.id);
    let acksIdMap = {};
    let acksEmailMap = {};
    if (announcementIds.length > 0) {
      const acksResult = await query(
        `SELECT announcement_id,
                ARRAY_AGG(user_id) AS user_ids,
                ARRAY_AGG(LOWER(user_email)) AS user_emails
           FROM announcement_acks
          WHERE announcement_id = ANY($1)
          GROUP BY announcement_id`,
        [announcementIds]
      );
      for (const row of acksResult.rows) {
        acksIdMap[row.announcement_id] = (row.user_ids || []).map(Number);
        acksEmailMap[row.announcement_id] = (row.user_emails || []).filter(Boolean);
      }
    }

    // Poll vote tallies — only for the announcements on this page that carry a
    // poll. Two cheap indexed GROUP BYs: per-option counts (+ whether THIS
    // caller picked each option) and the distinct voter total (a multi-select
    // voter is one person across several options, so we can't just sum counts).
    const pollIds = filtered.filter(r => r.poll).map(r => r.id);
    const pollTallyMap = {};   // announcementId → { optionId: count }
    const pollMineMap = {};     // announcementId → [optionId] the caller chose
    const pollVoterMap = {};    // announcementId → distinct voter count
    if (pollIds.length > 0) {
      const [perOpt, voters] = await Promise.all([
        query(
          `SELECT announcement_id, option_id, COUNT(*)::int AS cnt,
                  BOOL_OR(LOWER(user_email) = $2) AS mine
             FROM announcement_poll_votes
            WHERE announcement_id = ANY($1::uuid[])
            GROUP BY announcement_id, option_id`,
          [pollIds, callerEmailLc],
        ),
        query(
          `SELECT announcement_id, COUNT(DISTINCT LOWER(user_email))::int AS voters
             FROM announcement_poll_votes
            WHERE announcement_id = ANY($1::uuid[])
            GROUP BY announcement_id`,
          [pollIds],
        ),
      ]);
      for (const row of perOpt.rows) {
        if (!pollTallyMap[row.announcement_id]) pollTallyMap[row.announcement_id] = {};
        pollTallyMap[row.announcement_id][row.option_id] = row.cnt;
        if (row.mine) {
          if (!pollMineMap[row.announcement_id]) pollMineMap[row.announcement_id] = [];
          pollMineMap[row.announcement_id].push(row.option_id);
        }
      }
      for (const row of voters.rows) pollVoterMap[row.announcement_id] = row.voters;
    }

    // Hydrate author name + email by looking up members for every distinct
     // author_id in this page. Without this the frontend renders "—" in the
     // AUTHOR column, and — more importantly — the ack-button visibility
     // check can't tell whether the viewer is the author (it compares by
     // email, which wasn't populated). Batch-lookup keeps this O(1) query.
    const authorIds = Array.from(new Set(filtered.map(r => r.author_id).filter(Boolean)));
    const authorMap = {};
    if (authorIds.length > 0) {
      try {
        const ar = await query(
          'SELECT id, name, email FROM members WHERE id = ANY($1)',
          [authorIds]
        );
        for (const row of ar.rows) {
          authorMap[row.id] = { id: row.id, name: row.name, email: (row.email || '').toLowerCase() };
        }
      } catch (e) {
        console.warn('[announcements GET] author lookup failed:', e.message);
      }
    }

    const items = filtered.map(r => ({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, targetGroupId: r.target_group_id || null,
      priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      author: authorMap[r.author_id] || { id: r.author_id, name: '', email: '' },
      acks: acksIdMap[r.id] || [],
      ackEmails: acksEmailMap[r.id] || [],
      soundKey: r.sound_key || 'chime',
      sentAt: r.sent_at,
      scheduledFor: r.scheduled_for,
      // Poll (null on most rows). tallies/myVote/totalVoters are aggregate-
      // only — we never expose WHO voted, so polls are privacy-safe by default.
      poll: r.poll || null,
      pollTallies: pollTallyMap[r.id] || {},
      pollMyVote: pollMineMap[r.id] || [],
      pollTotalVoters: pollVoterMap[r.id] || 0,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    const total = parseInt(countResult.rows[0].count, 10);
    // Expose the caller's canonical DB id AND email so the frontend can match
    // acks by EITHER axis. Email is the durable one; id is preserved for
    // backwards compat with older clients mid-deploy.
    return NextResponse.json({
      items, page, limit, total,
      callerId,
      callerEmail: (user.email || '').toLowerCase(),
    });
  } catch (err) {
    console.error('[announcements GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST /api/v1/announcements — direct publish (bypasses the approval queue).
// Allowed for: admins, regional_managers, managers, team_leads, and anyone
// in the approver roster. Everyone else must go through
// /api/v1/announcement-requests.
//
// Body may include:
//   scheduledFor — ISO timestamp; if set, announcement is created with
//                  status='scheduled' and will lazy-promote to 'sent'
//                  when the time arrives.
//
// 2026-05-14 — `urgentOverride` + `urgentOverrideReason` body fields are
// no longer read. The publishing rate limits they used to bypass were
// removed (Laura Llopis feedback), so the override is redundant.
// Old clients can still send the field; it's ignored.
export async function POST(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Hydrate so role/team checks against MEMBERS_BY_EMAIL see new members
    // (Team-tab-added managers who haven't been bounced through pod boot
    // can still publish from the announcements composer).
    await ensureRosterHydrated();

    const allowedRoles = ['admin', 'regional_manager', 'manager', 'team_lead'];
    const approver = isApprover(user.email);
    const annAdmin = await isAnnouncementsAdmin(user.email);
    if (!approver && !annAdmin && !allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: 'Not allowed to publish directly. Submit via the approval queue.' },
        { status: 403 }
      );
    }

    const raw = await req.json();
    let payload;
    try { payload = normalizePayload(raw); }
    catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }

    const scheduledFor = raw.scheduledFor ? new Date(raw.scheduledFor) : null;
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
    }

    // Phase 11b: every direct publish stamps the actor's currentDeptId so
    // the new announcement is born tenanted. Super-admin's picker decides
    // the destination dept; everyone else writes to their own home dept.
    const orgNodeId = await getCurrentDeptId(user, req);

    const published = await publishFromRequest(
      {
        type: payload.type,
        title: payload.title,
        body: payload.body,
        target: payload.target,
        target_group_id: payload.targetGroupId,
        priority: payload.priority,
        is_popup: payload.isPopup,
        image_url: payload.imageUrl,
        link: payload.link,
        sound_key: payload.soundKey,
        poll: payload.poll,
        requested_by_id: user.id || null,
      },
      {
        sendAt: scheduledFor,
        actor: user,
        orgNodeId,
      }
    );

    return NextResponse.json({
      id: published.id, type: published.type, title: published.title, body: published.body,
      target: published.target, targetGroupId: published.target_group_id || null,
      priority: published.priority, isPopup: published.is_popup,
      imageUrl: published.image_url, link: published.link, status: published.status,
      authorId: published.author_id, pinned: published.pinned,
      acks: [],
      ackEmails: [],
      soundKey: published.sound_key || 'chime',
      sentAt: published.sent_at,
      scheduledFor: published.scheduled_for,
      poll: published.poll || null,
      pollTallies: {},
      pollMyVote: [],
      pollTotalVoters: 0,
      createdAt: published.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[announcements POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Re-export rule helpers for routes that import from here (none currently).
export { VALID_TARGETS };
