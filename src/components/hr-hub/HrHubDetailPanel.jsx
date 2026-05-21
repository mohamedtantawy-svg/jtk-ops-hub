// ── HrHubDetailPanel ────────────────────────────────────────────────────────
// Slide-in drawer that hosts a single request: header (status / assignee /
// priority pickers), fields, attachments, follower list, audit log, and
// the Slack-style comment thread + composer.
//
// Stage 4 lands here in the same component for cohesion: comments + the
// composer (≥14px font, emoji picker, @mention autocomplete, attachments)
// belong with the rest of the detail because the user spends most of
// their time inside this panel.
//
// Real-time: the thread polls /comments?since=<lastSeen> every 5s while
// the panel is open. Server-persisted notifications still cover the
// across-pages experience via the existing bell hook (link_view='hr_hub').

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  patchHrHubRequest,
  listHrHubComments,
  postHrHubComment,
  patchHrHubComment,
  deleteHrHubComment,
  followHrHubRequest,
  unfollowHrHubRequest,
} from '../../../src/services/hrHubApi';
import { MEMBERS, MEMBERS_BY_EMAIL } from '../../../src/data/members';
import { TASK_SOURCE_DISPLAY } from '../../../src/utils/applySlaExtensions';
import HrHubComposer from './HrHubComposer';
import ImageLightbox from '../ui/ImageLightbox';
import CommentReactions from '../ui/CommentReactions';

const SLA_EXT_REASON_LABELS = {
  immigration: 'Immigration',
  client_unresponsive: 'Client unresponsive',
  employee_unresponsive: 'Employee unresponsive',
  long_process: 'Long process',
};

const STATUS_OPTIONS = [
  { id: 'new',         label: 'New',         color: '#0369a1', bg: '#e0f2fe' },
  { id: 'in_progress', label: 'In Progress', color: '#92400e', bg: '#fff8e6' },
  { id: 'on_hold',     label: 'On Hold',     color: 'var(--text-secondary)', bg: '#f3f3f3' },
  { id: 'resolved',    label: 'Resolved',    color: '#166534', bg: '#e8f5e9' },
  // Terminal "closed without resolving" — Megan's 2026-05-12 ask. Red
  // semantic stays literal across themes (status colours convey meaning
  // that must not shift with dark mode).
  { id: 'rejected',    label: 'Rejected',    color: '#991b1b', bg: '#fee2e2' },
];
const PRIORITY_OPTIONS = [
  { id: 'low',      label: 'Low' },
  { id: 'medium',   label: 'Medium' },
  { id: 'high',     label: 'High' },
  { id: 'critical', label: 'Critical' },
];

const FLOW_LABELS = {
  hr_request: 'HR Request',
  hr_reporting: 'HR Reporting',
  escalation_zero: 'Escalation Zero',
  feedback: 'Ops Hub Feedback',
};

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function HrHubDetailPanel({ requestId, detail, loading, error, user, isManager, isAdmin, onApproveTask, onDenyTask, onClose, onRefresh, onItemUpdated }) {
  const request = detail?.request;
  const initialComments = detail?.comments || [];
  const followers = detail?.followers || [];
  const log = detail?.log || [];

  // Local comments state — seeded from initialComments and grown by the
  // polling effect. We seed only when the parent's initialComments array
  // identity changes (e.g. detail re-fetch from refresh) so we don't
  // clobber polling-fetched comments on every render.
  const [comments, setComments] = useState(initialComments);
  useEffect(() => { setComments(initialComments); }, [initialComments]);

  // ── Close on ESC (a11y / power-user shortcut) ──────────────────────────
  // Audit 2026-05-21 F13 — the drawer used to ignore Escape. Listener is
  // attached only while the drawer is open (requestId truthy) and removed
  // on close. Ignored when an inner editor (composer textarea, picker
  // dropdown) has focus, because those typically use Escape for their own
  // affordances (close picker, cancel inline edit).
  useEffect(() => {
    if (!requestId || typeof onClose !== 'function') return;
    const handler = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      const ae = document.activeElement;
      const tag = (ae?.tagName || '').toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || ae?.isContentEditable;
      // If an inner editor has focus, let it handle Escape first; this
      // event listener picks up the fallthrough on the next press.
      if (isEditable) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [requestId, onClose]);

  // Polling for new comments while the panel is open. The deps must NOT
  // include `comments` — that would tear down + rebuild the interval on
  // every poll, leaking timers. Use a ref to read the latest tail
  // timestamp from inside the tick.
  const commentsRef = useRef(comments);
  useEffect(() => { commentsRef.current = comments; }, [comments]);
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    const tick = async () => {
      const list = commentsRef.current;
      const latest = list.length ? list[list.length - 1].createdAt : null;
      try {
        const res = await listHrHubComments(requestId, { since: latest });
        if (cancelled) return;
        const fresh = res?.comments || [];
        if (fresh.length > 0) {
          setComments(prev => {
            const seen = new Set(prev.map(c => c.id));
            return [...prev, ...fresh.filter(c => !seen.has(c.id))];
          });
        }
      } catch { /* swallow — next tick will try again */ }
    };
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [requestId]);

  // ── Slack-style auto-scroll for the comment thread ──────────────────────
  // Olga Pastuszak 2026-05-20 bug "HR Hub - Sequence of comments not in
  // order". The thread itself is and always was chronological ASC (server
  // ORDER BY created_at ASC on both the detail endpoint and the polled
  // /comments?since= endpoint; FE appends to the bottom on own-post + on
  // poll), so technically "the newest is at the bottom" was already true.
  // What Olga actually saw is a SCROLL-POSITION bug: the panel mounted at
  // scrollTop=0 — i.e. showing the request title + status + fields + the
  // OLDEST comments. The newest comments + composer sat below the fold
  // until she manually scrolled. From her seat: her own freshly-posted
  // reply was "at the bottom (visible near the composer)" while others'
  // new replies appeared "stuck at the top of the view" — that "top" is
  // the panel's default scroll position, which happens to land on the
  // earliest comments in an ASC list.
  //
  // Fix: scroll to the latest comment on initial render, and Slack-style
  // "follow mode" on subsequent additions (stay pinned to the bottom if
  // already there; don't yank the user if they scrolled up to read
  // history). Own posts always force-scroll because the user just
  // submitted and expects to see their message — set
  // forceScrollOnNextRenderRef BEFORE setComments so the layout effect
  // catches it on the same render.
  const scrollBodyRef = useRef(null);
  const commentsEndRef = useRef(null);
  const userIsAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const forceScrollOnNextRenderRef = useRef(false);

  // Reset on request switch so panel-to-panel navigation rescroll to
  // bottom each time. Without this, opening a second request after
  // having scrolled up on the first would inherit
  // initialScrollDone=true and miss the auto-scroll.
  useEffect(() => {
    initialScrollDoneRef.current = false;
    userIsAtBottomRef.current = true;
  }, [requestId]);

  const handleCommentsScroll = useCallback(() => {
    const el = scrollBodyRef.current;
    if (!el) return;
    // 80px tolerance — in-flight image loads / padding rounding
    // shouldn't flip "follow mode" off when the user hasn't moved.
    userIsAtBottomRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80;
  }, []);

  useLayoutEffect(() => {
    if (comments.length === 0) return;
    const isInitial = !initialScrollDoneRef.current;
    const forced = forceScrollOnNextRenderRef.current;
    if (forced) forceScrollOnNextRenderRef.current = false;
    const shouldScroll = isInitial || forced || userIsAtBottomRef.current;
    if (!shouldScroll) return;
    commentsEndRef.current?.scrollIntoView({
      block: 'end',
      behavior: isInitial ? 'auto' : 'smooth',
    });
    initialScrollDoneRef.current = true;
    // We just snapped to the bottom — make sure the tracker reflects
    // that even if onScroll hasn't fired yet (e.g. when the body wasn't
    // scrollable enough to dispatch a real scroll event).
    userIsAtBottomRef.current = true;
  }, [comments]);

  const isFollowing = useMemo(() => {
    const e = (user?.email || '').toLowerCase();
    return followers.some(f => (f.email || '').toLowerCase() === e);
  }, [followers, user]);

  // ── Local optimistic state for status / assignee / priority ──────────────
  const [savingField, setSavingField] = useState(null);
  const updateField = useCallback(async (patch) => {
    if (!requestId) return;
    const fieldKey = Object.keys(patch)[0];
    setSavingField(fieldKey);
    try {
      await patchHrHubRequest(requestId, patch);
      onItemUpdated?.({ id: requestId, ...patch });
      onRefresh?.();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err?.message || 'Could not update');
    } finally {
      setSavingField(null);
    }
  }, [requestId, onItemUpdated, onRefresh]);

  if (!requestId) return null;
  const flowLabel = FLOW_LABELS[request?.flow] || request?.flow || '';

  // Approve/Deny gate — mirrors RequestRow's canDecide (HrHubView line
  // 730+) so the row + drawer enforce the same workflow. Mohamed
  // 2026-05-19: "SLA extension, when the task is open, you need to add
  // approval or Denial similar to what you see on the table. Right now
  // if you change the status from here, it doesn't impact anything and
  // it goes to solved queue whether you approved or deny." The picker
  // PATCH only updates the status column; it doesn't insert the
  // sla_extension row (or hidden_task row) the workflow actually needs.
  const isApprovalFlow = request?.flow === 'sla_extension_request' || request?.flow === 'hide_task_request';
  const isUnresolved = request?.status && request.status !== 'resolved' && request.status !== 'rejected';
  const viewerLc = (user?.email || '').toLowerCase();
  const isSelf = request && (request.createdByEmail || '').toLowerCase() === viewerLc;
  const canDecide = isApprovalFlow && isUnresolved && !!isManager && (!isSelf || !!isAdmin);
  // Disable the status picker on approval flows whose decision hasn't
  // landed yet — the picker only PATCHes status, bypassing the
  // approve/deny endpoints that actually grant the extension / hide the
  // row. Picker stays interactive on every other flow + on already-
  // resolved approval rows (rare admin reopen path).
  const statusPickerLocked = isApprovalFlow && isUnresolved;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        zIndex: 1400,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 'min(720px, 92vw)', background: 'var(--surface)',
          boxShadow: '-12px 0 30px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
          fontSize: 14,
        }}
      >
        {/* Header — sticky context strip.
            2026-05-21 audit F12: the drawer auto-scrolls to the comment
            thread on open (Slack-style, PR #741) which hides the
            request subject above the fold. Showing flowLabel + truncated
            subject + status pill in the sticky header gives a first-time
            opener (e.g. notification deep-link) enough context to know
            what they're looking at without scrolling up. */}
        <div style={{
          padding: '10px 20px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 6,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>{flowLabel}</div>
            {request?.status && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', padding: '2px 8px', borderRadius: 128,
                background:
                  request.status === 'resolved' ? '#e8f5e9' :
                  request.status === 'rejected' ? '#fee2e2' :
                  request.status === 'in_progress' ? '#fff8e6' :
                  request.status === 'on_hold' ? '#f5f5f4' :
                  '#e0f2fe',
                color:
                  request.status === 'resolved' ? '#15803d' :
                  request.status === 'rejected' ? '#991b1b' :
                  request.status === 'in_progress' ? '#d97706' :
                  request.status === 'on_hold' ? '#737373' :
                  '#0369a1',
              }}>{(request.status || '').replace(/_/g, ' ')}</span>
            )}
            <div style={{ flex: 1 }} />
          {canDecide && (
            <>
              <button
                type="button"
                onClick={() => onApproveTask?.(request)}
                title="Approve this request"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 999,
                  background: '#15803d', color: 'white',
                  border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                }}
              >
                <i className="bi bi-check2" style={{ fontSize: 13 }} />
                Approve
              </button>
              <button
                type="button"
                onClick={() => onDenyTask?.(request)}
                title="Deny this request"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 999,
                  background: 'var(--surface)', color: '#d42d35',
                  border: '1px solid #fca5a5', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                }}
              >
                <i className="bi bi-x" style={{ fontSize: 13 }} />
                Deny
              </button>
            </>
          )}
          <CopyLinkButton requestId={requestId} />
          <FollowButton
            isFollowing={isFollowing}
            onToggle={async () => {
              try {
                if (isFollowing) await unfollowHrHubRequest(requestId, user.email);
                else await followHrHubRequest(requestId, user.email);
                onRefresh?.();
              } catch (err) {
                // eslint-disable-next-line no-alert
                alert(err?.message || 'Could not update follow state');
              }
            }}
          />
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}
          ><i className="bi bi-x-lg" style={{ fontSize: 14 }} /></button>
          </div>
          {/* Sticky subject — single-line ellipsis so a long title doesn't
              steal vertical space from the scrollable body. */}
          {request && (
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }} title={request.title || request.summary || ''}>
              {request.title || (request.summary || '').slice(0, 200) || '(untitled)'}
            </div>
          )}
        </div>

        {/* Body */}
        <div
          ref={scrollBodyRef}
          onScroll={handleCommentsScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 16px' }}
        >
          {loading && !request && (
            <div style={{ padding: 30, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>{error}</div>
          )}
          {request && (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                {request.title || (request.summary || '').slice(0, 200) || '(untitled)'}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                Submitted by <strong>{request.createdByName || request.createdByEmail}</strong> · {formatRelative(request.createdAt)}
              </div>

              {/* Status / Priority / Assignee row.
                  Each picker carries an uppercase caption so managers can
                  tell at a glance which control is which — the assignee
                  picker on its own just says the person's name, and on a
                  busy drawer that read like "is this the requestor?" to
                  Melissa (2026-05-05 dashboard clarity report). */}
              <div style={{
                marginTop: 14, display: 'flex', alignItems: 'flex-end', gap: 14,
                flexWrap: 'wrap',
              }}>
                <LabeledPicker label="Status">
                  <PickerStatus
                    value={request.status}
                    onChange={v => updateField({ status: v })}
                    disabled={savingField === 'status' || statusPickerLocked}
                    title={statusPickerLocked ? 'Status is driven by Approve / Deny on this flow — use the buttons in the header.' : undefined}
                  />
                </LabeledPicker>
                <LabeledPicker label="Priority">
                  <PickerPriority value={request.priority} onChange={v => updateField({ priority: v })} disabled={savingField === 'priority'} />
                </LabeledPicker>
                <LabeledPicker label="Assignee">
                  <PickerAssignee value={request.assigneeEmail} valueName={request.assigneeName} onChange={(email, name) => updateField({ assigneeEmail: email, assigneeName: name })} disabled={savingField === 'assigneeEmail'} />
                </LabeledPicker>
              </div>

              {/* Task context — only for the two flows that anchor on a
                  queue row (hide_task_request + sla_extension_request).
                  Surfaces the originating source + subject + a clickable
                  link so reviewers can verify which row they're acting on
                  before approving / denying. */}
              {(request.flow === 'hide_task_request' || request.flow === 'sla_extension_request') && request.taskSource && (
                <TaskContextBlock
                  taskSource={request.taskSource}
                  taskUrl={request.taskUrl}
                  taskSubject={request.taskSubject}
                  taskId={request.taskId}
                  slaExtRequestedDays={request.slaExtRequestedDays}
                  slaExtApprovedDays={request.slaExtApprovedDays}
                  slaExtReasonCode={request.slaExtReasonCode}
                  isSlaExt={request.flow === 'sla_extension_request'}
                />
              )}

              {/* Fields */}
              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {request.functionArea && <FieldRow label="Function" value={request.functionArea} />}
                {request.requestType && <FieldRow label="Request Type" value={request.requestType} />}
                {request.reportType && <FieldRow label="Report Type" value={request.reportType} />}
                {request.summary && <FieldRow label="Summary" value={request.summary} multiline />}
                {request.idealSolution && <FieldRow label="Ideal Solution" value={request.idealSolution} multiline />}
                {request.resolutionNote && <FieldRow label="Resolution Note" value={request.resolutionNote} multiline />}
                {Array.isArray(request.links) && request.links.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Links</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {request.links.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#1f74b3', textDecoration: 'none' }}>
                          <i className="bi bi-link-45deg" /> {u}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(request.attachments) && request.attachments.length > 0 && (
                  <AttachmentsGrid attachments={request.attachments} />
                )}
              </div>

              {/* Followers */}
              {followers.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                    Following ({followers.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {followers.map(f => (
                      <span key={f.email} style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 999,
                        background: 'var(--surface-3)', color: 'var(--text)',
                      }} title={`${f.email} · ${f.source}`}>
                        {(MEMBERS_BY_EMAIL[f.email]?.name) || f.email}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div style={{ marginTop: 26 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                  Conversation
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {comments.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      No comments yet. Start the thread below — tag teammates with <code>@first.last</code> to bring them in as followers.
                    </div>
                  )}
                  {comments.map(c => (
                    <CommentRow
                      key={c.id}
                      comment={c}
                      currentUserEmail={user?.email}
                      onEdit={async (newBody) => {
                        try {
                          const res = await patchHrHubComment(c.id, newBody);
                          setComments(prev => prev.map(x => x.id === c.id ? { ...x, body: res?.body || newBody, mentionEmails: res?.mentionEmails || x.mentionEmails, editedAt: res?.editedAt || new Date().toISOString() } : x));
                        } catch (err) {
                          // eslint-disable-next-line no-alert
                          alert(err?.message || 'Could not save edit');
                        }
                      }}
                      onDelete={async () => {
                        try {
                          await deleteHrHubComment(c.id);
                          setComments(prev => prev.filter(x => x.id !== c.id));
                        } catch (err) {
                          // eslint-disable-next-line no-alert
                          alert(err?.message || 'Could not delete');
                        }
                      }}
                      onReactionsChange={(commentId, nextReactions) => {
                        setComments(prev => prev.map(x => x.id === commentId ? { ...x, reactions: nextReactions } : x));
                      }}
                    />
                  ))}
                  {/* Sentinel for Slack-style auto-scroll. Sits after the
                      last comment so `scrollIntoView({ block: 'end' })`
                      brings the latest comment + composer into view. */}
                  <div ref={commentsEndRef} aria-hidden="true" />
                </div>
              </div>

              {/* Audit log (collapsed by default; expand on click) */}
              <LogSection log={log} />
            </>
          )}
        </div>

        {/* Composer (sticky at bottom) */}
        {request && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 14, flexShrink: 0, background: 'var(--surface)' }}>
            <HrHubComposer
              onSubmit={async (payload) => {
                const created = await postHrHubComment(requestId, payload);
                // Optimistic local append so the author sees their comment
                // instantly. Then refresh the parent so the Following pill
                // list and Activity log row count pick up the @-mention
                // followers + comment_added log entry the server just
                // wrote — without this they read stale until manual reload.
                // Set the force-scroll flag BEFORE setComments so the
                // layout effect catches it on the same render — the user
                // just posted, they always want to see their message
                // regardless of whether they had scrolled up to read
                // older context.
                forceScrollOnNextRenderRef.current = true;
                setComments(prev => [...prev, created]);
                // Server-side auto-advance: when a manager comments on a
                // 'new' request, the route flips status to 'in_progress'
                // and echoes `autoAdvancedStatus`. Mirror it into the
                // parent list immediately so the row's status pill +
                // header status dropdown both reflect the move without
                // waiting on the next list refresh.
                if (created?.autoAdvancedStatus) {
                  onItemUpdated?.({ id: requestId, status: created.autoAdvancedStatus });
                }
                onRefresh?.();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FollowButton({ isFollowing, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: '6px 12px', borderRadius: 999,
        border: '1px solid ' + (isFollowing ? '#29811e' : '#e8e8e8'),
        background: isFollowing ? '#e8f5e9' : 'white',
        color: isFollowing ? '#166534' : '#1b1b1b',
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      <i className={`bi ${isFollowing ? 'bi-bell-fill' : 'bi-bell'}`} style={{ fontSize: 12 }} />
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}

// Copy a shareable deep-link to the clipboard. Anne Sanmartin 2026-05-11
// feedback ("Links of HR Requests") — users want to paste the link to an
// HR request into Slack, Workbench, or the employee profile in Deel admin.
// Mohamed's clarifier: "the link should be accessible by anyone with ops
// hub access depending on permission of course". Permission gating is
// already enforced server-side by the audience check in
// /api/v1/hr-hub/requests/[id]; this button just makes the URL discoverable
// instead of forcing users to hand-edit the address bar.
function CopyLinkButton({ requestId }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!requestId || typeof window === 'undefined') return;
    try {
      // Build a clean URL: drop every existing query/hash so the recipient
      // doesn't inherit stale filter / scope state from the sharer's tab.
      // Only `view` + `req` are set — App.jsx + HrHubView read those on
      // first paint via the existing URL-param-in-useState pattern.
      const u = new URL(window.location.href);
      const out = new URL(`${u.origin}${u.pathname}`);
      out.searchParams.set('view', 'hr-hub');
      out.searchParams.set('req', requestId);
      await navigator.clipboard.writeText(out.toString());
      setCopied(true);
      setErr(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr(true);
      setTimeout(() => setErr(false), 2400);
    }
  }, [requestId]);

  const label = err ? 'Copy failed' : (copied ? 'Copied!' : 'Copy link');
  const icon  = err ? 'bi-exclamation-triangle' : (copied ? 'bi-check2' : 'bi-link-45deg');
  const tone  = err
    ? { bg: '#fef2f2', color: '#991b1b', border: '#fca5a5' }
    : (copied
        ? { bg: '#e8f5e9', color: '#166534', border: '#86efac' }
        : { bg: 'white', color: '#1b1b1b', border: '#e8e8e8' });
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy a shareable link to this request"
      title="Copy a shareable link to this request — recipients with Ops Hub access (and audience visibility) will land directly on it."
      style={{
        padding: '6px 12px', borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg, color: tone.color,
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        transition: 'all .15s',
      }}
    >
      <i className={`bi ${icon}`} style={{ fontSize: 13 }} />
      {label}
    </button>
  );
}

function LabeledPicker({ label, children }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
      }}>{label}</span>
      {children}
    </div>
  );
}

function PickerStatus({ value, onChange, disabled, title }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      title={title}
      style={pickerStyle(STATUS_OPTIONS.find(s => s.id === value)?.bg, STATUS_OPTIONS.find(s => s.id === value)?.color)}
    >
      {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

function PickerPriority({ value, onChange, disabled }) {
  return (
    <select
      value={value || 'medium'}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={pickerStyle('#f3f3f3', '#1b1b1b')}
    >
      {PRIORITY_OPTIONS.map(p => <option key={p.id} value={p.id}>{`Priority: ${p.label}`}</option>)}
    </select>
  );
}

function PickerAssignee({ value, valueName, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const sortedMembers = useMemo(
    () => [...MEMBERS].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [],
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sortedMembers.filter(m => (m.name || '').toLowerCase().includes(q))
    : sortedMembers;

  // Build the flat option list once: a synthetic Unassigned row at index 0,
  // then the (filtered) members. ActiveIdx walks this combined array so
  // arrow / enter handling stays a single switch.
  const options = useMemo(() => [
    { email: '', name: 'Unassigned', _unassigned: true },
    ...filtered,
  ], [filtered]);

  // Reset highlight when the search changes so users don't enter on a hidden row.
  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Focus the search input on every open so typing immediately filters.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const select = (email, name) => {
    onChange(email || null, name || null);
    setOpen(false);
    setQuery('');
    setActiveIdx(0);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[activeIdx];
      if (opt) select(opt.email, opt._unassigned ? null : opt.name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Keep the highlighted row scrolled into view during keyboard nav.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const currentName = value
    ? (MEMBERS_BY_EMAIL[value]?.name || valueName || value)
    : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...pickerStyle('#f3f3f3', '#1b1b1b'),
          display: 'inline-flex', alignItems: 'center', gap: 6,
          opacity: disabled ? 0.6 : 1,
          maxWidth: 220, overflow: 'hidden',
          whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}
      >
        <i className="bi bi-person" style={{ fontSize: 12, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {currentName || 'Unassigned'}
        </span>
        <i className="bi bi-chevron-down" style={{ fontSize: 10, marginLeft: 2, flexShrink: 0 }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
            zIndex: 30,
            width: 280,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,.12)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search by name…"
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 13,
                outline: 'none',
                fontFamily: 'inherit',
                background: 'var(--surface, #fff)',
                color: 'var(--text)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div ref={listRef} role="listbox" style={{ overflowY: 'auto', maxHeight: 260 }}>
            {options.length === 1 && q && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                No matches
              </div>
            )}
            {options.map((opt, idx) => {
              const isActive = idx === activeIdx;
              const isSelected = opt._unassigned ? !value : opt.email === value;
              return (
                <button
                  key={opt._unassigned ? '__unassigned__' : opt.email}
                  type="button"
                  data-idx={idx}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => select(opt.email, opt._unassigned ? null : opt.name)}
                  style={{
                    display: 'block', width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: 'none',
                    background: isActive ? '#fef3ee' : 'transparent',
                    color: 'var(--text)',
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontStyle: opt._unassigned ? 'italic' : 'normal',
                  }}
                >
                  {opt.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function pickerStyle(bg, color) {
  return {
    padding: '5px 10px', borderRadius: 999,
    border: '1px solid var(--border)',
    background: bg || '#f3f3f3',
    color: color || '#1b1b1b',
    fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function FieldRow({ label, value, multiline }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
      <div style={{
        fontSize: 14, color: 'var(--text)', lineHeight: 1.55,
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
      }}>{value}</div>
    </div>
  );
}

// Task context for the two row-anchored flows: source chip, subject, ID,
// View-task link, plus the SLA extension's reason and day count when the
// flow is sla_extension_request. Renders nothing when taskSource isn't a
// known source — guards against future flow additions that re-use the
// task_* columns without a registered display entry.
function TaskContextBlock({ taskSource, taskUrl, taskSubject, taskId, slaExtRequestedDays, slaExtApprovedDays, slaExtReasonCode, isSlaExt }) {
  const meta = taskSource ? TASK_SOURCE_DISPLAY[taskSource] : null;
  if (!meta) return null;
  const reasonLabel = slaExtReasonCode ? (SLA_EXT_REASON_LABELS[slaExtReasonCode] || slaExtReasonCode) : null;
  return (
    <div style={{
      marginTop: 18, padding: '12px 14px',
      borderRadius: 12, border: '1px solid var(--border-light)',
      background: 'var(--surface-2)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        Task
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 999,
          background: meta.bg, color: meta.color,
          fontSize: 12, fontWeight: 700,
        }}>
          <i className={meta.icon} style={{ fontSize: 11 }} />
          {meta.label}
        </span>
        {taskId && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            #{taskId}
          </span>
        )}
        {taskUrl && (
          <a
            href={taskUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: '#1f74b3', textDecoration: 'none',
              fontSize: 12, fontWeight: 600,
            }}
            title="Open this task in a new tab"
          >
            <i className="bi-box-arrow-up-right" style={{ fontSize: 11 }} />
            View task
          </a>
        )}
      </div>
      {taskSubject && (
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4 }}>
          {taskSubject}
        </div>
      )}
      {isSlaExt && (reasonLabel || slaExtRequestedDays || slaExtApprovedDays) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
          {reasonLabel && (
            <div><strong style={{ color: 'var(--text)', fontWeight: 600 }}>Reason</strong> · {reasonLabel}</div>
          )}
          {slaExtRequestedDays && (
            <div><strong style={{ color: 'var(--text)', fontWeight: 600 }}>Requested</strong> · {slaExtRequestedDays} business day{slaExtRequestedDays === 1 ? '' : 's'}</div>
          )}
          {slaExtApprovedDays && (
            <div>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>Approved</strong> ·{' '}
              <span style={{ color: '#15803d', fontWeight: 600 }}>
                {slaExtApprovedDays} business day{slaExtApprovedDays === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AttachmentsGrid({ attachments }) {
  const [lightbox, setLightbox] = useState(null);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
        Attachments
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: 8,
      }}>
        {attachments.map((a, i) => {
          // Tiles always render as a relative-positioned container so the
          // download icon (and, for video, the play-overlay hint) can sit
          // on top of the media without affecting its layout. The inline
          // `<video>` previously rendered standalone — for large data URIs
          // the inline player would silently fail to load with no way for
          // the user to recover. We now open every attachment in the
          // lightbox on click and always surface a download icon so the
          // user has a fallback path to the file.
          const isPdf = a.kind === 'pdf';
          const tileStyle = {
            position: 'relative',
            display: 'block',
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: a.kind === 'video' ? '#1b1b1b' : 'var(--surface-2)',
            aspectRatio: '4 / 3',
            padding: 0,
            cursor: isPdf ? 'pointer' : 'zoom-in',
            width: '100%',
          };
          const lightboxKind = a.kind === 'video' ? 'video' : 'image';
          const titleAttr = isPdf ? 'Open PDF' : a.kind === 'video' ? 'Play video' : 'Open image';
          // PDFs open in a new tab via the browser's built-in viewer
          // (data URIs render fine in modern Chromium/Firefox). The
          // lightbox is image/video only, so we'd lose the user's
          // context if we tried to route PDFs through it.
          const onTileClick = isPdf
            ? () => { try { window.open(a.dataUri, '_blank', 'noopener,noreferrer'); } catch {} }
            : () => setLightbox({ src: a.dataUri, name: a.name, kind: lightboxKind });
          return (
            <div key={i} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={onTileClick}
                style={tileStyle}
                title={titleAttr}
                aria-label={titleAttr}
              >
                {a.kind === 'image' ? (
                  <img src={a.dataUri} alt={a.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : a.kind === 'video' ? (
                  // `preload="metadata"` is enough to render the first
                  // frame as a thumbnail. Pointer events are disabled so
                  // clicks bubble to the wrapping button (one click =
                  // open lightbox, never accidentally tap inline-play).
                  <>
                    <video
                      src={a.dataUri}
                      preload="metadata"
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                    <span style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      <span style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.55)', color: '#fff',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <i className="bi-play-fill" style={{ fontSize: 22 }} />
                      </span>
                    </span>
                  </>
                ) : (
                  // PDF tile — icon + filename. No inline preview because
                  // rendering data-URI PDFs in <object>/<iframe> is
                  // unreliable across browsers; the click handler opens
                  // the file in a new tab where the browser's viewer
                  // takes over, and the download icon overlay is the
                  // belt-and-braces fallback.
                  <div style={{
                    width: '100%', height: '100%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: 8, gap: 6,
                    color: '#b91c1c',
                    textAlign: 'center',
                  }}>
                    <i className="bi bi-filetype-pdf" style={{ fontSize: 36 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={a.name}>{a.name || 'document.pdf'}</span>
                  </div>
                )}
              </button>
              {/* Download — works for images, videos, and PDFs via the
                  `download` attribute on a data: URI. Sits at the
                  top-right of every tile so the user always has a way
                  to save the file even if the in-app player can't
                  decode it. */}
              <a
                href={a.dataUri}
                download={a.name || (a.kind === 'video' ? 'attachment.mp4' : a.kind === 'pdf' ? 'attachment.pdf' : 'attachment.png')}
                onClick={e => e.stopPropagation()}
                aria-label={`Download ${a.name || a.kind}`}
                title="Download"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  textDecoration: 'none',
                }}
              >
                <i className="bi-download" style={{ fontSize: 12 }} />
              </a>
            </div>
          );
        })}
      </div>
      <ImageLightbox
        src={lightbox?.src}
        name={lightbox?.name}
        kind={lightbox?.kind || 'image'}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}

// ── CommentRow with mention chips + edit/delete ─────────────────────────────
function CommentRow({ comment, currentUserEmail, onEdit, onDelete, onReactionsChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const isMine = (currentUserEmail || '').toLowerCase() === (comment.authorEmail || '').toLowerCase();

  return (
    <div style={{
      display: 'flex', gap: 10,
      padding: '10px 12px',
      background: 'var(--surface-2)', borderRadius: 10,
    }}>
      <Avatar name={comment.authorName || comment.authorEmail} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{comment.authorName || comment.authorEmail}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {formatRelative(comment.createdAt)}
            {comment.editedAt ? ' · edited' : ''}
          </div>
          {isMine && !editing && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button onClick={() => setEditing(true)} style={iconBtn} aria-label="Edit"><i className="bi bi-pencil" /></button>
              <button onClick={onDelete} style={iconBtn} aria-label="Delete"><i className="bi bi-trash" /></button>
            </div>
          )}
        </div>
        {!editing && (
          <CommentBody body={comment.body} />
        )}
        {editing && (
          <div style={{ marginTop: 6 }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={3}
              style={{
                width: '100%', padding: 8, fontSize: 14, lineHeight: 1.5,
                border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit',
                resize: 'vertical', minHeight: 60,
              }}
            />
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <button
                onClick={async () => { await onEdit(draft); setEditing(false); }}
                style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#1b1b1b', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >Save</button>
              <button
                onClick={() => { setDraft(comment.body); setEditing(false); }}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}
              >Cancel</button>
            </div>
          </div>
        )}
        {Array.isArray(comment.attachments) && comment.attachments.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <AttachmentsGrid attachments={comment.attachments} />
          </div>
        )}
        {!editing && (
          <CommentReactions
            commentType="hr_hub"
            commentId={comment.id}
            reactions={comment.reactions || []}
            currentUserEmail={currentUserEmail}
            onChange={(next) => onReactionsChange?.(comment.id, next)}
          />
        )}
      </div>
    </div>
  );
}

const iconBtn = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: 12, padding: 4,
};

function Avatar({ name }) {
  const initials = (name || '').split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: '#6b3fa0', color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, flexShrink: 0,
    }}>{initials}</div>
  );
}

// Render @firstname.lastname tokens as inline chips. Linked names look
// distinct without a heavy formatter (no markdown lib needed for Stage 4).
function CommentBody({ body }) {
  const parts = useMemo(() => {
    const out = [];
    const re = /(^|\s)@([a-z][a-z0-9._-]{1,80})/gi;
    let last = 0;
    let m;
    while ((m = re.exec(body)) != null) {
      const start = m.index + m[1].length;   // index of '@'
      if (start > last) out.push({ text: body.slice(last, start) });
      out.push({ mention: m[2] });
      last = start + 1 + m[2].length;
    }
    if (last < body.length) out.push({ text: body.slice(last) });
    return out;
  }, [body]);
  return (
    <div style={{ marginTop: 4, fontSize: 14, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((p, i) => p.mention
        ? <span key={i} style={{ background: '#f3eff8', color: '#5b21b6', borderRadius: 4, padding: '0 4px', fontWeight: 600 }}>@{p.mention}</span>
        : <span key={i}>{p.text}</span>
      )}
    </div>
  );
}

function LogSection({ log }) {
  const [expanded, setExpanded] = useState(false);
  if (!log || log.length === 0) return null;
  return (
    <div style={{ marginTop: 26 }}>
      <button
        onClick={() => setExpanded(p => !p)}
        style={{
          background: 'transparent', border: 'none',
          padding: 0, cursor: 'pointer',
          fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <i className={`bi bi-chevron-${expanded ? 'down' : 'right'}`} />
        Activity log ({log.length})
      </button>
      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {log.map(l => (
            <div key={l.id} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{formatRelative(l.createdAt)}</span>
              <span><strong>{l.actorName || l.actorEmail || 'system'}</strong> · {l.eventType.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
