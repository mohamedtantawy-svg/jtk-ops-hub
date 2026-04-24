// ── Public version endpoint ──────────────────────────────────────────────────
// Returns the currently-deployed build SHA so the client can detect when the
// server has been upgraded and prompt the user to reload. The value is read
// from APP_VERSION, which is populated at deploy time by Helm from the image
// tag (see helm/templates/deployment.yaml) and always points to the exact
// commit SHA that built the running image.
//
// Response shape is intentionally tiny: clients fetch this every 60s.
//
// Security: no auth required — the SHA is already public via the image tag
// and the git history. Listed in middleware.js bypass so the lightweight
// poll never hits the JWT verify path.
//
// Caching: the whole point is to never serve a stale value, so we force
// `no-store` explicitly (defense-in-depth against any CDN rewriting the
// default dynamic-route headers).

import { NextResponse } from 'next/server';

// Record the time the Node process started. Pods get recreated on every
// rollout, so this is effectively the deploy time for this replica. We
// expose it alongside the SHA purely for ops debugging — the client only
// uses `version` for equality comparison.
const PROCESS_STARTED_AT = new Date().toISOString();

export async function GET() {
  const version = process.env.APP_VERSION || 'unknown';

  return NextResponse.json(
    {
      version,
      startedAt: PROCESS_STARTED_AT,
    },
    {
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
    }
  );
}
