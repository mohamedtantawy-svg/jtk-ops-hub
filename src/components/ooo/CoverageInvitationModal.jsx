// ── CoverageInvitationModal ───────────────────────────────────────────
// The accept / reject popup a coverer gets when someone asks them to cover
// an OOO window (Mohamed 2026-06-04). It is keyed on a handover id and
// fetches the handover directly via getHandover — it does NOT depend on the
// OOO view having the requester's time-off event loaded. That dependency
// was exactly Insiya's bug ("Cannot click to review OOO coverage request
// from the notification"): the bell deep-link flipped to the OOO view and
// tried to resolve handoverId → time_off_event_id by scanning the COVERER's
// own events, which never contain the requester's event, so the detail
// never opened. Routing the invite notification to this popup fixes it.
//
// Opened from three places, all via App.jsx's single mount:
//   • bell / notifications click on a `handover_coverage_invited` notif
//   • the home-page PendingCoverageBanner "Respond" button
//   • the session-gated auto-prompt when the caller loads with a pending ask
//
// An optional `invite` (from the my-pending-coverages list) lets the modal
// paint instantly; a background getHandover then confirms the row is still
// pending for this caller (guards the race where it was cancelled / someone
// already responded).

import { useEffect, useRef, useState } from 'react';
import { getHandover, acceptHandover, declineHandover } from '../../services/handoversApi';
import { MEMBERS_BY_EMAIL } from '../../data/members';
import { getCountryName } from '../../data/constants';

function fmtRange(start, end) {
  if (!start || !end) return '';
  const fmt = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return String(iso);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

const PURPLE = '#7c3aed';

export default function CoverageInvitationModal({ handoverId, invite = null, userEmail = '', onClose, onResponded }) {
  const backdropRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(!invite); // paint instantly if the list already gave us the row
  const [loadError, setLoadError] = useState(null);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // 'accepted' | 'declined'

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Confirm the live state (status + my acceptance) regardless of how the
  // modal was opened. The coverer is authorised on the [id] GET.
  useEffect(() => {
    let alive = true;
    if (!handoverId) return undefined;
    (async () => {
      try {
        const h = await getHandover(handoverId);
        if (!alive) return;
        // getHandover (apiFetch) resolves to the raw body `{ handover: {...} }`,
        // NOT the handover itself — unwrap it exactly like DetailSlideOut.jsx
        // does (`res?.handover`). Without `.handover`, detail.status and
        // detail.coverers were always undefined → myRow undefined →
        // detailEligible always false → the modal showed "no longer awaiting
        // your response" to EVERY coverer and never rendered Accept/Decline
        // (Ljubica 2026-06-10 "Cannot accept coverage handover").
        setDetail(h?.handover || null);
      } catch (err) {
        if (!alive) return;
        setLoadError(err?.message || 'Could not load this coverage request.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [handoverId]);

  // ── Derived display (prefer confirmed detail, fall back to the invite) ──
  const callerLc = (userEmail || '').toLowerCase();
  const requesterEmail = detail?.requester_email || invite?.requester_email || '';
  const requesterName = invite?.requester_name
    || MEMBERS_BY_EMAIL[(requesterEmail || '').toLowerCase()]?.name
    || requesterEmail
    || 'A teammate';
  const firstName = String(requesterName).split(' ')[0] || requesterName;
  const startDate = detail?.start_date || invite?.start_date;
  const endDate = detail?.end_date || invite?.end_date;
  const reason = (detail?.reason ?? invite?.reason) || null;

  const myRow = detail && callerLc
    ? (detail.coverers || []).find(c => String(c.coverer_email || '').toLowerCase() === callerLc)
    : null;
  const scopeCodes = (myRow?.country_codes) || invite?.country_codes || [];
  const scopeLabel = scopeCodes.length === 0
    ? `All of ${firstName}'s work`
    : scopeCodes.map(c => getCountryName(c) || c).join(', ');
  const checklistCount = Array.isArray(detail?.checklist_items) ? detail.checklist_items.length : null;

  // Eligibility: only trust the fetched detail. Before it lands we paint
  // optimistically when an invite was passed (it came from the pending
  // list, so it WAS pending a moment ago).
  const detailEligible = detail
    ? (detail.status === 'pending_coverage_acceptance' && myRow?.acceptance_status === 'pending')
    : null;
  const showActions = detail ? detailEligible === true : !!invite;
  const alreadyHandled = detail ? detailEligible === false : false;

  let handledMsg = 'This coverage request is no longer awaiting your response.';
  if (alreadyHandled) {
    if (myRow?.acceptance_status === 'accepted') handledMsg = `You've already accepted this coverage.`;
    else if (myRow?.acceptance_status === 'declined') handledMsg = `You declined this coverage.`;
    else if (detail?.status === 'cancelled') handledMsg = 'This handover was cancelled.';
    else if (detail?.status === 'approved' || detail?.status === 'active') handledMsg = 'This coverage is already confirmed.';
    else if (detail?.status === 'completed') handledMsg = 'This handover is already complete.';
  }

  const finish = (kind) => {
    setDone(kind);
    try { window.dispatchEvent(new CustomEvent('ooo:coverageResponded')); } catch {}
    onResponded?.({ handoverId, action: kind });
  };

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await acceptHandover(handoverId);
      finish('accepted');
    } catch (err) {
      // 409 → status changed underneath us; surface it and let the detail
      // refetch flip the modal into the "already handled" state.
      setError(err?.message || 'Could not accept — it may have just changed. Reopen to retry.');
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await declineHandover(handoverId, declineReason.trim() || null);
      finish('declined');
    } catch (err) {
      setError(err?.message || 'Could not decline — it may have just changed.');
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coverage-invite-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 520,
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-light, #f0efed)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(124,58,237,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-people-fill" style={{ fontSize: 17, color: PURPLE }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="coverage-invite-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {done ? (done === 'accepted' ? 'Coverage accepted' : 'Coverage declined') : 'Coverage request'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {done
                ? (done === 'accepted' ? `You're now covering ${firstName}` : `${firstName} has been notified`)
                : <span><strong style={{ color: 'var(--text)' }}>{requesterName}</strong> asked you to cover their OOO</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Body */}
        {done ? (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: done === 'accepted' ? '#e8f5e9' : 'var(--surface-2, #f5f5f4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={done === 'accepted' ? 'bi-check-circle-fill' : 'bi-slash-circle'} style={{ fontSize: 22, color: done === 'accepted' ? '#15803d' : 'var(--text-muted)' }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #616161)', maxWidth: 420, lineHeight: 1.5 }}>
              {done === 'accepted'
                ? <>You&apos;re covering <strong style={{ color: 'var(--text)' }}>{requesterName}</strong> for {fmtRange(startDate, endDate)}. Their queues and breaches are now merged into yours for the window.</>
                : <>You declined to cover <strong style={{ color: 'var(--text)' }}>{requesterName}</strong>. They&apos;ll be notified to find another coverer.</>}
            </div>
            <button type="button" onClick={onClose}
              style={{ marginTop: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--text)', color: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Done
            </button>
          </div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <i className="bi-arrow-clockwise spin" style={{ fontSize: 24, color: 'var(--text-muted)' }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>Loading coverage request…</div>
          </div>
        ) : (loadError && !invite) ? (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <i className="bi-exclamation-triangle" style={{ fontSize: 28, color: '#b45309' }} />
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #616161)', maxWidth: 420 }}>{loadError}</div>
            <button type="button" onClick={onClose}
              style={{ marginTop: 6, padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Close
            </button>
          </div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Summary rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <InfoRow icon="bi-calendar-range" label="When" value={fmtRange(startDate, endDate) || '—'} />
              <InfoRow icon="bi-flag" label="You'd cover" value={scopeLabel} />
              {reason ? <InfoRow icon="bi-chat-left-text" label="Reason" value={reason} /> : null}
              {checklistCount != null && checklistCount > 0
                ? <InfoRow icon="bi-list-check" label="Handover notes" value={`${checklistCount} checklist item${checklistCount === 1 ? '' : 's'} to read on accept`} />
                : null}
            </div>

            {alreadyHandled ? (
              <div role="status" style={{ padding: '10px 12px', background: 'var(--surface-2, #f5f5f4)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-secondary, #616161)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="bi-info-circle" style={{ flexShrink: 0 }} />{handledMsg}
              </div>
            ) : declining ? (
              <div>
                <label htmlFor="coverage-decline-reason" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #616161)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display: 'block' }}>
                  Reason (optional — shared with {firstName})
                </label>
                <textarea
                  id="coverage-decline-reason"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  autoFocus
                  placeholder="e.g. I'm also off that week / at capacity — try Maria?"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', background: 'var(--surface)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>
            ) : null}

            {error && (
              <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
                <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
              </div>
            )}

            {/* Footer actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 2 }}>
              {alreadyHandled ? (
                <button type="button" onClick={onClose}
                  style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Close
                </button>
              ) : declining ? (
                <>
                  <button type="button" onClick={() => { setDeclining(false); setError(null); }} disabled={submitting}
                    style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary, #616161)', fontSize: 13, fontWeight: 500, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                    Back
                  </button>
                  <button type="button" onClick={handleDecline} disabled={submitting}
                    style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: submitting ? 'var(--text-muted)' : '#b91c1c', color: 'white', fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    {submitting ? 'Declining…' : 'Confirm decline'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setDeclining(true)} disabled={submitting || !showActions}
                    style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary, #616161)', fontSize: 13, fontWeight: 600, cursor: (submitting || !showActions) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: showActions ? 1 : 0.5 }}>
                    Decline
                  </button>
                  <button type="button" onClick={handleAccept} disabled={submitting || !showActions}
                    style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: (submitting || !showActions) ? 'var(--text-muted)' : PURPLE, color: 'white', fontSize: 13, fontWeight: 600, cursor: (submitting || !showActions) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    {submitting ? 'Accepting…' : 'Accept coverage'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <i className={icon} style={{ fontSize: 14, color: PURPLE, marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 1, lineHeight: 1.4 }}>{value}</div>
      </div>
    </div>
  );
}
