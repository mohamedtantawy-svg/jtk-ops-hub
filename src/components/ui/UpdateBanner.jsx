// ── UpdateBanner ─────────────────────────────────────────────────────────────
// Sticky, full-width banner that appears at the top of the viewport when
// useVersionCheck detects the server has rolled to a new deploy.
//
// ## Design choices
// - Full-width bar at the very top of the page (above even DeelTopNav) so
//   it's impossible to miss. Deploys are rare enough that stealing a few
//   pixels of vertical space for as long as the banner is visible is an
//   acceptable trade.
// - Deel's "alert" orange (#ed8d00) to match the existing toast palette —
//   signals "attention needed" without being a hard error red.
// - Primary CTA: "Reload now" — calls `reload()` from the hook, which
//   purges Cache Storage and does a hard refresh.
// - Secondary: "Later" dismisses the banner for this tab session. The hook
//   has already latched `hasUpdate=true` and stopped polling, so once
//   dismissed the banner won't reappear until the tab is reloaded.
// - Accessibility: role="alert" + aria-live="assertive" so screen readers
//   announce it immediately.

'use client';

import { useState } from 'react';

const BAR_BG = '#ed8d00';
const BAR_FG = '#1b1b1b';

export default function UpdateBanner({ hasUpdate, reload, latestVersion }) {
  // Local dismiss state — the hook's own state stays "update available" so
  // that if the user changes their mind and refreshes the page, or opens a
  // new tab, they'll still get the new version. Dismissal only suppresses
  // the visual banner for this tab session.
  const [dismissed, setDismissed] = useState(false);

  if (!hasUpdate || dismissed) return null;

  // Short SHA for the tooltip — the full tag is 40 chars of hex, but the
  // first 7 is enough to identify a commit uniquely in 99.99% of cases
  // and is what developers will recognise from GitHub.
  const shortSha = latestVersion ? String(latestVersion).slice(0, 7) : '';

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000, // above DeelTopNav (z-index ~100) and the impersonation bar (z-index 101)
        background: BAR_BG,
        color: BAR_FG,
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        fontSize: 13.5,
        fontWeight: 500,
        boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
        minHeight: 44,
        boxSizing: 'border-box',
      }}
    >
      <i className="bi-arrow-clockwise" style={{ fontSize: 16, flexShrink: 0 }}></i>
      <span style={{ flex: '0 1 auto' }}>
        A new version of Ops Hub is available.
        {shortSha && (
          <span
            style={{ marginLeft: 8, opacity: 0.7, fontFamily: 'monospace', fontSize: 12 }}
            title={`Build ${latestVersion}`}
          >
            ({shortSha})
          </span>
        )}
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={reload}
          style={{
            background: BAR_FG,
            color: 'white',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Reload now
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notification"
          style={{
            background: 'transparent',
            color: BAR_FG,
            border: `1px solid ${BAR_FG}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            opacity: 0.7,
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
