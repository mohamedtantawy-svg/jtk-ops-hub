// ── Cron auth ─────────────────────────────────────────────────────────
// Shared bearer-token check for scheduled job endpoints. Used by the
// Phase 4 handover lifecycle + reminders cron routes (HANDOVERS_PLAN.md
// §6.2). The secret lives in CRON_SECRET; the k8s CronJob (helm
// template) attaches it as `Authorization: Bearer ${CRON_SECRET}`.
//
// Returns { authorized: boolean, status, error }. On 503 we surface a
// clear server-misconfig error so operators know to set the env var.
//
// The secret comparison uses Node's `timingSafeEqual` when both lengths
// match — defends against timing attacks if anyone tries to brute-force
// the token via a slow side channel.

import { Buffer } from 'node:buffer';

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try {
    // crypto.timingSafeEqual exists on Node ≥ 14; static-import keeps
    // bundling predictable.
    // eslint-disable-next-line global-require
    return require('node:crypto').timingSafeEqual(ab, bb);
  } catch {
    // Last-ditch fallback if crypto is unavailable.
    return a === b;
  }
}

export function verifyCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    return {
      authorized: false,
      status: 503,
      error: 'CRON_SECRET is not configured on the server',
    };
  }

  const auth = req.headers.get('authorization') || '';
  // Accept either "Bearer <secret>" or the raw secret in
  // x-cron-secret for tooling that doesn't set bearer headers cleanly.
  let supplied = '';
  if (auth.startsWith('Bearer ')) {
    supplied = auth.slice('Bearer '.length).trim();
  } else {
    supplied = (req.headers.get('x-cron-secret') || '').trim();
  }
  if (!supplied) {
    return { authorized: false, status: 401, error: 'Missing cron credentials' };
  }
  if (!timingSafeStringEqual(supplied, expected)) {
    return { authorized: false, status: 403, error: 'Invalid cron credentials' };
  }
  return { authorized: true };
}
