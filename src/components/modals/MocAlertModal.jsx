// ── MocAlertModal ────────────────────────────────────────────────────────
// Red / "scary" popup that fires when the current user becomes the
// rotating Manager on Call (Mohamed 2026-05-07 spec). Dismiss closes
// the modal; "Open Manager on Call view" navigates to Urgent Assist
// scoped to All so the new MOC sees every active urgent-assist row
// across the org.
//
// Detection + de-dup live in App.jsx (per-email lastAcknowledgedMocAt
// in localStorage). This component is purely the visual surface — keep
// its logic minimal so it stays render-safe under impersonation +
// page-route transitions.

import { useEffect } from 'react';

export default function MocAlertModal({ mocName, onDismiss, onOpenView }) {
  // ESC closes — same affordance every other Ops Hub modal carries.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDismiss?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="moc-alert-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--surface)',
          borderRadius: 16,
          boxShadow: '0 12px 48px rgba(0,0,0,0.32)',
          overflow: 'hidden',
          // Top banner uses the literal red so the alert reads "scary"
          // in both light + dark mode — status semantics stay literal
          // per the skill UI rule.
          border: '1px solid #d42d35',
        }}
      >
        <div style={{
          background: 'linear-gradient(135deg, #d42d35 0%, #b91c1c 100%)',
          color: '#ffffff',
          padding: '20px 24px 18px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi-exclamation-triangle-fill" style={{ fontSize: 22 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="moc-alert-title" style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              You are the Manager on Call now
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, opacity: 0.94 }}>
              Good luck — every urgent-assist request routes to you until rotated.
            </div>
          </div>
        </div>
        <div style={{ padding: '18px 24px 20px' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {mocName ? <>Hi <strong style={{ color: 'var(--text)' }}>{mocName.split(' ')[0]}</strong>, you've just been set as the Manager on Call.</> : null}
            {' '}
            Open the Manager on Call view to see the full queue — anyone can hand off later via the same picker.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                height: 34, padding: '0 14px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={onOpenView}
              autoFocus
              style={{
                height: 34, padding: '0 16px', borderRadius: 8,
                border: 'none',
                background: '#d42d35', color: '#ffffff',
                fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                boxShadow: '0 1px 3px rgba(212,45,53,0.4)',
              }}
            >
              <i className="bi-broadcast-pin" style={{ fontSize: 12 }} />
              Open Manager on Call view
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
