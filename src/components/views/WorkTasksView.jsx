// ── WorkTasksView (Phase 1, 2026-05-25) ────────────────────────────────────
// Top-level "Tasks" tab. Replaces the home-page PersonalChecklist as the
// canonical place for manual task management. Layout follows the Feedback
// board pattern (skill section 3.13):
//   1. Hero header (icon + title + subtitle + primary "New task")
//   2. Segmented scope toggle (My tasks | Assigned to me | Followed | All)
//   3. 4-up status filter cards (Todo · In progress · Blocked · Done)
//   4. Filter bar (priority chips · search · refresh)
//   5. Quick-add composer (inline)
//   6. Row list (priority dot · title · assignees stack · due date pill)
//
// Detail drawer opens when a row is clicked. Notification deep-link from
// the bell sets focusTaskId; the view opens that task on mount.

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useWorkTasks } from '../../hooks/useWorkTasks';
import { useWorkProjects } from '../../hooks/useWorkProjects';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { useOrgNodes } from '../../hooks/useOrgNodes';
import { membersInSubtree } from '../../lib/org-scope';
import { PermissionsContext } from '../../App';
import { getHubBrand } from '../../lib/hub-brand';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import WorkTaskComposer from '../work-tasks/WorkTaskComposer';
import WorkTaskDetailDrawer from '../work-tasks/WorkTaskDetailDrawer';

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: '#d42d35', dot: '#d42d35', bg: '#FEE2E2' },
  high:   { label: 'High',   color: '#ed8d00', dot: '#ed8d00', bg: '#FEF3C7' },
  normal: { label: 'Normal', color: '#0369a1', dot: '#0369a1', bg: '#DBEAFE' },
  low:    { label: 'Low',    color: '#15803d', dot: '#15803d', bg: '#DCFCE7' },
};
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

const STATUS_META = {
  todo:        { label: 'To do',       color: '#0369a1', bg: '#DBEAFE',   icon: 'bi-circle' },
  in_progress: { label: 'In progress', color: '#ed8d00', bg: '#FEF3C7',   icon: 'bi-arrow-repeat' },
  blocked:     { label: 'Blocked',     color: '#d42d35', bg: '#FEE2E2',   icon: 'bi-exclamation-octagon-fill' },
  done:        { label: 'Done',        color: '#15803d', bg: '#DCFCE7',   icon: 'bi-check-circle-fill' },
};
const STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'done'];

const SCOPE_TABS = [
  { id: 'all',       label: 'All tasks' },
  { id: 'mine',      label: 'Created by me' },
  { id: 'assigned',  label: 'Assigned to me' },
  { id: 'followed',  label: 'Followed by me' },
];

function formatRelative(iso) {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const diff = target - Date.now();
  const absMs = Math.abs(diff);
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  if (absMs < oneHour) {
    const m = Math.round(absMs / 60000);
    return diff < 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (absMs < oneDay) {
    const h = Math.round(absMs / oneHour);
    return diff < 0 ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(absMs / oneDay);
  return diff < 0 ? `${d}d ago` : `in ${d}d`;
}
function isOverdue(task) {
  if (!task?.dueDate) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}
function isDueSoon(task) {
  if (!task?.dueDate) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  const ms = new Date(task.dueDate).getTime() - Date.now();
  return ms > 0 && ms < 24 * 60 * 60 * 1000;
}

export default function WorkTasksView({ user, focusTaskId, onTaskFocused }) {
  const perms = useContext(PermissionsContext);
  const tm = useTeamMembers();
  const org = useOrgNodes();
  const deptState = useCurrentDept();
  const dept = deptState?.dept;

  const [scope, setScope] = useState('all');
  const [statusFilter, setStatusFilter] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState(null);
  const [projectFilter, setProjectFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState(null);

  const { tasks, oooEmails, counts, loading, error, reload, create, archive } = useWorkTasks(user?.email, {
    filters: {
      status: statusFilter,
      priority: priorityFilter,
      projectId: projectFilter,
      includeArchived: showArchived,
    },
  });
  const { projects } = useWorkProjects(user?.email);

  // Focus a specific task on mount when arriving via notification deep-link.
  useEffect(() => {
    if (focusTaskId) {
      setDetailTaskId(focusTaskId);
      onTaskFocused?.();
    }
  }, [focusTaskId, onTaskFocused]);

  // Dept-scoped member candidates for the assignee / follower / mention pickers.
  const candidates = useMemo(() => {
    if (!dept?.id || !org?.tree?.byParent) {
      return tm.members || [];
    }
    return membersInSubtree(tm.members || [], dept.id, org.tree.byParent, { includeUnassigned: true });
  }, [tm.members, dept?.id, org?.tree?.byParent]);

  // Client-side scope + search filter (server already handled status / priority).
  const visibleTasks = useMemo(() => {
    const lcUser = (user?.email || '').toLowerCase();
    const lcSearch = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (scope === 'mine' && (t.creator?.email || '').toLowerCase() !== lcUser) return false;
      if (scope === 'assigned' && !(t.assignees || []).some(e => String(e).toLowerCase() === lcUser)) return false;
      if (scope === 'followed' && !(t.followers || []).some(e => String(e).toLowerCase() === lcUser)) return false;
      if (lcSearch) {
        const hay = `${t.title} ${t.description || ''}`.toLowerCase();
        if (!hay.includes(lcSearch)) return false;
      }
      return true;
    });
  }, [tasks, scope, search, user?.email]);

  // Counts per scope segment — based on the priority/status server filter
  // but BEFORE the scope filter, so the user can see how busy each segment is.
  const scopeCounts = useMemo(() => {
    const out = { all: 0, mine: 0, assigned: 0, followed: 0 };
    const lc = (user?.email || '').toLowerCase();
    for (const t of tasks) {
      if (t.isArchived) continue;
      out.all += 1;
      if ((t.creator?.email || '').toLowerCase() === lc) out.mine += 1;
      if ((t.assignees || []).some(e => String(e).toLowerCase() === lc)) out.assigned += 1;
      if ((t.followers || []).some(e => String(e).toLowerCase() === lc)) out.followed += 1;
    }
    return out;
  }, [tasks, user?.email]);

  const hubBrand = useMemo(() => getHubBrand(dept), [dept]);
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Hero */}
      <div style={{
        padding: '24px 32px 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-light)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'var(--purple-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi bi-check2-square" style={{ color: 'var(--purple)', fontSize: 18 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              fontSize: 'var(--font-3xl)', fontWeight: 700,
              color: 'var(--text)', margin: 0, lineHeight: 1.3,
              letterSpacing: '-0.01em',
            }}>Tasks</h2>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-md)',
              margin: '4px 0 0', lineHeight: 1.4,
            }}>
              Manual tasks and todos for {hubBrand.hubLabel.replace(' Hub', '')}. Create, assign, and track.
            </p>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 'var(--font-xs)', fontWeight: 600,
              color: showArchived ? 'var(--orange)' : 'var(--text-muted)',
              cursor: 'pointer', userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                style={{ accentColor: 'var(--orange)' }}
              />
              <i className="bi bi-archive" /> Archived
            </label>
            <button
              type="button"
              onClick={() => reload()}
              aria-label="Refresh"
              title="Refresh"
              style={iconBtnStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <i className="bi bi-arrow-clockwise" />
            </button>
            <button
              type="button"
              onClick={() => setComposerExpanded(v => !v)}
              style={primaryBtnStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--purple-hover, #6d28d9)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--purple)'}
            >
              <i className="bi bi-plus-lg" /> New task
            </button>
          </div>
        </div>

        {/* Segmented scope toggle */}
        <div role="tablist" aria-label="Task scope" style={{
          display: 'inline-flex',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-lg)',
          padding: 3, gap: 2,
          marginTop: 18,
          maxWidth: '100%',
          overflowX: 'auto',
        }}>
          {SCOPE_TABS.map(t => {
            const isActive = scope === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setScope(t.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 30, padding: '0 14px',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: isActive ? 'var(--surface)' : 'transparent',
                  color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                  boxShadow: isActive ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
                  fontSize: 12, fontWeight: isActive ? 600 : 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'all .12s',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
                <span style={{
                  padding: '1px 6px', borderRadius: 'var(--radius-pill)',
                  background: isActive ? 'var(--purple-light)' : 'var(--surface-3)',
                  color: isActive ? 'var(--purple)' : 'var(--text-muted)',
                  fontSize: 10, fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}>{scopeCounts[t.id] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 32px 48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Status filter cards */}
          <div className="work-tasks-status-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
          }}>
            <style>{`
              @media (max-width: 900px) {
                .work-tasks-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
              }
            `}</style>
            {STATUS_ORDER.map(s => (
              <StatusFilterCard
                key={s}
                statusKey={s}
                meta={STATUS_META[s]}
                count={counts[s] || 0}
                active={statusFilter === s}
                onClick={() => setStatusFilter(prev => prev === s ? null : s)}
              />
            ))}
          </div>

          {/* Filter bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {PRIORITY_ORDER.map(p => {
                const isActive = priorityFilter === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriorityFilter(prev => prev === p ? null : p)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 'var(--radius-pill)',
                      background: isActive ? PRIORITY_META[p].bg : 'var(--surface-2)',
                      color: isActive ? PRIORITY_META[p].color : 'var(--text-secondary)',
                      border: `1px solid ${isActive ? PRIORITY_META[p].color : 'var(--border-light)'}`,
                      fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', transition: 'all .12s',
                      fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_META[p].dot }} />
                    {PRIORITY_META[p].label}
                  </button>
                );
              })}
            </div>
            {projects && projects.filter(p => p.status !== 'archived').length > 0 && (
              <select
                value={projectFilter || ''}
                onChange={e => setProjectFilter(e.target.value || null)}
                style={{
                  height: 32, padding: '0 10px',
                  background: projectFilter ? 'var(--purple-light)' : 'var(--surface-2)',
                  border: `1px solid ${projectFilter ? 'var(--purple)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 12, color: projectFilter ? 'var(--purple)' : 'var(--text-secondary)',
                  fontWeight: projectFilter ? 600 : 500,
                  fontFamily: 'inherit',
                  outline: 'none', cursor: 'pointer',
                  maxWidth: 200,
                }}
              >
                <option value="">All projects</option>
                {projects
                  .filter(p => p.status !== 'archived')
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            )}
            <div style={{ flex: 1, position: 'relative', minWidth: 200, maxWidth: 360 }}>
              <i className="bi bi-search" style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none',
              }} />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tasks…"
                style={{
                  width: '100%', height: 32, paddingLeft: 32, paddingRight: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 12, color: 'var(--text)',
                  fontFamily: 'inherit',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
              {visibleTasks.length} of {scopeCounts.all} task{scopeCounts.all === 1 ? '' : 's'}
            </span>
          </div>

          {composerExpanded && (
            <WorkTaskComposer
              variant="full"
              candidates={candidates}
              oooEmails={oooEmails}
              currentUserEmail={user?.email}
              projects={projects}
              defaultProjectId={projectFilter}
              busy={composerBusy}
              error={composerError}
              onCancel={() => setComposerExpanded(false)}
              onSubmit={handleCreate}
            />
          )}
          {!composerExpanded && (
            <WorkTaskComposer
              variant="quick"
              candidates={candidates}
              oooEmails={oooEmails}
              currentUserEmail={user?.email}
              projects={projects}
              defaultProjectId={projectFilter}
              busy={composerBusy}
              error={composerError}
              onSubmit={handleCreate}
            />
          )}

          {/* Row list */}
          {error && !loading && (
            <div style={{ padding: 14, background: 'var(--orange-light)', color: 'var(--orange)', fontSize: 12, borderRadius: 'var(--radius-md)' }}>
              Couldn't load tasks — {error?.message || 'unknown error'}.{' '}
              <button type="button" onClick={reload} style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Retry</button>
            </div>
          )}
          {loading && tasks.length === 0 ? (
            <RowSkeleton />
          ) : visibleTasks.length === 0 ? (
            <EmptyState
              icon="bi-check2-square"
              title={scope === 'all' && !statusFilter && !priorityFilter && !search ? 'No tasks yet' : 'No tasks match your filters'}
              subtitle={scope === 'all' && !statusFilter && !priorityFilter && !search
                ? 'Add your first task using the composer above, or pick one of the scope tabs.'
                : 'Try clearing a filter or scoping wider.'}
            />
          ) : (
            <TaskList
              tasks={visibleTasks}
              candidates={candidates}
              oooEmails={oooEmails}
              onOpen={(t) => setDetailTaskId(t.id)}
            />
          )}
        </div>
      </div>

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

function StatusFilterCard({ statusKey, meta, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr auto',
        alignItems: 'center', gap: 12,
        padding: '14px 16px',
        background: active ? meta.bg : 'var(--surface)',
        color: active ? meta.color : 'var(--text)',
        border: `1px solid ${active ? meta.color : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all .12s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'var(--surface)'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: active ? meta.color : meta.bg,
        color: active ? 'white' : meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <i className={`bi ${meta.icon}`} style={{ fontSize: 18 }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: active ? meta.color : 'var(--text)' }}>{meta.label}</div>
        <div style={{ fontSize: 11, color: active ? meta.color : 'var(--text-muted)' }}>
          {count === 1 ? '1 task' : `${count} tasks`}
        </div>
      </div>
      <div style={{
        fontSize: 24, fontWeight: 800,
        color: active ? meta.color : 'var(--text)',
        fontVariantNumeric: 'tabular-nums',
      }}>{count}</div>
    </button>
  );
}

function TaskList({ tasks, candidates, oooEmails, onOpen }) {
  const memberByEmail = useMemo(() => {
    const m = new Map();
    for (const c of candidates) {
      if (c.email) m.set(String(c.email).toLowerCase(), c);
    }
    return m;
  }, [candidates]);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {tasks.map((t, idx) => (
        <TaskRow
          key={t.id}
          task={t}
          isLast={idx === tasks.length - 1}
          memberByEmail={memberByEmail}
          oooEmails={oooEmails}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function TaskRow({ task, isLast, memberByEmail, oooEmails, onOpen }) {
  const sm = STATUS_META[task.status] || STATUS_META.todo;
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  const overdue = isOverdue(task);
  const soon = isDueSoon(task);
  const rel = task.dueDate ? formatRelative(task.dueDate) : null;
  const oooAssignee = (task.assignees || []).some(e => oooEmails?.has(String(e).toLowerCase()));

  return (
    <div
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task); } }}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px minmax(0, 1fr) 130px 140px 100px',
        gap: 12, alignItems: 'center',
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
        cursor: 'pointer',
        transition: 'background .12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: pm.dot,
        boxShadow: overdue ? '0 0 0 3px rgba(212,45,53,0.18)' : 'none',
      }} title={pm.label} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: task.status === 'done' ? 'var(--text-muted)' : 'var(--text)',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{task.title}</div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          marginTop: 2,
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          {task.commentCount > 0 && (
            <span><i className="bi bi-chat-left" /> {task.commentCount}</span>
          )}
          {task.tags?.length > 0 && (
            <span><i className="bi bi-tag" /> {task.tags.join(', ')}</span>
          )}
          {oooAssignee && (
            <span style={{ color: '#B91C1C' }}>
              <i className="bi bi-calendar-x" /> Assignee on leave
            </span>
          )}
        </div>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        background: sm.bg, color: sm.color,
        fontSize: 11, fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        <i className={`bi ${sm.icon}`} /> {sm.label}
      </span>
      <AssigneeStack emails={task.assignees} memberByEmail={memberByEmail} oooEmails={oooEmails} />
      <span style={{
        textAlign: 'right',
        fontSize: 11, fontWeight: 600,
        color: overdue ? '#B91C1C' : soon ? '#92400E' : 'var(--text-muted)',
      }}>
        {rel || '—'}
      </span>
    </div>
  );
}

function AssigneeStack({ emails, memberByEmail, oooEmails }) {
  const list = (emails || []).slice(0, 3);
  const extra = (emails || []).length - list.length;
  if (list.length === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unassigned</span>;
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: -4 }}>
      {list.map((e, idx) => {
        const lc = String(e).toLowerCase();
        const m = memberByEmail.get(lc);
        const onLeave = oooEmails?.has(lc);
        return (
          <span
            key={lc}
            title={`${m?.name || lc}${onLeave ? ' • On leave' : ''}`}
            style={{
              position: 'relative',
              marginLeft: idx === 0 ? 0 : -6,
              border: '2px solid var(--surface)',
              borderRadius: '50%',
              zIndex: list.length - idx,
            }}
          >
            <Avatar
              name={m?.name || lc}
              initials={m?.initials || lc.slice(0, 2).toUpperCase()}
              src={m?.avatarUrl}
              size="sm"
            />
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

function RowSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{
          height: 48,
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          opacity: 0.6,
        }} />
      ))}
    </div>
  );
}

const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 36, padding: '0 14px',
  background: 'var(--purple)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-lg)',
  fontSize: 13, fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};
const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 36, height: 36,
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};
