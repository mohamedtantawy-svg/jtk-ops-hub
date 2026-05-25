// ── WorkTasksTour (2026-05-25) ─────────────────────────────────────────────
// One-time onboarding modal that introduces the Tasks queue to the team.
// Auto-opens the first time a user signs in after the Phase 1-3 deploy
// (via /api/v1/work-tasks/tour-status). Dismissible at any step with the
// "Skip tour" link or the X button; clicking "Done" on the final step
// has the same effect.
//
// Persistence: GET the status on App.jsx mount; POST after dismiss so it
// never re-appears for the same user (per-email app_settings sentinel).
// Skipped automatically while a super-admin is impersonating someone so
// an admin testing as Bob doesn't get Bob's tour.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../services/api';

const STEPS = [
  {
    id: 'welcome',
    icon: 'bi-check2-square',
    iconBg: 'var(--purple-light)',
    iconColor: 'var(--purple)',
    title: 'Meet Tasks',
    body: 'A new home for todos, manual work tracking, and team-wide assignments — built right into Ops Hub. Your old home-page checklist has been moved over automatically, so nothing is lost.',
    highlights: [
      { icon: 'bi-arrow-up-right', label: 'Find it in the top nav as "Tasks"' },
      { icon: 'bi-house', label: 'A compact card lives on Home for quick add' },
      { icon: 'bi-inbox', label: 'A "Tasks" tab is also in Workspace' },
    ],
  },
  {
    id: 'capture',
    icon: 'bi-plus-circle',
    iconBg: '#E0F2FE',
    iconColor: '#0369a1',
    title: 'Capture work in one line',
    body: 'Type a task and hit Enter — that\'s the quick path. Expand the composer to add a description, multiple assignees, followers, due date, and priority.',
    highlights: [
      { icon: 'bi-keyboard', label: 'Enter creates from anywhere a composer is visible' },
      { icon: 'bi-people-fill', label: 'Add multiple primary assignees and follower watchers' },
      { icon: 'bi-at', label: 'Comments support @-mentions — the person gets a bell ping' },
    ],
  },
  {
    id: 'organise',
    icon: 'bi-flag',
    iconBg: '#FEF3C7',
    iconColor: '#92400E',
    title: 'Prioritise, schedule, and stay covered',
    body: 'Four priorities (Urgent / High / Normal / Low) — each one has a smart SLA default if you don\'t set a due date. When an assignee is on approved leave, the row badges "On leave" so you can follow up.',
    highlights: [
      { icon: 'bi-clock-history', label: 'Urgent 4h · High 1d · Normal 3d · Low 7d business time' },
      { icon: 'bi-calendar-event', label: 'Override with an explicit due date when you have one' },
      { icon: 'bi-calendar-x', label: 'OOO assignees are flagged automatically on every row' },
    ],
  },
  {
    id: 'stay-on-top',
    icon: 'bi-bell',
    iconBg: '#DCFCE7',
    iconColor: '#15803d',
    title: 'Get pinged at the right moment',
    body: 'The bell now surfaces five new task notification types so nothing slips. You only get notified for tasks where you are the creator, an assignee, a follower, or someone @-mentioned in a comment.',
    highlights: [
      { icon: 'bi-person-plus', label: 'Assigned + Unassigned' },
      { icon: 'bi-chat-left-dots', label: 'Comments + @-mentions' },
      { icon: 'bi-arrow-repeat', label: 'Status changes' },
      { icon: 'bi-exclamation-triangle', label: 'Due-soon (24h before) + Overdue' },
    ],
  },
];

export default function WorkTasksTour({ user, onClose, onGoToTasks }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const total = STEPS.length;
  const current = STEPS[step];

  // Persist dismiss server-side; resolves silently and never blocks close.
  const persistSeen = useCallback(async (lastStep) => {
    try {
      await apiFetch('/work-tasks/tour-status', {
        method: 'POST',
        body: JSON.stringify({ lastStep }),
      });
    } catch (err) {
      // Failure is non-fatal — the tour just shows once more next time.
      console.warn('[work-tasks tour] dismiss POST failed:', err?.message);
    }
  }, []);

  const dismiss = useCallback(async ({ goToTasks = false } = {}) => {
    if (busy) return;
    setBusy(true);
    await persistSeen(step);
    setBusy(false);
    if (goToTasks) onGoToTasks?.();
    onClose?.();
  }, [busy, step, persistSeen, onClose, onGoToTasks]);

  const next = useCallback(() => {
    if (step < total - 1) setStep(s => s + 1);
    else dismiss({ goToTasks: true });
  }, [step, total, dismiss]);
  const prev = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  // Esc + arrow keys for keyboard nav.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') dismiss();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss, next, prev]);

  const greeting = useMemo(() => {
    const name = (user?.name || '').split(' ')[0];
    if (!name) return '';
    return `Hey ${name}, `;
  }, [user?.name]);

  const isLast = step === total - 1;

  return (
    <>
      <div
        onClick={() => dismiss()}
        style={{
          position: 'fixed', inset: 0, zIndex: 1300,
          background: 'rgba(15, 12, 24, 0.55)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tasks onboarding tour"
        style={{
          position: 'fixed', inset: 0, zIndex: 1301,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, pointerEvents: 'none',
        }}
      >
        <div style={{
          width: 560, maxWidth: '100%',
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 18,
          boxShadow: '0 30px 80px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          fontFamily: 'inherit',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-light)',
          }}>
            <span style={{
              padding: '3px 8px', borderRadius: 'var(--radius-pill)',
              background: 'var(--purple-light)', color: 'var(--purple)',
              fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>New</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Step {step + 1} of {total}
            </span>
            <button
              type="button"
              onClick={() => dismiss()}
              aria-label="Close tour"
              style={{
                marginLeft: 'auto',
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600,
                padding: '4px 8px', borderRadius: 'var(--radius-md)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >Skip tour <i className="bi bi-x-lg" /></button>
          </div>

          {/* Body */}
          <div style={{ padding: '28px 28px 24px' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: current.iconBg,
              color: current.iconColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18,
            }}>
              <i className={`bi ${current.icon}`} style={{ fontSize: 30 }} />
            </div>
            <h2 style={{
              fontSize: 22, fontWeight: 700, color: 'var(--text)',
              margin: 0, lineHeight: 1.25, letterSpacing: '-0.01em',
            }}>
              {step === 0 && greeting}{current.title}
            </h2>
            <p style={{
              marginTop: 10, marginBottom: 18,
              fontSize: 14, lineHeight: 1.55,
              color: 'var(--text-secondary)',
            }}>
              {current.body}
            </p>

            {Array.isArray(current.highlights) && current.highlights.length > 0 && (
              <ul style={{
                listStyle: 'none', padding: 0, margin: 0,
                display: 'flex', flexDirection: 'column', gap: 10,
                background: 'var(--surface-2)',
                borderRadius: 'var(--radius-lg)',
                padding: 12,
              }}>
                {current.highlights.map((h, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      fontSize: 13, color: 'var(--text)',
                    }}
                  >
                    <span style={{
                      width: 26, height: 26, borderRadius: 8,
                      background: 'var(--surface)',
                      color: current.iconColor,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid var(--border-light)',
                      flexShrink: 0,
                    }}>
                      <i className={`bi ${h.icon}`} style={{ fontSize: 13 }} />
                    </span>
                    <span style={{ minWidth: 0 }}>{h.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 18px',
            borderTop: '1px solid var(--border-light)',
            background: 'var(--surface-2)',
          }}>
            {/* Step dots */}
            <div style={{ display: 'inline-flex', gap: 6 }}>
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`Go to step ${i + 1}`}
                  style={{
                    width: i === step ? 22 : 8, height: 8,
                    borderRadius: 4,
                    background: i === step ? 'var(--purple)' : 'var(--surface-3)',
                    border: 'none', padding: 0,
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                />
              ))}
            </div>

            <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
              <button
                type="button"
                onClick={prev}
                disabled={step === 0 || busy}
                style={{
                  ...secondaryBtn,
                  opacity: step === 0 ? 0.4 : 1,
                  cursor: step === 0 || busy ? 'not-allowed' : 'pointer',
                }}
              >Back</button>
              <button
                type="button"
                onClick={next}
                disabled={busy}
                style={{
                  ...primaryBtn,
                  opacity: busy ? 0.7 : 1,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {isLast ? (
                  <>Open Tasks <i className="bi bi-arrow-right" /></>
                ) : (
                  <>Next <i className="bi bi-arrow-right-short" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 36, padding: '0 16px',
  background: 'var(--purple)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-lg)',
  fontSize: 13, fontWeight: 600,
  fontFamily: 'inherit',
  transition: 'background .12s',
};

const secondaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 36, padding: '0 14px',
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  fontSize: 13, fontWeight: 600,
  fontFamily: 'inherit',
  transition: 'all .12s',
};
