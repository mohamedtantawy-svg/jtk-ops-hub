// ── BriefingMyTasks (Phase 2, 2026-05-25) ──────────────────────────────────
// Replaces PersonalChecklist on the Briefing column-1 slot. Compact card:
//   • Header "My Tasks" + open-count badge + "View all" link to Tasks tab
//   • Quick-add composer (single line)
//   • Top N open tasks (priority-sorted) with check toggle + click-to-open
//
// Reads from the same work_tasks backend the standalone Tasks tab uses,
// so a task created here shows up in the Tasks tab + Queue Tasks source
// without any extra plumbing. Data continuity comes from the lazy
// migration of personal_checklist_snapshots that runs server-side on
// the first /api/v1/work-tasks GET per user.

import { useCallback, useMemo, useState } from 'react';
import { useWorkTasks } from '../../hooks/useWorkTasks';
import { patchWorkTask } from '../../services/workTasksApi';

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: '#d42d35', dot: '#d42d35', bg: '#FEE2E2' },
  high:   { label: 'High',   color: '#ed8d00', dot: '#ed8d00', bg: '#FEF3C7' },
  normal: { label: 'Normal', color: '#0369a1', dot: '#0369a1', bg: '#DBEAFE' },
  low:    { label: 'Low',    color: '#15803d', dot: '#15803d', bg: '#DCFCE7' },
};
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];
const VISIBLE_LIMIT = 12;

function formatDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff <= 7) return `In ${diff}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function isOverdue(t) {
  if (!t?.dueDate) return false;
  if (t.status === 'done' || t.status === 'archived') return false;
  return new Date(t.dueDate).getTime() < Date.now();
}

export default function BriefingMyTasks({ user, onOpenTasks, onOpenTask }) {
  const [draft, setDraft] = useState('');
  const [priority, setPriority] = useState('normal');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const { tasks, loading, error, reload, create } = useWorkTasks(user?.email, { filters: {} });

  const lcUser = (user?.email || '').toLowerCase();

  // Open + relevant-to-me, priority-sorted, capped at VISIBLE_LIMIT.
  const visibleTasks = useMemo(() => {
    const ranked = tasks
      .filter(t => !t.isArchived && t.status !== 'done' && t.status !== 'archived')
      .filter(t =>
        (t.creator?.email || '').toLowerCase() === lcUser
        || (t.assignees || []).some(e => String(e).toLowerCase() === lcUser)
        || (t.followers || []).some(e => String(e).toLowerCase() === lcUser)
      );
    ranked.sort((a, b) => {
      const ap = PRIORITY_ORDER.indexOf(a.priority);
      const bp = PRIORITY_ORDER.indexOf(b.priority);
      if (ap !== bp) return ap - bp;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return ranked;
  }, [tasks, lcUser]);

  const openCount = visibleTasks.length;
  const shownTasks = visibleTasks.slice(0, VISIBLE_LIMIT);

  const submitQuickAdd = useCallback(async () => {
    const title = draft.trim();
    if (!title) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      await create({ title, priority });
      setDraft('');
    } catch (err) {
      setLocalError(err?.message || 'Could not add task');
    } finally {
      setSubmitting(false);
    }
  }, [draft, priority, create]);

  const toggleDone = useCallback(async (task) => {
    const next = task.status === 'done' ? 'todo' : 'done';
    try {
      await patchWorkTask(task.id, { status: next });
      await reload();
    } catch (err) {
      setLocalError(err?.message || 'Could not update task');
    }
  }, [reload]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--border-light)',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--purple-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className="bi bi-check2-square" style={{ color: 'var(--purple)', fontSize: 14 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>My Tasks</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {openCount === 0 ? 'You are all caught up.' :
              openCount === 1 ? '1 open task' : `${openCount} open tasks`}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenTasks}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 'var(--radius-pill)',
            background: 'transparent', color: 'var(--purple)',
            border: '1px solid var(--border-light)',
            fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >View all <i className="bi bi-arrow-up-right" /></button>
      </header>

      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          <i className="bi bi-plus-circle" style={{ color: 'var(--purple)', fontSize: 14, flexShrink: 0 }} />
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); } }}
            placeholder="Add a task and hit Enter"
            disabled={submitting}
            style={{
              flex: 1, minWidth: 0,
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          />
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            disabled={submitting}
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 11, fontWeight: 600,
              color: PRIORITY_META[priority]?.color || 'var(--text-secondary)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {PRIORITY_ORDER.map(p => (
              <option key={p} value={p}>{PRIORITY_META[p].label}</option>
            ))}
          </select>
        </div>
        {localError && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--orange)' }}>{localError}</div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', maxHeight: 480 }}>
        {error && !loading && (
          <div style={{ padding: 14, color: 'var(--orange)', fontSize: 12 }}>
            Couldn't load tasks — {error?.message}.{' '}
            <button type="button" onClick={reload} style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Retry</button>
          </div>
        )}
        {loading && shownTasks.length === 0 ? (
          <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
        ) : shownTasks.length === 0 && !error ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <i className="bi bi-check-circle" style={{ fontSize: 24, marginBottom: 6, display: 'block' }} />
            Nothing on your plate. Use the input above to add a task.
          </div>
        ) : (
          shownTasks.map((task, idx) => (
            <TaskRow
              key={task.id}
              task={task}
              isLast={idx === shownTasks.length - 1}
              onToggle={() => toggleDone(task)}
              onOpen={() => onOpenTask?.(task.id)}
            />
          ))
        )}
        {visibleTasks.length > VISIBLE_LIMIT && (
          <button
            type="button"
            onClick={onOpenTasks}
            style={{
              display: 'block', width: '100%',
              padding: '10px 14px',
              background: 'transparent', border: 'none',
              borderTop: '1px solid var(--border-light)',
              color: 'var(--purple)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >View {visibleTasks.length - VISIBLE_LIMIT} more in Tasks →</button>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, isLast, onToggle, onOpen }) {
  const pm = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  const overdue = isOverdue(task);
  const dueLabel = task.dueDate ? formatDue(task.dueDate) : null;
  const isDone = task.status === 'done';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '20px minmax(0, 1fr) auto',
      gap: 10, alignItems: 'center',
      padding: '10px 14px',
      borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
      transition: 'background .12s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
        style={{
          width: 18, height: 18, borderRadius: '50%',
          border: `2px solid ${isDone ? '#15803d' : pm.dot}`,
          background: isDone ? '#15803d' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0,
          color: 'white', fontSize: 10,
        }}
      >{isDone && <i className="bi bi-check" />}</button>
      <button
        type="button"
        onClick={onOpen}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          textAlign: 'left', cursor: onOpen ? 'pointer' : 'default',
          minWidth: 0, fontFamily: 'inherit',
        }}
      >
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: isDone ? 'var(--text-muted)' : 'var(--text)',
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{task.title}</div>
        {(dueLabel || task.commentCount > 0) && (
          <div style={{
            display: 'flex', gap: 8, marginTop: 2,
            fontSize: 11,
            color: overdue ? '#B91C1C' : 'var(--text-muted)',
            fontWeight: overdue ? 600 : 400,
          }}>
            {dueLabel && <span><i className="bi bi-calendar-event" /> {dueLabel}</span>}
            {task.commentCount > 0 && <span><i className="bi bi-chat-left" /> {task.commentCount}</span>}
          </div>
        )}
      </button>
      <span style={{
        padding: '2px 8px', borderRadius: 'var(--radius-pill)',
        background: pm.bg, color: pm.color,
        fontSize: 10, fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>{pm.label}</span>
    </div>
  );
}
