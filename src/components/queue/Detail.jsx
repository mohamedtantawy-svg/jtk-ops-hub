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
import { getVisibleEmails, isAdminUser } from '../../lib/queue-scoping';
import Avatar from '../ui/Avatar';
import { ToolBadge } from '../ui/Badges';
import NotesTab from './NotesTab';
import TimelineTab from './TimelineTab';
import { fetchTicketComments, postTicketAction, updateTicketCustomFields, fetchZendeskMacros, previewTicketMacro, applyTicketMacro } from '../../services/integrationsApi';
import { useTicketFieldsMeta } from '../../hooks/useTicketFieldsMeta';
import SideConversationsModal from './SideConversationsModal';

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
  // Phase 2 — which custom field's edit popover is open + which field is
  // currently being saved (so we can show a spinner + lock other edits).
  const [editingField, setEditingField] = useState(null);   // 'employeeCountry' | 'form' | ...
  const [fieldSaving, setFieldSaving] = useState(null);     // same key while PUT is in flight
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  // Phase 4 — side conversations modal toggle
  const [showSideConvModal, setShowSideConvModal] = useState(false);
  // Phase 3 — macros
  const [showMacroPicker, setShowMacroPicker] = useState(false);
  const [macroSearch, setMacroSearch] = useState('');
  const [macros, setMacros] = useState(null);              // null = not loaded yet
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [macrosError, setMacrosError] = useState(null);
  const [previewingMacro, setPreviewingMacro] = useState(null); // {id, title} of macro being previewed
  const [previewData, setPreviewData] = useState(null);    // { changes: [...] } from BE
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [applyingMacro, setApplyingMacro] = useState(false);

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
    setEditingField(null);
    setFieldSaving(null);
    setEditingAssignee(false);
    setAssigneeSaving(false);
    setShowMacroPicker(false);
    setMacroSearch('');
    setPreviewingMacro(null);
    setPreviewData(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setApplyingMacro(false);
    setShowSideConvModal(false);
  }, [task?.id]);

  // Discover the 4 ZD custom fields once per session — shared cache so
  // navigating between tickets doesn't refetch the metadata.
  const { meta: fieldsMeta, loading: fieldsLoading } = useTicketFieldsMeta();

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

  // ── Custom field edit (Phase 2) ────────────────────────────────────────
  // Optimistic pattern: flip the FE value first, send the PUT, roll back on
  // failure. Only one field saves at a time (UX simplicity + Zendesk rate-
  // limit friendliness).
  const handleFieldChange = useCallback(async (feKey, newValue) => {
    if (fieldSaving) return;
    if (!isZD) return;            // Phase 2 is Zendesk-only
    if (!fieldsMeta?.[feKey]?.id) return; // field wasn't discovered
    const previous = task.customFields?.[feKey] ?? null;
    if (previous === newValue) { setEditingField(null); return; }
    setFieldSaving(feKey);
    setEditingField(null);
    setTasks?.(prev => prev.map(t => t.id === task.id
      ? { ...t, customFields: { ...(t.customFields || {}), [feKey]: newValue } }
      : t));
    try {
      await updateTicketCustomFields(task.id, { [feKey]: newValue });
      const optionName = fieldsMeta[feKey].options?.find(o => o.value === newValue)?.name;
      addToast?.('success', `${fieldsMeta[feKey].title} updated`,
        optionName ? `Set to "${optionName}".` : 'Saved to Zendesk.');
    } catch (err) {
      setTasks?.(prev => prev.map(t => t.id === task.id
        ? { ...t, customFields: { ...(t.customFields || {}), [feKey]: previous } }
        : t));
      addToast?.('error', `${fieldsMeta[feKey].title} update failed`, err?.message || 'Please retry.');
    } finally {
      if (mountedRef.current) setFieldSaving(null);
    }
  }, [fieldSaving, isZD, fieldsMeta, task, setTasks, addToast]);

  // ── Assignee change ────────────────────────────────────────────────────
  // Reuses the existing /actions endpoint (`action: 'assignee'`) which
  // already gates on admin/regional_manager/team_lead and applies
  // canAssignTo() scope checks. Optimistic update + rollback on error.
  const handleAssigneeChange = useCallback(async (newEmail) => {
    if (assigneeSaving) return;
    const prev = { id: task.assigneeId, email: task.assigneeEmail, name: task.assigneeName };
    setAssigneeSaving(true);
    setEditingAssignee(false);
    const newMember = newEmail ? MEMBERS.find(m => m.email.toLowerCase() === newEmail.toLowerCase()) : null;
    setTasks?.(p => p.map(t => t.id === task.id ? {
      ...t,
      assigneeId: newMember?.id || null,
      assigneeEmail: newEmail || null,
      assigneeName: newMember?.name || null,
      _locallyReassignedAt: Date.now(),
    } : t));
    try {
      await postTicketAction(task.id, { action: 'assignee', assigneeEmail: newEmail });
      addToast?.('success', 'Assignee updated', newMember ? `Reassigned to ${newMember.name}.` : 'Unassigned.');
    } catch (err) {
      setTasks?.(p => p.map(t => t.id === task.id ? {
        ...t, assigneeId: prev.id, assigneeEmail: prev.email, assigneeName: prev.name, _locallyReassignedAt: null,
      } : t));
      addToast?.('error', 'Assignee change failed', err?.message || 'Please retry.');
    } finally {
      if (mountedRef.current) setAssigneeSaving(false);
    }
  }, [assigneeSaving, task, setTasks, addToast]);

  // Visible reassign targets: admin sees everyone; non-admin sees their
  // hierarchy chain (self + reports/subtree). Matches the BE's canAssignTo.
  const assigneeCandidates = useMemo(() => {
    if (!isAdminUser(currentUser)) {
      const allowed = getVisibleEmails(currentUser);
      return MEMBERS.filter(m => allowed.has((m.email || '').toLowerCase()));
    }
    return MEMBERS;
  }, [currentUser]);

  // Mirror the BE role gate on /actions (admin / regional_manager / team_lead).
  // Falls back to MEMBERS_BY_EMAIL when the JWT doesn't carry `role` so a TL
  // who hasn't been pushed a role claim still gets the picker.
  const canChangeAssignee = useMemo(() => {
    if (isAdminUser(currentUser)) return true;
    const direct = String(currentUser?.role || '').toLowerCase();
    if (direct === 'regional_manager' || direct === 'team_lead') return true;
    const email = (currentUser?.email || '').toLowerCase();
    const m = email ? MEMBERS.find(x => x.email.toLowerCase() === email) : null;
    const fallback = String(m?.access || '').toLowerCase();
    return fallback === 'regional_manager' || fallback === 'team_lead';
  }, [currentUser]);

  // ── Macros (Phase 3) ───────────────────────────────────────────────────
  // Lazy: list loads only when the picker is first opened (the response
  // can be 100s of entries; no point fetching for every Detail mount).
  const ensureMacrosLoaded = useCallback(async () => {
    if (macros !== null && !macrosError) return macros;
    setMacrosLoading(true);
    setMacrosError(null);
    try {
      const res = await fetchZendeskMacros();
      const list = res?.macros || [];
      if (!mountedRef.current) return list;
      setMacros(list);
      return list;
    } catch (err) {
      if (mountedRef.current) setMacrosError(err?.message || 'Failed to load macros');
      return [];
    } finally {
      if (mountedRef.current) setMacrosLoading(false);
    }
  }, [macros, macrosError]);

  const openMacroPicker = useCallback(() => {
    setShowMacroPicker(true);
    setMacroSearch('');
    ensureMacrosLoaded();
  }, [ensureMacrosLoaded]);

  // Step 1 of the apply flow: fetch the preview, open the confirmation
  // modal, close the picker so the modal isn't covered. The user reviews
  // changes and clicks Apply (or Cancel).
  const handleSelectMacro = useCallback(async (macroSummary) => {
    if (!isZD) return;
    setShowMacroPicker(false);
    setPreviewingMacro({ id: macroSummary.id, title: macroSummary.title });
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await previewTicketMacro(task.id, macroSummary.id);
      if (!mountedRef.current) return;
      setPreviewData(res);
    } catch (err) {
      if (mountedRef.current) setPreviewError(err?.message || 'Preview failed');
    } finally {
      if (mountedRef.current) setPreviewLoading(false);
    }
  }, [isZD, task?.id]);

  const closeMacroPreview = useCallback(() => {
    if (applyingMacro) return;
    setPreviewingMacro(null);
    setPreviewData(null);
    setPreviewError(null);
  }, [applyingMacro]);

  // Step 2: commit the macro. Server bumps queue cache so the next sync
  // picks up the new state; we eagerly refresh comments so the macro's
  // appended comment shows up immediately. The rest of the ticket fields
  // catch up on the next 2-min queue poll.
  const handleApplyMacro = useCallback(async () => {
    if (!previewingMacro?.id || applyingMacro) return;
    setApplyingMacro(true);
    try {
      await applyTicketMacro(task.id, previewingMacro.id);
      if (!mountedRef.current) return;
      addToast?.('success', 'Macro applied', `"${previewingMacro.title}" was applied to the ticket.`);
      // Refresh comments for the macro's auto-comment.
      fetchInflightRef.current = null;
      loadComments();
      setPreviewingMacro(null);
      setPreviewData(null);
    } catch (err) {
      if (mountedRef.current) addToast?.('error', 'Macro failed', err?.message || 'Please retry.');
    } finally {
      if (mountedRef.current) setApplyingMacro(false);
    }
  }, [previewingMacro, applyingMacro, task?.id, addToast, loadComments]);

  const filteredMacros = useMemo(() => {
    const list = macros || [];
    const q = macroSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q),
    );
  }, [macros, macroSearch]);

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
              <AssigneePicker
                assignee={assignee}
                editing={editingAssignee}
                saving={assigneeSaving}
                canChange={canChangeAssignee}
                candidates={assigneeCandidates}
                onOpen={() => setEditingAssignee(true)}
                onClose={() => setEditingAssignee(false)}
                onSelect={handleAssigneeChange}
              />
            } />
            {/* Country: heuristic (detected from tags/subject) — kept
                visible because the queue still uses it for filtering /
                routing. The editable "Employee Country" custom field
                is below. */}
            <DetailRow label="Country (detected)" value={task.country
              ? <span>{getFlag(task.country)} <span>{task.country}</span></span>
              : '—'} />
            <EditableField
              label="Employee Country"
              feKey="employeeCountry"
              task={task}
              meta={fieldsMeta}
              metaLoading={fieldsLoading}
              isZD={isZD}
              editing={editingField}
              saving={fieldSaving}
              onOpen={k => setEditingField(k)}
              onClose={() => setEditingField(null)}
              onSelect={handleFieldChange}
            />
            <EditableField
              label="Form"
              feKey="form"
              task={task}
              meta={fieldsMeta}
              metaLoading={fieldsLoading}
              isZD={isZD}
              editing={editingField}
              saving={fieldSaving}
              onOpen={k => setEditingField(k)}
              onClose={() => setEditingField(null)}
              onSelect={handleFieldChange}
            />
            <EditableField
              label="Root Cause - Support"
              feKey="rootCauseSupport"
              task={task}
              meta={fieldsMeta}
              metaLoading={fieldsLoading}
              isZD={isZD}
              editing={editingField}
              saving={fieldSaving}
              onOpen={k => setEditingField(k)}
              onClose={() => setEditingField(null)}
              onSelect={handleFieldChange}
            />
            <EditableField
              label="Root Cause Selector"
              feKey="rootCauseSelector"
              task={task}
              meta={fieldsMeta}
              metaLoading={fieldsLoading}
              isZD={isZD}
              editing={editingField}
              saving={fieldSaving}
              onOpen={k => setEditingField(k)}
              onClose={() => setEditingField(null)}
              onSelect={handleFieldChange}
            />
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
            {isZD ? (
              <RailLink
                onClick={() => setShowSideConvModal(true)}
                icon="bi-chat-square-quote"
                label="Side conversations"
              />
            ) : (
              <RailLink disabled icon="bi-chat-dots" label="Side conversations (Zendesk-only)" />
            )}
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
              showMacroPicker={showMacroPicker}
              onOpenMacroPicker={openMacroPicker}
              onCloseMacroPicker={() => setShowMacroPicker(false)}
              macros={filteredMacros}
              macrosLoading={macrosLoading}
              macrosError={macrosError}
              macroSearch={macroSearch}
              setMacroSearch={setMacroSearch}
              onSelectMacro={handleSelectMacro}
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

      {/* Macro preview modal — full-screen overlay (Phase 3) */}
      {previewingMacro && (
        <MacroPreviewModal
          macroTitle={previewingMacro.title}
          loading={previewLoading}
          error={previewError}
          changes={previewData?.changes}
          fieldsMeta={fieldsMeta}
          applying={applyingMacro}
          onCancel={closeMacroPreview}
          onApply={handleApplyMacro}
        />
      )}

      {/* Side conversations modal — full CRUD (Phase 4) */}
      {showSideConvModal && isZD && (
        <SideConversationsModal
          ticketId={task.id}
          addToast={addToast}
          onClose={() => setShowSideConvModal(false)}
        />
      )}
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

function RailLink({ href, onClick, icon, label, disabled = false }) {
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
    fontFamily: 'inherit',
    width: '100%', textAlign: 'left',
  };
  const hoverIn = (e) => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bddcf0'; };
  const hoverOut = (e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; };

  if (disabled) {
    return (
      <div style={baseStyle} aria-disabled="true">
        <i className={icon} style={{ fontSize: 13 }} />
        <span style={{ flex: 1 }}>{label}</span>
      </div>
    );
  }

  // Button form (in-app action) — used by Side conversations to open the
  // modal. No external-link icon, no target=_blank.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ ...baseStyle, border: '1px solid transparent' }}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
      >
        <i className={icon} style={{ fontSize: 13 }} />
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    );
  }

  // Anchor form (external link) — Open in Source / Employee profile.
  return (
    <a
      href={href} target="_blank" rel="noopener noreferrer"
      style={baseStyle}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
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

function ReplyComposer({
  isZD, replyText, setReplyText, replyPublic, setReplyPublic, replySending, onSend,
  showTemplates, setShowTemplates, taskType,
  // Phase 3 — macros
  showMacroPicker, onOpenMacroPicker, onCloseMacroPicker, macros, macrosLoading, macrosError,
  macroSearch, setMacroSearch, onSelectMacro,
}) {
  const templatesRef = useRef(null);
  const macrosRef = useRef(null);
  useEffect(() => {
    if (!showTemplates) return;
    const onDoc = (e) => { if (templatesRef.current && !templatesRef.current.contains(e.target)) setShowTemplates(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showTemplates, setShowTemplates]);
  useEffect(() => {
    if (!showMacroPicker) return;
    const onDoc = (e) => { if (macrosRef.current && !macrosRef.current.contains(e.target)) onCloseMacroPicker(); };
    const onKey = (e) => { if (e.key === 'Escape') onCloseMacroPicker(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [showMacroPicker, onCloseMacroPicker]);

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
          {isZD && (
            <div ref={macrosRef} style={{ position: 'relative' }}>
              <button
                onClick={() => showMacroPicker ? onCloseMacroPicker() : onOpenMacroPicker()}
                aria-haspopup="listbox"
                aria-expanded={!!showMacroPicker}
                title="Apply a Zendesk macro to this ticket"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  height: 26, padding: '0 10px', borderRadius: 6,
                  border: `1px solid ${showMacroPicker ? '#7c3aed' : '#e8e8e8'}`,
                  background: showMacroPicker ? '#f3eff8' : 'white',
                  color: showMacroPicker ? '#7c3aed' : '#616161',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  transition: 'all .12s', fontFamily: 'inherit',
                }}
              >
                <i className="bi-lightning-charge-fill" style={{ fontSize: 10 }} />
                Macros
              </button>
              {showMacroPicker && (
                <div role="listbox" style={{
                  position: 'absolute', right: 0, top: 30, zIndex: 100,
                  width: 320, maxHeight: 380,
                  background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0efed' }}>
                    <input
                      autoFocus
                      placeholder="Search macros…"
                      value={macroSearch}
                      onChange={e => setMacroSearch(e.target.value)}
                      style={{
                        width: '100%', height: 30, padding: '0 8px',
                        border: '1px solid #e8e8e8', borderRadius: 6,
                        fontSize: 12, outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                    {macrosLoading && (!macros || macros.length === 0) ? (
                      <div style={{ padding: '20px 14px', textAlign: 'center', color: '#9e9e9e', fontSize: 12 }}>
                        <i className="bi-arrow-clockwise spin" style={{ fontSize: 16, display: 'block', marginBottom: 6 }} />
                        Loading macros…
                      </div>
                    ) : macrosError ? (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: '#991b1b' }}>
                        <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
                        {macrosError}
                      </div>
                    ) : (macros || []).length === 0 ? (
                      <div style={{ padding: '20px 14px', textAlign: 'center', color: '#9e9e9e', fontSize: 12 }}>
                        {macroSearch ? 'No matches' : 'No active macros'}
                      </div>
                    ) : (
                      (macros || []).slice(0, 80).map(m => (
                        <button
                          key={m.id}
                          role="option"
                          onClick={() => onSelectMacro(m)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '8px 14px', border: 'none', borderBottom: '1px solid #f7f5f2',
                            background: 'white', cursor: 'pointer',
                            fontSize: 12, color: '#1b1b1b', fontFamily: 'inherit',
                            transition: 'background .1s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f3eff8'}
                          onMouseLeave={e => e.currentTarget.style.background = 'white'}
                        >
                          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                          {m.description && (
                            <div style={{ marginTop: 2, color: '#9e9e9e', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.description}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                    {(macros || []).length > 80 && (
                      <div style={{ padding: '8px 14px', fontSize: 11, color: '#9e9e9e', textAlign: 'center', borderTop: '1px solid #f0efed' }}>
                        Showing first 80 of {macros.length}. Use search to narrow.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
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
// ── Editable custom-field row ─────────────────────────────────────────────
// Renders a DetailRow whose value is a click-to-edit chip. Click reveals a
// popover with the discovered options (filtered via a tiny inline search
// when the list is long). Selecting an option triggers the parent's save
// handler, which does the optimistic update + PUT to Zendesk.
//
// Disabled states (no popover, just a static value):
//   • Jira tickets — these custom fields are Zendesk-only.
//   • Field metadata not yet loaded — chip shows a small spinner.
//   • Field title not configured in Zendesk — chip shows "not configured".
const EditableField = memo(function EditableField({
  label, feKey, task, meta, metaLoading, isZD, editing, saving, onOpen, onClose, onSelect,
}) {
  const fieldMeta = meta?.[feKey];
  const currentValue = task?.customFields?.[feKey] ?? null;
  const currentName = fieldMeta?.options?.find(o => o.value === currentValue)?.name;
  const isOpen = editing === feKey;
  const isSaving = saving === feKey;

  let chip;
  if (!isZD) {
    chip = <ChipReadOnly>{label === 'Form' || label === 'Root Cause - Support' || label === 'Root Cause Selector' || label === 'Employee Country' ? 'Zendesk-only' : '—'}</ChipReadOnly>;
  } else if (metaLoading && !fieldMeta) {
    chip = <ChipReadOnly><i className="bi-arrow-clockwise spin" style={{ fontSize: 9, marginRight: 4 }} />Loading…</ChipReadOnly>;
  } else if (!fieldMeta?.id) {
    chip = <ChipReadOnly>Not configured in Zendesk</ChipReadOnly>;
  } else if (fieldMeta.type !== 'tagger') {
    // Phase 2 only ships single-select dropdown editors. Multiselect/
    // free-text/checkbox/etc. fall back to a read-only chip so the data
    // is still visible — Phase 3+ can add specialised editors per type.
    chip = <ChipReadOnly>{currentName || (currentValue == null ? '—' : String(currentValue))}</ChipReadOnly>;
  } else {
    chip = (
      <FieldDropdownChip
        label={currentName || (currentValue == null ? '—' : String(currentValue))}
        isOpen={isOpen}
        isSaving={isSaving}
        currentValue={currentValue}
        options={fieldMeta.options || []}
        onOpen={() => onOpen(feKey)}
        onClose={onClose}
        onSelect={(v) => onSelect(feKey, v)}
      />
    );
  }

  return <DetailRow label={label} value={chip} />;
});

function ChipReadOnly({ children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 128,
      fontSize: 11, color: '#9e9e9e', background: '#f5f3ef',
      border: '1px solid #e8e4df',
    }}>
      {children}
    </span>
  );
}

// Click-to-edit chip with an inline popover. Filters options when there
// are more than 8 to avoid scrolling through long lists (e.g. country lists).
function FieldDropdownChip({ label, isOpen, isSaving, currentValue, options, onOpen, onClose, onSelect }) {
  const wrapRef = useRef(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!isOpen) { setFilter(''); return; }
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  const filtered = filter
    ? options.filter(o => o.name.toLowerCase().includes(filter.toLowerCase()))
    : options;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => isOpen ? onClose() : onOpen()}
        disabled={isSaving}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          maxWidth: 200,
          padding: '2px 6px 2px 10px', borderRadius: 128,
          fontSize: 11, fontWeight: 600,
          color: currentValue ? '#1b1b1b' : '#9e9e9e',
          background: isOpen ? '#eff6ff' : currentValue ? '#f7f5f2' : 'white',
          border: `1px solid ${isOpen ? '#bddcf0' : '#e8e8e8'}`,
          cursor: isSaving ? 'wait' : 'pointer',
          transition: 'all .12s',
        }}
        onMouseEnter={e => { if (!isSaving && !isOpen) e.currentTarget.style.borderColor = '#c0c0c0'; }}
        onMouseLeave={e => { if (!isSaving && !isOpen) e.currentTarget.style.borderColor = '#e8e8e8'; }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {isSaving
          ? <i className="bi-arrow-clockwise spin" style={{ fontSize: 9 }} />
          : <i className="bi-chevron-down" style={{ fontSize: 9, color: '#9e9e9e' }} />}
      </button>
      {isOpen && (
        <div role="listbox" style={{
          position: 'absolute', left: 0, top: 28, zIndex: 100,
          width: 240, maxHeight: 320, overflow: 'hidden',
          background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
        }}>
          {options.length > 8 && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0efed' }}>
              <input
                autoFocus
                placeholder="Filter…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                style={{
                  width: '100%', height: 28, padding: '0 8px',
                  border: '1px solid #e8e8e8', borderRadius: 6,
                  fontSize: 12, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            <button
              role="option"
              aria-selected={currentValue == null}
              onClick={() => onSelect(null)}
              style={dropdownItemStyle(currentValue == null)}
              onMouseEnter={e => e.currentTarget.style.background = '#f7f5f2'}
              onMouseLeave={e => e.currentTarget.style.background = currentValue == null ? '#eff6ff' : 'white'}
            >
              <span style={{ color: '#9e9e9e', fontStyle: 'italic' }}>(none)</span>
              {currentValue == null && <i className="bi-check-lg" style={{ fontSize: 11, color: '#1f74b3' }} />}
            </button>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 12, color: '#9e9e9e', textAlign: 'center' }}>No matches</div>
            ) : filtered.map(opt => {
              const selected = opt.value === currentValue;
              return (
                <button
                  key={opt.value}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(opt.value)}
                  style={dropdownItemStyle(selected)}
                  onMouseEnter={e => e.currentTarget.style.background = '#f7f5f2'}
                  onMouseLeave={e => e.currentTarget.style.background = selected ? '#eff6ff' : 'white'}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.name}</span>
                  {selected && <i className="bi-check-lg" style={{ fontSize: 11, color: '#1f74b3' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function dropdownItemStyle(selected) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    width: '100%', padding: '8px 14px',
    background: selected ? '#eff6ff' : 'white',
    color: '#1b1b1b', fontSize: 12, fontWeight: selected ? 600 : 500,
    border: 'none', borderLeft: `3px solid ${selected ? '#1f74b3' : 'transparent'}`,
    cursor: 'pointer', textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'background .1s',
  };
}

// ── Assignee picker ─────────────────────────────────────────────────────
// Read-only (avatar + name) for users who can't reassign. Click-to-edit
// for admin/regional_manager/team_lead. Uses the existing /actions
// endpoint — its server-side scope check is the source of truth, this is
// just a UX gate so unauthorized users don't get a dropdown that errors
// every click.
const AssigneePicker = memo(function AssigneePicker({
  assignee, editing, saving, canChange, candidates, onOpen, onClose, onSelect,
}) {
  const wrapRef = useRef(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!editing) { setFilter(''); return; }
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [editing, onClose]);

  const display = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {assignee
        ? (<><Avatar name={assignee.name} size={20} /><span>{assignee.name}</span></>)
        : <span style={{ color: '#d42d35', fontWeight: 600 }}>Unassigned</span>}
    </span>
  );

  if (!canChange) return display;

  const filtered = filter
    ? candidates.filter(m => (m.name || '').toLowerCase().includes(filter.toLowerCase())
        || (m.email || '').toLowerCase().includes(filter.toLowerCase()))
    : candidates;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => editing ? onClose() : onOpen()}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={!!editing}
        title={saving ? 'Saving…' : 'Click to reassign'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 4px 2px 0',
          background: editing ? '#eff6ff' : 'transparent',
          border: 'none', borderRadius: 6,
          cursor: saving ? 'wait' : 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => { if (!saving && !editing) e.currentTarget.style.background = '#f7f5f2'; }}
        onMouseLeave={e => { if (!saving && !editing) e.currentTarget.style.background = 'transparent'; }}
      >
        {display}
        {saving
          ? <i className="bi-arrow-clockwise spin" style={{ fontSize: 9, marginLeft: 4 }} />
          : <i className="bi-chevron-down" style={{ fontSize: 9, color: '#9e9e9e', marginLeft: 4 }} />}
      </button>
      {editing && (
        <div role="listbox" style={{
          position: 'absolute', left: 0, top: 28, zIndex: 100,
          width: 280, maxHeight: 360, overflow: 'hidden',
          background: 'white', border: '1px solid #e8e8e8', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0efed' }}>
            <input
              autoFocus
              placeholder="Search by name or email…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                width: '100%', height: 28, padding: '0 8px',
                border: '1px solid #e8e8e8', borderRadius: 6,
                fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {/* Note: full "Unassign" via this picker is deferred — the
                /actions endpoint requires a target assigneeEmail. To
                unassign, do it from Zendesk directly. */}
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 12, color: '#9e9e9e', textAlign: 'center' }}>No matches in your scope</div>
            ) : filtered.map(m => {
              const selected = assignee?.email && m.email && assignee.email.toLowerCase() === m.email.toLowerCase();
              return (
                <button
                  key={m.email || m.id}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(m.email)}
                  style={{
                    ...dropdownItemStyle(selected),
                    alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f7f5f2'}
                  onMouseLeave={e => e.currentTarget.style.background = selected ? '#eff6ff' : 'white'}
                >
                  <Avatar name={m.name} size={20} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    <span style={{ display: 'block', fontSize: 10, color: '#9e9e9e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' }}>{m.email}</span>
                  </span>
                  {selected && <i className="bi-check-lg" style={{ fontSize: 11, color: '#1f74b3' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 8,
  border: '1px solid #e8e8e8', background: 'white',
  color: '#616161', cursor: 'pointer',
  transition: 'all .15s',
};

// ── Macro preview modal (Phase 3) ─────────────────────────────────────────
// Modal overlay shown after the user selects a macro from the picker. Lists
// every change the macro will make to the ticket — comments, status, fields,
// tags — so the agent confirms before committing. Apply hits ZD with
// `macro_ids: [id]` so Zendesk performs the operation atomically.
function MacroPreviewModal({ macroTitle, loading, error, changes, fieldsMeta, applying, onCancel, onApply }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !applying) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [applying, onCancel]);

  const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9000,
    animation: 'fadeInOverlay 0.18s ease both',
  };
  const modalStyle = {
    width: 'min(640px, 92vw)', maxHeight: '85vh',
    background: 'white', borderRadius: 16,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
    animation: 'scaleInModal 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
  };

  const hasChanges = Array.isArray(changes) && changes.length > 0;

  return (
    <div ref={overlayRef} style={overlayStyle} role="dialog" aria-modal="true" aria-label="Macro preview"
      onClick={e => { if (e.target === e.currentTarget && !applying) onCancel(); }}>
      <div style={modalStyle}>
        <style>{`
          @keyframes fadeInOverlay { from { opacity:0; } to { opacity:1; } }
          @keyframes scaleInModal { from { opacity:0; transform:scale(0.97) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
        `}</style>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 128,
              background: '#f3eff8', color: '#7c3aed',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <i className="bi-lightning-charge-fill" style={{ fontSize: 9 }} />
              Macro
            </span>
            <span style={{ fontSize: 11, color: '#9e9e9e' }}>Review changes before applying</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>{macroTitle}</div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#616161', fontSize: 13 }}>
              <i className="bi-arrow-clockwise spin" style={{ fontSize: 24, display: 'block', marginBottom: 8 }} />
              Loading preview…
            </div>
          ) : error ? (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 8 }} />
              Couldn't load preview: {error}
            </div>
          ) : !hasChanges ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#9e9e9e', fontSize: 13 }}>
              <i className="bi-info-circle" style={{ fontSize: 24, display: 'block', marginBottom: 8 }} />
              This macro doesn't make any changes to the ticket.
            </div>
          ) : (
            <ChangeList changes={changes} fieldsMeta={fieldsMeta} />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #e8e8e8', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onCancel}
            disabled={applying}
            style={{
              height: 36, padding: '0 16px', borderRadius: 8,
              border: '1px solid #e8e8e8', background: 'white', color: '#1b1b1b',
              fontSize: 12, fontWeight: 600,
              cursor: applying ? 'not-allowed' : 'pointer',
              opacity: applying ? 0.6 : 1,
              transition: 'all .15s', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={loading || !!error || !hasChanges || applying}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 36, padding: '0 18px', borderRadius: 8,
              border: 'none',
              background: (loading || !!error || !hasChanges || applying) ? '#e0e0e0' : '#7c3aed',
              color: (loading || !!error || !hasChanges || applying) ? '#9e9e9e' : 'white',
              fontSize: 12, fontWeight: 700,
              cursor: (loading || !!error || !hasChanges || applying) ? 'not-allowed' : 'pointer',
              transition: 'all .15s', fontFamily: 'inherit',
            }}
          >
            {applying
              ? <><i className="bi-hourglass-split" style={{ fontSize: 11 }} />Applying…</>
              : <><i className="bi-lightning-charge-fill" style={{ fontSize: 11 }} />Apply Macro</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// Renders a structured change row per type returned by the preview endpoint.
function ChangeList({ changes, fieldsMeta }) {
  const STATUS_LABEL = { new: 'New', open: 'Open', pending: 'Pending', hold: 'On hold', solved: 'Solved', closed: 'Closed' };
  const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {changes.map((c, i) => {
        if (c.type === 'comment') {
          return (
            <ChangeRow
              key={`comment-${i}`}
              icon={c.public ? 'bi-send-fill' : 'bi-journal-text'}
              iconColor={c.public ? '#b91c1c' : '#92400E'}
              iconBg={c.public ? '#fef2f2' : '#fef3c7'}
              label={c.public ? 'Adds public reply' : 'Adds internal note'}
            >
              <div style={{
                marginTop: 6, padding: '10px 12px',
                borderRadius: 8, background: c.public ? '#fef2f2' : '#fef3c7',
                border: `1px solid ${c.public ? '#fca5a5' : '#fde68a'}`,
                fontSize: 13, color: '#1b1b1b', whiteSpace: 'pre-wrap',
                maxHeight: 200, overflowY: 'auto', lineHeight: 1.5,
              }}>{c.body || '(empty body)'}</div>
            </ChangeRow>
          );
        }
        if (c.type === 'status') {
          return <ChangeRow key={`status-${i}`} icon="bi-arrow-repeat" iconColor="#1d4ed8" iconBg="#eff6ff"
            label={`Sets status to`} value={STATUS_LABEL[c.value] || c.value} />;
        }
        if (c.type === 'priority') {
          return <ChangeRow key={`pri-${i}`} icon="bi-exclamation-circle" iconColor="#92400E" iconBg="#fff8e6"
            label="Sets priority to" value={PRIORITY_LABEL[c.value] || c.value} />;
        }
        if (c.type === 'ticketType') {
          return <ChangeRow key={`type-${i}`} icon="bi-tag-fill" iconColor="#616161" iconBg="#f5f3ef"
            label="Sets type to" value={c.value} />;
        }
        if (c.type === 'assignee') {
          return <ChangeRow key={`asn-${i}`} icon="bi-person-fill" iconColor="#1d4ed8" iconBg="#eff6ff"
            label="Reassigns to Zendesk user ID" value={String(c.value)}
            note="Resolves to a name on the next sync." />;
        }
        if (c.type === 'group') {
          return <ChangeRow key={`grp-${i}`} icon="bi-people-fill" iconColor="#616161" iconBg="#f5f3ef"
            label="Moves to group ID" value={String(c.value)} />;
        }
        if (c.type === 'tags') {
          return <ChangeRow key={`tags-${i}`} icon="bi-tags-fill" iconColor="#0369a1" iconBg="#e0f2fe"
            label="Sets tags to">
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(c.value || []).length === 0
                  ? <span style={{ fontSize: 11, color: '#9e9e9e', fontStyle: 'italic' }}>(no tags)</span>
                  : c.value.map(t => (
                    <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 128, background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>{t}</span>
                  ))}
              </div>
            </ChangeRow>;
        }
        if (c.type === 'customField') {
          return <ChangeRow key={`cf-${c.id}-${i}`} icon="bi-input-cursor-text" iconColor="#7c3aed" iconBg="#f3eff8"
            label={`Sets "${c.label}" to`} value={c.displayValue || '(none)'} />;
        }
        if (c.type === 'subject') {
          return <ChangeRow key={`subj-${i}`} icon="bi-pencil-fill" iconColor="#1b1b1b" iconBg="#f5f4f2"
            label="Updates subject to" value={c.value} />;
        }
        return null;
      })}
    </div>
  );
}

function ChangeRow({ icon, iconColor, iconBg, label, value, children, note }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: iconBg,
      }}>
        <i className={icon} style={{ fontSize: 13, color: iconColor }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#616161' }}>
          {label}
          {value && <span style={{ marginLeft: 6, color: '#1b1b1b', fontWeight: 700 }}>{value}</span>}
        </div>
        {note && <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>{note}</div>}
        {children}
      </div>
    </div>
  );
}
