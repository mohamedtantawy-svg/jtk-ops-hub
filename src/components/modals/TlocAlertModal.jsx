// ── TlocAlertModal ──────────────────────────────────────────────────────
// Mirror of MocAlertModal for the Team Lead On Call rotation. Fires when
// the current user becomes the rotating TLOC — either via their own
// click on the picker or another teammate flipping the assignment.
//
// Visual + audio cue is identical to the MOC alert (Mohamed 2026-05-14
// spec: "popup with a sound exactly the same to when the manager on
// call changes"). Status colours differ slightly to telegraph "this is
// the TL rotation, not the MOC" — the existing MOC modal uses pure red
// because every urgent-assist routes to the MOC; the TLOC modal uses a
// warmer amber/red because HR-Hub work is a calmer signal than urgent
// assist. Both stay literal so they read the same in light + dark mode.

import { useEffect, useMemo } from 'react';
import { playAlertSound } from '../../utils/playAlertSound';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { getHubBrand } from '../../lib/hub-brand';

export default function TlocAlertModal({ tlocName, onDismiss, onOpenView }) {
  // 2026-05-22 — dept-branded copy ("New GIX Requests…" for GIX users).
  const deptState = useCurrentDept();
  const hubBrand = useMemo(() => getHubBrand(deptState.dept), [deptState.dept]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDismiss?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Same three-tone alarm as the MOC modal.
  useEffect(() => { try { playAlertSound(); } catch {} }, []);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tloc-alert-title"
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
          border: '1px solid #d97706',
        }}
      >
        <div style={{
          background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
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
            <i className="bi-broadcast-pin" style={{ fontSize: 22 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="tloc-alert-title" style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              You are the Team Lead on Call now
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, opacity: 0.94 }}>
              New {hubBrand.requestLabel}s and {hubBrand.reportingLabel} items will auto-route to you until rotated.
            </div>
          </div>
        </div>
        <div style={{ padding: '18px 24px 20px' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {tlocName ? <>Hi <strong style={{ color: 'var(--text)' }}>{tlocName.split(' ')[0]}</strong>, you&apos;ve just been set as the Team Lead on Call.</> : null}
            {' '}
            Existing rows that were auto-assigned to the previous TLOC and weren&apos;t manually touched have been re-routed to you. Manually-assigned rows stay with their current owners.
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
                background: '#d97706', color: '#ffffff',
                fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                boxShadow: '0 1px 3px rgba(217,119,6,0.4)',
              }}
            >
              <i className="bi-broadcast-pin" style={{ fontSize: 12 }} />
              Open HR Hub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
