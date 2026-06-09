// ── GET /api/v1/queue/country-overlay ───────────────────────────────────────
// Sarah Suge 2026-06-09 ("Managers Task View Should Be Based on Countries"):
// when cross-team helpers pick up a country's work the rows get reassigned to
// people outside the original manager's chain, so the manager loses sight of
// them. The fix mohamed asked for: a country filter that, when active, shows
// ALL tasks for that country — even ones not assigned to the viewer and
// outside their default visibility.
//
// The normal Queue routes scope every payload to the caller's visibility
// BEFORE returning, so those out-of-scope rows never reach the browser. This
// endpoint is the "isolated overlay": it reads the SAME warm in-memory caches
// the source routes already populate (which hold the FULL, pre-scope payload —
// scoping is applied on the way out, after the cache read) and returns the
// rows whose country is in the requested set, WITHOUT any assignee/ownership
// scoping. The existing Queue data path is untouched, so nothing that works
// today can regress — the FE only fetches + merges this when a country filter
// is active.
//
// Department isolation is preserved: dept-namespaced caches (tickets /
// workbench / immigration) are read for the CURRENT dept only, and HRX-global
// Deel sources are gated by the dept's source-visibility profile — a GIX user
// filtering "Germany" never sees HRX's Germany onboarding rows.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { getCurrentDeptSlugAndId } from '../../../../../src/lib/dept-scope';
import { isDeelSourceVisible, SLUGS } from '../../../../../src/lib/dept-integrations';
import { cacheGet, cacheGetByPrefix } from '../../../../../src/lib/server-cache';

// Tolerate stale caches generously — this is a best-effort supplementary view
// layered on top of the live queue, not the queue's own freshness contract.
const READ_TTL = 30 * 60 * 1000;

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let countries;
  try {
    const url = new URL(req.url);
    countries = new Set(
      (url.searchParams.get('countries') || '')
        .split(',')
        .map(c => c.trim().toUpperCase())
        .filter(Boolean),
    );
  } catch {
    countries = new Set();
  }
  if (countries.size === 0) {
    return NextResponse.json({ countries: [], bySource: {} });
  }

  try {
    const deptInfo = await getCurrentDeptSlugAndId(user, req);
    const deptSlug = deptInfo?.deptSlug || null;
    const isHrx = !deptInfo || deptSlug === SLUGS.HR_EXPERIENCE;
    // Mirror the queue route's namespace formula (route.js: cacheNS) so we
    // read the SAME per-dept cache rows the FE's ticket feed populated.
    const cacheNS = isHrx ? SLUGS.HR_EXPERIENCE : (deptSlug || 'no-dept');

    const itemsOf = (cached) => (cached && Array.isArray(cached.items)) ? cached.items : [];
    const matchCC = (items) => items.filter((it) => {
      const cc = String(it?.country || it?.countryCode || '').toUpperCase();
      return cc && countries.has(cc);
    });
    const dedupe = (items) => {
      const seen = new Set();
      const out = [];
      for (const it of items) {
        const id = it?.id != null ? String(it.id) : null;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        out.push(it);
      }
      return out;
    };

    const cold = [];
    const bySource = {};

    // ── Tickets (Zendesk + Jira) — available to every dept, per-dept caches,
    // fetched per-source by the FE so the per-source keys are the warm ones. ──
    {
      const zd = cacheGet(`queue_zendesk_${cacheNS}`, READ_TTL);
      const jira = cacheGet(`queue_jira_${cacheNS}`, READ_TTL);
      if (!zd) cold.push('zendesk');
      if (!jira) cold.push('jira');
      bySource.tickets = dedupe(matchCC([...itemsOf(zd), ...itemsOf(jira)]));
    }

    // ── Deel sources — only those visible to the current dept (this is what
    // keeps the overlay inside the department's tenancy). visKey values match
    // each route's isDeelSourceVisible(...) call verbatim. ──
    const addDeel = (sourceKey, visKey, read) => {
      if (!isDeelSourceVisible(deptSlug, visKey)) return;
      const cached = read();
      const items = Array.isArray(cached)
        ? cached.flatMap(itemsOf)         // cacheGetByPrefix → array of payloads
        : itemsOf(cached);                // cacheGet → single payload
      if (Array.isArray(cached) ? cached.length === 0 : cached == null) cold.push(sourceKey);
      bySource[sourceKey] = dedupe(matchCC(items));
    };

    addDeel('onboarding',        'onboarding',     () => cacheGet('deel_onboarding_0', READ_TTL));
    addDeel('paused_onboarding', 'onboarding',     () => cacheGet('deel_onboarding_paused', READ_TTL));
    addDeel('offboarding',       'offboarding',    () => cacheGet('deel_offboarding', READ_TTL));
    // Parameter-hashed keys — prefix scan (no other key shares these prefixes).
    addDeel('amendments',        'amendments',     () => cacheGetByPrefix('deel_amendments_v2', READ_TTL));
    addDeel('redlines',          'redlines',       () => cacheGetByPrefix('deel_redlines_v2', READ_TTL));
    addDeel('incentive_plans',   'incentivePlans', () => cacheGetByPrefix('deel_incentive_plans_v1', READ_TTL));
    // Active EOR — HRX-only, single (non-offset, non-dept-namespaced) cache key.
    addDeel('active_eor',        'activeEor',      () => cacheGet('deel_active_eor', READ_TTL));
    // Dept-namespaced keys — read the CURRENT dept's row only.
    addDeel('workbench',         'workbench',        () => cacheGet(isHrx ? 'deel_workbench' : `deel_workbench_${deptSlug}`, READ_TTL));
    addDeel('immigration_tasks', 'immigrationTasks', () => cacheGet(`deel_immigration_tasks_${deptSlug}`, READ_TTL));
    addDeel('immigration_cases', 'immigrationCases', () => cacheGet(`deel_immigration_cases_${deptSlug}`, READ_TTL));

    return NextResponse.json({ countries: [...countries], bySource, meta: { deptSlug, cold } });
  } catch (err) {
    // Never fail hard — the overlay is supplementary. Degrade to empty so the
    // base queue (which the FE renders regardless) is never affected.
    console.warn('[queue/country-overlay]', err?.message);
    return NextResponse.json({ countries: [...countries], bySource: {}, meta: { error: true } });
  }
}
