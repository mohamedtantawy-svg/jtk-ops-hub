import { NextResponse } from 'next/server';
import { query } from '../../../../../../src/lib/db';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';

// Resolve typed @mention tokens to canonical emails. The FE sends the resolved
// list directly (it ran the picker against the live roster) but we re-validate
// server-side so a malicious client can't fan out notifications to arbitrary
// addresses.
async function validateMentionEmails(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];
  const cleaned = [];
  const seen = new Set();
  for (const raw of rawList) {
    const e = String(raw || '').trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    seen.add(e);
    cleaned.push(e);
  }
  if (cleaned.length === 0) return [];
  // Keep only emails that map to a known member or override row. Anything
  // unrecognised is dropped silently — future roster additions just won't
  // get notified, which is the safe default.
  const { rows } = await query(
    `SELECT LOWER(email) AS email FROM members WHERE LOWER(email) = ANY($1)
     UNION
     SELECT LOWER(email) AS email FROM team_member_overrides WHERE LOWER(email) = ANY($1)`,
    [cleaned]
  );
  const allowed = new Set(rows.map(r => r.email));
  return cleaned.filter(e => allowed.has(e));
}

export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    const [{ rows }, countResult] = await Promise.all([
      query(
        `SELECT id, announcement_id, author_id, author_name, body, parent_id,
                COALESCE(mention_emails, '{}'::text[]) AS mention_emails, created_at
           FROM announcement_comments
          WHERE announcement_id = $1
          ORDER BY created_at ASC
          LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      ),
      query('SELECT COUNT(*) FROM announcement_comments WHERE announcement_id = $1', [id]),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    // Splice emoji reactions onto each comment (Sarah Suge 2026-05-14).
    let reactionMap = new Map();
    if (rows.length > 0) {
      const { fetchReactionsForComments } = await import('../../../../../../src/lib/comment-reactions-helpers');
      reactionMap = await fetchReactionsForComments('announcement', rows.map(c => c.id));
    }
    const items = rows.map(r => ({
      id: r.id, announcementId: r.announcement_id, authorId: r.author_id,
      authorName: r.author_name, body: r.body, parentId: r.parent_id,
      mentionEmails: r.mention_emails || [],
      createdAt: r.created_at,
      reactions: reactionMap.get(String(r.id)) || [],
    }));
    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[comments GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const { body, parentId, mentionEmails: rawMentions } = await req.json();
    if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

    const mentionEmails = await validateMentionEmails(rawMentions || []);

    const { rows } = await query(
      `INSERT INTO announcement_comments
         (announcement_id, body, parent_id, author_name, mention_emails)
       VALUES ($1, $2, $3, $4, $5::text[])
       RETURNING *`,
      [id, body, parentId || null, authUser.name || 'User', mentionEmails]
    );
    const r = rows[0];

    // Fan out a notification per mentioned email (skip self — no point
    // pinging yourself for typing your own name). Best-effort: a notification
    // failure must not roll back the comment, so we swallow per-row errors
    // and log. Title pulls the announcement's title for context so the row
    // in the bell makes sense without expanding it.
    if (mentionEmails.length > 0) {
      try {
        const annRow = await query(
          'SELECT title FROM announcements WHERE id = $1',
          [id]
        );
        const annTitle = annRow.rows[0]?.title || 'Announcement';
        const actorEmailLc = String(authUser.email || '').toLowerCase();
        const actorName = authUser.name || authUser.email || 'Someone';
        const recipients = mentionEmails.filter(e => e !== actorEmailLc);
        if (recipients.length > 0) {
          // Bulk insert via UNNEST keeps this O(1) round trips regardless of
          // how many people were tagged.
          await query(
            `INSERT INTO user_notifications
               (recipient_email, type, title, body, link_view, link_id,
                source_type, source_id, actor_email, actor_name)
             SELECT recipient, 'mention', $1, $2, 'announcements', $3,
                    'announcement_comment', $4, $5, $6
               FROM UNNEST($7::text[]) AS recipient`,
            [
              `${actorName} mentioned you`,
              `On announcement: ${String(annTitle).slice(0, 200)}`,
              String(id),
              String(r.id),
              actorEmailLc,
              actorName,
              recipients,
            ]
          );
        }
      } catch (notifErr) {
        console.error('[comments POST notify]', notifErr.message);
      }
    }

    return NextResponse.json({
      id: r.id, body: r.body, parentId: r.parent_id,
      mentionEmails: r.mention_emails || [],
      createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[comments POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
