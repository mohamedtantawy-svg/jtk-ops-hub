// ── /api/v1/handovers/:id ──────────────────────────────────────────────
// GET    — full handover detail (coverers, checklist, log)
// PATCH  — edit fields. Allowed in draft / pending_*; admin/RM can also
//          edit (e.g. fix a typo on a pending handover their report submitted).
// DELETE — soft-only via cancel; this endpoint exists for status=draft
//          + requester to undo a stray create. Anything more nuanced
//          flows through /cancel.

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../src/lib/db';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { isAdminUser } from '../../../../../src/lib/queue-scoping';
import {
  loadHandoverWithDetails,
  canModifyHandover,
  writeLog,
} from '../../../../../src/lib/handover-server';
import {
  HANDOVER_STATUSES,
  HANDOVER_EVENT_TYPES,
} from '../../../../../src/lib/handover-helpers';

const lc = (v) => (v || '').toLowerCase().trim();

const EDITABLE_STATES = new Set([
  HANDOVER_STATUSES.DRAFT,
  HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE,
  HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL,
]);

export async function GET(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const handover = await loadHandoverWithDetails(id);
    // Visibility — caller must be requester OR coverer OR manager OR admin/RM.
    const callerEmail = lc(user.email);
    if (!isAdminUser(user)
      && lc(handover.requester_email) !== callerEmail
      && lc(handover.manager_email) !== callerEmail
      && !handover.coverers.some(c => lc(c.coverer_email) === callerEmail)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ handover });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id GET]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}

export async function PATCH(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  try {
    const updated = await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (!canModifyHandover(user, handover)) {
        throw Object.assign(new Error('You cannot edit this handover'), { status: 403 });
      }
      if (!EDITABLE_STATES.has(handover.status)) {
        throw Object.assign(new Error(`Handover in status "${handover.status}" cannot be edited`), { status: 409 });
      }

      // Self-cover prevention applies to any coverer mutation.
      const newCoverers = Array.isArray(body?.coverers) ? body.coverers : null;
      if (newCoverers) {
        for (const c of newCoverers) {
          if (lc(c?.email) === lc(handover.requester_email)) {
            throw Object.assign(new Error('Requester cannot be a coverer'), { status: 400 });
          }
        }
      }

      // Field-level updates.
      const setParts = ['updated_at = NOW()'];
      const params = [handover.id];
      let p = 2;
      if (typeof body?.reason === 'string') {
        setParts.push(`reason = $${p++}`);
        params.push(body.reason.slice(0, 1000));
      }
      if (setParts.length > 1) {
        await client.query(
          `UPDATE handovers SET ${setParts.join(', ')} WHERE id = $1`,
          params,
        );
      }

      // Replace coverers if provided. Diff against existing to preserve
      // acceptance state on rows that didn't change.
      if (newCoverers) {
        const existing = handover.coverers;
        const wantedByEmail = new Map();
        for (const c of newCoverers) {
          const ce = lc(c?.email);
          if (!ce) continue;
          wantedByEmail.set(ce, {
            country_codes: Array.isArray(c?.country_codes)
              ? c.country_codes.map(x => String(x || '').toUpperCase()).filter(Boolean)
              : [],
          });
        }
        // Remove ones no longer present.
        for (const e of existing) {
          if (!wantedByEmail.has(lc(e.coverer_email))) {
            await client.query(
              `DELETE FROM handover_coverers WHERE id = $1`,
              [e.id],
            );
            await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.COVERER_REMOVED, user, {
              coverer_email: e.coverer_email,
            });
          }
        }
        // Upsert wanted ones.
        for (const [ce, info] of wantedByEmail.entries()) {
          const existingRow = existing.find(e => lc(e.coverer_email) === ce);
          if (existingRow) {
            await client.query(
              `UPDATE handover_coverers SET country_codes = $1::text[] WHERE id = $2`,
              [info.country_codes, existingRow.id],
            );
          } else {
            await client.query(
              `INSERT INTO handover_coverers (handover_id, coverer_email, country_codes, acceptance_status)
               VALUES ($1, $2, $3::text[], 'pending')`,
              [handover.id, ce, info.country_codes],
            );
            await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.COVERER_ADDED, user, {
              coverer_email: ce,
            });
          }
        }
      }

      // Replace checklist if provided (only in DRAFT — once submitted
      // the checklist is locked except for completion ticks).
      const newChecklist = Array.isArray(body?.checklist_items) ? body.checklist_items : null;
      if (newChecklist && handover.status === HANDOVER_STATUSES.DRAFT) {
        await client.query(
          `DELETE FROM handover_checklist_items WHERE handover_id = $1`,
          [handover.id],
        );
        for (const item of newChecklist) {
          const itemId = String(item?.id || '').slice(0, 80);
          const label  = String(item?.label || '').slice(0, 500);
          if (!itemId || !label) continue;
          await client.query(
            `INSERT INTO handover_checklist_items (handover_id, item_id, label, required)
             VALUES ($1, $2, $3, $4)`,
            [handover.id, itemId, label, item?.required !== false],
          );
        }
      }

      await writeLog(client, handover.id, HANDOVER_EVENT_TYPES.EDITED, user, {
        fields: Object.keys(body || {}),
      });

      return loadHandoverWithDetails(handover.id, { client });
    });

    return NextResponse.json({ handover: updated });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id PATCH]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}

export async function DELETE(req, ctx) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await withTransaction(async (client) => {
      const handover = await loadHandoverWithDetails(id, { client });
      if (!canModifyHandover(user, handover)) {
        throw Object.assign(new Error('You cannot delete this handover'), { status: 403 });
      }
      if (handover.status !== HANDOVER_STATUSES.DRAFT) {
        throw Object.assign(new Error('Only drafts can be deleted; submitted handovers must be cancelled'), { status: 409 });
      }
      // Cascade via ON DELETE CASCADE on child tables.
      await client.query(`DELETE FROM handovers WHERE id = $1`, [handover.id]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[handovers/:id DELETE]', err.message);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status });
  }
}
