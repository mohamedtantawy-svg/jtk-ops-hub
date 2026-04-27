// ── GET /api/v1/integrations/zendesk/macros ──────────────────────────────────
// Lists active Zendesk macros. Cached server-side for 5 min — macros change
// rarely (admins edit them weekly at most) and the response is large enough
// that caching meaningfully cuts the round trip cost on the Detail page.
//
// Query params:
//   ?search=<text>   — case-insensitive title filter applied client-side
//                      after the cache hit, so we don't burn a ZD call per
//                      keystroke.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { listMacros, isZendeskConfigured } from '../../../../../../src/lib/zendesk-api';

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = { value: null, ts: 0, inflight: null };

async function loadAll() {
  const now = Date.now();
  if (_cache.value && (now - _cache.ts) < CACHE_TTL_MS) return _cache.value;
  if (_cache.inflight) return _cache.inflight;
  _cache.inflight = (async () => {
    try {
      // Pull up to ~500 macros across 5 pages — ZD orgs rarely exceed this.
      const all = [];
      for (let page = 1; page <= 5; page++) {
        const res = await listMacros({ page, per_page: 100 });
        const items = res?.macros || [];
        all.push(...items);
        if (items.length < 100) break;
      }
      const slim = all.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description || '',
        active: m.active !== false,
        position: m.position ?? null,
        // raw_title preserved so search includes hidden category prefixes.
        raw_title: m.raw_title || m.title || '',
      }));
      _cache = { value: slim, ts: Date.now(), inflight: null };
      return slim;
    } catch (err) {
      _cache.inflight = null;
      throw err;
    }
  })();
  return _cache.inflight;
}

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: 'Zendesk API not configured' }, { status: 503 });
  }

  try {
    const all = await loadAll();
    const url = new URL(req.url);
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const filtered = search
      ? all.filter(m => m.title.toLowerCase().includes(search) || m.raw_title.toLowerCase().includes(search))
      : all;
    return NextResponse.json({ macros: filtered, total: all.length });
  } catch (err) {
    console.error('[integrations/zendesk/macros]', err.message);
    return NextResponse.json({ error: 'Failed to load macros' }, { status: 500 });
  }
}
