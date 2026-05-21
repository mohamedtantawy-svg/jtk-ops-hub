// ── SubmitFeedbackPicker (2026-05-21) ──────────────────────────────────────
// Two-card modal that routes the submitter to the right composer. Replaces
// the previous direct "+ New Feedback" jump.
//
//   • Ops Hub Feedback — bug or improvement idea about the Ops Hub app
//     itself. Opens the existing CreateFeedbackModal.
//   • Escalation Zero  — strategic improvement, process gap, or product
//     feedback reviewed by leadership. Opens the dedicated
//     CreateEscalationZeroModal (function dropdown, ideal solution,
//     multi-country, linked Zendesk / Jira URLs).
//
// Mounted by both:
//   1. FeedbackView's "+ New request" button (per Mohamed's 2026-05-21
//      spec: "from the feedback tab directly, if they clicked on
//      New Request they should see both options").
//   2. DeelTopNav's Quick Create menu under "Submit Feedback" (replaces
//      the standalone "Ops Hub Feedback" entry that previously jumped
//      straight into the feedback composer).
//
// The parent owns the chosen kind. On pick → onPick(kind) fires →
// parent closes the picker and opens the right composer for that kind.

import { useEffect } from 'react';

const CARDS = [
  {
    kind: 'ops_hub_feedback',
    label: 'Ops Hub Feedback',
    desc: 'Bug, idea, or improvement about the Ops Hub app itself.',
    icon: 'bi-lightbulb-fill',
    accent: '#d97706',
    bg: '#fff8e6',
  },
  {
    kind: 'escalation_zero',
    label: 'Escalation Zero',
    desc: 'Strategic improvement, process gap, or product feedback. Reviewed by leadership.',
    icon: 'bi-stars',
    accent: '#7c3aed',
    bg: '#f3eff8',
  },
];

export default function SubmitFeedbackPicker({ onClose, onPick }) {
  // ESC to close + lock body scroll while the picker is open. Mirrors the
  // pattern every other modal in this codebase uses so muscle memory is
  // preserved.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-feedback-picker-title"
      style={overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={modal}>
        {/* Inline responsive — cards stack at narrow widths. */}
        <style>{`
          .submit-feedback-picker-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
          @media (max-width: 640px) { .submit-feedback-picker-grid { grid-template-columns: 1fr; } }
          .submit-feedback-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,0.08); border-color: var(--purple, #7c3aed); }
          .submit-feedback-card:focus-visible { outline: 2px solid var(--purple, #7c3aed); outline-offset: 2px; }
        `}</style>

        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <div id="submit-feedback-picker-title" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
              Submit feedback
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
              Pick the flow that matches what you'd like to raise.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            style={iconBtn}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <i className="bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        <div style={body}>
          <div className="submit-feedback-picker-grid">
            {CARDS.map((c) => (
              <button
                key={c.kind}
                type="button"
                className="submit-feedback-card"
                onClick={() => onPick?.(c.kind)}
                style={card}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: c.bg, color: c.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12,
                }}>
                  <i className={c.icon} style={{ fontSize: 19 }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                  {c.label}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  {c.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={footer}>
          <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Styles (match the design tokens used by every other modal in this app) ─
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
  zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
};
const modal = {
  width: 'min(720px, 100%)', maxHeight: 'min(85vh, 720px)',
  background: 'var(--surface)', borderRadius: 14, boxShadow: 'var(--shadow-lg, 0 24px 64px rgba(15,23,42,0.18))',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  border: '1px solid var(--border-light)',
};
const header = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  padding: '16px 18px 0', gap: 12,
};
const body = {
  padding: '16px 18px',
  flex: 1, minHeight: 0, overflowY: 'auto',
};
const footer = {
  padding: '12px 18px 16px', display: 'flex', justifyContent: 'flex-end',
  borderTop: '1px solid var(--border-light)', background: 'var(--surface-2)',
};
const iconBtn = {
  width: 32, height: 32, borderRadius: 8, border: 'none',
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background .12s',
};
const ghostBtn = {
  padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
};
const card = {
  textAlign: 'left', padding: 18, borderRadius: 14,
  background: 'var(--surface)', border: '1px solid var(--border)',
  cursor: 'pointer', transition: 'transform .12s, box-shadow .12s, border-color .12s',
};
