// ── Public config endpoint ──────────────────────────────────────────────────
// Returns non-secret configuration values needed by the client at runtime.
// This avoids the build-time inlining issue with NEXT_PUBLIC_* env vars
// in Docker/standalone builds where build args aren't available.

import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const projectId = process.env.GOOGLE_OAUTH_PROJECT_ID || '';
  const nextauthUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || '';

  let googleAuthUrl = '';
  if (clientId && projectId && nextauthUrl) {
    const state = Buffer.from(JSON.stringify({
      projectId,
      returnUrl: `${nextauthUrl}/auth/callback`,
    })).toString('base64');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://login.dp.com/api/gcp-oauth/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });

    googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  return NextResponse.json({ googleAuthUrl });
}
