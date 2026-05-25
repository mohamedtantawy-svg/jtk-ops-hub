// ── TasksQueuePanel (Phase 2, 2026-05-25) ──────────────────────────────────
// Compact "Tasks" panel embedded as a Queue source tab. Shows the user's
// open (non-done, non-archived) tasks sorted by status/priority/due, with
// an inline quick-add composer at the top and a click-to-open detail
// drawer. Reuses useWorkTasks, WorkTaskComposer, and WorkTaskDetailDrawer
// from the standalone Tasks view so the underlying data + behaviours are
// identical -- this is just a focused surface inside the Queue chrome.
//
// Default scope is "open tasks assigned to OR followed by the user OR
// created by the user" so an agent sees their full picture without
// having to flip filters. A small segmented control lets them narrow
// to just-assigned-to-me / just-created-by-me.

import { useCallback, useMemo, useState } from 'react';
import { useWorkTasks } from '../../hooks/useWorkTasks';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useOrgNodes } from '../../hooks/useOrgNodes';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { membersInSubtree } from '../../lib/org-scope';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import WorkTaskComposer from '../work-tasks/WorkTaskComposer';
import WorkTaskDetailDrawer from '../work-tasks/WorkTaskDetailDrawer';

const PRIORITY_META = {
  urgent: { color: '#d42d35', dot: '#d42d35' },
  high:   { color: '#ed8d00', dot: '#ed8d00' },
  normal: { color: '#0369a1', dot: '#0369a1' },
  low:    { color: '#15803d', dot: '#15803d' },
};
const STATUS_META = {
  todo:        { label: 'To do',       color: '#0369a1', bg: '#DBEAFE',   icon: 'bi-circle' },
  in_progress: { label: 'In progress', color: '#ed8d00', bg: '#FEF3C7',   icon: 'bi-arrow-repeat' },
  blocked:     { label: 'Blocked',     color: '#d42d35', bg: '#FEE2E2',   icon: 'bi-exclamation-octagon-fill' },
  done:        { label: 'Done',        color: '#15803d', bg: '#DCFCE7',   icon: 'bi-check-circle-fill' },
};

const SCOPE_TABS = [
  { id: 'open',      label: 'Open for me' },
  { id: 'assigned',  label: 'Assigned to me' },
  { id: 'mine',      label: 'Created by me' },
  { id: 'followed',  label: 'Followed by me' },
];

function isOverdue(t) {
  if (!t?.dueDate) return false;
  if (t.status === 'done' || t.status === 'archived') return false;
  return new Date(t.dueDate).getTime() < Date.now();
}
function formatRel(iso) {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const diff = target - Date.now();
  const abs = Math.abs(diff);
  const h = 60 * 60 * 1000;
  const d = 24 * h;
  if (abs < h) return diff < 0 ? `${Math.round(abs / 60000)}m ago` : `in ${Math.round(abs / 60000)}m`;
  if (abs < d) return diff < 0 ? `${Math.round(abs / h)}h ago` : `in ${Math.round(abs / h)}h`;
  return diff < 0 ? `${Math.round(abs / d)}d ago` : `in ${Math.round(abs / d)}d`;
}

export default function TasksQueuePanel({ user }) {
  const tm = useTeamMembers();
  const org = useOrgNodes();
  const deptState = useCurrentDept();
  const dept = deptState?.dept;

  const [scope, setScope] = useState('open');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState(null);
  const [detailTaskId, setDetailTaskId] = useState(null);

  const { tasks, oooEmails, loading, error, reload, create } = useWorkTasks(user?.email, {
    filters: { /* no server filter; we narrow client-side per scope */ },
  });

  const candidates = useMemo(() => {
    if (!dept?.id || !org?.tree?.byParent) return tm.members || [];
    return membersInSubtree(tm.members || [], dept.id, org.tree.byParent, { includeUnassigned: true });
  }, [tm.members, dept?.id, org?.tree?.byParent]);

  const lcUser = (user?.email || '').toLowerCase();

  const filtered = useMemo(() => {
    return tasks
      .filter(t => !t.isArchived)
      .filter(t => {
        if (scope === 'open') {
          if (t.status === 'done' || t.status === 'archived') return false;
          return (t.creator?.email || '').toLowerCase() === lcUser
              || (t.assignees || []).some(e => String(e).toLowerCase() === lcUser)
              || (t.followers || []).some(e => String(e).toLowerCase() === lcUser);
        }
        if (scope === 'mine') return (t.creator?.email || '').toLowerCase() === lcUser;
        if (scope === 'assigned') return (t.assignees || []).some(e => String(e).toLowerCase() === lcUser);
        if (scope === 'followed') return (t.followers || []).some(e => String(e).toLowerCase() === lcUser);
        return true;
      });
  }, [tasks, scope, lcUser]);

  const scopeCounts = useMemo(() => {
    const out = { open: 0, mine: 0, assigned: 0, followed: 0 };
    for (const t of tasks) {
      if (t.isArchived) continue;
      const isCreator = (t.creator?.email || '').toLowerCase() === lcUser;
      const isAssignee = (t.assignees || []).some(e => String(e).toLowerCase() === lcUser);
      const isFollower = (t.followers || []).some(e => String(e).toLowerCase() === lcUser);
      if (isCreator) out.mine += 1;
      if (isAssignee) out.assigned += 1;
      if (isFollower) out.followed += 1;
      if ((isCreator || isAssignee || isFollower) && t.status !== 'done' && t.status !== 'archived') out.open += 1;
    }
    return out;
  }, [tasks, lcUser]);

  const handleCreate = useCallback(async (payload) => {
    setComposerBusy(true);
    setComposerError(null);
    try {
      await create(payload);
      setComposerExpanded(false);
    } catch (err) {
      setComposerError(err?.message || 'Could not create task');
      throw err;
    } finally {
      setComposerBusy(false);
    }
  }, [create]);

  const memberByEmail = useMemo(() => {
    const m = new Map();
    for (const c of candidates) {
      if (c.email) m.set(String(c.email).toLowerCase(), c);
    }
    return m;
  }, [candidates]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Scope toggle */}
      <div role="tablist" aria-label="Task scope" style={{
        display: 'inline-flex',
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius-lg)',
        padding: 3, gap: 2,
        width: 'fit-content',
      }}>
        {SCOPE_TABS.map(t => {
          const isActive = scope === t.id;
          const count = scopeCounts[t.id] || 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setScope(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 30, padding: '0 12px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: isActive ? 'var(--surface)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                boxShadow: isActive ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
                fontSize: 12, fontWeight: isActive ? 600 : 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'all .12s',
              }}
            >
              {t.label}
              <span style={{
                padding: '1px 6px', borderRadius: 'var(--radius-pill)',
                background: isActive ? 'var(--purple-light)' : 'var(--surface-3)',
                color: isActive ? 'var(--purple)' : 'var(--text-muted)',
                fontSize: 10, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Composer */}
      {composerExpanded ? (
        <WorkTaskComposer
          variant="full"
          candidates={candidates}
          oooEmails={oooEmails}
          currentUserEmail={user?.email}
          busy={composerBusy}
          error={composerError}
          onCancel={() => setComposerExpanded(false)}
          onSubmit={handleCreate}
        />
      ) : (
        <WorkTaskComposer
          variant="quick"
          candidates={candidates}
          oooEmails={oooEmails}
          currentUserEmail={user?.email}
          busy={composerBusy}
          error={composerError}
          onSubmit={handleCreate}
        />
      )}
      {!composerExpanded && (
        <button
          type="button"
          onClick={() => setComposerExpanded(true)}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none',
            color: 'var(--purple)', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            padding: 0,
          }}
        ><i className="bi bi-arrows-angle-expand" /> Expand for assignees + description</button>
      )}

      {/* Row list */}
      {error && !loading && (
        <div style={{ padding: 14, background: 'var(--orange-light)', color: 'var(--orange)', fontSize: 12, borderRadius: 'var(--radius-md)' }}>
          Couldn't load tasks — {error?.message || 'unknown error'}.{' '}
          <button type="button" onClick={reload} style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Retry</button>
        </div>
      )}
      {loading && filtered.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>Loading tasks…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="bi-check2-square"
          title="Nothing in this scope"
          subtitle="Use the composer above to create your first task, or pick a different scope."
        />
      ) : (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          {filtered.map((t, idx) => (
            <TaskRow
              key={t.id}
              task={t}
              isLast={idx === filtered.length - 1}
              memberByEmail={memberByEmail}
              oooEmails={oooEmails}
              onOpen={() => setDetailTaskId(t.id)}
            />
          ))}
        </div>
      )}

      {detailTaskId && (
        <WorkTaskDetailDrawer
          taskId={detailTaskId}
          candidates={candidates}
          currentUser={user}
          oooEmails={oooEmails}
          onClose={() => setDetailTaskId(null)}
          onChanged={() => reload()}
        />
      )}
    </div>
  );
}

function TaskRow({ task, isLast, memberByEmail, oooEmails, onOpen }) {
  const sm = STATUS_META[task.status] || STATUS_META.todo;
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  const overdue = isOverdue(task);
  const rel = task.dueDate ? formatRel(task.dueDate) : null;
  const oooAssignee = (task.assignees || []).some(e => oooEmails?.has(String(e).toLowerCase()));

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px minmax(0, 1fr) 130px 140px 100px',
        gap: 12, alignItems: 'center',
        padding: '10px 14px',
        borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
        cursor: 'pointer',
        transition: 'background .12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{
        width: 10, height: 10, borderRadius: '50%', background: pm.dot,
        boxShadow: overdue ? '0 0 0 3px rgba(212,45,53,0.18)' : 'none',
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: task.status === 'done' ? 'var(--text-muted)' : 'var(--text)',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{task.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8 }}>
          {task.commentCount > 0 && <span><i className="bi bi-chat-left" /> {task.commentCount}</span>}
          {oooAssignee && <span style={{ color: '#B91C1C' }}><i className="bi bi-calendar-x" /> Assignee on leave</span>}
        </div>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 'var(--radius-pill)',
        background: sm.bg, color: sm.color,
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        <i className={`bi ${sm.icon}`} /> {sm.label}
      </span>
      <AssigneeStack emails={task.assignees} memberByEmail={memberByEmail} oooEmails={oooEmails} />
      <span style={{
        textAlign: 'right',
        fontSize: 11, fontWeight: 600,
        color: overdue ? '#B91C1C' : 'var(--text-muted)',
      }}>{rel || '—'}</span>
    </div>
  );
}

function AssigneeStack({ emails, memberByEmail, oooEmails }) {
  const list = (emails || []).slice(0, 3);
  const extra = (emails || []).length - list.length;
  if (list.length === 0) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unassigned</span>;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      {list.map((e, i) => {
        const lc = String(e).toLowerCase();
        const m = memberByEmail.get(lc);
        const onLeave = oooEmails?.has(lc);
        return (
          <span key={lc} title={`${m?.name || lc}${onLeave ? ' • On leave' : ''}`} style={{
            position: 'relative',
            marginLeft: i === 0 ? 0 : -6,
            border: '2px solid var(--surface)',
            borderRadius: '50%',
            zIndex: list.length - i,
          }}>
            <Avatar name={m?.name || lc} initials={m?.initials || lc.slice(0, 2).toUpperCase()} src={m?.avatarUrl} size="sm" />
            {onLeave && (
              <span style={{
                position: 'absolute', right: -2, bottom: -2,
                width: 12, height: 12, borderRadius: '50%',
                background: '#FEE2E2', color: '#B91C1C',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, border: '1.5px solid var(--surface)',
              }}><i className="bi bi-calendar-x" /></span>
            )}
          </span>
        );
      })}
      {extra > 0 && (
        <span style={{
          marginLeft: -6,
          width: 24, height: 24, borderRadius: '50%',
          background: 'var(--surface-2)', color: 'var(--text-secondary)',
          border: '2px solid var(--surface)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700,
        }}>+{extra}</span>
      )}
    </div>
  );
}
