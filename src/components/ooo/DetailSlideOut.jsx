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
  cancelHandover,
  declineHandover,
  getHandover,
  submitHandover,
  toggleChecklistItem,
  listHandoverComments,
  postHandoverComment,
} from '../../services/handoversApi';
import { deleteTimeOffEvent } from '../../services/timeOffApi';
import { listCountryHandoverDocs, getCountryHandoverDoc } from '../../services/countryHandoverDocsApi';
import LogHandbackModal from './LogHandbackModal';
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

// Client-side mirror of `canManageTimeOffFor` in src/lib/queue-scoping.js.
// Keeps the Delete button hidden when the caller can't act — the server is
// still the authority, so a 403 toast surfaces the same message if the
// roster cache and the server view ever drift.
function canCallerManageTarget(callerEmail, callerRole, targetEmail, membersByEmail) {
  if (!callerEmail || !targetEmail) return false;
  const callerLc = String(callerEmail).toLowerCase();
  const targetLc = String(targetEmail).toLowerCase();
  if (callerLc === targetLc) return true;
  if (callerRole === 'admin') return true;
  const targetMember = membersByEmail?.get?.(targetLc);
  if (!targetMember) return false;
  const directMgr = String(targetMember.managerEmail || '').toLowerCase();
  if (callerRole === 'team_lead') return directMgr === callerLc;
  if (callerRole === 'regional_manager') {
    let cursor = directMgr;
    let safety = 0;
    while (cursor && safety++ < 20) {
      if (cursor === callerLc) return true;
      const next = membersByEmail?.get?.(cursor);
      cursor = String(next?.managerEmail || '').toLowerCase();
    }
    return false;
  }
  return false;
}

function DetailSlideOut({
  event,
  membersByEmail,
  onClose,
  todayIso,
  currentUserEmail,
  currentUserRole,
  onUpdated,        // optional — called whenever a write completes so OOOView can refresh
  onSubmitDraft,    // optional — called when caller clicks "Open wizard for missing-handover"
  onEdit,           // optional — called with the event when caller clicks Edit; OOOView opens the modal
  onToast,
}) {
  const [fullHandover, setFullHandover] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(null);   // string id of pending action
  const [pendingPrompt, setPendingPrompt] = useState(null);   // { kind: 'decline' | 'reject' | 'cancel', onConfirm }
  const [handbackOpen, setHandbackOpen] = useState(false);
  // Delete-time-off busy flag — hoisted above the early-return at L~175 so
  // the hook order is stable regardless of whether `event` is set. The
  // 2026-05-13 first version placed this AFTER the `if (!event) return null;`
  // guard, which gave React error #310 ("Rendered fewer hooks than expected")
  // the moment a user clicked Submit / Delete and the panel re-rendered
  // with event toggling. Rules of hooks — every render must call the same
  // hooks in the same order.
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Phase E: country-doc summaries (left-rail-style cards) + per-CC
  // expanded reader cache. We fetch the doc summaries once per handover
  // load and the full doc lazily when the user expands the card.
  const [countryDocList, setCountryDocList] = useState([]);
  const [countryDocOpen, setCountryDocOpen] = useState(() => new Set());
  const [countryDocFull, setCountryDocFull] = useState({}); // { CC: doc }
  // Phase E: coverer ↔ requester comment thread.
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);

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

  // Phase E: fetch the country docs summary + comments whenever a
  // handover is loaded. The summary fetch returns the union; we filter
  // to the handover's covered countries in render.
  useEffect(() => {
    if (!handoverId) {
      setCountryDocList([]);
      setComments([]);
      return;
    }
    let cancelled = false;
    listCountryHandoverDocs()
      .then(res => { if (!cancelled) setCountryDocList(Array.isArray(res?.items) ? res.items : []); })
      .catch(() => { if (!cancelled) setCountryDocList([]); });
    listHandoverComments(handoverId)
      .then(res => { if (!cancelled) setComments(Array.isArray(res?.items) ? res.items : []); })
      .catch(() => { if (!cancelled) setComments([]); });
    return () => { cancelled = true; };
  }, [handoverId]);

  const toggleCountryDoc = useCallback(async (cc) => {
    setCountryDocOpen(prev => {
      const next = new Set(prev);
      if (next.has(cc)) next.delete(cc);
      else next.add(cc);
      return next;
    });
    if (!countryDocFull[cc]) {
      try {
        const res = await getCountryHandoverDoc(cc);
        if (res?.item) setCountryDocFull(prev => ({ ...prev, [cc]: res.item }));
      } catch (err) {
        // Surface a soft error inline — we don't toast to avoid noise on
        // a coverer who lacks read access to a draft (the API will 403
        // and the card stays collapsed).
        // eslint-disable-next-line no-console
        console.warn('[DetailSlideOut] country doc fetch failed:', err?.message);
      }
    }
  }, [countryDocFull]);

  async function postComment() {
    if (!handoverId || !commentDraft.trim() || postingComment) return;
    setPostingComment(true);
    try {
      const eventType = isCoverer ? 'coverer_question' : 'requester_reply';
      const res = await postHandoverComment(handoverId, { text: commentDraft, event_type: eventType });
      if (res?.item) setComments(prev => [...prev, res.item]);
      setCommentDraft('');
    } catch (err) {
      onToast?.({ kind: 'error', message: err?.body?.error || err?.message || 'Comment failed' });
    } finally {
      setPostingComment(false);
    }
  }

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
  const canDelete  = canCallerManageTarget(currentUserEmail, currentUserRole, event.work_email, membersByEmail);
  const handleDelete = async () => {
    if (!canDelete || deleteBusy) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Delete this time-off entry?\n\n${event.work_email} · ${event.start_date} → ${event.end_date}\n\nThis can't be undone.`)
      : false;
    if (!confirmed) return;
    setDeleteBusy(true);
    try {
      await deleteTimeOffEvent(event.id);
      onToast?.({ kind: 'success', message: 'Time-off entry removed.' });
      onUpdated?.();
      onClose?.();
    } catch (err) {
      onToast?.({ kind: 'error', message: err?.body?.error || err?.message || 'Delete failed' });
    } finally {
      setDeleteBusy(false);
    }
  };

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
  // Approve / Reject removed 2026-05-18 — TL approval is no longer part
  // of the state machine (HANDOVER_TEMPLATE_REVAMP_PLAN.md §4.2).
  // Managers still see the handover via the TEAM lens and can post
  // questions via the comment thread above, but they don't gate it.
  if (handover && status === HANDOVER_STATUSES.ACTIVE && (isCoverer || isAdminish)) {
    footerButtons.push({
      id: 'log_handback',
      kind: 'primary',
      label: 'Log handback',
      onClick: () => setHandbackOpen(true),
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
          {canDelete && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(event)}
              disabled={deleteBusy}
              aria-label="Edit time-off entry"
              title="Change dates or reason"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                padding: '5px 10px',
                cursor: deleteBusy ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <i className="bi-pencil" style={{ fontSize: 11 }} />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteBusy}
              aria-label="Delete time-off entry"
              title="Delete this entry"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                padding: '5px 10px',
                cursor: deleteBusy ? 'not-allowed' : 'pointer',
                color: '#b91c1c',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <i className="bi-trash" style={{ fontSize: 11 }} />
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </button>
          )}
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

          {/* ── Country handover docs (Phase E) ──────────────────────────
              For each country covered by this handover, render a
              collapsible read-only card. Coverer sees this inline so they
              don't have to leave the slide-out to brush up on a country. */}
          {handover && (() => {
            // Union of covered country codes across coverers. Empty
            // country_codes on a coverer means "everything the requester
            // owns" — without the requester's country list here we fall
            // back to whatever non-empty rows are present.
            const ccs = new Set();
            for (const c of coverers) {
              const arr = Array.isArray(c.country_codes) ? c.country_codes : [];
              for (const cc of arr) if (cc) ccs.add(String(cc).toUpperCase());
            }
            const list = Array.from(ccs).sort();
            if (list.length === 0) return null;
            return (
              <section>
                <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>
                  Country handover docs
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.map(cc => {
                    const summary = countryDocList.find(d => (d.country_code || '').toUpperCase() === cc);
                    const open = countryDocOpen.has(cc);
                    const full = countryDocFull[cc];
                    const fresh = summary && summary.status === 'published' && summary.freshness !== 'stale';
                    return (
                      <div key={cc} style={{
                        border: '1px solid var(--border-light)', borderRadius: 10,
                        background: 'var(--surface)', overflow: 'hidden',
                      }}>
                        <button
                          type="button"
                          onClick={() => toggleCountryDoc(cc)}
                          aria-expanded={open}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            width: '100%', padding: '10px 12px',
                            background: 'transparent', border: 'none',
                            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                          }}
                        >
                          <span style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                            fontSize: 12, fontWeight: 700, color: 'var(--text)', minWidth: 28,
                          }}>{cc}</span>
                          {summary ? (
                            <span style={{
                              padding: '2px 8px', borderRadius: 999,
                              background: fresh ? '#D1FAE5' : '#FEF3C7',
                              color:      fresh ? '#065F46' : '#92400E',
                              fontSize: 10, fontWeight: 700,
                            }}>
                              {summary.status === 'published'
                                ? (summary.freshness === 'stale' ? 'stale' : 'published')
                                : summary.status}
                            </span>
                          ) : (
                            <span style={{
                              padding: '2px 8px', borderRadius: 999,
                              background: '#FEE2E2', color: '#991B1B',
                              fontSize: 10, fontWeight: 700,
                            }}>no doc</span>
                          )}
                          <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)' }}>
                            {summary
                              ? `${summary.counts?.sections_filled || 0}/10 filled · ${summary.counts?.stakeholders || 0} stakeholders · ${summary.counts?.faqs || 0} FAQs`
                              : 'Owner hasn’t created a country doc yet.'}
                          </span>
                          <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        {open && (
                          <div style={{ padding: '6px 14px 14px', borderTop: '1px dashed var(--border)', fontSize: 12, color: 'var(--text)' }}>
                            {!full ? (
                              <div style={{ color: 'var(--text-secondary)' }}>Loading {cc} doc…</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {full.scope_responsibilities && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Scope</div>
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{full.scope_responsibilities}</div>
                                  </div>
                                )}
                                {(full.signatory || full.payroll_cycle || full.payroll_cutoff_date) && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Payroll</div>
                                    <div>
                                      {full.signatory && <div>Signatory: <strong>{full.signatory}</strong></div>}
                                      {full.payroll_cycle && <div>Cycle: <strong>{full.payroll_cycle}</strong></div>}
                                      {full.payroll_cutoff_date && <div>Cut-off: <strong>{full.payroll_cutoff_date}</strong></div>}
                                    </div>
                                  </div>
                                )}
                                {Array.isArray(full.stakeholders) && full.stakeholders.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Stakeholders</div>
                                    {full.stakeholders.map((s, i) => (
                                      <div key={i}>{s.role}{s.label ? ` (${s.label})` : ''}: <strong>{s.name || '—'}</strong>{s.email ? ` · ${s.email}` : ''}</div>
                                    ))}
                                  </div>
                                )}
                                {Array.isArray(full.benefits) && full.benefits.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Benefits</div>
                                    {full.benefits.map((b, i) => (
                                      <div key={i}>{b.benefit_type || '—'}: <strong>{b.provider_name || '—'}</strong>{b.slack_channel ? ` · ${b.slack_channel}` : ''}</div>
                                    ))}
                                  </div>
                                )}
                                {(full.termination_process || full.resignation_process) && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Offboarding</div>
                                    {full.termination_process && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}><em>Termination:</em> {full.termination_process}</div>}
                                    {full.resignation_process && <div style={{ whiteSpace: 'pre-wrap' }}><em>Resignation:</em> {full.resignation_process}</div>}
                                  </div>
                                )}
                                {Array.isArray(full.faqs) && full.faqs.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>FAQs</div>
                                    {full.faqs.map((q, i) => (
                                      <div key={i} style={{ marginBottom: 6 }}>
                                        <div><strong>Q:</strong> {q.question}</div>
                                        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{q.answer}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {full.docs_folder_url && (
                                  <div>
                                    <a href={full.docs_folder_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--purple)' }}>Country docs folder ↗</a>
                                  </div>
                                )}
                                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Updated {full.updated_at ? relTime(full.updated_at) : '—'}{full.updated_by_email ? ` · ${full.updated_by_email}` : ''}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* ── Question for the requester (Phase E) ─────────────────────
              Lightweight comment thread keyed on the handover. Both
              parties can read + post; the requester's view sees the same
              messages with reversed defaults. */}
          {handover && (isOwn || isCoverer || isManager || isAdminish) && (
            <section>
              <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 700 }}>
                {isCoverer && !isOwn ? 'Question for the requester' : 'Comment thread'}
              </h3>
              {comments.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  No comments yet — ask anything the requester should answer before going OOO.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {comments.map(c => {
                    const fromCoverer = c.event_type === 'coverer_question';
                    return (
                      <div key={c.id} style={{
                        padding: '10px 12px',
                        border: '1px solid var(--border-light)',
                        borderRadius: 10,
                        background: fromCoverer ? 'rgba(124, 58, 237, 0.05)' : 'var(--surface)',
                        fontSize: 13, color: 'var(--text)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <strong>{c.actor_name || c.actor_email}</strong>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{relTime(c.created_at)}</span>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={commentDraft}
                  onChange={e => setCommentDraft(e.target.value.slice(0, 4000))}
                  placeholder={isCoverer && !isOwn ? 'Ask the requester for clarification…' : 'Add a comment for the coverer / team…'}
                  rows={2}
                  style={{
                    width: '100%', resize: 'vertical', padding: 8,
                    border: '1px solid var(--border)', borderRadius: 8,
                    fontFamily: 'inherit', fontSize: 13, color: 'var(--text)',
                    background: 'var(--surface)',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={postComment}
                    disabled={!commentDraft.trim() || postingComment}
                    style={{
                      padding: '6px 14px', borderRadius: 8, border: 'none',
                      background: 'var(--purple, #7c3aed)', color: 'white',
                      fontSize: 12, fontWeight: 700,
                      cursor: postingComment || !commentDraft.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      opacity: postingComment || !commentDraft.trim() ? 0.55 : 1,
                    }}
                  >
                    {postingComment ? 'Posting…' : 'Send'}
                  </button>
                </div>
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

      {handbackOpen && handover && (
        <LogHandbackModal
          handover={handover}
          onClose={() => setHandbackOpen(false)}
          onSubmitted={async () => {
            setHandbackOpen(false);
            await reload();
            onUpdated?.();
          }}
          onToast={onToast}
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
