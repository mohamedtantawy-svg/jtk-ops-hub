// ── DetailSlideOut ────────────────────────────────────────────────────
// Right-anchored panel anchored on a single time-off event. When the
// event has an associated handover we hydrate the full row (coverers,
// checklist items, log) and surface the context-aware actions footer:
// Submit / Accept / Decline / Approve / Reject / Cancel / checklist
// toggle. The footer buttons gate on viewer role + current handover
// status.
//
// Phase 1 of this component was read-only. Phase 2 adds:
//   • Live checklist tick on click (PATCH /handovers/:id/checklist/:itemId)
//   • Actions footer wired through handoversApi.js
//   • Reject + Cancel reason modal sub-prompt
//   • Audit timeline rendered from handover.log

import { useCallback, useEffect, useMemo, useState } from 'react';
import Avatar from '../ui/Avatar';
import {
  acceptHandover,
  approveHandover,
  cancelHandover,
  declineHandover,
  getHandover,
  rejectHandover,
  submitHandover,
  toggleChecklistItem,
} from '../../services/handoversApi';
import {
  HANDOVER_STATUSES,
  TERMINAL_STATUSES,
  eventTiming,
  handoverStateColor,
  daysBetween,
  daysUntil,
} from '../../lib/handover-helpers';

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
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function humanStatus(status) {
  if (!status) return 'No handover';
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

const EVENT_TYPE_LABEL = {
  created:                  'Created',
  edited:                   'Edited',
  submitted:                'Submitted for coverage',
  coverer_invited:          'Coverer invited',
  coverer_accepted:         'Coverer accepted',
  coverer_declined:         'Coverer declined',
  coverer_added:            'Coverer added',
  coverer_removed:          'Coverer removed',
  manager_approved:         'Manager approved',
  manager_rejected:         'Manager rejected',
  activated:                'Activated',
  completed:                'Completed',
  extended:                 'Extended',
  cancelled:                'Cancelled',
  expired:                  'Expired',
  force_cancelled:          'Force-cancelled by admin',
  checklist_item_completed: 'Checklist item completed',
  checklist_item_reopened:  'Checklist item reopened',
  reminder_pre48h_sent:     '48-hour reminder sent',
  reminder_pre24h_sent:     '24-hour alert sent',
  reminder_handback_sent:   'Return-day reminder sent',
  handback_logged:          'Handback summary logged',
  dates_drifted:            'OOO dates changed upstream',
};

function lc(v) { return (v || '').toLowerCase(); }

function DetailSlideOut({
  event,
  membersByEmail,
  onClose,
  todayIso,
  currentUserEmail,
  currentUserRole,
  onUpdated,        // optional — called whenever a write completes so OOOView can refresh
  onSubmitDraft,    // optional — called when caller clicks "Open wizard for missing-handover"
  onToast,
}) {
  const [fullHandover, setFullHandover] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(null);   // string id of pending action
  const [pendingPrompt, setPendingPrompt] = useState(null);   // { kind: 'decline' | 'reject' | 'cancel', onConfirm }

  const handoverId = event?.handover?.id || null;

  // Hydrate full handover (with coverers + checklist + log) when one exists.
  const reload = useCallback(async () => {
    if (!handoverId) {
      setFullHandover(null);
      return;
    }
    setLoading(true);
    try {
      const res = await getHandover(handoverId);
      setFullHandover(res?.handover || null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[DetailSlideOut] reload failed:', err?.message);
      setFullHandover(null);
    } finally {
      setLoading(false);
    }
  }, [handoverId]);

  useEffect(() => { reload(); }, [reload]);

  // Close on ESC.
  useEffect(() => {
    if (!event) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [event, onClose]);

  if (!event) return null;

  const member = membersByEmail?.get(lc(event.work_email));
  const timing = eventTiming(event, todayIso);
  const handover = fullHandover || event.handover || null;
  const colour = handoverStateColor({ handover, eventInPast: timing === 'past' });
  const statusColours = STATUS_COLOURS[colour] || STATUS_COLOURS.red;
  const totalDays = daysBetween(event.start_date, event.end_date) + 1;
  const startsIn = daysUntil(event.start_date, todayIso);

  const callerLc = lc(currentUserEmail);
  const isOwn      = lc(event.work_email) === callerLc;
  const isManager  = handover && lc(handover.manager_email) === callerLc;
  const isCoverer  = handover ? handover.coverers?.some(c => lc(c.coverer_email) === callerLc) : false;
  const isAdminish = currentUserRole === 'admin' || currentUserRole === 'regional_manager';

  const coverers = handover?.coverers || event.handover?.coverers || [];
  const checklistItems = handover?.checklist_items || [];
  const log = handover?.log || [];

  const myCovererRow = coverers.find(c => lc(c.coverer_email) === callerLc);

  // Action handlers
  async function runAction(name, fn, { successMsg } = {}) {
    setBusyAction(name);
    try {
      await fn();
      await reload();
      onUpdated?.();
      if (successMsg) onToast?.({ kind: 'success', message: successMsg });
    } catch (err) {
      onToast?.({ kind: 'error', message: err?.message || 'Action failed' });
    } finally {
      setBusyAction(null);
    }
  }

  // Wraps actions that need a free-text reason prompt.
  function askReason(kind, defaultMessage, onConfirm) {
    setPendingPrompt({
      kind,
      defaultMessage,
      onConfirm: async (reason) => {
        setPendingPrompt(null);
        await onConfirm(reason);
      },
    });
  }

  async function onChecklistToggle(item, completed) {
    if (!handoverId) return;
    await runAction(`check_${item.item_id}`, async () => {
      await toggleChecklistItem(handoverId, item.item_id, { completed });
    });
  }

  // Footer buttons — built dynamically based on viewer role + status.
  const status = handover?.status;
  const footerButtons = [];
  if (!handover && isOwn) {
    footerButtons.push({
      id: 'open_wizard',
      kind: 'primary',
      label: 'Submit handover',
      onClick: () => onSubmitDraft?.(event),
    });
  }
  if (handover && (isOwn || isAdminish) && status === HANDOVER_STATUSES.DRAFT) {
    footerButtons.push({
      id: 'submit',
      kind: 'primary',
      label: 'Submit for coverage',
      onClick: () => runAction('submit', () => submitHandover(handoverId), {
        successMsg: 'Submitted — coverers notified',
      }),
    });
  }
  if (handover && isCoverer && status === HANDOVER_STATUSES.PENDING_COVERAGE_ACCEPTANCE && myCovererRow?.acceptance_status === 'pending') {
    footerButtons.push({
      id: 'accept',
      kind: 'primary',
      label: 'Accept coverage',
      onClick: () => runAction('accept', () => acceptHandover(handoverId), {
        successMsg: 'Accepted',
      }),
    });
    footerButtons.push({
      id: 'decline',
      kind: 'secondary',
      label: 'Decline',
      onClick: () => askReason('decline', 'Sorry, I can\'t cover this window…', async (reason) => {
        await runAction('decline', () => declineHandover(handoverId, reason || null), {
          successMsg: 'Declined',
        });
      }),
    });
  }
  if (handover && (isManager || isAdminish) && status === HANDOVER_STATUSES.PENDING_MANAGER_APPROVAL) {
    footerButtons.push({
      id: 'approve',
      kind: 'primary',
      label: 'Approve',
      onClick: () => runAction('approve', () => approveHandover(handoverId, null), {
        successMsg: 'Approved',
      }),
    });
    footerButtons.push({
      id: 'reject',
      kind: 'danger',
      label: 'Reject',
      onClick: () => askReason('reject', '', async (reason) => {
        if (!reason) {
          onToast?.({ kind: 'error', message: 'A rejection reason is required.' });
          return;
        }
        await runAction('reject', () => rejectHandover(handoverId, reason), {
          successMsg: 'Rejected',
        });
      }),
    });
  }
  if (handover && status && !TERMINAL_STATUSES.has(status)) {
    const canCancel = isOwn || isManager || isAdminish;
    if (canCancel) {
      footerButtons.push({
        id: 'cancel',
        kind: 'ghost',
        label: 'Cancel handover',
        onClick: () => askReason('cancel', '', async (reason) => {
          await runAction('cancel', () => cancelHandover(handoverId, reason || null), {
            successMsg: 'Cancelled',
          });
        }),
      });
    }
  }

  const buttonStyles = {
    primary: { bg: 'var(--purple, #7c3aed)', fg: 'white', border: 'transparent' },
    secondary: { bg: 'var(--surface)', fg: 'var(--text)', border: 'var(--border)' },
    danger: { bg: '#B91C1C', fg: 'white', border: 'transparent' },
    ghost: { bg: 'transparent', fg: 'var(--text-secondary)', border: 'transparent' },
  };

  return (
    <>
      <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.30)', zIndex: 50 }} />
      <aside role="dialog" aria-modal="true" aria-label="Handover detail" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(560px, 95vw)', background: 'var(--surface)',
        boxShadow: '-12px 0 32px rgba(15,23,42,0.10)', zIndex: 51,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'inherit',
      }}>
        <header style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <Avatar
            name={member?.name || event.work_email}
            initials={member?.initials}
            src={member?.avatarUrl || member?.avatar_url}
            size="lg"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{member?.name || event.work_email}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {formatRange(event.start_date, event.end_date)} · {totalDays} day{totalDays === 1 ? '' : 's'}
              {timing === 'upcoming' && startsIn > 0 && ` · starts in ${startsIn} day${startsIn === 1 ? '' : 's'}`}
              {timing === 'active' && ' · OOO now'}
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '3px 10px', borderRadius: 999,
                background: statusColours.bg, color: statusColours.fg, border: `1px solid ${statusColours.border}`,
                fontSize: 11, fontWeight: 600,
              }}>
                {handover ? humanStatus(handover.status) : 'No handover'}
              </span>
              {event.reason && (
                <span style={{
                  marginLeft: 8, display: 'inline-flex', alignItems: 'center',
                  padding: '3px 10px', borderRadius: 999,
                  background: 'rgba(15,23,42,0.06)', color: 'var(--text-secondary)',
                  fontSize: 11, fontWeight: 500,
                }}>{event.reason}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', padding: 6, cursor: 'pointer',
            color: 'var(--text-secondary)', fontFamily: 'inherit',
          }}>
            <i className="bi-x-lg" style={{ fontSize: 16 }} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Coverers */}
          <section>
            <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>Coverers</h3>
            {coverers.length === 0 ? (
              <div style={{
                padding: 14, background: 'rgba(15,23,42,0.03)',
                border: '1px dashed var(--border)', borderRadius: 10,
                fontSize: 13, color: 'var(--text-secondary)',
              }}>
                {handover ? 'No coverers on this handover yet.' : 'No handover has been submitted for this OOO range yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {coverers.map(c => {
                  const m = membersByEmail?.get(lc(c.coverer_email));
                  const countries = Array.isArray(c.country_codes) ? c.country_codes : [];
                  return (
                    <div key={c.coverer_email || c.email} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', border: '1px solid var(--border-light)',
                      borderRadius: 10, background: 'var(--surface)',
                    }}>
                      <Avatar name={m?.name || c.coverer_email} initials={m?.initials} src={m?.avatarUrl || m?.avatar_url} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{m?.name || c.coverer_email || c.email}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{countries.length === 0 ? 'Full coverage' : `Covers ${countries.join(', ')}`}</div>
                      </div>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        background: c.acceptance_status === 'accepted' ? '#DCFCE7'
                                  : c.acceptance_status === 'declined' ? '#FEE2E2'
                                  : '#FEF3C7',
                        color: c.acceptance_status === 'accepted' ? '#166534'
                             : c.acceptance_status === 'declined' ? '#991B1B'
                             : '#92400E',
                      }}>{c.acceptance_status || 'pending'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Checklist */}
          {handover && checklistItems.length > 0 && (
            <section>
              <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>Checklist</h3>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                {checklistItems.filter(i => i.completed).length} / {checklistItems.length} done
              </div>
              <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: 'rgba(15,23,42,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, (100 * checklistItems.filter(i => i.completed).length) / Math.max(1, checklistItems.length))}%`,
                  background: 'var(--purple, #7c3aed)',
                  transition: 'width .2s',
                }} />
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {checklistItems.map(item => {
                  const canToggle = isOwn || isCoverer || isManager || isAdminish;
                  return (
                    <label key={item.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--border-light)',
                      background: item.completed ? 'rgba(124, 58, 237, 0.06)' : 'var(--surface)',
                      cursor: canToggle ? 'pointer' : 'default', opacity: busyAction === `check_${item.item_id}` ? 0.6 : 1,
                    }}>
                      <input
                        type="checkbox"
                        checked={!!item.completed}
                        disabled={!canToggle || busyAction === `check_${item.item_id}`}
                        onChange={(e) => onChecklistToggle(item, e.target.checked)}
                        style={{ marginTop: 3, cursor: canToggle ? 'pointer' : 'default' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{item.label}</div>
                        {item.completed && item.completed_at && (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                            ✓ {relTime(item.completed_at)}{item.completed_by ? ` · ${item.completed_by}` : ''}
                          </div>
                        )}
                      </div>
                      {item.required && (
                        <span style={{ fontSize: 9, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Required</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Audit timeline */}
          {handover && log.length > 0 && (
            <section>
              <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>Audit timeline</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {log.slice(0, 30).map(entry => (
                  <div key={entry.id} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    fontSize: 12, color: 'var(--text-secondary)',
                  }}>
                    <span style={{ flexShrink: 0, opacity: 0.6, fontSize: 10, marginTop: 2 }}>{relTime(entry.created_at)}</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{EVENT_TYPE_LABEL[entry.event_type] || entry.event_type}</span>
                      {entry.actor_name && <span> · {entry.actor_name}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!handover && isOwn && (
            <div style={{
              padding: 14, borderRadius: 10,
              background: 'rgba(124, 58, 237, 0.08)',
              border: '1px solid rgba(124, 58, 237, 0.30)',
              color: 'var(--purple, #7c3aed)',
              fontSize: 13, fontWeight: 500,
            }}>
              <i className="bi-info-circle" style={{ marginRight: 8 }} />
              No handover yet — submit one to brief your coverer before you go OOO.
            </div>
          )}

          {loading && handoverId && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: 8 }}>
              Loading handover detail…
            </div>
          )}
        </div>

        {footerButtons.length > 0 && (
          <footer style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--border-light)',
            display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, flexWrap: 'wrap',
          }}>
            {footerButtons.map(btn => {
              const s = buttonStyles[btn.kind] || buttonStyles.secondary;
              const isBusy = busyAction === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={btn.onClick}
                  disabled={isBusy || busyAction !== null}
                  style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', opacity: (isBusy || (busyAction && busyAction !== btn.id)) ? 0.55 : 1,
                  }}
                >
                  {isBusy ? 'Working…' : btn.label}
                </button>
              );
            })}
          </footer>
        )}
      </aside>

      {pendingPrompt && (
        <ReasonPrompt
          kind={pendingPrompt.kind}
          defaultMessage={pendingPrompt.defaultMessage}
          onCancel={() => setPendingPrompt(null)}
          onConfirm={pendingPrompt.onConfirm}
        />
      )}
    </>
  );
}

function ReasonPrompt({ kind, defaultMessage, onCancel, onConfirm }) {
  const [text, setText] = useState(defaultMessage || '');
  const isReject = kind === 'reject';
  const title = kind === 'decline' ? 'Decline coverage'
              : kind === 'reject'  ? 'Reject handover'
              : 'Cancel handover';
  const ctaLabel = kind === 'decline' ? 'Decline'
                 : kind === 'reject'  ? 'Reject'
                 : 'Cancel handover';
  return (
    <>
      <div role="presentation" onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 70 }} />
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(480px, 92vw)', background: 'var(--surface)',
        borderRadius: 16, boxShadow: '0 20px 60px rgba(15,23,42,0.20)',
        padding: 22, zIndex: 71, fontFamily: 'inherit',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          {isReject ? 'A reason is required.' : 'Optional reason — visible to everyone on this handover.'}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value.slice(0, 1000))}
          rows={4}
          style={{
            width: '100%', resize: 'vertical', padding: 10,
            border: '1px solid var(--border)', borderRadius: 10,
            fontFamily: 'inherit', fontSize: 13, color: 'var(--text)',
            background: 'var(--surface)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onCancel} style={{
            padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Back</button>
          <button type="button"
            onClick={() => onConfirm(text.trim() || null)}
            disabled={isReject && !text.trim()}
            style={{
              padding: '8px 16px', borderRadius: 8,
              background: isReject ? '#B91C1C' : 'var(--purple, #7c3aed)',
              color: 'white', border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', opacity: (isReject && !text.trim()) ? 0.5 : 1,
            }}
          >{ctaLabel}</button>
        </div>
      </div>
    </>
  );
}

export default DetailSlideOut;
