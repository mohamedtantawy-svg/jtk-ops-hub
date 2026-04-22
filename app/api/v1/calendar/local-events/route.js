// ── /api/v1/calendar/local-events — local-only calendar items ──────────────
// The "Add to my calendar" button in CalendarView writes here, not to
// Google. Scoped that way because:
//   1. Keeping write scope out of the Google OAuth grant means the consent
//      screen only asks for calendar.readonly — much less scary UI.
//   2. Users explicitly asked for "just a quick item they can add" with no
//      requirement to push back into their Google calendar.
//
// Per-user rows; events are loaded into the same day/week/month views as
// Google events, flagged with source='local' so the UI can render them
// differently (e.g. a 📌 pin icon, or a distinct colour).
//
// GET    → events overlapping [timeMin, timeMax]
// POST   → create a new event. Body: { title, description?, startAt, endAt, color? }
// DELETE → ?id=<uuid> removes one event owned by the caller

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { query } from '../../../../../src/lib/db';

const OWNER_EMAIL = 'mohamed.tantawy@deel.com';

function ownerGate(user) {
  if (!user.email) return { ok: false, status: 401, error: 'Unauthorized' };
  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    return { ok: false, status: 403, error: 'Calendar integration is in limited rollout' };
  }
  return { ok: true };
}

function rowToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    startAt: row.start_at instanceof Date ? row.start_at.toISOString() : row.start_at,
    endAt: row.end_at instanceof Date ? row.end_at.toISOString() : row.end_at,
    color: row.color || 'blue',
    allDay: false,
    attendees: [],
    organizer: null,
    htmlLink: null,
    meetingLink: null,
    status: 'confirmed',
    source: 'local',
  };
}

// Validation caps — keep them sane so a runaway client can't insert huge blobs.
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const ALLOWED_COLORS = new Set(['blue', 'green', 'purple', 'orange', 'red', 'gray']);

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req) {
  const user = getAuthUser(req);
  const gate = ownerGate(user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(req.url);
  const timeMin = url.searchParams.get('timeMin');
  const timeMax = url.searchParams.get('timeMax');

  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: 'timeMin and timeMax required' }, { status: 400 });
  }

  try {
    // Events overlapping the window: start < timeMax AND end > timeMin.
    // Captures all-day events and events straddling the window boundary.
    const { rows } = await query(
      `SELECT id, title, description, start_at, end_at, color
         FROM calendar_local_events
        WHERE user_email = $1
          AND start_at < $3
          AND end_at   > $2
        ORDER BY start_at ASC`,
      [user.email, timeMin, timeMax]
    );
    return NextResponse.json({ events: rows.map(rowToEvent) });
  } catch (err) {
    console.error('[calendar/local-events][GET]', err.message);
    return NextResponse.json({ error: 'Failed to load local events' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req) {
  const user = getAuthUser(req);
  const gate = ownerGate(user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const startAt = body.startAt;
  const endAt = body.endAt;
  const color = body.color && ALLOWED_COLORS.has(body.color) ? body.color : 'blue';

  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 });
  if (title.length > MAX_TITLE) return NextResponse.json({ error: `Title > ${MAX_TITLE} chars` }, { status: 400 });
  if (description.length > MAX_DESCRIPTION) {
    return NextResponse.json({ error: `Description > ${MAX_DESCRIPTION} chars` }, { status: 400 });
  }

  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'Invalid startAt' }, { status: 400 });
  }
  if (!end || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'Invalid endAt' }, { status: 400 });
  }
  if (end <= start) {
    return NextResponse.json({ error: 'endAt must be after startAt' }, { status: 400 });
  }

  try {
    const { rows } = await query(
      `INSERT INTO calendar_local_events (user_email, title, description, start_at, end_at, color)
            VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, description, start_at, end_at, color`,
      [user.email, title, description || null, start, end, color]
    );
    return NextResponse.json({ event: rowToEvent(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[calendar/local-events][POST]', err.message);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE ?id=<uuid>
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(req) {
  const user = getAuthUser(req);
  const gate = ownerGate(user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  try {
    const res = await query(
      // AND user_email ensures a user can only delete their own events even
      // if they guess someone else's UUID.
      `DELETE FROM calendar_local_events WHERE id = $1 AND user_email = $2`,
      [id, user.email]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[calendar/local-events][DELETE]', err.message);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
