// ── /api/v1/country-handover-docs/:countryCode ─────────────────────────────
// Single-doc read + partial update.
//
// GET   → full row. Published docs are org-readable. Draft / archived rows
//         require canEdit (admin / HR Hub admin / country owner).
// PATCH → debounced autosave from the editor. Body is an arbitrary subset
//         of EDITABLE_FIELDS; unknown keys are silently ignored. Writes
//         only the changed columns, logs the diff to country_handover_doc_history,
//         and returns the fresh row so the editor doesn't need a re-read.

import { NextResponse } from 'next/server';
import { query } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { ensureRosterHydrated } from '../../../../../src/lib/roster-server';
import {
  canEditCountryHandoverDoc,
  canReadCountryHandoverDoc,
  coerceUpdateBody,
  buildDiff,
  writeHistory,
  rowToDoc,
  normaliseCountryCode,
  isValidCountryCode,
} from '../../../../../src/lib/country-handover-docs';

async function fetchRow(countryCode) {
  const { rows } = await query(
    `SELECT * FROM country_handover_docs WHERE country_code = $1`,
    [countryCode],
  );
  return rows[0] || null;
}

export async function GET(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { countryCode: raw } = await ctx.params;
  if (!isValidCountryCode(raw)) {
    return NextResponse.json({ error: 'Invalid country code' }, { status: 400 });
  }
  const cc = normaliseCountryCode(raw);

  await ensureRosterHydrated();

  try {
    const row = await fetchRow(cc);
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!(await canReadCountryHandoverDoc(user, row))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ item: rowToDoc(row) });
  } catch (err) {
    console.error('[country-handover-docs/:cc GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { countryCode: raw } = await ctx.params;
  if (!isValidCountryCode(raw)) {
    return NextResponse.json({ error: 'Invalid country code' }, { status: 400 });
  }
  const cc = normaliseCountryCode(raw);

  await ensureRosterHydrated();

  if (!(await canEditCountryHandoverDoc(user, cc))) {
    return NextResponse.json({ error: 'Forbidden — only country owners or HR Hub admins can edit this doc.' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const { values, errors } = coerceUpdateBody(body);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', field_errors: errors }, { status: 400 });
  }
  if (Object.keys(values).length === 0) {
    // No editable fields supplied — return current row so the autosave
    // doesn't trip on an empty body and the FE state stays consistent.
    const current = await fetchRow(cc);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: rowToDoc(current), updated: 0 });
  }

  try {
    const before = await fetchRow(cc);
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const diff = buildDiff(before, values);
    if (Object.keys(diff).length === 0) {
      return NextResponse.json({ item: rowToDoc(before), updated: 0 });
    }

    // Build a parameterised UPDATE that touches only changed columns.
    // pg's JSONB coercion is automatic when we pass JS objects/arrays so
    // we don't need to JSON.stringify here — except we DO for JSONB to
    // dodge the "could not determine data type" error on parameterised
    // empty arrays (pg sees [] as text[]).
    const sets = [];
    const params = [];
    let p = 1;
    for (const [k, v] of Object.entries(values)) {
      if (v === null) {
        sets.push(`${k} = NULL`);
        continue;
      }
      // JSONB columns: stringify so pg routes to ::jsonb.
      if (k === 'stakeholders' || k === 'pre_onboarding_steps' || k === 'benefits' || k === 'faqs') {
        sets.push(`${k} = $${p++}::jsonb`);
        params.push(JSON.stringify(v));
        continue;
      }
      sets.push(`${k} = $${p++}`);
      params.push(v);
    }
    sets.push(`updated_at = NOW()`);
    sets.push(`updated_by_email = $${p++}`);
    params.push(user.email);
    params.push(cc);

    const update = await query(
      `UPDATE country_handover_docs
          SET ${sets.join(', ')}
        WHERE country_code = $${p}
        RETURNING *`,
      params,
    );
    const after = update.rows[0];

    await writeHistory({
      docId: after.id,
      countryCode: cc,
      editorEmail: user.email,
      diff,
    });

    return NextResponse.json({ item: rowToDoc(after), updated: Object.keys(diff).length });
  } catch (err) {
    console.error('[country-handover-docs/:cc PATCH]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
