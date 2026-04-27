// ── Detail (Phase 1) ─────────────────────────────────────────────────────────
// Full-page 3-column ticket view that replaces the old tabbed modal.
//   Left rail   — status changer + ticket metadata + external links
//   Center      — email chain (last 10) + reply composer
//   Right rail  — AI summary placeholder, Notes, Timeline
//
// Phase 1 ships the layout, status changes, comments, and reply (with the
// internal-first default from PR #263). Editable custom fields, macros,
// side conversations, and the AI summary follow in later phases.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useContext, useCallback, useMemo, memo } from 'react';
import { PermissionsContext, SettingsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { TOOLS, SLA_MINS, getFlag } from '../../data/constants';
import { slaInfo } from '../../utils/helpers';
import Avatar from '../ui/Avatar';
import { ToolBadge } from '../ui/Badges';
import NotesTab from './NotesTab';
import TimelineTab from './TimelineTab';
import { fetchTicketComments, postTicketAction } from '../../services/integrationsApi';

// Visible status options (FE → app status). Maps to ZD via actions/route.js
// statusMap. "On hold" requires actions/route.js to accept on_hold → hold.
const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'Open',     icon: 'bi-arrow-repeat',         color: '#1d4ed8', bg: '#eff6ff', border: '#bddcf0' },
  { value: 'waiting',     label: 'Pending',  icon: 'bi-hourglass-split',      color: '#92400E', bg: '#fff8e6', border: '#fde68a' },
  { value: 'on_hold',     label: 'On hold',  icon: 'bi-pause-circle',         color: '#6b6560', bg: '#f5f3ef', border: '#e0d9d2' },
  { value: 'resolved',    label: 'Resolved', icon: 'bi-check-circle-fill',    color: '#15803d', bg: '#e8f5e9', border: '#bbf7d0' },
];

// ZD raw status → app-level button id (used to highlight the active option).
// ZD's `hold` collapses to our 'waiting' bucket in queue/route.js, so we
// look at the raw `zdStatus` field first when present, falling back to the
// app-level `status` for Jira / older payloads.
function deriveActiveStatus(task) {
  const zd = (task?.zdStatus || '').toLowerCase();
  if (zd === 'hold') return 'on_hold';
  if (zd === 'pending') return 'waiting';
  if (zd === 'open') return 'in_progress';
  if (zd === 'new') return 'in_progress';        // new is also "actively in queue"
  if (zd === 'solved' || zd === 'closed') return 'resolved';
  // Jira fallback (no zdStatus). The app statuses already match.
  return task?.status || 'in_progress';
}

// admin.deel.network deep-link for the ticket requester. The exact path (e.g.
// /people/<id>) varies per environment, so for Phase 1 we open the admin
// portal's people search with the requester's email pre-filled — guaranteed
// to land on a usable result regardless of current URL conventions.
function employeeProfileUrl(email) {
  if (!email) return null;
  return `https://admin.deel.network/people?search=${encodeURIComponent(email)}`;
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  const days = Math.floor(mins / 1440);
  return `${days}d ago`;
}

function absTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Quick reply templates keyed by task type — preserved from the previous
// Detail. Used by the inline templates dropdown on the reply composer.
const REPLY_TEMPLATES = {
  default:        'Thank you for reaching out. I\'m reviewing your request and will follow up within [SLA time].',
  'Payment Issue':'I can see there\'s a discrepancy in your payslip. I\'ve raised this with the payroll team and expect a correction within 2 business days.',
  'Immigration':  'Your immigration case has been received. Please allow 5-10 business days for processing.',
  'Onboarding':   'Welcome! Your onboarding request has been received. Your manager will be in touch shortly.',
  'Benefits':     'Your benefits query has been logged. Our benefits team will respond within 24 hours.',
  'Leave Request':'Your leave request has been reviewed. Please check your leave balance in the HR portal.',
};

const Detail = ({
  task: selectedTask,
  onClose,
  tasks,
  setTasks,
  notes,
  setNotes,
  activity,
  setActivity,
  currentUser,
  escalations = [],
  onResolve,
  addToast,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
}) => {
  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const canResolve = perms?.canDo ? perms.canDo('can_resolve_task') !== false : true;

  // The parent passes `selectedTask` (Queue.jsx's `selTask` state). When
  // setTasks updates the list, that state object stays stale — so the
  // status changer would keep highlighting the pre-update value until the
  // user navigated. Resolve the live row from the current `tasks` array on
  // every render so optimistic updates AND server-side refreshes both flow
  // through visibly. Falls back to the passed-in object when the row is
  // momentarily out of the list (e.g. just resolved + filter active).
  const task = useMemo(() => {
    if (!selectedTask?.id) return selectedTask;
    if (!Array.isArray(tasks)) return selectedTask;
    return tasks.find(t => t.id === selectedTask.id) || selectedTask;
  }, [selectedTask, tasks]);

  // ── Component-local state ──────────────────────────────────────────────
  const [replyText, setReplyText] = useState('');
  // Default to INTERNAL — public replies go to the requester (usually the
  // affected employee), so making "public" an explicit affirmative click
  // prevents accidental publication of internal notes. Jira ignores this.
  const [replyPublic, setReplyPublic] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(null); // status value currently in-flight
  const [expandedComments, setExpandedComments] = useState(new Set());

  // Reset transient state when the task changes (next/prev navigation).
  useEffect(() => {
    setReplyText('');
    setReplyPublic(false);
    setShowTemplates(false);
    setComments([]);
    setCommentsLoading(true);
    setCommentsError(null);
    setStatusUpdating(null);
    setExpandedComments(new Set());
  }, [task?.id]);

  // ── Comment fetching (lazy, deduped) ───────────────────────────────────
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchInflightRef = useRef(null);
  // Monotonic sequence so a comment fetch that resolves AFTER the user
  // navigated to a different ticket can't clobber the new ticket's data
  // (race condition: prev/next switches task.id while a fetch is mid-flight).
  const fetchSeqRef = useRef(0);
  const loadComments = useCallback(() => {
    if (!task?.id) return;
    if (task.source !== 'zendesk' && task.source !== 'jira') {
      setCommentsLoading(false);
      return;
    }
    if (fetchInflightRef.current === task.id) return;
    fetchInflightRef.current = task.id;
    const seq = ++fetchSeqRef.current;
    const targetId = task.id;
    setCommentsLoading(true);
    setCommentsError(null);
    fetchTicketComments(task.id)
      .then(data => {
        if (!mountedRef.current || fetchSeqRef.current !== seq) return;
        setComments(data.comments || []);
      })
      .catch(err => {
        if (!mountedRef.current || fetchSeqRef.current !== seq) return;
        setCommentsError(err?.message || 'Failed to load messages');
      })
      .finally(() => {
        if (mountedRef.current && fetchSeqRef.current === seq) setCommentsLoading(false);
        if (fetchInflightRef.current === targetId) fetchInflightRef.current = null;
      });
  }, [task?.id, task?.source]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // ── Derived data ───────────────────────────────────────────────────────
  const assignee = useMemo(() => {
    if (task?.assigneeId) {
      const m = MEMBERS.find(x => x.id === task.assigneeId);
      if (m) return m;
    }
    if (task?.assigneeEmail) {
      const m = MEMBERS.find(x => x.email.toLowerCase() === task.assigneeEmail.toLowerCase());
      if (m) return m;
      return { id: null, name: task.assigneeName || task.assigneeEmail, email: task.assigneeEmail };
    }
    return null;
  }, [task?.assigneeId, task?.assigneeEmail, task?.assigneeName]);

  const activeStatus = useMemo(() => deriveActiveStatus(task), [task]);
  const isZD = task?.source === 'zendesk';
  const isJira = task?.source === 'jira';
  const isResolved = activeStatus === 'resolved';

  const sla = useMemo(() => slaInfo(task), [task]);
  const slaLim = (Number.isFinite(task?.slaMinsOverride) && task.slaMinsOverride > 0)
    ? task.slaMinsOverride
    : (SLA_MINS[task?.type] || 1440);
  const slaRem = slaLim - ((task?.minutesSinceLastResponse ?? task?.minutesAgo) ?? 0);
  const slaPct = Math.max(0, Math.min(100, (slaRem / slaLim) * 100));

  // ── Action handlers ────────────────────────────────────────────────────
  const handleStatusChange = useCallback(async (next) => {
    if (statusUpdating) return;
    if (next === activeStatus) return;
    setStatusUpdating(next);
    // Optimistic — update parent task list immediately so the rest of the
    // queue reflects the change. Roll back if the API call fails.
    const previousStatus = task.status;
    const optimisticStatus = next === 'on_hold' ? 'waiting' : next; // app maps on_hold → waiting bucket
    const optimisticZd = next === 'on_hold' ? 'hold'
      : next === 'waiting' ? 'pending'
      : next === 'in_progress' ? 'open'
      : next === 'resolved' ? 'solved'
      : task.zdStatus;
    setTasks?.(prev => prev.map(t => t.id === task.id
      ? { ...t, status: optimisticStatus, zdStatus: optimisticZd }
      : t));
    try {
      await postTicketAction(task.id, { action: 'status', status: next });
      addToast?.('success', 'Status updated', `Set to ${STATUS_OPTIONS.find(s => s.value === next)?.label}.`);
      // For "Resolved" also surface the standard onResolve hook so any other
      // queue side-effect (e.g. recordMutation, locallyResolvedAt) fires.
      if (next === 'resolved' && onResolve) onResolve(task);
    } catch (err) {
      setTasks?.(prev => prev.map(t => t.id === task.id
        ? { ...t, status: previousStatus, zdStatus: task.zdStatus }
        : t));
      addToast?.('error', 'Status change failed', err?.message || 'Please retry.');
    } finally {
      if (mountedRef.current) setStatusUpdating(null);
    }
  }, [activeStatus, statusUpdating, task, setTasks, addToast, onResolve]);

  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    const sentMode = isZD
      ? (replyPublic ? 'Public reply sent' : 'Internal note added')
      : 'Reply sent';
    const sentDetail = isZD && replyPublic
      ? 'Visible to the requester in Zendesk.'
      : isZD ? 'Only visible to your team in Zendesk.'
      : 'Your reply has been posted to the ticket.';
    try {
      await postTicketAction(task.id, { action: 'reply', message: replyText, public: replyPublic });
      if (!mountedRef.current) return;
      addToast?.('success', sentMode, sentDetail);
      setReplyText('');
      // Refresh comment list so the new entry shows. Reset the dedup ref
      // so the fetch isn't suppressed.
      fetchInflightRef.current = null;
      loadComments();
    } catch (err) {
      if (mountedRef.current) addToast?.('error', 'Reply failed', err?.message || 'Could not send reply.');
    } finally {
      if (mountedRef.current) setReplySending(false);
    }
  }, [replyText, replyPublic, replySending, isZD, task?.id, addToast, loadComments]);

  const toggleCommentExpansion = useCallback((id) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        // Cmd/Ctrl+Enter from inside the textarea sends the reply.
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.target.tagName === 'TEXTAREA') {
          e.preventDefault();
          handleSendReply();
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); }
      if (e.key === 'ArrowLeft' && canPrev) { e.preventDefault(); onPrev?.(); }
      if (e.key === 'ArrowRight' && canNext) { e.preventDefault(); onNext?.(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, canPrev, canNext, handleSendReply]);

  if (!task) return null;
  const taskEscalation = escalations.find(e => e.taskId === task.id);
  const employeeUrl = employeeProfileUrl(task.requesterEmail);

  return (
    <div data-role="zd-detail-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafaf9', overflow: 'hidden', minHeight: 0 }}>
      <style>{`
        @keyframes detailFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .zd-comment-body { white-space: pre-wrap; word-break: break-word; line-height: 1.55; }
        .zd-rail-section { animation: detailFadeIn 0.18s ease both; }
        .zd-status-btn:focus-visible { outline: 2px solid #1f74b3; outline-offset: 2px; }
        .zd-status-btn:disabled { cursor: not-allowed; opacity: 0.55; }
      `}</style>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto auto 1fr auto',
        alignItems: 'center',
        gap: 12,
        padding: '12px 24px',
        background: 'white',
        borderBottom: '1px solid #e8e8e8',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          aria-label="Back to queue"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #e8e8e8', background: 'white', color: '#1b1b1b', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f7f5f2'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
        >
          <i className="bi-arrow-left" style={{ fontSize: 13 }} />
          Back
        </button>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <ToolBadge source={task.source} />
          <span style={{ fontSize: 12, color: '#9e9e9e', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{task.id}</span>
        </div>

        <div title={task.subject} style={{
          fontSize: 15, fontWeight: 700, color: '#1b1b1b',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          minWidth: 0,
        }}>
          {task.subject || '(no subject)'}
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Previous ticket"
            title="Previous ticket (←)"
            style={{ ...iconBtnStyle, opacity: canPrev ? 1 : 0.35, cursor: canPrev ? 'pointer' : 'not-allowed' }}
          >
            <i className="bi-chevron-left" style={{ fontSize: 13 }} />
          </button>
          <button
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next ticket"
            title="Next ticket (→)"
            style={{ ...iconBtnStyle, opacity: canNext ? 1 : 0.35, cursor: canNext ? 'pointer' : 'not-allowed' }}
          >
            <i className="bi-chevron-right" style={{ fontSize: 13 }} />
          </button>
          {task.externalUrl && (
            <a
              href={task.externalUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open in ${TOOLS[task.source]?.label || 'source'}`}
              style={{ ...iconBtnStyle, color: '#1f74b3', textDecoration: 'none' }}
            >
              <i className="bi-box-arrow-up-right" style={{ fontSize: 12 }} />
            </a>
          )}
        </div>
      </div>

      {/* ── 3-column body ──────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr) minmax(280px, 340px)',
        gap: 16,
        padding: 16,
        overflow: 'hidden',
        minHeight: 0,
      }}>
        {/* ═══ LEFT RAIL ═════════════════════════════════════════════════ */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
          {/* Status changer */}
          <RailCard title="Status">
            <div role="radiogroup" aria-label="Ticket status" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {STATUS_OPTIONS.map(opt => {
                const isActive = activeStatus === opt.value;
                const isLoading = statusUpdating === opt.value;
                const permissionLocked = opt.value === 'resolved' && !canResolve;
                const disabled = !!statusUpdating || permissionLocked;
                return (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={isActive}
                    disabled={disabled}
                    title={permissionLocked ? "You don't have permission to resolve tasks" : undefined}
                    onClick={() => handleStatusChange(opt.value)}
                    className="zd-status-btn"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      height: 36, padding: '0 10px', borderRadius: 10,
                      border: `1px solid ${isActive ? opt.color : '#e8e8e8'}`,
                      background: isActive ? opt.bg : 'white',
                      color: isActive ? opt.color : '#616161',
                      fontSize: 12, fontWeight: isActive ? 700 : 500,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      transition: 'all .15s',
                      boxShadow: isActive ? `0 0 0 2px ${opt.color}18` : 'none',
                    }}
                  >
                    <i className={isLoading ? 'bi-arrow-clockwise spin' : opt.icon} style={{ fontSize: 12 }} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </RailCard>

          {/* SLA bar (hidden once resolved or paused — both Pending and On hold
              are treated as paused so the bar doesn't keep ticking down while
              we're blocked on someone else). */}
          {settings?.sla_enabled !== false && !isResolved && activeStatus !== 'waiting' && activeStatus !== 'on_hold' && (
            <RailCard title="SLA">
              <SlaBar pct={slaPct} remMins={slaRem} />
              {sla?.label && (
                <div style={{ marginTop: 6, fontSize: 11, color: sla.color, fontWeight: 600 }}>
                  <i className={sla.breach ? 'bi-exclamation-triangle-fill' : 'bi-clock'} style={{ marginRight: 4 }} />
                  {sla.label}
                </div>
              )}
            </RailCard>
          )}

          {/* Ticket details */}
          <RailCard title="Details">
            <DetailRow label="Assignee" value={
              assignee
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Avatar name={assignee.name} size={20} />
                    <span>{assignee.name}</span>
                  </span>
                : <span style={{ color: '#d42d35', fontWeight: 600 }}>Unassigned</span>
            } />
            {/* Country: heuristic (detected from tags/subject) — shown
                immediately so the user has SOME signal. The actual
                "Employee Country" Zendesk custom field is rendered below
                as its own row; Phase 2 will fetch and let the user edit it. */}
            <DetailRow label="Country (detected)" value={task.country
              ? <span>{getFlag(task.country)} <span>{task.country}</span></span>
              : '—'} />
            <DetailRow label="Employee Country" value={readCustomField(task, 'employeeCountry')} hint="(editable in Phase 2)" />
            <DetailRow label="Form" value={readCustomField(task, 'form')} hint="(editable in Phase 2)" />
            <DetailRow label="Root Cause - Support" value={readCustomField(task, 'rootCauseSupport')} hint="(editable in Phase 2)" />
            <DetailRow label="Root Cause Selector" value={readCustomField(task, 'rootCauseSelector')} hint="(editable in Phase 2)" />
            <DetailRow label="Type" value={task.type || '—'} />
            <DetailRow label="Requester" value={task.requesterName || '—'} />
            {task.requesterEmail && (
              <DetailRow label="Email" value={
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{task.requesterEmail}</span>
              } />
            )}
            <DetailRow label="Received" value={task.createdAt ? absTime(task.createdAt) : '—'} />
            <DetailRow label="Last update" value={task.updatedAt ? `${relTime(task.updatedAt)}` : '—'} />
          </RailCard>

          {/* Quick links */}
          <RailCard title="Links">
            {task.externalUrl && (
              <RailLink href={task.externalUrl} icon={TOOLS[task.source]?.icon || 'bi-box-arrow-up-right'} label={`Open in ${TOOLS[task.source]?.label || 'source'}`} />
            )}
            {employeeUrl && (
              <RailLink href={employeeUrl} icon="bi-person-badge" label="Employee profile" />
            )}
            <RailLink disabled icon="bi-chat-dots" label="Side conversations (Phase 4)" />
          </RailCard>

          {/* Escalation banner */}
          {taskEscalation && (
            <div style={{
              background: taskEscalation.managerResponseStatus === 'responded' ? '#F0FDF9' : '#fff8e6',
              border: `1px solid ${taskEscalation.managerResponseStatus === 'responded' ? '#A7F3D0' : '#ffe27c'}`,
              borderRadius: 12,
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: taskEscalation.managerResponseStatus === 'responded' ? '#29811e' : '#ed8d00', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: taskEscalation.managerResponseStatus === 'responded' ? '#29811e' : '#92400E' }}>
                  Escalated to {taskEscalation.managerName}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#616161' }}>{taskEscalation.reason}</div>
            </div>
          )}
        </aside>

        {/* ═══ CENTER ═══════════════════════════════════════════════════ */}
        <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, gap: 12 }}>
          {/* Email chain */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'white',
            border: '1px solid #f0efed',
            borderRadius: 14,
            overflow: 'hidden',
            minHeight: 0,
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid #f0efed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <i className="bi-envelope-paper" style={{ fontSize: 13, color: '#616161' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b' }}>Conversation</span>
                {!commentsLoading && comments.length > 0 && (
                  <span style={{ padding: '1px 8px', borderRadius: 128, background: '#f2f2f2', color: '#616161', fontSize: 10, fontWeight: 700 }}>
                    {comments.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => { fetchInflightRef.current = null; loadComments(); }}
                title="Refresh conversation"
                aria-label="Refresh conversation"
                style={{ ...iconBtnStyle, width: 28, height: 28 }}
              >
                <i className={commentsLoading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 11 }} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {commentsLoading && comments.length === 0 ? (
                <CommentSkeleton />
              ) : commentsError ? (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 12 }}>
                  <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
                  Couldn't load conversation: {commentsError}
                  <button onClick={() => { fetchInflightRef.current = null; loadComments(); }} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#991b1b', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>
                    Retry
                  </button>
                </div>
              ) : comments.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#9e9e9e', fontSize: 13 }}>
                  <i className="bi-chat-square-text" style={{ fontSize: 24, display: 'block', marginBottom: 6, color: '#d0d0d0' }} />
                  No messages yet on this {isZD ? 'Zendesk' : isJira ? 'Jira' : ''} ticket
                </div>
              ) : (
                comments.map(c => (
                  <CommentBubble
                    key={c.id}
                    comment={c}
                    expanded={expandedComments.has(c.id)}
                    onToggleExpand={toggleCommentExpansion}
                  />
                ))
              )}
            </div>
          </div>

          {/* Reply composer */}
          {settings?.ai_replies_enabled !== false && (
            <ReplyComposer
              isZD={isZD}
              replyText={replyText}
              setReplyText={setReplyText}
              replyPublic={replyPublic}
              setReplyPublic={setReplyPublic}
              replySending={replySending}
              onSend={handleSendReply}
              showTemplates={showTemplates}
              setShowTemplates={setShowTemplates}
              taskType={task.type}
            />
          )}
        </section>

        {/* ═══ RIGHT RAIL ═══════════════════════════════════════════════ */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', minHeight: 0, paddingLeft: 4 }}>
          {/* AI summary placeholder */}
          <RailCard
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <i className="bi-stars" style={{ fontSize: 11, color: '#7c3aed' }} />
              <span>AI Summary</span>
            </span>}
          >
            <div style={{ padding: '12px 0', textAlign: 'center', color: '#9e9e9e', fontSize: 11 }}>
              <i className="bi-clock-history" style={{ fontSize: 18, display: 'block', marginBottom: 4, color: '#d0d0d0' }} />
              Coming in Phase 5
            </div>
          </RailCard>

          {/* Notes — uses NotesTab's own internal padding. */}
          <RailCard title="Notes" padded={false}>
            <NotesTab taskId={task.id} notes={notes} setNotes={setNotes} currentUser={currentUser} setActivity={setActivity} />
          </RailCard>

          {/* Timeline — capped at 280px tall so a long activity log doesn't
              push the AI summary + Notes off the visible right rail. */}
          <RailCard title="Timeline" padded={false}>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <TimelineTab taskId={task.id} task={task} activity={activity} escalation={taskEscalation} />
            </div>
          </RailCard>
        </aside>
      </div>
    </div>
  );
};

export default Detail;

// ─────────────────────────────────────────────────────────────────────────
// Sub-components & helpers
// ─────────────────────────────────────────────────────────────────────────

function RailCard({ title, children, padded = true }) {
  // padded=true → standard 12/14 padding inside, title sits inline at top.
  // padded=false → flush body (children handle their own padding); title
  //                gets its own 12/14 strip and the body sits underneath
  //                with no extra inset, so embedded components like
  //                NotesTab don't double up on padding.
  return (
    <div className="zd-rail-section" style={{
      background: 'white',
      border: '1px solid #f0efed',
      borderRadius: 12,
      padding: padded ? '12px 14px' : '0',
      overflow: 'hidden',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#9e9e9e',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: padded ? 10 : 0,
        padding: padded ? 0 : '12px 14px 4px',
      }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function DetailRow({ label, value, hint }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 10, alignItems: 'baseline', padding: '4px 0', fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ color: '#9e9e9e', fontWeight: 500, fontSize: 11 }}>{label}</span>
      <span style={{ color: '#1b1b1b', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
        {hint && <span style={{ marginLeft: 6, fontSize: 10, color: '#bebebe', fontWeight: 400 }}>{hint}</span>}
      </span>
    </div>
  );
}

function RailLink({ href, icon, label, disabled = false }) {
  const baseStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 8,
    fontSize: 12, fontWeight: 500,
    textDecoration: 'none',
    color: disabled ? '#bebebe' : '#1f74b3',
    background: 'transparent',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all .15s',
  };
  if (disabled) {
    return (
      <div style={baseStyle} aria-disabled="true">
        <i className={icon} style={{ fontSize: 13 }} />
        <span style={{ flex: 1 }}>{label}</span>
      </div>
    );
  }
  return (
    <a
      href={href} target="_blank" rel="noopener noreferrer"
      style={baseStyle}
      onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bddcf0'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
    >
      <i className={icon} style={{ fontSize: 13 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <i className="bi-box-arrow-up-right" style={{ fontSize: 10, opacity: 0.6 }} />
    </a>
  );
}

function SlaBar({ pct, remMins }) {
  const color = remMins <= 0 ? '#b91c1c' : pct > 50 ? '#15803d' : pct > 20 ? '#b45309' : '#b91c1c';
  const label = remMins <= 0
    ? `Breached ${Math.abs(remMins)}m ago`
    : remMins >= 60 ? `${Math.floor(remMins / 60)}h ${remMins % 60}m remaining` : `${remMins}m remaining`;
  return (
    <div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`SLA: ${label}`}
        style={{ background: '#f2f2f2', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width .3s' }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#616161', display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

function CommentSkeleton() {
  return (
    <>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ background: '#fafaf9', borderRadius: 10, border: '1px solid #f0efed', padding: 12 }}>
          <div className="skeleton" style={{ width: 140, height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: '100%', height: 12, marginBottom: 6 }} />
          <div className="skeleton" style={{ width: '70%', height: 12 }} />
        </div>
      ))}
    </>
  );
}

const CommentBubble = memo(function CommentBubble({ comment, expanded, onToggleExpand }) {
  const c = comment;
  const isPublic = c.public !== false;
  const isAgent = c.authorRole === 'agent' || c.authorRole === 'admin';
  const bg = !isPublic ? '#fffbeb' : isAgent ? '#fafaf9' : '#eff6ff';
  const border = !isPublic ? '#fde68a' : isAgent ? '#f0efed' : '#bddcf0';
  const COLLAPSE_THRESHOLD = 700;
  const isLong = (c.body || '').length > COLLAPSE_THRESHOLD;
  const visibleBody = (isLong && !expanded) ? c.body.substring(0, COLLAPSE_THRESHOLD) + '…' : c.body;

  return (
    <article style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: '10px 14px',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <Avatar name={c.authorName || '?'} size={24} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.authorName || 'Unknown'}
              {isAgent && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: 128, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Agent</span>}
            </div>
            {c.authorEmail && (
              <div style={{ fontSize: 10, color: '#9e9e9e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' }}>{c.authorEmail}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {!isPublic && (
            <span style={{ fontSize: 9, fontWeight: 700, color: '#92400E', background: '#fef3c7', padding: '2px 8px', borderRadius: 128, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Internal</span>
          )}
          <span title={absTime(c.createdAt)} style={{ fontSize: 11, color: '#9e9e9e' }}>{relTime(c.createdAt)}</span>
        </div>
      </header>
      <div className="zd-comment-body" style={{ fontSize: 13, color: '#1b1b1b' }}>
        {visibleBody || <span style={{ color: '#bebebe', fontStyle: 'italic' }}>(empty)</span>}
      </div>
      {isLong && (
        <button
          onClick={() => onToggleExpand(c.id)}
          style={{ marginTop: 8, padding: 0, background: 'none', border: 'none', color: '#1f74b3', fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {expanded ? 'Show less' : `Show full message (${c.body.length} chars)`}
        </button>
      )}
    </article>
  );
});

function ReplyComposer({ isZD, replyText, setReplyText, replyPublic, setReplyPublic, replySending, onSend, showTemplates, setShowTemplates, taskType }) {
  const templatesRef = useRef(null);
  useEffect(() => {
    if (!showTemplates) return;
    const onDoc = (e) => { if (templatesRef.current && !templatesRef.current.contains(e.target)) setShowTemplates(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showTemplates, setShowTemplates]);

  const canSend = replyText.trim() && !replySending;
  const sendBg = !canSend ? '#e0e0e0' : (isZD && replyPublic) ? '#b91c1c' : '#1b1b1b';
  const sendLabel = replySending
    ? 'Sending…'
    : !isZD ? 'Send Reply'
    : replyPublic ? 'Send Public Reply'
    : 'Add Internal Note';
  const sendIcon = replySending ? 'bi-hourglass-split' : !isZD ? 'bi-send' : replyPublic ? 'bi-send-fill' : 'bi-journal-text';

  return (
    <div style={{
      background: 'white',
      border: '1px solid #f0efed',
      borderRadius: 14,
      padding: 14,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <i className="bi-pencil-square" style={{ fontSize: 13, color: '#616161' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b' }}>Compose reply</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            disabled
            title="Macros — Phase 3"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', borderRadius: 6, border: '1px dashed #e8e8e8', background: 'white', color: '#bebebe', fontSize: 11, fontWeight: 500, cursor: 'not-allowed' }}
          >
            <i className="bi-lightning" style={{ fontSize: 10 }} />
            Macros
          </button>
          <div ref={templatesRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowTemplates(v => !v)}
              aria-haspopup="menu"
              aria-expanded={showTemplates}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid #e8e8e8', background: showTemplates ? '#e8f0fe' : 'white', color: showTemplates ? '#1f74b3' : '#616161', fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all .12s' }}
            >
              <i className="bi-file-text" style={{ fontSize: 10 }} />
              Templates
            </button>
            {showTemplates && (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 30, width: 280, background: 'white', border: '1px solid #e8e8e8', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, overflow: 'hidden' }}>
                {Object.keys(REPLY_TEMPLATES).map(key => (
                  <button
                    key={key}
                    role="menuitem"
                    onClick={() => { setReplyText(REPLY_TEMPLATES[key]); setShowTemplates(false); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid #f2f2f2', background: 'white', cursor: 'pointer', fontSize: 12, color: '#1b1b1b', transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f7f5f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{key === 'default' ? 'General' : key}</div>
                    <div style={{ color: '#9e9e9e', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{REPLY_TEMPLATES[key].slice(0, 60)}…</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <textarea
        value={replyText}
        onChange={e => setReplyText(e.target.value)}
        aria-label="Reply message"
        placeholder={isZD ? "Type a reply… (Cmd+Enter to send)" : "Type a comment… (Cmd+Enter to send)"}
        rows={5}
        style={{
          width: '100%', boxSizing: 'border-box', minHeight: 110,
          padding: 12, borderRadius: 10, border: '1px solid #e8e8e8',
          fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
          transition: 'border-color .12s',
        }}
        onFocus={e => e.target.style.borderColor = '#1f74b3'}
        onBlur={e => e.target.style.borderColor = '#e8e8e8'}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {isZD && (
            <label
              title={replyPublic ? 'This reply will be sent to the requester.' : 'Internal notes are only visible to your team in Zendesk.'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 128,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: replyPublic ? '#fef2f2' : '#fef3c7',
                color: replyPublic ? '#991b1b' : '#92400E',
                border: `1px solid ${replyPublic ? '#fca5a5' : '#fde68a'}`,
              }}
            >
              <input
                type="checkbox"
                checked={replyPublic}
                onChange={e => setReplyPublic(e.target.checked)}
                style={{ accentColor: replyPublic ? '#d42d35' : '#92400E' }}
              />
              {replyPublic ? 'Public — visible to requester' : 'Internal note'}
            </label>
          )}
        </div>
        <button
          disabled={!canSend}
          onClick={onSend}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 36, padding: '0 18px', borderRadius: 128,
            border: 'none', background: sendBg,
            color: canSend ? 'white' : '#9e9e9e',
            fontSize: 12, fontWeight: 700,
            cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'all .15s',
          }}
        >
          <i className={sendIcon} style={{ fontSize: 12 }} />
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

// Reads a custom-field value off the task. Phase 1 surfaces these as
// read-only — Phase 2 adds the discovery (GET /ticket_fields) + edit path.
// For now we look up a flat namespace `task.customFields[<key>]`; if the
// queue route hasn't populated it yet, we render an em-dash so the slot
// is visible but clearly blank.
function readCustomField(task, key) {
  const v = task?.customFields?.[key];
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 8,
  border: '1px solid #e8e8e8', background: 'white',
  color: '#616161', cursor: 'pointer',
  transition: 'all .15s',
};
