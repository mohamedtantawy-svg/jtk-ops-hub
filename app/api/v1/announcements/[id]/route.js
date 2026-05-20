import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageAnnouncements, canArchiveAnnouncements } from '../../../../../src/lib/announcements-admin';
import { getCurrentDeptId } from '../../../../../src/lib/dept-scope';

export async function GET(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // Phase 11b: filter by current dept so cross-tenant reads 404 instead
    // of leaking. NULL org_node_id post-backfill should never happen, but
    // we 404 those too rather than guess.
    const currentDeptId = await getCurrentDeptId(user, req);
    if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { rows } = await query(
      `SELECT id, type, title, body, target, priority, is_popup, image_url, link,
              status, author_id, pinned, sound_key, sent_at, created_at, updated_at
         FROM announcements WHERE id = $1 AND org_node_id = $2`,
      [id, currentDeptId],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = rows[0];

    // Read canonical acks from announcement_acks table (source of truth).
    // Return BOTH user_ids and lowercased emails — the frontend prefers
    // email-based matching (drift-proof vs MEMBERS-array / DB id collisions).
    const acksResult = await query(
      `SELECT ARRAY_AGG(user_id) AS user_ids,
              ARRAY_AGG(LOWER(user_email)) AS user_emails
         FROM announcement_acks
        WHERE announcement_id = $1`,
      [id]
    );
    const acks = acksResult.rows[0]?.user_ids?.map(Number) || [];
    const ackEmails = (acksResult.rows[0]?.user_emails || []).filter(Boolean);

    return NextResponse.json({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      acks,
      ackEmails,
      soundKey: r.sound_key || 'chime',
      sentAt: r.sent_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error('[announcements/id GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Only admins/managers — or per-user announcements admins — can edit
    // announcements.
    if (!(await canManageAnnouncements(user))) {
      return NextResponse.json({ error: 'Only managers can edit announcements' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    // Archiving is reserved for Regional Managers, Directors, or per-user
    // announcements admins (Team Leads excluded). Team Leads can edit other
    // fields but cannot toggle the archived state.
    if (body.status === 'archived' && !(await canArchiveAnnouncements(user))) {
      return NextResponse.json({ error: 'Only Regional Managers, Directors, or announcements admins can archive announcements' }, { status: 403 });
    }

    // Enum validation — kept in lockstep with POST + compose UI
    const VALID_TYPES = ['info', 'alert', 'announce', 'celebration', 'policy', 'update', 'guidance', 'kudos', 'general'];
    const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical', 'normal'];
    const VALID_STATUSES = ['draft', 'published', 'sent', 'archived'];
    const VALID_TARGETS = ['all','global','emea','apac','americas','nam','latam'];
    const VALID_SOUNDS = ['chime','alert','kudos','none'];

    if (body.target) body.target = String(body.target).toLowerCase();

    if (body.type && !VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      return NextResponse.json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    if (body.target && !VALID_TARGETS.includes(body.target)) {
      return NextResponse.json({ error: `Invalid target. Must be one of: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
    }
    if (body.soundKey && !VALID_SOUNDS.includes(body.soundKey)) {
      return NextResponse.json({ error: `Invalid soundKey. Must be one of: ${VALID_SOUNDS.join(', ')}` }, { status: 400 });
    }

    const allowed = ['type', 'title', 'body', 'target', 'priority', 'is_popup', 'image_url', 'link', 'status', 'pinned', 'sound_key'];
    const sets = [];
    const vals = [];
    let idx = 1;

    for (const [key, val] of Object.entries(body)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowed.includes(col)) {
        sets.push(`${col} = $${idx++}`);
        vals.push(val);
      }
    }

    if (sets.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    sets.push('updated_at = NOW()');
    vals.push(id);
    // Phase 11b: refuse to edit announcements from a different dept.
    const currentDeptId = await getCurrentDeptId(user, req);
    if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    vals.push(currentDeptId);

    const { rows } = await query(
      `UPDATE announcements SET ${sets.join(', ')} WHERE id = $${idx} AND org_node_id = $${idx + 1} RETURNING *`,
      vals
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[announcements/id PATCH]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Only admins or per-user announcements admins can delete announcements.
    // Per-user grants extend the destroy privilege without granting full
    // app-wide admin elsewhere.
    const { canDeleteAnnouncements } = await import('../../../../../src/lib/announcements-admin');
    if (!(await canDeleteAnnouncements(user))) {
      return NextResponse.json({ error: 'Only admins or announcements admins can delete announcements' }, { status: 403 });
    }

    const { id } = await params;
    // Phase 11b: refuse to delete announcements from a different dept.
    const currentDeptId = await getCurrentDeptId(user, req);
    if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Hard delete — announcement_acks, comments, reactions, links all cascade
    // via ON DELETE CASCADE on their FKs. No orphan rows left behind.
    const delRes = await query(
      'DELETE FROM announcements WHERE id = $1 AND org_node_id = $2',
      [id, currentDeptId],
    );
    if (!delRes.rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[announcements/id DELETE]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
