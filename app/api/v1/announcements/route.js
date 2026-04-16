import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser, requireRole } from '../../../../src/lib/auth-helpers';

// Server-side audience match — mirrors src/data/comms.js matchesAudience()
function matchesAudience(target, memberTeam) {
  if (!target || target === 'all' || target === 'global') return true;
  const t = String(target).toLowerCase();
  const team = String(memberTeam || '').toLowerCase();
  if (!team) return false;
  if (t === team) return true;
  if (team === 'latam + nam' && (t === 'nam' || t === 'latam' || t === 'americas')) return true;
  if (t === 'americas' && (team === 'nam' || team === 'latam' || team === 'latam + nam')) return true;
  return false;
}

const VALID_TARGETS = ['all','global','emea','apac','americas','nam','latam'];

export async function GET(req) {
  try {
    const user = getAuthUser(req);
    if (!user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const target = searchParams.get('target');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
    const offset = (page - 1) * limit;

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) {
      const statuses = status.split(',');
      whereSql += ` AND status = ANY($${idx++})`;
      params.push(statuses);
    }
    if (target) { whereSql += ` AND target = $${idx++}`; params.push(target); }

    const countSql = 'SELECT COUNT(*) FROM announcements' + whereSql;
    const dataSql = `SELECT id, type, title, body, target, priority, is_popup, image_url, link,
                            status, author_id, pinned, sound_key, sent_at,
                            created_at, updated_at
                       FROM announcements${whereSql}
                      ORDER BY pinned DESC, COALESCE(sent_at, created_at) DESC
                      LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    // Look up caller's info once (team for audience scope, id for author match)
    let callerTeam = null;
    let callerId = user.id ? Number(user.id) : null;
    if (user.role !== 'admin' || !callerId) {
      const r = await query('SELECT id, team FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [user.email]);
      callerTeam = r.rows[0]?.team || null;
      if (!callerId) callerId = r.rows[0]?.id || null;
    }

    const [{ rows }, countResult] = await Promise.all([
      query(dataSql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    // Filter by audience server-side (admin sees everything unfiltered).
    // Always include announcements authored by the caller regardless of target.
    const filtered = user.role === 'admin'
      ? rows
      : rows.filter(r =>
          (callerId && r.author_id === callerId) || matchesAudience(r.target, callerTeam)
        );

    // Read canonical acks from announcement_acks table (source of truth)
    const announcementIds = filtered.map(r => r.id);
    let acksMap = {};
    if (announcementIds.length > 0) {
      const acksResult = await query(
        'SELECT announcement_id, ARRAY_AGG(user_id) AS user_ids FROM announcement_acks WHERE announcement_id = ANY($1) GROUP BY announcement_id',
        [announcementIds]
      );
      for (const row of acksResult.rows) {
        acksMap[row.announcement_id] = row.user_ids.map(Number);
      }
    }

    const items = filtered.map(r => ({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      acks: acksMap[r.id] || [],
      soundKey: r.sound_key || 'chime',
      sentAt: r.sent_at,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));

    const total = parseInt(countResult.rows[0].count, 10);
    return NextResponse.json({ items, page, limit, total });
  } catch (err) {
    console.error('[announcements GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { authorized, user, status, error } = requireRole(req, 'admin', 'regional_manager', 'manager', 'team_lead');
    if (!authorized) return NextResponse.json({ error }, { status });

    const { type, title, body, target, priority, isPopup, imageUrl, link, soundKey } = await req.json();
    if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 });

    const normalizedTarget = (target || 'all').toLowerCase();
    if (!VALID_TARGETS.includes(normalizedTarget)) {
      return NextResponse.json({ error: `Invalid target. Must be one of: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
    }

    const { rows } = await query(
      `INSERT INTO announcements
         (type, title, body, target, priority, is_popup, image_url, link, author_id, sound_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        type || 'info',
        title,
        body || '',
        normalizedTarget,
        priority || 'normal',
        isPopup || false,
        imageUrl || null,
        link || null,
        user?.id || null,
        soundKey || 'chime',
      ]
    );

    const r = rows[0];
    return NextResponse.json({
      id: r.id, type: r.type, title: r.title, body: r.body,
      target: r.target, priority: r.priority, isPopup: r.is_popup,
      imageUrl: r.image_url, link: r.link, status: r.status,
      authorId: r.author_id, pinned: r.pinned,
      acks: [],
      soundKey: r.sound_key || 'chime',
      sentAt: r.sent_at,
      createdAt: r.created_at,
    }, { status: 201 });
  } catch (err) {
    console.error('[announcements POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
