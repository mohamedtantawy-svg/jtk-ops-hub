// ── WorkTaskDetailDrawer (Phase 1, 2026-05-25) ─────────────────────────────
// Right-side slide-out detail view for a single task:
//   • Title + status pill + priority pill + due-date pill
//   • Inline-editable fields (title, description, status, priority, due date,
//     assignees, followers)
//   • Comment thread with composer + @-mention picker
//   • Activity log (collapsible)
//   • Archive button (creator / assignee / follower / dept admin only)
//
// All edits go through the parent's onUpdate callback; the drawer reloads
// the full task on save so derived fields (completed_at, started_at) stay
// in sync.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import MemberMultiPicker from '../org/MemberMultiPicker';
import { getWorkTask, patchWorkTask, archiveWorkTask, listWorkTaskComments, createWorkTaskComment } from '../../services/workTasksApi';

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: '#d42d35', bg: '#FEE2E2', dot: '#d42d35' },
  high:   { label: 'High',   color: '#ed8d00', bg: '#FEF3C7', dot: '#ed8d00' },
  normal: { label: 'Normal', color: '#0369a1', bg: '#DBEAFE', dot: '#0369a1' },
  low:    { label: 'Low',    color: '#15803d', bg: '#DCFCE7', dot: '#15803d' },
};
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

const STATUS_META = {
  todo:        { label: 'To do',       color: '#0369a1', bg: '#DBEAFE',   icon: 'bi-circle' },
  in_progress: { label: 'In progress', color: '#ed8d00', bg: '#FEF3C7',   icon: 'bi-arrow-repeat' },
  blocked:     { label: 'Blocked',     color: '#d42d35', bg: '#FEE2E2',   icon: 'bi-exclamation-octagon-fill' },
  done:        { label: 'Done',        color: '#15803d', bg: '#DCFCE7',   icon: 'bi-check-circle-fill' },
  archived:    { label: 'Archived',    color: '#6B7280', bg: 'var(--surface-2)', icon: 'bi-archive' },
};
const STATUS_ORDER_PICKER = ['todo', 'in_progress', 'blocked', 'done'];

function formatDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isOverdue(task) {
  if (!task?.dueDate) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}
function dueSoon(task) {
  if (!task?.dueDate) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  const ms = new Date(task.dueDate).getTime() - Date.now();
  return ms > 0 && ms < 24 * 60 * 60 * 1000;
}

export default function WorkTaskDetailDrawer({
  taskId,
  candidates,
  currentUser,
  oooEmails,
  onClose,
  onChanged,
}) {
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [drawerOoo, setDrawerOoo] = useState(new Set());
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  // Comment composer
  const [draftComment, setDraftComment] = useState('');
  const [mentionDraft, setMentionDraft] = useState([]);
  const [postingComment, setPostingComment] = useState(false);
  const lastCommentTimeRef = useRef(null);

  const isOpen = !!taskId;

  const reload = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await getWorkTask(taskId);
      setTask(res.task || null);
      setComments(res.comments || []);
      setActivity(res.activity || []);
      setDrawerOoo(new Set((res.oooEmails || []).map(e => String(e).toLowerCase())));
      setCanEdit(res.canEdit === true);
      setError(null);
      if (res.comments?.length) {
        lastCommentTimeRef.current = res.comments[res.comments.length - 1].createdAt;
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!isOpen) return;
    reload();
  }, [isOpen, reload]);

  // Lightweight 8s comment poll while the drawer is open (skill section 3.11).
  // Cursor on the latest createdAt; dedupe by id when merging.
  useEffect(() => {
    if (!isOpen || !taskId) return undefined;
    const interval = setInterval(async () => {
      try {
        const since = lastCommentTimeRef.current;
        const res = await listWorkTaskComments(taskId, { since: since || undefined });
        const fresh = res?.comments || [];
        if (fresh.length === 0) return;
        setComments(prev => {
          const seen = new Set(prev.map(c => c.id));
          const merged = [...prev, ...fresh.filter(c => !seen.has(c.id))];
          merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          if (merged.length) {
            lastCommentTimeRef.current = merged[merged.length - 1].createdAt;
          }
          return merged;
        });
      } catch {}
    }, 8000);
    return () => clearInterval(interval);
  }, [isOpen, taskId]);

  // Single saved-field update helper. Wraps patchWorkTask + reload.
  const savePatch = useCallback(async (patch) => {
    if (!task) return;
    setSaving(true);
    try {
      await patchWorkTask(task.id, patch);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [task, reload, onChanged]);

  const archive = useCallback(async () => {
    if (!task) return;
    if (!window.confirm(`Archive "${task.title}"?`)) return;
    setSaving(true);
    try {
      await archiveWorkTask(task.id);
      onChanged?.();
      onClose?.();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }, [task, onChanged, onClose]);

  const postComment = useCallback(async () => {
    const text = draftComment.trim();
    if (!text) return;
    setPostingComment(true);
    try {
      await createWorkTaskComment(task.id, { body: text, mentions: mentionDraft });
      setDraftComment('');
      setMentionDraft([]);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setPostingComment(false);
    }
  }, [draftComment, mentionDraft, task, reload, onChanged]);

  if (!isOpen) return null;

  const memberByEmail = (() => {
    const m = new Map();
    for (const c of candidates) {
      if (c.email) m.set(String(c.email).toLowerCase(), c);
    }
    return m;
  })();

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          zIndex: 1000,
        }}
      />
      <aside
        role="dialog"
        aria-label="Task detail"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(620px, 95vw)',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-12px 0 30px rgba(0,0,0,0.18)',
          zIndex: 1001,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-light)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={onClose}
            style={iconBtnStyle}
            aria-label="Close"
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          ><i className="bi bi-x-lg" /></button>
          <div style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Task
          </div>
          {canEdit && task && !task.isArchived && (
            <button
              type="button"
              onClick={archive}
              style={{ ...iconBtnStyle, color: 'var(--orange)' }}
              aria-label="Archive task"
              title="Archive task"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--orange-light)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            ><i className="bi bi-archive" /></button>
          )}
        </header>

        {loading && !task ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading…</div>
        ) : !task ? (
          <div style={{ padding: 24, color: 'var(--orange)' }}>
            {error?.message || 'Could not load task'}
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px 24px' }}>
            <DrawerBody
              task={task}
              comments={comments}
              activity={activity}
              showActivity={showActivity}
              setShowActivity={setShowActivity}
              canEdit={canEdit}
              candidates={candidates}
              currentUser={currentUser}
              oooEmails={drawerOoo}
              memberByEmail={memberByEmail}
              saving={saving}
              draftComment={draftComment}
              setDraftComment={setDraftComment}
              mentionDraft={mentionDraft}
              setMentionDraft={setMentionDraft}
              postingComment={postingComment}
              postComment={postComment}
              savePatch={savePatch}
            />
            {error && (
              <div style={{ marginTop: 12, color: 'var(--orange)', fontSize: 12 }}>{error?.message || String(error)}</div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function DrawerBody({
  task, comments, activity, showActivity, setShowActivity,
  canEdit, candidates, currentUser, oooEmails, memberByEmail,
  saving, draftComment, setDraftComment, mentionDraft, setMentionDraft,
  postingComment, postComment, savePatch,
}) {
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  useEffect(() => { setTitleDraft(task.title); }, [task.id, task.title]);
  useEffect(() => { setDescDraft(task.description || ''); }, [task.id, task.description]);

  const sm = STATUS_META[task.status] || STATUS_META.todo;
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  const overdue = isOverdue(task);
  const soon = dueSoon(task);

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (!t || t === task.title) { setTitleDraft(task.title); return; }
    savePatch({ title: t });
  };
  const commitDesc = () => {
    setEditingDesc(false);
    if (descDraft === (task.description || '')) return;
    savePatch({ description: descDraft });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {canEdit ? (
          <textarea
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
            rows={1}
            style={{
              width: '100%',
              fontSize: 20, fontWeight: 700,
              color: 'var(--text)',
              padding: '6px 8px',
              border: '1px solid transparent',
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              minHeight: 38,
              lineHeight: 1.4,
            }}
            onFocus={e => e.currentTarget.style.background = 'var(--surface-2)'}
          />
        ) : (
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{task.title}</h2>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusPill sm={sm} />
        <PriorityPill pm={pm} />
        {task.dueDate && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px',
            borderRadius: 'var(--radius-pill)',
            background: overdue ? '#FEE2E2' : soon ? '#FEF3C7' : 'var(--surface-2)',
            color: overdue ? '#B91C1C' : soon ? '#92400E' : 'var(--text-secondary)',
            fontSize: 11, fontWeight: 700,
          }}>
            <i className={`bi ${overdue ? 'bi-exclamation-triangle-fill' : 'bi-clock-history'}`} />
            {overdue ? 'Overdue · ' : soon ? 'Due soon · ' : 'Due '}{formatDateTime(task.dueDate)}
          </span>
        )}
        {task.creator?.email && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Created by {task.creator.name || task.creator.email} · {formatDate(task.createdAt)}
          </span>
        )}
      </div>

      {/* Status / priority / due editor row */}
      {canEdit && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10,
        }}>
          <FieldLabel label="Status">
            <select
              value={task.status}
              onChange={e => savePatch({ status: e.target.value })}
              disabled={saving}
              style={inputStyle}
            >
              {STATUS_ORDER_PICKER.map(s => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Priority">
            <select
              value={task.priority}
              onChange={e => savePatch({ priority: e.target.value })}
              disabled={saving}
              style={inputStyle}
            >
              {PRIORITY_ORDER.map(p => (
                <option key={p} value={p}>{PRIORITY_META[p].label}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Due date">
            <input
              type="datetime-local"
              value={isoToLocalInput(task.dueDate)}
              onChange={e => savePatch({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
              disabled={saving}
              style={inputStyle}
            />
          </FieldLabel>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <FieldLabel label={`Assignee(s) (${task.assignees.length})`}>
          {canEdit ? (
            <MemberMultiPicker
              selected={task.assignees}
              onChange={(next) => savePatch({ assignees: next })}
              candidates={candidates}
              oooEmails={oooEmails}
              placeholder="Add assignee…"
            />
          ) : (
            <PersonStack emails={task.assignees} memberByEmail={memberByEmail} oooEmails={oooEmails} />
          )}
        </FieldLabel>
        <FieldLabel label={`Follower(s) (${task.followers.length})`}>
          {canEdit ? (
            <MemberMultiPicker
              selected={task.followers}
              onChange={(next) => savePatch({ followers: next })}
              candidates={candidates}
              oooEmails={oooEmails}
              placeholder="Add follower…"
            />
          ) : (
            <PersonStack emails={task.followers} memberByEmail={memberByEmail} oooEmails={oooEmails} emptyLabel="No followers" />
          )}
        </FieldLabel>
      </div>

      <FieldLabel label="Description">
        {editingDesc && canEdit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              autoFocus
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 96, padding: 8 }}
            />
            <div style={{ display: 'inline-flex', gap: 6 }}>
              <button type="button" onClick={() => { setEditingDesc(false); setDescDraft(task.description || ''); }} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={commitDesc} style={primaryBtnStyle}>Save</button>
            </div>
          </div>
        ) : (
          <div
            onClick={canEdit ? () => setEditingDesc(true) : undefined}
            style={{
              padding: 10,
              minHeight: 60,
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-2)',
              fontSize: 13,
              lineHeight: 1.5,
              color: task.description ? 'var(--text)' : 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              cursor: canEdit ? 'text' : 'default',
            }}
          >
            {task.description || (canEdit ? 'Add a description…' : '—')}
          </div>
        )}
      </FieldLabel>

      <section style={{
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-light)',
          background: 'var(--surface-2)',
          fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <i className="bi bi-chat-left-dots" /> Discussion ({comments.length})
        </header>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {comments.length === 0 ? (
            <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12 }}>
              No comments yet. Add the first.
            </div>
          ) : (
            comments.map((c) => (
              <CommentRow key={c.id} comment={c} memberByEmail={memberByEmail} />
            ))
          )}
          <div style={{
            padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
            borderTop: comments.length > 0 ? '1px solid var(--border-light)' : 'none',
          }}>
            <textarea
              value={draftComment}
              onChange={e => setDraftComment(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              style={{ ...inputStyle, padding: 8, resize: 'vertical', minHeight: 50 }}
            />
            {mentionDraft.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Notify on post: {mentionDraft.map(e => memberByEmail.get(e)?.name || e).join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <MemberMultiPicker
                  selected={mentionDraft}
                  onChange={setMentionDraft}
                  candidates={candidates}
                  oooEmails={oooEmails}
                  placeholder="@-mention (notifies the person)"
                />
              </div>
              <button
                type="button"
                onClick={postComment}
                disabled={postingComment || !draftComment.trim()}
                style={{
                  ...primaryBtnStyle,
                  opacity: (postingComment || !draftComment.trim()) ? 0.5 : 1,
                  cursor: (postingComment || !draftComment.trim()) ? 'not-allowed' : 'pointer',
                }}
              >{postingComment ? 'Posting…' : 'Post comment'}</button>
            </div>
          </div>
        </div>
      </section>

      <section style={{
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-md)',
      }}>
        <button
          type="button"
          onClick={() => setShowActivity(s => !s)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            width: '100%', padding: '10px 12px',
            background: 'var(--surface-2)',
            border: 'none', borderBottom: showActivity ? '1px solid var(--border-light)' : 'none',
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <i className={`bi ${showActivity ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
          <i className="bi bi-clock-history" /> Activity ({activity.length})
        </button>
        {showActivity && (
          <div style={{ maxHeight: 240, overflow: 'auto' }}>
            {activity.length === 0 ? (
              <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12 }}>No activity yet.</div>
            ) : (
              activity.map(ev => (
                <div key={ev.id} style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border-light)',
                  fontSize: 12, color: 'var(--text-secondary)',
                }}>
                  <strong style={{ color: 'var(--text)' }}>{ev.actor?.name || ev.actor?.email}</strong>{' '}
                  {ev.eventType.replace(/_/g, ' ')}{' '}
                  <span style={{ color: 'var(--text-muted)' }}>· {formatDateTime(ev.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ sm }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      background: sm.bg, color: sm.color,
      fontSize: 11, fontWeight: 700,
    }}>
      <i className={`bi ${sm.icon}`} /> {sm.label}
    </span>
  );
}
function PriorityPill({ pm }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      background: pm.bg, color: pm.color,
      fontSize: 11, fontWeight: 700,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: pm.dot,
      }} />
      {pm.label}
    </span>
  );
}

function CommentRow({ comment, memberByEmail }) {
  const author = memberByEmail.get(String(comment.author.email).toLowerCase());
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: '1px solid var(--border-light)',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <Avatar
        name={author?.name || comment.author.email}
        initials={author?.initials || comment.author.email.slice(0, 2).toUpperCase()}
        src={author?.avatarUrl}
        size="sm"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <strong>{author?.name || comment.author.email}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(comment.createdAt)}</span>
        </div>
        <div style={{
          marginTop: 4, fontSize: 13, color: 'var(--text)',
          whiteSpace: 'pre-wrap', lineHeight: 1.5,
        }}>{comment.body}</div>
        {comment.mentions?.length > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            Mentioned: {comment.mentions.map(e => memberByEmail.get(e)?.name || e).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

function PersonStack({ emails, memberByEmail, oooEmails, emptyLabel = 'Unassigned' }) {
  if (!emails || emails.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '6px 4px' }}>{emptyLabel}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {emails.map(e => {
        const lc = String(e).toLowerCase();
        const m = memberByEmail.get(lc);
        const onLeave = oooEmails?.has(lc);
        return (
          <div key={lc} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar
              name={m?.name || e}
              initials={m?.initials || lc.slice(0, 2).toUpperCase()}
              src={m?.avatarUrl}
              size="xs"
            />
            <span style={{ fontSize: 12, color: 'var(--text)' }}>{m?.name || lc.split('@')[0]}</span>
            {onLeave && (
              <i className="bi bi-calendar-x" title="On leave" style={{ color: '#B91C1C', fontSize: 11 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldLabel({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: '100%',
  height: 32,
  padding: '0 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 32, padding: '0 12px',
  background: 'var(--purple)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-md)',
  fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};

const secondaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 32, padding: '0 12px',
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32,
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};
