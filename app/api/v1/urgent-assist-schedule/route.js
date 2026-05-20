// ── /api/v1/urgent-assist-schedule ──────────────────────────────────────
// HRX Urgent Assist MOC Schedule — managers-only CRUD endpoint.
// One row per calendar date with EMEA / NAM / APAC main+backup slots.
// Mirrors the team's Google Sheet (Duygu Cakalli feedback 2026-05-14:
// "we don't have HRX Urgent Assist MOC Schedule on the Ops hub").
//
// GET:
//   ?from=YYYY-MM-DD   inclusive lower bound (default: today)
//   ?to=YYYY-MM-DD     inclusive upper bound (default: today + 60d)
//   Returns rows sorted by schedule_date ASC.
//
// POST: { scheduleDate, emeaMain{Email,Name}, emeaBackup{Email,Name},
//         namMain..., namBackup..., apacMain..., apacBackup..., notes }
//   UPSERTs on schedule_date so an admin re-saving the same day overwrites
//   in place — no duplicate-date errors.
//
// Permission gate matches the view: managers only (team_lead /
// regional_manager / admin). Agents 403.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { query } from '../../../../src/lib/db';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';
import { memberByEmail, isManagerOrAdmin } from '../../../../src/lib/hide-task-helpers';
import { getCurrentDeptId } from '../../../../src/lib/dept-scope';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function lc(s) { return typeof s === 'string' ? s.toLowerCase() : null; }
function cleanStr(s, max = 255) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
}
function rowToJson(r) {
  return {
    id: r.id,
    scheduleDate: r.schedule_date instanceof Date
      ? r.schedule_date.toISOString().slice(0, 10)
      : String(r.schedule_date).slice(0, 10),
    emeaMainEmail: r.emea_main_email,
    emeaMainName: r.emea_main_name,
    emeaBackupEmail: r.emea_backup_email,
    emeaBackupName: r.emea_backup_name,
    namMainEmail: r.nam_main_email,
    namMainName: r.nam_main_name,
    namBackupEmail: r.nam_backup_email,
    namBackupName: r.nam_backup_name,
    apacMainEmail: r.apac_main_email,
    apacMainName: r.apac_main_name,
    apacBackupEmail: r.apac_backup_email,
    apacBackupName: r.apac_backup_name,
    notes: r.notes,
    updatedByEmail: r.updated_by_email,
    updatedByName: r.updated_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();

  // Read-side is open to every authenticated user — the rotation is not
  // sensitive data, the team needs to know who's on call right now.
  // Write-side (POST/PATCH/DELETE) stays manager-gated below.

  const { searchParams } = new URL(req.url);
  const fromRaw = searchParams.get('from');
  const toRaw   = searchParams.get('to');
  const from = ISO_DATE.test(fromRaw || '') ? fromRaw : null;
  const to   = ISO_DATE.test(toRaw   || '') ? toRaw   : null;

  // Default window: today - 14d ... today + 60d. Past 2 weeks visible so
  // the user can spot recent gaps; 60d lookahead lines up with the
  // typical scheduling horizon.
  const defaultFromSql = "(CURRENT_DATE - INTERVAL '14 days')::date";
  const defaultToSql   = "(CURRENT_DATE + INTERVAL '60 days')::date";

  const where = [];
  const params = [];
  let p = 1;
  // Phase 11f (2026-05-20): dept-isolate the MOC schedule so each dept's
  // on-call rotation is independent. Mohamed switching the picker shows
  // the per-dept rotation he's viewing.
  const currentDeptId = await getCurrentDeptId(user, req);
  if (currentDeptId) {
    where.push(`org_node_id = $${p++}`);
    params.push(currentDeptId);
  } else {
    where.push(`FALSE`);
  }
  if (from) { where.push(`schedule_date >= $${p++}::date`); params.push(from); }
  else      { where.push(`schedule_date >= ${defaultFromSql}`); }
  if (to)   { where.push(`schedule_date <= $${p++}::date`); params.push(to); }
  else      { where.push(`schedule_date <= ${defaultToSql}`); }

  const { rows } = await query(
    `SELECT *
       FROM urgent_assist_schedule
      WHERE ${where.join(' AND ')}
      ORDER BY schedule_date ASC
      LIMIT 500`,
    params,
  );

  return NextResponse.json({ items: rows.map(rowToJson), total: rows.length });
}

export async function POST(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureRosterHydrated();

  const callerEmail = lc(user.email);
  if (!isManagerOrAdmin(callerEmail)) {
    return NextResponse.json({ error: 'Forbidden — only managers (TL/RM/admin) can edit the schedule' }, { status: 403 });
  }
  const callerName = user.name || memberByEmail(callerEmail)?.name || callerEmail;

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const scheduleDate = typeof body?.scheduleDate === 'string' ? body.scheduleDate.trim() : '';
  if (!ISO_DATE.test(scheduleDate)) {
    return NextResponse.json({ error: 'scheduleDate is required (YYYY-MM-DD)' }, { status: 400 });
  }

  const slots = {
    emeaMain:   { email: lc(cleanStr(body.emeaMainEmail)),   name: cleanStr(body.emeaMainName) },
    emeaBackup: { email: lc(cleanStr(body.emeaBackupEmail)), name: cleanStr(body.emeaBackupName) },
    namMain:    { email: lc(cleanStr(body.namMainEmail)),    name: cleanStr(body.namMainName) },
    namBackup:  { email: lc(cleanStr(body.namBackupEmail)),  name: cleanStr(body.namBackupName) },
    apacMain:   { email: lc(cleanStr(body.apacMainEmail)),   name: cleanStr(body.apacMainName) },
    apacBackup: { email: lc(cleanStr(body.apacBackupEmail)), name: cleanStr(body.apacBackupName) },
  };
  // Auto-fill name from the roster when only email was provided. Cheap
  // — keeps the UI lookup simple ("type the email" works without
  // needing a second field).
  for (const k of Object.keys(slots)) {
    if (slots[k].email && !slots[k].name) {
      slots[k].name = memberByEmail(slots[k].email)?.name || null;
    }
  }

  const notes = cleanStr(body.notes, 2000);
  // Phase 11f: stamp the actor's currentDeptId so each dept's schedule is
  // independent. The (schedule_date, org_node_id) pair is what should be
  // unique going forward (schema-level constraint update is a follow-up).
  const currentDeptId = await getCurrentDeptId(user, req);

  const { rows } = await query(
    `INSERT INTO urgent_assist_schedule
       (schedule_date,
        emea_main_email,   emea_main_name,
        emea_backup_email, emea_backup_name,
        nam_main_email,    nam_main_name,
        nam_backup_email,  nam_backup_name,
        apac_main_email,   apac_main_name,
        apac_backup_email, apac_backup_name,
        notes,
        updated_by_email, updated_by_name, updated_at, org_node_id)
     VALUES ($1,
             $2, $3,
             $4, $5,
             $6, $7,
             $8, $9,
             $10, $11,
             $12, $13,
             $14,
             $15, $16, NOW(), $17)
     ON CONFLICT (schedule_date) DO UPDATE SET
       emea_main_email   = EXCLUDED.emea_main_email,
       emea_main_name    = EXCLUDED.emea_main_name,
       emea_backup_email = EXCLUDED.emea_backup_email,
       emea_backup_name  = EXCLUDED.emea_backup_name,
       nam_main_email    = EXCLUDED.nam_main_email,
       nam_main_name     = EXCLUDED.nam_main_name,
       nam_backup_email  = EXCLUDED.nam_backup_email,
       nam_backup_name   = EXCLUDED.nam_backup_name,
       apac_main_email   = EXCLUDED.apac_main_email,
       apac_main_name    = EXCLUDED.apac_main_name,
       apac_backup_email = EXCLUDED.apac_backup_email,
       apac_backup_name  = EXCLUDED.apac_backup_name,
       notes             = EXCLUDED.notes,
       updated_by_email  = EXCLUDED.updated_by_email,
       updated_by_name   = EXCLUDED.updated_by_name,
       updated_at        = NOW()
     RETURNING *`,
    [
      scheduleDate,
      slots.emeaMain.email,   slots.emeaMain.name,
      slots.emeaBackup.email, slots.emeaBackup.name,
      slots.namMain.email,    slots.namMain.name,
      slots.namBackup.email,  slots.namBackup.name,
      slots.apacMain.email,   slots.apacMain.name,
      slots.apacBackup.email, slots.apacBackup.name,
      notes,
      callerEmail, callerName,
      currentDeptId,
    ],
  );

  return NextResponse.json({ ok: true, item: rowToJson(rows[0]) }, { status: 201 });
}
