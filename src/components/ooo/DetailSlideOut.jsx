// ── DetailSlideOut ────────────────────────────────────────────────────
// Right-anchored panel mirroring the existing HR Hub / Leaders Alerts
// detail panels. Phase 1 is read-only: header + coverers + checklist
// progress + audit timeline (when present) + a clear next-action hint
// for the empty-handover case.
//
// Phase 2 swaps the bottom "Submit handover" CTA for the full actions
// footer (Save / Submit / Accept / Decline / Approve / etc.).

import { useEffect } from 'react';
import Avatar from '../ui/Avatar';
import { eventTiming, handoverStateColor, daysBetween, daysUntil } from '../../lib/handover-helpers';

const STATUS_COLOURS = {
  green: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
  amber: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  red:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  slate: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' },
  grey:  { bg: '#E5E7EB', fg: '#6B7280', border: '#D1D5DB' },
};

function formatRange(start, end) {
  if (!start || !end) return '';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function humanStatus(status) {
  if (!status) return 'No handover';
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function DetailSlideOut({ event, membersByEmail, onClose, todayIso, currentUserEmail }) {
  // Close on ESC for keyboard accessibility.
  useEffect(() => {
    if (!event) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [event, onClose]);

  if (!event) return null;

  const member = membersByEmail?.get((event.work_email || '').toLowerCase());
  const timing = eventTiming(event, todayIso);
  const colour = handoverStateColor({ handover: event.handover, eventInPast: timing === 'past' });
  const statusColours = STATUS_COLOURS[colour] || STATUS_COLOURS.red;
  const totalDays = daysBetween(event.start_date, event.end_date) + 1;
  const startsIn = daysUntil(event.start_date, todayIso);

  const isOwn = (event.work_email || '').toLowerCase() === (currentUserEmail || '').toLowerCase();
  const coverers = event.handover?.coverers || [];

  return (
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,0.30)',
          zIndex: 50,
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Handover detail"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(560px, 95vw)',
          background: 'var(--surface)',
          boxShadow: '-12px 0 32px rgba(15,23,42,0.10)',
          zIndex: 51,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <Avatar
            name={member?.name || event.work_email}
            initials={member?.initials}
            src={member?.avatarUrl || member?.avatar_url}
            size="lg"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {member?.name || event.work_email}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {formatRange(event.start_date, event.end_date)} · {totalDays} day{totalDays === 1 ? '' : 's'}
              {timing === 'upcoming' && startsIn > 0 && ` · starts in ${startsIn} day${startsIn === 1 ? '' : 's'}`}
              {timing === 'active' && ' · OOO now'}
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 10px',
                borderRadius: 999,
                background: statusColours.bg,
                color: statusColours.fg,
                border: `1px solid ${statusColours.border}`,
                fontSize: 11,
                fontWeight: 600,
              }}>
                {event.handover ? humanStatus(event.handover.status) : 'No handover'}
              </span>
              {event.reason && (
                <span style={{
                  marginLeft: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: 'rgba(15,23,42,0.06)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 500,
                }}>
                  {event.reason}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
            }}
          >
            <i className="bi-x-lg" style={{ fontSize: 16 }} />
          </button>
        </header>

        {/* Body — sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Coverers */}
          <section>
            <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>
              Coverers
            </h3>
            {coverers.length === 0 ? (
              <div style={{
                padding: 14,
                background: 'rgba(15,23,42,0.03)',
                border: '1px dashed var(--border)',
                borderRadius: 10,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}>
                {event.handover
                  ? 'No coverers on this handover yet.'
                  : 'No handover has been submitted for this OOO range yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {coverers.map(c => {
                  const m = membersByEmail?.get((c.email || '').toLowerCase());
                  const countries = Array.isArray(c.country_codes) ? c.country_codes : [];
                  return (
                    <div key={c.email} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px',
                      border: '1px solid var(--border-light)',
                      borderRadius: 10,
                      background: 'var(--surface)',
                    }}>
                      <Avatar name={m?.name || c.email} initials={m?.initials} src={m?.avatarUrl || m?.avatar_url} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                          {m?.name || c.email}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {countries.length === 0 ? 'Full coverage' : `Covers ${countries.join(', ')}`}
                        </div>
                      </div>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background:
                          c.acceptance_status === 'accepted' ? '#DCFCE7' :
                          c.acceptance_status === 'declined' ? '#FEE2E2' : '#FEF3C7',
                        color:
                          c.acceptance_status === 'accepted' ? '#166534' :
                          c.acceptance_status === 'declined' ? '#991B1B' : '#92400E',
                      }}>
                        {c.acceptance_status || 'pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Checklist progress */}
          {event.handover?.checklist_progress?.total > 0 && (
            <section>
              <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>
                Checklist
              </h3>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {event.handover.checklist_progress.done} / {event.handover.checklist_progress.total} done
              </div>
              <div style={{
                marginTop: 6,
                height: 6,
                borderRadius: 999,
                background: 'rgba(15,23,42,0.06)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, (100 * event.handover.checklist_progress.done) / Math.max(1, event.handover.checklist_progress.total))}%`,
                  background: 'var(--purple, #7c3aed)',
                  transition: 'width .2s',
                }} />
              </div>
            </section>
          )}

          {/* Phase-2 footer hint */}
          {!event.handover && isOwn && (
            <div style={{
              padding: 14,
              borderRadius: 10,
              background: 'rgba(124, 58, 237, 0.08)',
              border: '1px solid rgba(124, 58, 237, 0.30)',
              color: 'var(--purple, #7c3aed)',
              fontSize: 13,
              fontWeight: 500,
            }}>
              <i className="bi-info-circle" style={{ marginRight: 8 }} />
              Submitting a handover from here will land in Phase 2. Until then,
              use this view to plan who you want to cover each block.
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export default DetailSlideOut;
