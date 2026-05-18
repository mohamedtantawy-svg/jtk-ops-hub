// ── GET /api/v1/country-handover-docs ──────────────────────────────────────
// Lists every country handover doc row with a thin summary payload — the
// editor's left rail and the wizard's Step 3 strip (Phase D) both read
// this. Published docs are visible to everyone; draft / archived rows
// surface only to admins or country owners so unfinished docs don't leak.
//
// Response shape:
//   { items: [{ country_code, status, updated_at, updated_by_email,
//               counts: { stakeholders, benefits, faqs, sections_filled },
//               freshness: 'fresh' | 'stale' | 'unknown' }] }
//
// freshness is computed from updated_at (≤ 90d = fresh, > 90d = stale,
// no updates beyond creation = 'unknown'). The Phase B editor uses it to
// surface the stale-doc banner on Home; right now the field is just
// reflected so the FE doesn't need a second pass.

import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/db';
import { getAuthUser } from '../../../../src/lib/auth-helpers';
import { isAdminUser } from '../../../../src/lib/queue-scoping';
import { canAdministerHrHub } from '../../../../src/lib/hr-hub-admin';
import { getOwnedCountries } from '../../../../src/data/countryOwners';
import { ensureRosterHydrated } from '../../../../src/lib/roster-server';

const STALE_DAYS = 90;

function countSectionsFilled(row) {
  let n = 0;
  if (row.scope_responsibilities) n++;
  if (row.signatory) n++;
  if (row.payroll_cycle) n++;
  if (row.onboarding_guide_url) n++;
  if (row.post_onboarding_steps) n++;
  if (row.legal_amendment_handover_url || row.amendments_country_notes) n++;
  if (row.termination_process || row.resignation_process) n++;
  if (row.evl_template_url || row.evl_process_description) n++;
  if (row.pto_key_aspects || row.pto_carry_over_rules) n++;
  if ((row.faqs || []).length > 0) n++;
  return n;
}

function freshnessFor(row) {
  if (!row.updated_at || row.status !== 'published') return 'unknown';
  const updated = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  const ageDays = (Date.now() - updated.getTime()) / 86_400_000;
  return ageDays > STALE_DAYS ? 'stale' : 'fresh';
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Hydrate so getOwnedCountries reflects Team-tab edits since pod boot.
  await ensureRosterHydrated();

  const isAdmin = isAdminUser(user);
  const isHrAdmin = isAdmin ? true : await canAdministerHrHub(user);
  const owned = isAdmin || isHrAdmin ? null : getOwnedCountries(user.email);

  try {
    const { rows } = await query(
      `SELECT id, country_code, status,
              scope_responsibilities, signatory, payroll_cycle,
              onboarding_guide_url, post_onboarding_steps,
              legal_amendment_handover_url, amendments_country_notes,
              termination_process, resignation_process,
              evl_template_url, evl_process_description,
              pto_key_aspects, pto_carry_over_rules,
              stakeholders, benefits, faqs,
              updated_at, updated_by_email
         FROM country_handover_docs
        ORDER BY country_code ASC`,
    );

    const items = rows
      .filter(r => {
        if (r.status === 'published') return true;
        // Draft/archived: visible only to admins, HR Hub admins, or owners
        // of that country.
        if (isAdmin || isHrAdmin) return true;
        return owned && owned.has(r.country_code);
      })
      .map(r => ({
        id: r.id,
        country_code: r.country_code,
        status: r.status,
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
        updated_by_email: r.updated_by_email,
        counts: {
          stakeholders: Array.isArray(r.stakeholders) ? r.stakeholders.length : 0,
          benefits:     Array.isArray(r.benefits) ? r.benefits.length : 0,
          faqs:         Array.isArray(r.faqs) ? r.faqs.length : 0,
          sections_filled: countSectionsFilled(r),
        },
        freshness: freshnessFor(r),
      }));

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('[country-handover-docs GET]', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
