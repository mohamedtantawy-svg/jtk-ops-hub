// ── GET /api/v1/integrations/deel/health ─────────────────────────────────────
// Diagnostic endpoint: tests the Deel API connection and returns detailed info.
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

  // Sanitize token
  const token = (process.env.DEEL_API_KEY || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/[\r\n]+/g, '');

  // Test with admin profile endpoint (known to work)
  const testUrl = `${diag.baseUrl}/admin/admin_profile/me`;
  const startMs = Date.now();
  let testResult;

  try {
    const res = await fetch(testUrl, {
      headers: {
        'x-auth-token': token,
        Authorization: `Bearer ${token}`,
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
      const adminName = parsed?.full_name || parsed?.data?.full_name || parsed?.name || parsed?.email || '(ok)';
      testResult = {
        status: 'ok',
        httpStatus: res.status,
        elapsed: `${elapsed}ms`,
        contentType,
        adminUser: adminName,
        message: `Connected to Deel Admin API as ${adminName}`,
      };
    } else {
      const isS3 = body.includes('<Error>') || body.includes('NoSuchBucket') || body.includes('Unsupported Authorization');
      const is401 = res.status === 401;
      const is403 = res.status === 403;

      let help;
      if (isS3) {
        help = 'Request hit CDN/S3 instead of Deel API. Check DEEL_API_BASE_URL.';
      } else if (is401 || is403) {
        help = 'Token rejected. Get a fresh token from admin.deel.network Admin Debug Tool and update DEEL_API_KEY on Nexus.';
      } else {
        help = `Deel API returned HTTP ${res.status}.`;
      }

      testResult = {
        status: 'error',
        httpStatus: res.status,
        elapsed: `${elapsed}ms`,
        contentType,
        bodyPreview: body.substring(0, 300),
        isS3CdnError: isS3,
        help,
      };
    }
  } catch (err) {
    const elapsed = Date.now() - startMs;
    testResult = {
      status: 'network_error',
      error: err.message,
      elapsed: `${elapsed}ms`,
      help: 'Could not reach the Deel API. Check network connectivity.',
    };
  }

  return NextResponse.json({
    config: diag,
    test: testResult,
    timestamp: new Date().toISOString(),
  });
}
