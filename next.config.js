/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  instrumentationHook: true,
  poweredByHeader: false,
  env: {
    // Nexus injects GOOGLE_CLIENT_ID server-side; expose it to the client
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  },
  async headers() {
    return [
      // Baseline security headers applied to everything.
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // ── Cache strategy ───────────────────────────────────────────────────
      // The HTML shell MUST revalidate on every request — otherwise the
      // browser keeps serving a stale shell that references _next/static/
      // chunks from the previous deploy, and the user has to manually clear
      // their cache to see new code. This was the root cause of the
      // "announcement changes didn't show up until I cleared cache" reports.
      //
      // Static assets under /_next/static/ are content-hashed by Next's
      // build — filenames change whenever code changes — so they're safe
      // (and desirable) to cache aggressively at the browser edge.
      //
      // The /api/* responses set their own Cache-Control per-route; don't
      // blanket-override them here.
      {
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // Covers anything resolved as a page — exclude API, static chunks,
        // and asset paths so we don't disable their caching.
        source: '/((?!api|_next/static|_next/image|favicon|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?)).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      // NOTE: /_next/static/* is intentionally left alone — Next.js already
      // sets `public, max-age=31536000, immutable` on those routes internally
      // and explicitly warns against overriding it (see Next.js build output).
      // Our cache strategy relies on that default: content-hashed chunks stay
      // cacheable, only the HTML shell revalidates.
    ];
  },
};

module.exports = nextConfig;
