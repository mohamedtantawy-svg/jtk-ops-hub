// ── Public config endpoint ──────────────────────────────────────────────────
// Returns non-secret configuration values needed by the client at runtime.
// This avoids the build-time inlining issue with NEXT_PUBLIC_* env vars
// in Docker/standalone builds where build args aren't available.

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  });
}
