// ── CreateHideTaskRequestModal ───────────────────────────────────────────
// Asks the team member WHY they want to hide a queue row. Required: a
// reason code from the documented three-option set. Optional unless the
// reason is "Other" — in which case the free-text becomes mandatory.
//
// On submit → POST /api/v1/hr-hub/requests with flow='hide_task_request'.
// Backend computes team_lead_email and persists the task_* fields. Modal
// then flips into a confirmation state ("Sent to your manager…") so the
// user gets the explicit acknowledgement the spec calls for.

import { useEffect, useRef, useState } from 'react';
import { createHrHubRequest } from '../../services/hrHubApi';

const REASON_OPTIONS = [
  {
    value: 'internal_deel_employee',
    label: 'Internal Deel Employee',
    desc: 'Task is about a Deel employee that shouldn\'t be on this queue.',
    icon: 'bi-person-badge',
    color: '#1f74b3',
    bg: '#eff6ff',
  },
  {
    value: 'test_task',
    label: 'Test Task',
    desc: 'Task was created during testing and isn\'t real work.',
    icon: 'bi-bug',
    color: '#7c3aed',
    bg: '#f5f3ff',
  },
  {
    value: 'other',
    label: 'Other',
    desc: 'Different reason — please describe below.',
    icon: 'bi-three-dots',
    color: '#6b6560',
    bg: '#f5f4f2',
  },
];

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: 10,
  fontSize: 13, color: '#1b1b1b', background: 'var(--surface)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: '#616161', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 6, display: 'block',
};

export default function CreateHideTaskRequestModal({ task, tasks, onClose, onSubmitted }) {
  // Normalise the input — `task` (single) and `tasks` (array) are both
  // accepted so existing single-row callers don't need to change. When
  // both are passed `tasks` wins. Bulk submit fires N hide requests with
  // the same reason; the manager sees them as separate approval rows on
  // their HR Hub queue (per Pilar — they want to be able to deny one of
  // a batch without rejecting the whole batch).
  const taskList = Array.isArray(tasks) && tasks.length > 0
    ? tasks
    : task ? [task] : [];
  const isBulk = taskList.length > 1;
  const headTask = taskList[0] || null;
  const backdropRef = useRef(null);
  const [reasonCode, setReasonCode] = useState(null);
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [submittedId, setSubmittedId] = useState(null);
  const [submittedCount, setSubmittedCount] = useState(0);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const otherSelected = reasonCode === 'other';
  const otherTextValid = !otherSelected || reasonText.trim().length > 0;
  const canSubmit = !!reasonCode && otherTextValid && !submitting;

  // Build the payload from the task descriptor the parent passed in. Spec:
  // unique identifier could be the task link — we store source+id (most
  // robust) AND the URL so the manager has the link to open and the FE
  // filter has a clean key.
  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit || taskList.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const reasonLabel = REASON_OPTIONS.find(r => r.value === reasonCode)?.label || 'reason not specified';
      const computedSummary = otherSelected
        ? reasonText.trim()
        : reasonLabel;

      const buildPayload = (t) => ({
        flow: 'hide_task_request',
        requestType: reasonCode,
        title: `Request to hide task — ${reasonLabel}${t?.subject ? `: ${t.subject}` : ''}`.slice(0, 300),
        summary: computedSummary,
        priority: 'medium',
        links: t?.url ? [t.url] : [],
        taskSource: t?.source,
        taskId: t?.id ? String(t.id) : null,
        taskUrl: t?.url || null,
        taskSubject: t?.subject || null,
      });

      // Bulk submit fires the requests in parallel — each becomes its own
      // approval row so the manager can approve some and deny others. We
      // surface a partial-failure count rather than aborting the whole
      // batch; better to land 9/10 hides than 0/10 because the 10th was
      // already hidden upstream.
      const results = await Promise.allSettled(
        taskList.map(t => createHrHubRequest(buildPayload(t)))
      );
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');
      if (fulfilled.length === 0) {
        const firstErr = rejected[0]?.reason?.message || 'Failed to submit hide request';
        throw new Error(firstErr);
      }
      setSubmittedCount(fulfilled.length);
      setSubmittedId(fulfilled[0]?.value?.id || 'unknown');
      if (rejected.length > 0) {
        setError(`${rejected.length} of ${taskList.length} request${taskList.length === 1 ? '' : 's'} failed: ${rejected[0]?.reason?.message || 'unknown error'}`);
      }
      onSubmitted?.({ id: fulfilled[0]?.value?.id, count: fulfilled.length, failed: rejected.length });
    } catch (err) {
      setError(err?.message || 'Failed to submit hide request');
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={ev => { if (ev.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hide-task-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 540,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-eye-slash-fill" style={{ fontSize: 17, color: '#d42d35' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="hide-task-title" style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>
              {submittedId
                ? (isBulk ? `${submittedCount} hide requests submitted` : 'Hide request submitted')
                : (isBulk ? `Hide ${taskList.length} tasks` : 'Hide this task')}
            </div>
            <div style={{ fontSize: 12, color: '#9e9e9e', marginTop: 2 }}>
              {isBulk
                ? <span>One reason will apply to all <strong style={{ color: '#1b1b1b' }}>{taskList.length}</strong> selected tasks. Each lands as a separate approval for your manager.</span>
                : headTask?.subject
                  ? <span><strong style={{ color: '#1b1b1b' }}>{headTask.subject}</strong>{headTask.country ? ` · ${headTask.country}` : ''}</span>
                  : 'Why should this task be removed from the queue?'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e8e8', background: 'var(--surface)', color: '#9e9e9e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Confirmation state — replaces the form once the POST succeeds */}
        {submittedId ? (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi-send-check-fill" style={{ fontSize: 22, color: '#15803d' }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b' }}>Sent to your manager for review</div>
            <div style={{ fontSize: 13, color: '#616161', maxWidth: 420, lineHeight: 1.5 }}>
              Once approved, this task will disappear from your view and any future syncs.
              You can track the status under HR Hub → My Requests.
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ marginTop: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: '#1b1b1b', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Got it
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Reason *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {REASON_OPTIONS.map(opt => {
                  const active = reasonCode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setReasonCode(opt.value)}
                      aria-pressed={active}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 12px', borderRadius: 10,
                        border: active ? `1.5px solid ${opt.color}` : '1px solid #e8e8e8',
                        background: active ? opt.bg : 'white',
                        textAlign: 'left',
                        cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: active ? `0 1px 4px ${opt.color}22` : 'none',
                      }}
                    >
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: opt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={opt.icon} style={{ color: opt.color, fontSize: 13 }} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b' }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: '#616161', marginTop: 2 }}>{opt.desc}</div>
                      </span>
                      <span style={{ width: 16, height: 16, borderRadius: '50%', border: active ? `5px solid ${opt.color}` : '2px solid #d5d5d5', flexShrink: 0, marginTop: 4 }} />
                    </button>
                  );
                })}
              </div>
            </div>

            {otherSelected && (
              <div>
                <label htmlFor="hide-other-text" style={labelStyle}>Tell us why *</label>
                <textarea
                  id="hide-other-text"
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Why should this task be hidden?"
                  style={{ ...inputStyle, resize: 'vertical', borderColor: otherTextValid ? '#e8e8e8' : '#d42d35' }}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
                <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #e8e8e8', background: 'var(--surface)', fontSize: 13, fontWeight: 500, color: '#616161', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  padding: '9px 18px', borderRadius: 10, border: 'none',
                  background: canSubmit ? '#d42d35' : '#9e9e9e',
                  color: 'white', fontSize: 13, fontWeight: 600,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >
                {submitting ? 'Submitting…' : 'Send to manager'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
