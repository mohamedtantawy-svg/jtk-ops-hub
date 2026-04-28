// ── Origin guard ─────────────────────────────────────────────────────────────
// Lightweight CSRF defence: reject state-changing requests whose Origin/Referer
// header does not match the host the request landed on. This is defence-in-
// depth on top of JWT auth — a stolen token can't be weaponised from a third-
// party site if we refuse cross-origin POST/PUT/PATCH/DELETE calls.
//
// The allow-list is driven by (in order):
//   1. ALLOWED_ORIGINS env — comma-separated absolute origins
//   2. NEXT_PUBLIC_APP_URL — the canonical public URL
//   3. The request's own host  — always permitted (SSR, same-origin calls)
//
// Returns { ok: true } on pass, or { ok: false, status, reason } on reject.
// Callers in app/api/**/route.js should early-return a NextResponse.json with
// the provided status code.

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originFromUrl(u) {
  try { return new URL(u).origin; } catch { return null; }
}

function allowList(req) {
  const set = new Set();
  if (process.env.ALLOWED_ORIGINS) {
    for (const raw of process.env.ALLOWED_ORIGINS.split(',')) {
      const o = originFromUrl(raw.trim());
      if (o) set.add(o);
    }
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    const o = originFromUrl(process.env.NEXT_PUBLIC_APP_URL);
    if (o) set.add(o);
  }
  // Same-origin: the request URL's own origin is always trusted.
  try {
    const reqUrl = req.url ? new URL(req.url) : null;
    if (reqUrl) set.add(reqUrl.origin);
  } catch {}
  // Behind an ingress / reverse proxy, req.url carries the in-pod origin
  // (http://localhost:3000) instead of the public-facing one. Recover the
  // public origin from x-forwarded-* (+ Host) and trust it as same-origin.
  try {
    const get = (h) => (typeof req.headers?.get === 'function'
      ? req.headers.get(h)
      : req.headers?.[h] || null);
    const fwdProto = (get('x-forwarded-proto') || '').split(',')[0].trim();
    const fwdHost  = (get('x-forwarded-host')  || '').split(',')[0].trim();
    const host     = get('host') || '';
    const proto    = fwdProto || 'https';
    if (fwdHost) { const o = originFromUrl(`${proto}://${fwdHost}`); if (o) set.add(o); }
    if (host)    { const o = originFromUrl(`${proto}://${host}`);    if (o) set.add(o); }
  } catch {}
  return set;
}

export function checkOrigin(req) {
  if (!STATE_CHANGING.has(req.method)) return { ok: true };

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const candidate = origin || (referer ? originFromUrl(referer) : null);

  // Absent header on a POST from a modern browser is suspicious; allow only
  // if an explicit bypass env is set (e.g. for server-to-server cron jobs).
  if (!candidate) {
    if (process.env.ORIGIN_CHECK_ALLOW_MISSING === '1') return { ok: true };
    return { ok: false, status: 403, reason: 'missing-origin' };
  }

  const allowed = allowList(req);
  if (allowed.has(candidate)) return { ok: true };
  return { ok: false, status: 403, reason: 'origin-not-allowed' };
}
