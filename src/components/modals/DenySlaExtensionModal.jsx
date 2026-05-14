// ── DenySlaExtensionModal ───────────────────────────────────────────────
// Manager denies an sla_extension_request. Requires a reason so the
// requester sees why on the bell notification + request thread.
// Calls /api/v1/sla-extension/[id]/deny. Mirrors DenyHideTaskModal.

import { useEffect, useRef, useState } from 'react';
import { denySlaExtension } from '../../services/slaExtensionApi';

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10,
  fontSize: 13, color: 'var(--text)', background: 'var(--surface)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #616161)', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 6, display: 'block',
};

export default function DenySlaExtensionModal({ request, onClose, onDenied }) {
  const backdropRef = useRef(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 2000 && !submitting;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await denySlaExtension(request.id, trimmed);
      onDenied?.(trimmed);
    } catch (err) {
      setError(err?.message || 'Failed to deny request');
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={ev => { if (ev.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deny-sla-ext-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1010,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 18, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-light, #f0efed)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-x-octagon-fill" style={{ fontSize: 15, color: '#d42d35' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="deny-sla-ext-title" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Deny SLA extension</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {request?.taskSubject ? <span><strong style={{ color: 'var(--text)' }}>{request.taskSubject}</strong></span> : 'Provide a reason — the requester will be notified.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 11 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="deny-sla-reason" style={labelStyle}>Reason for denial *</label>
            <textarea
              id="deny-sla-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              placeholder="Why isn't the SLA being extended?"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
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
              style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #616161)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '8px 16px', borderRadius: 9, border: 'none',
                background: canSubmit ? '#d42d35' : 'var(--text-muted)',
                color: 'white', fontSize: 12, fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Denying…' : 'Deny request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
