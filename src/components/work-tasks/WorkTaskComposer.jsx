// ── WorkTaskComposer (Phase 1, 2026-05-25) ─────────────────────────────────
// Two modes:
//   • inline="quick"  — single-row "+ Add task" composer at the top of the
//                       list. Title + due date + priority + create.
//   • inline="full"   — expanded composer used inside a drawer or modal.
//                       Adds description, assignees, followers, tags.
//
// Submit calls the parent's onCreate with the payload; parent handles the
// API + reload. Composer manages its own draft state and resets on submit.

import { useCallback, useEffect, useState } from 'react';
import MemberMultiPicker from '../org/MemberMultiPicker';

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: '#d42d35', bg: '#FEE2E2' },
  high:   { label: 'High',   color: '#ed8d00', bg: '#FEF3C7' },
  normal: { label: 'Normal', color: 'var(--text-muted)', bg: 'var(--surface-2)' },
  low:    { label: 'Low',    color: '#1f74b3', bg: '#DBEAFE' },
};
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

export default function WorkTaskComposer({
  variant = 'quick',
  candidates = [],
  projects = [],
  defaultProjectId = null,
  oooEmails,
  currentUserEmail,
  busy = false,
  error = null,
  onCancel,
  onSubmit,
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [assignees, setAssignees] = useState(() =>
    currentUserEmail ? [String(currentUserEmail).toLowerCase()] : [],
  );
  const [followers, setFollowers] = useState([]);
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (currentUserEmail && assignees.length === 0) {
      setAssignees([String(currentUserEmail).toLowerCase()]);
    }
  }, [currentUserEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setTitle('');
    setDescription('');
    setPriority('normal');
    setDueDate('');
    setProjectId(defaultProjectId || '');
    setAssignees(currentUserEmail ? [String(currentUserEmail).toLowerCase()] : []);
    setFollowers([]);
    setLocalError(null);
  }, [currentUserEmail, defaultProjectId]);

  const submit = useCallback(async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setLocalError('Title is required');
      return;
    }
    setLocalError(null);
    let dueDateISO = null;
    if (dueDate) {
      const d = new Date(dueDate);
      if (!Number.isFinite(d.getTime())) {
        setLocalError('Invalid due date');
        return;
      }
      dueDateISO = d.toISOString();
    }
    try {
      await onSubmit({
        title: cleanTitle,
        description: description.trim() || null,
        priority,
        assignees,
        followers,
        dueDate: dueDateISO,
        projectId: projectId || null,
      });
      reset();
    } catch (err) {
      setLocalError(err?.message || 'Could not create task');
    }
  }, [title, description, priority, dueDate, projectId, assignees, followers, onSubmit, reset]);

  const isQuick = variant === 'quick';
  const displayError = error || localError;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: isQuick ? '10px 14px' : 16,
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isQuick
          ? 'minmax(0, 1fr) 130px 150px auto'
          : 'minmax(0, 1fr) 130px 180px auto',
        gap: 8, alignItems: 'center',
      }}>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          placeholder="What needs to be done?"
          autoFocus={!isQuick}
          style={inputStyle}
        />
        <select
          value={priority}
          onChange={e => setPriority(e.target.value)}
          style={inputStyle}
        >
          {PRIORITY_ORDER.map(p => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          style={inputStyle}
          title="Due date (optional). Leaves blank uses priority-based SLA."
        />
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {onCancel && (
            <button type="button" onClick={onCancel} style={secondaryBtnStyle} disabled={busy}>Cancel</button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !title.trim()}
            style={{
              ...primaryBtnStyle,
              opacity: (busy || !title.trim()) ? 0.5 : 1,
              cursor: (busy || !title.trim()) ? 'not-allowed' : 'pointer',
            }}
          >{busy ? 'Saving…' : (isQuick ? 'Add' : 'Create task')}</button>
        </div>
      </div>

      {!isQuick && (
        <>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Add a description (optional)"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64, padding: 8 }}
          />
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
          }}>
            <FieldLabel label="Assignee(s)">
              <MemberMultiPicker
                selected={assignees}
                onChange={setAssignees}
                candidates={candidates}
                oooEmails={oooEmails}
                placeholder="Add assignee…"
              />
            </FieldLabel>
            <FieldLabel label="Follower(s)">
              <MemberMultiPicker
                selected={followers}
                onChange={setFollowers}
                candidates={candidates}
                oooEmails={oooEmails}
                placeholder="Add follower…"
              />
            </FieldLabel>
          </div>
          {projects && projects.length > 0 && (
            <FieldLabel label="Project (optional)">
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                style={inputStyle}
              >
                <option value="">— No project —</option>
                {projects
                  .filter(p => p.status !== 'archived')
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            </FieldLabel>
          )}
        </>
      )}

      {displayError && (
        <div style={{ color: 'var(--orange)', fontSize: 12 }}>{displayError}</div>
      )}
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
  height: 32, padding: '0 14px',
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
