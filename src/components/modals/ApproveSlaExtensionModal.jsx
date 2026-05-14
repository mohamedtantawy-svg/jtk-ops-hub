// ── ApproveSlaExtensionModal ─────────────────────────────────────────────
// Manager approves an sla_extension_request. Picks 1-7 days (the team
// member's request only carried 3/5/7 — the manager has finer control).
// On submit → POST /api/v1/sla-extension/[id]/approve. The server inserts
// the active sla_extension row with effective_from=NOW() and
// expires_at=NOW()+approvedDays days.

import { useEffect, useRef, useState } from 'react';
import { approveSlaExtension } from '../../services/slaExtensionApi';

const REASON_LABELS = {
  immigration: 'Immigration',
  client_unresponsive: 'Client unresponsive',
  employee_unresponsive: 'Employee unresponsive',
};

const labelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #616161)', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 6, display: 'block',
};

export default function ApproveSlaExtensionModal({ request, onClose, onApproved }) {
  const backdropRef = useRef(null);
  const requested = Number(request?.slaExtRequestedDays || request?.sla_ext_requested_days || 0) || null;
  const [days, setDays] = useState(requested && requested >= 1 && requested <= 7 ? requested : 3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const canSubmit = Number.isInteger(days) && days >= 1 && days <= 7 && !submitting;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await approveSlaExtension(request.id, days);
      onApproved?.(res);
    } catch (err) {
      setError(err?.message || 'Failed to approve request');
      setSubmitting(false);
    }
  };

  const reasonCode = request?.slaExtReasonCode || request?.sla_ext_reason_code || null;
  const reasonLabel = reasonCode ? (REASON_LABELS[reasonCode] || reasonCode) : null;

  return (
    <div
      ref={backdropRef}
      onClick={ev => { if (ev.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-sla-ext-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1010,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 520,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-light, #f0efed)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-check-circle-fill" style={{ fontSize: 17, color: '#15803d' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="approve-sla-ext-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              Approve SLA extension
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {request?.taskSubject
                ? <span><strong style={{ color: 'var(--text)' }}>{request.taskSubject}</strong></span>
                : 'Set how many days the SLA should be extended'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Context — requester + reason + their ask */}
          <div style={{
            padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2, #fafaf9)',
            border: '1px solid var(--border-light, #f0efed)', fontSize: 12, color: 'var(--text-secondary, #616161)', lineHeight: 1.55,
          }}>
            <div><strong style={{ color: 'var(--text)' }}>Requester</strong> &middot; {request?.createdByName || request?.created_by_name || request?.createdByEmail || request?.created_by_email || '—'}</div>
            {reasonLabel && <div><strong style={{ color: 'var(--text)' }}>Reason</strong> &middot; {reasonLabel}</div>}
            {requested && <div><strong style={{ color: 'var(--text)' }}>Requested</strong> &middot; {requested} business day{requested === 1 ? '' : 's'}</div>}
          </div>

          {/* Day picker — 1..7 chips */}
          <div>
            <label style={labelStyle}>Approve for *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 7].map(d => {
                const active = days === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays(d)}
                    aria-pressed={active}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 10,
                      border: active ? '1.5px solid #15803d' : '1px solid var(--border)',
                      background: active ? '#f0fdf4' : 'var(--surface)',
                      color: active ? '#166534' : 'var(--text)',
                      fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      boxShadow: active ? '0 1px 4px #15803d22' : 'none',
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              SLA timer starts at approval (now) and runs for the selected number of business days.
            </div>
          </div>

          {error && (
            <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 2 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary, #616161)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '9px 18px', borderRadius: 10, border: 'none',
                background: canSubmit ? '#15803d' : 'var(--text-muted)',
                color: 'white', fontSize: 13, fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Approving…' : `Approve for ${days} day${days === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
