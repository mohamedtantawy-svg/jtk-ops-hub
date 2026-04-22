// ── ConnectPrompt — full-pane empty state when calendar isn't connected ────
// Shown first time, and every time after disconnect/token-expiry. Explains
// exactly what's happening (we need a read-only scope to pull your
// meetings) so the consent screen isn't a surprise.
//
// Props:
//   onConnect  — async () => void  invoked when the user clicks "Connect".
//   connecting — bool              disables the button while we redirect.
//   error      — string|null       shown below the button on failure.

import { memo } from 'react';

function ConnectPrompt({ onConnect, connecting, error }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      gap: 20,
    }}>
      <div style={{
        width: 72,
        height: 72,
        borderRadius: 16,
        background: '#ede9fe',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <i className="bi-calendar2-event" style={{ fontSize: 32, color: '#7c3aed' }} />
      </div>

      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <h2 style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--text-1)',
          margin: '0 0 8px',
        }}>
          Connect your Google Calendar
        </h2>
        <p style={{
          fontSize: 13,
          color: 'var(--text-2)',
          lineHeight: 1.55,
          margin: 0,
        }}>
          Pull your upcoming meetings into Ops Hub. You&rsquo;ll get a 5-minute
          heads-up for every meeting and can see the week / month at a glance
          next to your queue.
        </p>
        <p style={{
          fontSize: 12,
          color: 'var(--text-3)',
          lineHeight: 1.5,
          margin: '10px 0 0',
        }}>
          We ask Google for <b>read-only</b> access only — Ops Hub can&rsquo;t
          create, edit, or delete events on your calendar. You can disconnect
          anytime from this page.
        </p>
      </div>

      <button
        type="button"
        onClick={onConnect}
        disabled={connecting}
        style={{
          background: connecting ? '#9ca3af' : '#7c3aed',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          padding: '10px 22px',
          fontSize: 14,
          fontWeight: 600,
          cursor: connecting ? 'default' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {connecting ? (
          <>
            <i className="bi-arrow-clockwise" style={{ fontSize: 14, animation: 'spin 0.9s linear infinite' }} />
            Redirecting…
          </>
        ) : (
          <>
            <i className="bi-google" style={{ fontSize: 14 }} />
            Connect with Google
          </>
        )}
      </button>

      {error && (
        <div style={{
          fontSize: 12,
          color: 'var(--red)',
          background: 'var(--red-light, #fef2f2)',
          border: '1px solid var(--red-mid, #fecaca)',
          borderRadius: 8,
          padding: '8px 14px',
          maxWidth: 440,
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default memo(ConnectPrompt);
