// ── GET /api/v1/integrations/deel/health ─────────────────────────────────────
// Diagnostic endpoint: tests the Deel API connection and returns detailed info.
// Helps debug auth/URL issues without exposing the full token.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import { isDeelConfigured, getDeelDiagnostics } from '../../../../../../src/lib/deel-api';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const diag = getDeelDiagnostics();

  if (!isDeelConfigured()) {
    return NextResponse.json({
      status: 'not_configured',
      ...diag,
      help: 'Set DEEL_API_KEY environment variable on Nexus',
    }, { status: 503 });
  }

  // Make a minimal test call to the Deel API
  const testUrl = `${diag.baseUrl}/organizations/current`;
  const startMs = Date.now();
  let testResult;

  try {
    const res = await fetch(testUrl, {
      headers: {
        Authorization: `Bearer ${process.env.DEEL_API_KEY?.trim().replace(/^["']+|["']+$/g, '').replace(/^Bearer\s+/i, '').replace(/[\r\n]+/g, '')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });

    const elapsed = Date.now() - startMs;
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text().catch(() => '');

    if (res.ok) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      testResult = {
        status: 'ok',
        httpStatus: res.status,
        elapsed: `${elapsed}ms`,
        contentType,
        orgName: parsed?.data?.name || parsed?.name || '(parsed ok)',
      };
    } else {
      const isS3 = body.includes('<Error>') || body.includes('NoSuchBucket') || body.includes('Unsupported Authorization');
      testResult = {
        status: 'error',
        httpStatus: res.status,
        elapsed: `${elapsed}ms`,
        contentType,
        bodyPreview: body.substring(0, 300),
        isS3CdnError: isS3,
        help: isS3
          ? 'The request hit a CDN/S3 bucket instead of the Deel API. The base URL is likely wrong or DNS is resolving incorrectly. Try setting DEEL_API_BASE_URL=https://api.letsdeel.com on Nexus.'
          : `Deel API returned HTTP ${res.status}. Check DEEL_API_KEY is valid.`,
      };
    }
  } catch (err) {
    const elapsed = Date.now() - startMs;
    testResult = {
      status: 'network_error',
      error: err.message,
      elapsed: `${elapsed}ms`,
      help: 'Could not reach the Deel API. Check network connectivity and DNS resolution from the Nexus server.',
    };
  }

  return NextResponse.json({
    config: diag,
    test: testResult,
    timestamp: new Date().toISOString(),
  });
}
