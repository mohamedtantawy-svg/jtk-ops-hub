// ── /api/v1/org/audit (Phase 7, 2026-05-20) ────────────────────────────────
// GET — paginated audit log read. Filters: action, actor email, target id,
// since timestamp. Open to global org-admins only; delegated team-admins
// don't read the global feed (they'd see entries outside their subtree).

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { canManageOrgGlobal } from '../../../../../src/lib/org-admin';

const MAX_LIMIT = 200;

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageOrgGlobal(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const actor = searchParams.get('actor');
  const targetId = searchParams.get('target');
  const since = searchParams.get('since');
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit') || 50)));

  const conditions = [];
  const values = [];
  let i = 1;
  if (action) { conditions.push(`action = $${i++}`); values.push(action); }
  if (actor)  { conditions.push(`LOWER(actor_email) = $${i++}`); values.push(actor.toLowerCase()); }
  if (targetId) { conditions.push(`target_id = $${i++}`); values.push(targetId); }
  if (since) { conditions.push(`created_at >= $${i++}`); values.push(since); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await query(
      `SELECT id, actor_email, action, target_kind, target_id,
              before_json, after_json, metadata, created_at
         FROM org_audit
         ${where}
         ORDER BY id DESC
         LIMIT ${limit}`,
      values,
    );
    return NextResponse.json({
      entries: rows.map(r => ({
        id: r.id,
        actorEmail: r.actor_email,
        action: r.action,
        targetKind: r.target_kind,
        targetId: r.target_id,
        before: r.before_json,
        after: r.after_json,
        metadata: r.metadata,
        createdAt: r.created_at,
      })),
      limit,
    });
  } catch (err) {
    console.error('[org/audit GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
