// ── CreateSlaExtensionModal ─────────────────────────────────────────────
// Team-member-facing form for requesting an SLA extension on a queue row.
// Three required inputs:
//   1. Duration — 3 / 5 / 7 days
//   2. Reason   — Immigration / Client unresponsive / Employee unresponsive
//   3. Acknowledgement — checkbox confirming the employee/client has been
//                        informed about the hold
//
// On submit → POST /api/v1/hr-hub/requests with flow='sla_extension_request'.
// Server auto-routes the request to the requester's manager. Modal flips
// to a confirmation state after a successful POST.
//
// Mirrors CreateHideTaskRequestModal.jsx visually so the two row-action
// surfaces feel like one family (skill §3.13).

import { useEffect, useRef, useState } from 'react';
import { createHrHubRequest } from '../../services/hrHubApi';
import { getCountryName } from '../../data/constants';

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

// 1–2 business-day extensions are auto-approved server-side and apply
// immediately — they skip manager review (Mohamed 2026-06-04). Kept in
// lockstep with SLA_EXT_AUTO_APPROVE_MAX_DAYS in
// app/api/v1/hr-hub/requests/route.js — if you tune one, tune both.
const AUTO_APPROVE_MAX_DAYS = 2;

// 2026-05-29 — Jose feedback: agents were skipping the optional note,
// leaving managers without context. The note is now required with a
// minimum of 20 characters; "Send to manager" stays disabled until met.
// The same minimum is enforced server-side in /api/v1/hr-hub/requests so
// it can't be bypassed by a direct API call.
const NOTE_MIN_CHARS = 20;

const REASON_OPTIONS = [
  {
    value: 'immigration',
    label: 'Immigration',
    desc: 'On hold pending visa, work-permit, or document submission.',
    icon: 'bi-globe-americas',
    color: '#1d4ed8',
    bg: '#eff6ff',
  },
  {
    value: 'client_unresponsive',
    label: 'Client unresponsive',
    desc: 'Waiting on the client side; reminders sent but no reply.',
    icon: 'bi-building',
    color: '#b45309',
    bg: '#fffbeb',
  },
  {
    value: 'employee_unresponsive',
    label: 'Employee unresponsive',
    desc: 'Waiting on the employee side; reminders sent but no reply.',
    icon: 'bi-person-x',
    color: '#7c3aed',
    bg: '#f5f3ff',
  },
  {
    value: 'long_process',
    label: 'Long process',
    desc: 'Multi-stage task that exceeds the standard SLA window.',
    icon: 'bi-hourglass-split',
    color: '#0f766e',
    bg: '#ecfdf5',
  },
];

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10,
  fontSize: 13, color: 'var(--text)', background: 'var(--surface)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #616161)', textTransform: 'uppercase',
  letterSpacing: '.05em', marginBottom: 6, display: 'block',
};

export default function CreateSlaExtensionModal({ task, tasks, onClose, onSubmitted }) {
  const backdropRef = useRef(null);
  const [duration, setDuration] = useState(null);
  const [reasonCode, setReasonCode] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [submittedId, setSubmittedId] = useState(null);
  // Whether the submitted request was auto-approved server-side (set from
  // the POST response). Drives the confirmation copy below.
  const [submittedAuto, setSubmittedAuto] = useState(false);
  // Bulk result tallies — applied / skipped-because-already-extended /
  // hard-failed. Single-row submits set submittedCount = 1.
  const [submittedCount, setSubmittedCount] = useState(0);
  const [submittedSkipped, setSubmittedSkipped] = useState(0);
  const [submittedFailed, setSubmittedFailed] = useState(0);

  // `task` (single) and `tasks` (array) are both accepted — single-row
  // callers are unchanged; the Queue bulk-bar passes `tasks`. In bulk, ONE
  // duration + reason + note applies to every selected task and each fires
  // its own auto-approve request (mirrors CreateHideTaskRequestModal). Bulk
  // is capped at 1–2 business days (Ayushi 2026-06-04) — exactly the range
  // that auto-approves, so a mass hold never waits on manager review.
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? tasks : (task ? [task] : []);
  const isBulk = taskList.length > 1;
  const headTask = taskList[0] || null;
  // Rows that already carry an active/pending extension are pre-skipped in
  // bulk — the server would 409 them anyway. `slaLocked` is stamped by the
  // Queue's buildTaskDescriptor via isSlaExtensionLocked(row).
  const eligibleTasks = isBulk ? taskList.filter(t => !t?.slaLocked) : taskList;
  const preSkippedCount = isBulk ? (taskList.length - eligibleTasks.length) : 0;
  // Bulk is capped at 1–2 days; single keeps the full 1–7 range.
  const durationOptions = isBulk ? [1, 2] : DURATION_OPTIONS;

  // 1–2 day holds auto-approve; 3+ go to the manager. Drives the live
  // indicator on the form + the submit button label.
  const willAutoApprove = !!duration && duration <= AUTO_APPROVE_MAX_DAYS;

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const trimmedNote = note.trim();
  const noteLen = trimmedNote.length;
  const noteMeetsMin = noteLen >= NOTE_MIN_CHARS;
  const submitTargets = isBulk ? eligibleTasks : taskList;
  const targetsValid = submitTargets.length > 0 && submitTargets.every(t => !!t?.source && !!t?.id);
  const canSubmit = !!duration && !!reasonCode && acknowledged && noteMeetsMin && !submitting && targetsValid;

  const buildPayload = (t) => {
    const reasonLabel = REASON_OPTIONS.find(r => r.value === reasonCode)?.label || 'reason not specified';
    const summary = `${reasonLabel} — requesting ${duration} business day${duration === 1 ? '' : 's'}. ${trimmedNote}`;
    return {
      flow: 'sla_extension_request',
      title: `SLA Extension — ${reasonLabel}${t?.subject ? `: ${t.subject}` : ''}`.slice(0, 300),
      summary,
      // The server requires `note` to be ≥ NOTE_MIN_CHARS on this flow.
      // Sending the raw note alongside the composed `summary` lets the
      // server validate length without parsing the prefix back out.
      note: trimmedNote,
      priority: 'medium',
      links: t?.url ? [t.url] : [],
      taskSource: t.source,
      taskId: String(t.id),
      taskUrl: t.url || null,
      taskSubject: t.subject || null,
      requestedDays: duration,
      reasonCode,
      acknowledged: true,
    };
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!isBulk) {
        // Single-row — unchanged contract.
        const result = await createHrHubRequest(buildPayload(taskList[0]));
        setSubmittedId(result?.id || 'submitted');
        // Server is the source of truth: it returns autoApproved=true only
        // when the ≤2-day request was actually applied (a rare auto-approve
        // failure falls back to manual review, so we must not assume).
        setSubmittedAuto(result?.autoApproved === true);
        setSubmittedCount(1);
        onSubmitted?.({ id: result?.id, duration, reasonCode, autoApproved: result?.autoApproved === true });
        return;
      }
      // Bulk — fire one auto-approve request per eligible task in parallel.
      // Partial failures never abort the batch (mirror of the bulk Hide
      // modal). A 409 means the task already has an active/pending
      // extension → counted as "skipped", not a hard failure.
      const results = await Promise.allSettled(eligibleTasks.map(t => createHrHubRequest(buildPayload(t))));
      const applied = results.filter(r => r.status === 'fulfilled');
      const conflicts = results.filter(r => r.status === 'rejected' && r.reason?.status === 409);
      const failed = results.filter(r => r.status === 'rejected' && r.reason?.status !== 409);
      if (applied.length === 0 && conflicts.length === 0) {
        throw new Error(failed[0]?.reason?.message || 'Failed to apply SLA extensions');
      }
      setSubmittedId(applied[0]?.value?.id || 'submitted');
      setSubmittedAuto(true); // 1–2 day bulk always auto-approves
      setSubmittedCount(applied.length);
      setSubmittedSkipped(preSkippedCount + conflicts.length);
      setSubmittedFailed(failed.length);
      onSubmitted?.({ count: applied.length, skipped: preSkippedCount + conflicts.length, failed: failed.length, duration, reasonCode });
    } catch (err) {
      setError(err?.message || 'Failed to submit SLA extension request');
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={ev => { if (ev.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sla-ext-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 560,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-light, #f0efed)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-clock-history" style={{ fontSize: 17, color: '#d97706' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="sla-ext-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {submittedId
                ? (isBulk
                    ? `${submittedCount} SLA extension${submittedCount === 1 ? '' : 's'} applied`
                    : (submittedAuto ? 'SLA extension applied' : 'SLA extension submitted'))
                : (isBulk ? `Extend SLA on ${taskList.length} tasks` : 'Request SLA extension')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {isBulk
                ? <span>One duration &amp; reason applies to all <strong style={{ color: 'var(--text)' }}>{taskList.length}</strong> selected tasks. 1–2 day holds apply immediately.{preSkippedCount > 0 ? ` ${preSkippedCount} already extended — will be skipped.` : ''}</span>
                : headTask?.subject
                  ? <span><strong style={{ color: 'var(--text)' }}>{headTask.subject}</strong>{headTask.country ? ` · ${getCountryName(headTask.country) || headTask.country}` : ''}</span>
                  : 'Hold the SLA on this task while you resolve a blocker'}
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

        {/* Confirmation state */}
        {submittedId ? (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={submittedAuto ? 'bi-lightning-charge-fill' : 'bi-send-check-fill'} style={{ fontSize: 22, color: '#15803d' }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              {isBulk
                ? `${submittedCount} extension${submittedCount === 1 ? '' : 's'} applied`
                : (submittedAuto ? 'SLA extension applied' : 'Sent to your manager for review')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #616161)', maxWidth: 440, lineHeight: 1.5 }}>
              {isBulk ? (
                <>The SLA is now paused for <strong style={{ color: 'var(--text)' }}>{duration} business day{duration === 1 ? '' : 's'}</strong> on {submittedCount} task{submittedCount === 1 ? '' : 's'} — applied immediately, no manager review.
                {submittedSkipped > 0 ? <> {submittedSkipped} skipped (already extended).</> : null}
                {submittedFailed > 0 ? <> <span style={{ color: '#b45309', fontWeight: 600 }}>{submittedFailed} failed — try those again.</span></> : null}
                {' '}Track them under HR Hub → My Requests.</>
              ) : submittedAuto ? (
                <>The SLA on this task is now paused for <strong style={{ color: 'var(--text)' }}>{duration} business day{duration === 1 ? '' : 's'}</strong> — no manager review needed. It resumes automatically after that. You can track it under HR Hub → My Requests.</>
              ) : (
                <>Once your manager approves, the SLA on this task will be paused for the number of days they confirm. You can track the status under HR Hub → My Requests.</>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ marginTop: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--text)', color: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Got it
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Duration */}
            <div>
              <label style={labelStyle}>How many business days? *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {durationOptions.map(d => {
                  const active = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      aria-pressed={active}
                      style={{
                        flex: 1, padding: '12px 0', borderRadius: 10,
                        border: active ? '1.5px solid #d97706' : '1px solid var(--border)',
                        background: active ? '#fff7ed' : 'var(--surface)',
                        color: active ? '#92400e' : 'var(--text)',
                        fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: active ? '0 1px 4px #d9770622' : 'none',
                      }}
                    >
                      {d} day{d === 1 ? '' : 's'}
                    </button>
                  );
                })}
              </div>
              {/* Auto-approval indicator — sets expectations before + after
                  picking a duration. ≤2 days applies instantly; 3+ goes to
                  the manager. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
                fontSize: 11.5, fontWeight: 600, lineHeight: 1.4,
                color: duration == null
                  ? 'var(--text-muted)'
                  : (willAutoApprove ? '#0f766e' : 'var(--text-secondary, #616161)'),
              }}>
                <i
                  className={duration == null ? 'bi-info-circle' : (willAutoApprove ? 'bi-lightning-charge-fill' : 'bi-person-check')}
                  style={{ fontSize: 12, flexShrink: 0 }}
                  aria-hidden="true"
                />
                <span>
                  {isBulk
                    ? 'Bulk holds are capped at 2 business days and apply immediately — no manager review.'
                    : duration == null
                      ? '1–2 days are approved automatically · 3+ days need manager review.'
                      : willAutoApprove
                        ? 'Auto-approved — applies immediately, no manager review needed.'
                        : 'Sent to your manager for review before the SLA is paused.'}
                </span>
              </div>
            </div>

            {/* Reason */}
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
                        border: active ? `1.5px solid ${opt.color}` : '1px solid var(--border)',
                        background: active ? opt.bg : 'var(--surface)',
                        textAlign: 'left',
                        cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: active ? `0 1px 4px ${opt.color}22` : 'none',
                      }}
                    >
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: opt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={opt.icon} style={{ color: opt.color, fontSize: 13 }} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary, #616161)', marginTop: 2 }}>{opt.desc}</div>
                      </span>
                      <span style={{ width: 16, height: 16, borderRadius: '50%', border: active ? `5px solid ${opt.color}` : '2px solid var(--border)', flexShrink: 0, marginTop: 4 }} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Required note */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                <label htmlFor="sla-ext-note" style={{ ...labelStyle, marginBottom: 0 }}>Note *</label>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: noteMeetsMin ? '#15803d' : (noteLen > 0 ? '#b45309' : 'var(--text-muted)'),
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {noteMeetsMin
                    ? `${noteLen} characters`
                    : `${noteLen} / ${NOTE_MIN_CHARS} minimum`}
                </span>
              </div>
              <textarea
                id="sla-ext-note"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                required
                aria-required="true"
                aria-invalid={!noteMeetsMin && noteLen > 0}
                placeholder="Explain what's blocking, what's already been tried, and the next step. The manager uses this to approve."
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  borderColor: (!noteMeetsMin && noteLen > 0) ? '#b45309' : 'var(--border)',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                Required — managers approve based on this. Aim for the
                blocker + what you&apos;ve tried + next step.
              </div>
            </div>

            {/* Acknowledgement */}
            <label style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '10px 12px', borderRadius: 10,
              border: acknowledged ? '1.5px solid #15803d' : '1px solid var(--border)',
              background: acknowledged ? '#f0fdf4' : 'var(--surface-2, #fafaf9)',
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, cursor: 'pointer' }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  Employee / client has been informed *
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary, #616161)', marginTop: 2, lineHeight: 1.5 }}>
                  I confirm I&apos;ve let the affected employee or client know
                  why this task is on hold and that we&apos;re extending the SLA.
                </div>
              </span>
            </label>

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
                  background: canSubmit ? '#d97706' : 'var(--text-muted)',
                  color: 'white', fontSize: 13, fontWeight: 600,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >
                {submitting
                  ? 'Submitting…'
                  : isBulk
                    ? `Apply to ${eligibleTasks.length} task${eligibleTasks.length === 1 ? '' : 's'}`
                    : (willAutoApprove ? 'Apply extension' : 'Send to manager')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
