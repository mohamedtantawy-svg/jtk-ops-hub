// ── /api/v1/queue/source-reassign ───────────────────────────────────────────
// Override-layer reassignments for the four Deel-source queues that don't
// support upstream re-routing: onboarding, amendments, redlines, incentive
// plans. Stores (source, task_id, assignee_email) so the GET endpoints for
// those sources can overlay the new assignee on the row before scoping.
//
// POST body: { source, taskId, taskUrl?, taskSubject?, taskCountry?,
//              assigneeEmail, assigneeName?,
//              originalAssigneeEmail?, originalAssigneeName? }
// PUT  body (clear): { source, taskId, assigneeEmail: null }
// GET  ?source=... → list current reassignments (visible to every authed user)
//
// Role gate: any authenticated @deel.com user. The role-restricted version
// (admin/RM/TL only) was opened up 2026-05-07 per HR ops feedback —
// agents need to reassign their own cases without round-tripping through
// a TL. Persistence is unaffected: every override is stored in the
// queue_reassignments table and overlaid via applyReassignments AFTER
// each upstream sync, so reassignments survive sync cycles indefinitely.
// Target validation still requires a known active member in the directory.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { MEMBERS_BY_EMAIL } from '../../../../../src/data/members';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import {
  ALLOWED_REASSIGN_SOURCES,
  isReassignableSource,
  bumpVersion,
} from '../../../../../src/lib/queue-reassignments';

// Dot-segmented regex with non-overlapping character classes to dodge
// js/polynomial-redos: `[^\s@.]+` cannot match a dot, so the literal `@`
// and `\.` boundaries leave the engine exactly one way to slice a given
// string — no ambiguous backtracking on inputs like `!@!.!.!.!.!.`. We
// also gate by length (RFC 5321 caps emails at 254 chars) so any
// pathological input is dropped before the regex runs at all.
const EMAIL_MAX_LEN = 254;
const EMAIL_RE = /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/;

function normSource(s) {
  return String(s || '').toLowerCase().trim();
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  const { searchParams } = new URL(req.url);
  const source = normSource(searchParams.get('source'));

  try {
    const filterParams = [];
    let where = '';
    if (source) {
      where = 'WHERE task_source = $1';
      filterParams.push(source);
    }
    const { rows } = await query(
      `SELECT task_source, task_id, task_url, task_subject, task_country,
              original_assignee_email, original_assignee_name,
              assignee_email, assignee_name,
              reassigned_by_email, reassigned_by_name,
              created_at, updated_at
         FROM queue_reassignments
         ${where}
         ORDER BY updated_at DESC
         LIMIT 1000`,
      filterParams,
    );
    // Reassignment rows are not sensitive — they're "this row was routed
    // from X to Y". The hierarchy filter that used to live here was a
    // hangover from the role-gated era; with all roles able to reassign
    // it would hide their own outgoing assignments from non-managers.
    const items = rows
      .map(r => ({
        source: r.task_source,
        taskId: r.task_id,
        taskUrl: r.task_url,
        taskSubject: r.task_subject,
        taskCountry: r.task_country,
        originalAssigneeEmail: r.original_assignee_email,
        originalAssigneeName: r.original_assignee_name,
        assigneeEmail: r.assignee_email,
        assigneeName: r.assignee_name,
        reassignedByEmail: r.reassigned_by_email,
        reassignedByName: r.reassigned_by_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[source-reassign GET]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureRosterHydrated();

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const source       = normSource(body.source);
  const taskId       = String(body.taskId || '').trim();
  const taskUrl      = body.taskUrl ? String(body.taskUrl).trim() : null;
  const taskSubject  = body.taskSubject ? String(body.taskSubject).slice(0, 500) : null;
  const taskCountry  = body.taskCountry ? String(body.taskCountry).slice(0, 8) : null;
  const assigneeEmailRaw = body.assigneeEmail;
  const assigneeName = body.assigneeName ? String(body.assigneeName).slice(0, 255) : null;
  const originalAssigneeEmail = body.originalAssigneeEmail ? String(body.originalAssigneeEmail).toLowerCase() : null;
  const originalAssigneeName  = body.originalAssigneeName ? String(body.originalAssigneeName).slice(0, 255) : null;

  if (!source || !isReassignableSource(source)) {
    return NextResponse.json(
      { error: `Invalid source. Allowed: ${[...ALLOWED_REASSIGN_SOURCES].join(', ')}` },
      { status: 400 },
    );
  }
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  // Clear path: assigneeEmail explicitly null → delete the override row so
  // the row reverts to whatever Deel currently says. We deliberately accept
  // an explicit null/empty here so callers can build "Reset to original"
  // affordances on top of the same endpoint.
  const clearing = assigneeEmailRaw === null || assigneeEmailRaw === '' || assigneeEmailRaw === undefined;
  if (clearing) {
    try {
      await query(
        'DELETE FROM queue_reassignments WHERE task_source = $1 AND task_id = $2',
        [source, taskId],
      );
      bumpVersion();
      return NextResponse.json({ ok: true, cleared: true });
    } catch (err) {
      console.error('[source-reassign DELETE]', err.message);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  const assigneeEmail = String(assigneeEmailRaw).toLowerCase().trim();
  if (assigneeEmail.length > EMAIL_MAX_LEN || !EMAIL_RE.test(assigneeEmail)) {
    return NextResponse.json({ error: 'Invalid assigneeEmail' }, { status: 400 });
  }

  // Target must be a known directory member and active. The hierarchy
  // scope check that used to live here was removed 2026-05-07 — every
  // role can now reassign to anyone in the directory. Directory + active
  // checks remain so we still can't park rows on a ghost or deactivated
  // address.
  const target = MEMBERS_BY_EMAIL[assigneeEmail];
  if (!target) {
    return NextResponse.json({ error: 'Assignee not in directory' }, { status: 400 });
  }
  if (target.isDeleted === true) {
    return NextResponse.json({ error: 'Assignee is deactivated' }, { status: 400 });
  }

  try {
    await query(
      `INSERT INTO queue_reassignments (
         task_source, task_id, task_url, task_subject, task_country,
         original_assignee_email, original_assignee_name,
         assignee_email, assignee_name,
         reassigned_by_email, reassigned_by_name
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (task_source, task_id) DO UPDATE
         SET task_url               = COALESCE(EXCLUDED.task_url, queue_reassignments.task_url),
             task_subject           = COALESCE(EXCLUDED.task_subject, queue_reassignments.task_subject),
             task_country           = COALESCE(EXCLUDED.task_country, queue_reassignments.task_country),
             original_assignee_email = COALESCE(queue_reassignments.original_assignee_email, EXCLUDED.original_assignee_email),
             original_assignee_name  = COALESCE(queue_reassignments.original_assignee_name, EXCLUDED.original_assignee_name),
             assignee_email         = EXCLUDED.assignee_email,
             assignee_name          = EXCLUDED.assignee_name,
             reassigned_by_email    = EXCLUDED.reassigned_by_email,
             reassigned_by_name     = EXCLUDED.reassigned_by_name,
             updated_at             = NOW()`,
      [
        source, taskId, taskUrl, taskSubject, taskCountry,
        originalAssigneeEmail, originalAssigneeName,
        assigneeEmail, assigneeName || target.name || null,
        (user.email || '').toLowerCase(), user.name || null,
      ],
    );
    bumpVersion();
    return NextResponse.json({
      ok: true,
      source,
      taskId,
      assigneeEmail,
      assigneeName: assigneeName || target.name || null,
    });
  } catch (err) {
    console.error('[source-reassign POST]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
