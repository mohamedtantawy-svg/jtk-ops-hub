// ── /api/v1/leader-alerts/alerts/[id] ────────────────────────────────────
// GET    — single alert + first 50 comments + ack list (paginated separately
//          via /acks if needed) + recent log (50 entries).
// PATCH  — update status / severity / category / title / body / impact_tags
//          / links / attachments. Logs each change. Notifies followers on
//          status changes per the policy.
// DELETE — soft delete (sets resolved_at + status='resolved'); permanent
//          delete reserved for Alerts Admin only (TODO Stage 5).

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { query, withTransaction } from '../../../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../../../src/lib/roster-server';
import { getCurrentDeptId } from '../../../../../../src/lib/dept-scope';
import {
  ALLOWED_STATUSES,
  ALLOWED_SEVERITIES,
  clean,
  sanitiseLinks,
  sanitiseAttachments,
  sanitiseImpactTags,
  writeLog,
  writeNotifications,
  listFollowerEmails,
  readAllSettings,
  canAdministerLeaderAlerts,
} from '../../../../../../src/lib/leader-alerts-helpers';

export async function GET(_req, { params }) {
  const user = getAuthUser(_req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();
  const { id } = await params;

  // Phase 11d (2026-05-20): 404 cross-dept reads.
  const currentDeptId = await getCurrentDeptId(user, _req);
  if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const { rows: alertRows } = await query(
      `SELECT a.*,
        (SELECT COUNT(*)::int FROM leader_alert_ack ack WHERE ack.alert_id = a.id) AS ack_count,
        EXISTS(SELECT 1 FROM leader_alert_ack ack WHERE ack.alert_id = a.id AND LOWER(ack.email) = $2) AS i_acked
      FROM leader_alert a
      WHERE a.id = $1 AND a.org_node_id = $3`,
      [id, user.email.toLowerCase(), currentDeptId],
    );
    if (alertRows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const alert = alertRows[0];

    const [acks, comments, followers, log] = await Promise.all([
      query(
        `SELECT email, name, created_at FROM leader_alert_ack WHERE alert_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [id],
      ),
      query(
        `SELECT c.id, c.parent_comment_id, c.author_email, c.author_name, c.body,
                c.mention_emails, c.attachments, c.created_at, c.edited_at, c.deleted_at,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                    'emoji', r.emoji,
                    'email', r.email
                  ) ORDER BY r.created_at)
                   FROM leader_alert_comment_reaction r
                   WHERE r.comment_id = c.id),
                  '[]'::json
                ) AS reactions
         FROM leader_alert_comment c
         WHERE c.alert_id = $1
         ORDER BY c.created_at ASC
         LIMIT 50`,
        [id],
      ),
      query(
        `SELECT email, source, muted, created_at FROM leader_alert_follower WHERE alert_id = $1`,
        [id],
      ),
      query(
        `SELECT id, actor_email, actor_name, event_type, before_json, after_json, created_at
         FROM leader_alert_log
         WHERE alert_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [id],
      ),
    ]);

    return NextResponse.json({
      alert,
      acks: acks.rows,
      comments: comments.rows,
      followers: followers.rows,
      log: log.rows,
    });
  } catch (err) {
    console.error('[leader-alerts.get]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();
  const { id } = await params;

  let payload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Phase 11d: refuse cross-dept edits.
  const currentDeptId = await getCurrentDeptId(user, req);
  if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const { rows: existingRows } = await query(
      `SELECT * FROM leader_alert WHERE id = $1 AND org_node_id = $2`,
      [id, currentDeptId],
    );
    if (existingRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const existing = existingRows[0];

    // Authorisation (2026-05-22 — Olga Pastuszak "Can't change the
    // Leader's Alert status when submitted by Others"):
    //   • Meta fields (severity / category / title / body / impact_tags /
    //     links / attachments) — creator OR Alerts Admin only. Keeps the
    //     original "Stage 1" intent: a wrong click can't reword someone
    //     else's alert.
    //   • Status — open to any signed-in user in the same dept. The
    //     org_node_id check above already verified dept membership, so
    //     this only widens within the visible scope. Every change is
    //     logged in leader_alert_log with the actor's email, so accidental
    //     transitions stay traceable and reversible.
    // Olga's specific case: her manager filed an alert, she needs to mark
    // it "In Progress" while she works on the underlying issue. Pre-fix
    // the button was disabled for her even though she could see the row.
    const isAdmin = await canAdministerLeaderAlerts(user);
    const isCreator = (existing.created_by_email || '').toLowerCase() === user.email.toLowerCase();
    const META_FIELDS = ['severity', 'category', 'title', 'body', 'impact_tags', 'links', 'attachments'];
    const isMutatingMeta = META_FIELDS.some(k => payload[k] !== undefined);
    if (isMutatingMeta && !isAdmin && !isCreator) {
      return NextResponse.json({ error: 'Only the creator or an Alerts Admin can edit this alert\'s severity, category, title, body, tags, links or attachments' }, { status: 403 });
    }

    const sets = [];
    const vals = [];
    const before = {};
    const after = {};
    let p = 1;

    if (payload.status !== undefined) {
      if (!ALLOWED_STATUSES.has(payload.status)) {
        return NextResponse.json({ error: `Invalid status: ${payload.status}` }, { status: 400 });
      }
      if (payload.status !== existing.status) {
        sets.push(`status = $${p++}`); vals.push(payload.status);
        before.status = existing.status; after.status = payload.status;
        if (payload.status === 'resolved') {
          sets.push(`resolved_at = NOW()`);
        } else if (existing.status === 'resolved') {
          sets.push(`resolved_at = NULL`);
        }
      }
    }
    if (payload.severity !== undefined) {
      if (!ALLOWED_SEVERITIES.has(payload.severity)) {
        return NextResponse.json({ error: `Invalid severity: ${payload.severity}` }, { status: 400 });
      }
      if (payload.severity !== existing.severity) {
        sets.push(`severity = $${p++}`); vals.push(payload.severity);
        before.severity = existing.severity; after.severity = payload.severity;
      }
    }
    if (payload.category !== undefined) {
      const c = clean(payload.category, 80);
      if (!c) return NextResponse.json({ error: 'category cannot be empty' }, { status: 400 });
      if (c !== existing.category) {
        sets.push(`category = $${p++}`); vals.push(c);
        before.category = existing.category; after.category = c;
      }
    }
    if (payload.title !== undefined) {
      const t = clean(payload.title, 300);
      if (!t) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
      if (t !== existing.title) {
        sets.push(`title = $${p++}`); vals.push(t);
        before.title = existing.title; after.title = t;
      }
    }
    if (payload.body !== undefined) {
      const b = clean(payload.body, 50_000);
      if (!b) return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 });
      if (b !== existing.body) {
        sets.push(`body = $${p++}`); vals.push(b);
        before.body = (existing.body || '').slice(0, 200); after.body = b.slice(0, 200);
      }
    }
    if (payload.impact_tags !== undefined) {
      const tags = sanitiseImpactTags(payload.impact_tags);
      if (tags.length === 0) return NextResponse.json({ error: 'at least one impact tag required' }, { status: 400 });
      sets.push(`impact_tags = $${p++}::text[]`); vals.push(tags);
      before.impact_tags = existing.impact_tags; after.impact_tags = tags;
    }
    if (payload.links !== undefined) {
      const links = sanitiseLinks(payload.links);
      sets.push(`links = $${p++}::jsonb`); vals.push(JSON.stringify(links));
    }
    if (payload.attachments !== undefined) {
      let attachments;
      try { attachments = sanitiseAttachments(payload.attachments); }
      catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 400 }); }
      sets.push(`attachments = $${p++}::jsonb`); vals.push(JSON.stringify(attachments));
    }

    if (sets.length === 0) {
      return NextResponse.json({ alert: existing, noop: true });
    }

    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE leader_alert SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
        vals,
      );
      const row = rows[0];

      // One log entry per kind of change so the audit timeline is readable.
      const eventType = before.status ? 'status_change'
        : before.severity ? 'severity_change'
        : before.category ? 'category_change'
        : 'field_edit';
      await writeLog(id, { email: user.email, name: user.name }, eventType, before, after, client);

      return row;
    });

    // Status-change notifications (followers + creator + commenters).
    if (after.status) {
      try {
        const settings = await readAllSettings();
        const policy = settings.notifications || {};
        if (policy.statusChangeBell !== false) {
          const followers = await listFollowerEmails(id, { excludeMuted: true });
          await writeNotifications({
            recipients: followers,
            excludeEmail: user.email,
            type: 'status_change',
            title: `Status changed to ${after.status.replace('_', ' ')}`,
            body: updated.title,
            alertId: id,
            sourceType: 'leader_alert_status_change',
            sourceId: id,
            actor: { email: user.email, name: user.name },
          });
        }
      } catch (err) {
        console.warn('[leader-alerts.patch] status notify failed:', err.message);
      }
    }

    return NextResponse.json({ alert: updated });
  } catch (err) {
    console.error('[leader-alerts.patch]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  const user = getAuthUser(_req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = await canAdministerLeaderAlerts(user);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Only an Alerts Admin can delete alerts' }, { status: 403 });
  }

  const { id } = await params;
  // Phase 11d: refuse cross-dept deletes.
  const currentDeptId = await getCurrentDeptId(user, _req);
  if (!currentDeptId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { rowCount } = await query(
      `DELETE FROM leader_alert WHERE id = $1 AND org_node_id = $2`,
      [id, currentDeptId],
    );
    if (rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[leader-alerts.delete]', err.message);
    return NextResponse.json({ error: 'Internal error', detail: err.message }, { status: 500 });
  }
}
