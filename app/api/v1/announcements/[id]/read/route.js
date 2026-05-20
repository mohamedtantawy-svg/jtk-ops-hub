import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { getCurrentDeptId } from '../../../../../../src/lib/dept-scope';

export async function POST(req, { params }) {
  try {
    const user = getAuthUser(req);
    const email = (user.email || '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Phase 11i (2026-05-20): dept-scope the existence check so a user
    // can't ack a cross-dept announcement by guessing its UUID. 410 keeps
    // the FE behavior aligned with the original "announcement no longer
    // exists" path (drop the popup, stop retrying) — from the caller's
    // perspective, an announcement in another tenant is indistinguishable
    // from one that's been deleted.
    const currentDeptId = await getCurrentDeptId(user, req);
    if (!currentDeptId) {
      return NextResponse.json({ error: 'Announcement not found', code: 'gone' }, { status: 410 });
    }
    const exists = await query(
      'SELECT 1 FROM announcements WHERE id = $1 AND org_node_id = $2 LIMIT 1',
      [id, currentDeptId]
    );
    if (exists.rowCount === 0) {
      return NextResponse.json(
        { error: 'Announcement not found', code: 'gone' },
        { status: 410 }
      );
    }

    // Resolve the caller's members.id best-effort — it's a nice-to-have for
    // historical reporting, but user_email is the canonical identity for
    // acks (see the migration comment in migrate.js). If we can't resolve an
    // id — the common case for override-only users whose JWT sub=0 — we
    // persist user_id=NULL rather than 400'ing the way we used to. The ack
    // still lands; the frontend matches by email; the tracker counts them.
    let userId = user.id ? Number(user.id) : null;
    if (!userId || userId === 0) {
      try {
        const r = await query(
          'SELECT id FROM members WHERE LOWER(email) = $1 LIMIT 1',
          [email]
        );
        userId = r.rows[0]?.id || null;
      } catch (_) { /* DB blip — proceed with null id */ }
    }

    // Source of truth: announcement_acks table. Idempotent via the PK on
    // (announcement_id, user_email) — a retrying client or the drain loop
    // in useAnnouncements can re-POST safely.
    await query(
      `INSERT INTO announcement_acks (announcement_id, user_id, user_email)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [id, userId, email]
    );

    await query('UPDATE announcements SET updated_at = NOW() WHERE id = $1', [id]);

    // Return canonical acks from announcement_acks (source of truth). We
    // surface BOTH user_ids (legacy, nullable) and lowercased emails so the
    // frontend can keep matching either way while we migrate callers.
    const acksResult = await query(
      `SELECT ARRAY_AGG(user_id) AS user_ids,
              ARRAY_AGG(LOWER(user_email)) AS user_emails
         FROM announcement_acks
        WHERE announcement_id = $1`,
      [id]
    );
    const acks = (acksResult.rows[0]?.user_ids || []).map(Number).filter(Boolean);
    const ackEmails = (acksResult.rows[0]?.user_emails || []).filter(Boolean);

    return NextResponse.json({
      ok: true,
      acks,
      ackEmails,
      userId,
      userEmail: email,
    });
  } catch (err) {
    console.error('[announcements/read]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
