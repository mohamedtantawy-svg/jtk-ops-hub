import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Resolve user.id — the JWT's `sub` claim is the primary source, but we
    // ALWAYS cross-check against the DB by email. Rationale: if a stale token
    // was issued before a members table re-seed, the sub claim can point at a
    // deleted or reassigned id. Trusting the DB id here means the ack lands on
    // the row the UI will later compare against — no silent mismatches.
    let userId = null;
    if (user.email) {
      const r = await query('SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [user.email]);
      userId = r.rows[0]?.id || null;
    }
    if (!userId && user.id) userId = Number(user.id); // final fallback to JWT
    if (!userId) {
      return NextResponse.json({ error: 'Could not resolve user id' }, { status: 400 });
    }

    // Source of truth: announcement_acks table. Preserved forever.
    await query(
      `INSERT INTO announcement_acks (announcement_id, user_id, user_email)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [id, userId, user.email]
    );

    // Update timestamp
    await query('UPDATE announcements SET updated_at = NOW() WHERE id = $1', [id]);

    // Return canonical acks from announcement_acks table (source of truth).
    // Return both user_ids and emails — frontend prefers email matching because
    // the static MEMBERS array id is an array position index that can drift
    // from DB members.id. Emails are stable and drift-proof.
    const acksResult = await query(
      `SELECT ARRAY_AGG(user_id) AS user_ids,
              ARRAY_AGG(LOWER(user_email)) AS user_emails
         FROM announcement_acks
        WHERE announcement_id = $1`,
      [id]
    );
    const acks = (acksResult.rows[0]?.user_ids || []).map(Number).filter(Boolean);
    const ackEmails = (acksResult.rows[0]?.user_emails || []).filter(Boolean);

    // Return the resolved userId + userEmail so the frontend can update its
    // local "who acked" state using the canonical identity, without relying on
    // a possibly-stale id in memory. Fixes popup-reappearing bug.
    return NextResponse.json({
      ok: true,
      acks,
      ackEmails,
      userId,
      userEmail: (user.email || '').toLowerCase(),
    });
  } catch (err) {
    console.error('[announcements/read]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
