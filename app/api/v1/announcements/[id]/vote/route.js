// ── POST /api/v1/announcements/[id]/vote ────────────────────────────────────
// Cast (or change / clear) the caller's vote on an announcement's poll.
// Body: { optionIds: string[] }  — the option id(s) the caller is voting for.
//   • Single-choice poll  → at most one id (a second id is a 400).
//   • Multiple-choice poll → any subset of the poll's options.
//   • Empty array          → clears the caller's vote (revert).
//
// The whole thing mirrors the ack route (/[id]/read): dept-scope the
// existence check so a poll in another tenant is indistinguishable from a
// deleted one (410 'gone'), then replace the caller's votes atomically. Votes
// live in announcement_poll_votes (PK = announcement_id, option_id,
// user_email) so a retry is idempotent and tallying is a cheap GROUP BY.
import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../../src/lib/dept-scope';

// Aggregate the poll's votes for ONE announcement: per-option counts, the
// caller's own selections, and the distinct voter total (a multi-select voter
// is one person even across several options). Shared by POST's response so the
// FE reconciles to the exact same shape the list endpoint returns.
async function tallyFor(announcementId, callerEmailLc) {
  const [perOption, voters] = await Promise.all([
    query(
      `SELECT option_id,
              COUNT(*)::int AS cnt,
              BOOL_OR(LOWER(user_email) = $2) AS mine
         FROM announcement_poll_votes
        WHERE announcement_id = $1
        GROUP BY option_id`,
      [announcementId, callerEmailLc],
    ),
    query(
      `SELECT COUNT(DISTINCT LOWER(user_email))::int AS voters
         FROM announcement_poll_votes
        WHERE announcement_id = $1`,
      [announcementId],
    ),
  ]);
  const tallies = {};
  const myVote = [];
  for (const r of perOption.rows) {
    tallies[r.option_id] = r.cnt;
    if (r.mine) myVote.push(r.option_id);
  }
  return { tallies, myVote, totalVoters: voters.rows[0]?.voters || 0 };
}

export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    const email = (user.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // Dept-scope the existence check (Phase 11i pattern): a poll in another
    // tenant is indistinguishable from one that's been deleted → 410 'gone'.
    const currentDeptId = await getCurrentDeptId(user, req);
    if (!currentDeptId) {
      return NextResponse.json({ error: 'Announcement not found', code: 'gone' }, { status: 410 });
    }
    const { rows } = await query(
      'SELECT poll FROM announcements WHERE id = $1 AND org_node_id = $2 LIMIT 1',
      [id, currentDeptId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Announcement not found', code: 'gone' }, { status: 410 });
    }
    const poll = rows[0].poll;
    if (!poll || !Array.isArray(poll.options) || poll.options.length === 0) {
      return NextResponse.json({ error: 'This announcement has no poll' }, { status: 400 });
    }

    let body;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    // Closed poll → reject new/changed votes (the FE also hides the buttons,
    // but server-side is the enforcement).
    if (poll.closesAt) {
      const closes = Date.parse(poll.closesAt);
      if (Number.isFinite(closes) && Date.now() > closes) {
        return NextResponse.json({ error: 'This poll is closed', code: 'poll_closed' }, { status: 409 });
      }
    }

    // Keep only ids that are real options on this poll.
    const validIds = new Set(poll.options.map(o => o.id));
    const requested = Array.isArray(body.optionIds) ? body.optionIds : [];
    const chosen = [...new Set(requested.map(String).filter(o => validIds.has(o)))];

    if (!poll.allowMultiple && chosen.length > 1) {
      return NextResponse.json({ error: 'This poll only allows one answer' }, { status: 400 });
    }

    // Best-effort members.id resolution (nice-to-have for reporting; email is
    // the canonical identity — same as the ack route).
    let userId = user.id ? Number(user.id) : null;
    if (!userId || userId === 0) {
      try {
        const r = await query('SELECT id FROM members WHERE LOWER(email) = $1 LIMIT 1', [email]);
        userId = r.rows[0]?.id || null;
      } catch (_) { /* DB blip — proceed with null id */ }
    }

    // Replace the caller's votes atomically: clear their prior picks, then
    // insert the new set. Empty `chosen` just clears (revert / undo a vote).
    await withTransaction(async (client) => {
      await client.query(
        'DELETE FROM announcement_poll_votes WHERE announcement_id = $1 AND LOWER(user_email) = $2',
        [id, email],
      );
      for (const optionId of chosen) {
        await client.query(
          `INSERT INTO announcement_poll_votes (announcement_id, option_id, user_email, user_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [id, optionId, email, userId],
        );
      }
    });

    const result = await tallyFor(id, email);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[announcements/vote]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
