// ── Public version endpoint ──────────────────────────────────────────────────
// Returns a unique build identifier so the client can detect when the server
// has been upgraded and prompt the user to reload (see useVersionCheck.js).
//
// ## Version source priority
// 1. Next.js BUILD_ID — generated fresh by every `next build` and stored at
//    .next/BUILD_ID (present in the standalone output that ships inside the
//    Docker image). This is the preferred source: it requires zero external
//    injection, changes deterministically with every deploy, and is always
//    present in prod.
// 2. APP_VERSION env var — set by CI as the image tag SHA (see Dockerfile +
//    .github/workflows/ci.yml). Falls back to this if BUILD_ID can't be read
//    for any reason (e.g. unit-test environments where .next/ doesn't exist).
// 3. 'unknown' — graceful last-resort; the client's useVersionCheck hook
//    treats this as a no-op so it doesn't spam reload banners in envs where
//    neither source is configured.
//
// ## Why BUILD_ID and not APP_VERSION alone?
// Nexus's `deploy: dev → main` auto-promotion pipeline only ships "user code"
// files (src/, app/, middleware.js, etc.) and intentionally skips Dockerfile
// and .github/workflows/ci.yml. Additionally, the platform's helm template
// sync bot periodically resets helm/templates/deployment.yaml, wiping any
// custom env block. BUILD_ID bypasses both restrictions — it's baked into
// the Docker image by Next.js itself, no external injection required.
//
// ## Response shape
// Intentionally tiny — clients fetch this every 60 seconds.
//
// ## Caching
// Always no-store so no CDN or browser caches a stale version token.
//
// ## Auth
// Public — listed in middleware.js bypass. The build ID is low-sensitivity
// (already derivable from the bundle filenames in /_next/static/).

import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

// Resolve BUILD_ID once at module load (i.e. when the pod starts) so
// subsequent requests are pure in-memory reads with no I/O.
function resolveBuildId() {
  try {
    // In the standalone Docker image the file lives at
    // /app/.next/BUILD_ID (process.cwd() === '/app').
    const buildIdPath = join(process.cwd(), '.next', 'BUILD_ID');
    return readFileSync(buildIdPath, 'utf8').trim();
  } catch {
    // .next/BUILD_ID not found — fall back to injected env or sentinel.
    return process.env.APP_VERSION || 'unknown';
  }
}

const BUILD_VERSION = resolveBuildId();

// Record the time the Node process started. Pods get recreated on every
// rollout, so this is effectively the deploy time for this replica — useful
// for ops debugging even though the client only uses `version` for comparison.
const PROCESS_STARTED_AT = new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    {
      version: BUILD_VERSION,
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
