// ── ReassignTaskModal ────────────────────────────────────────────────────
// Pop-up search picker for reassigning a queue row whose source can't be
// updated upstream (Onboarding / Amendments / Redlines / Incentive Plans).
// The picker is plain text + filter — no native <select> — per Jose's
// feedback row that the assignee dropdown was unworkable past 100 names.
//
// On submit → POST /queue/source-reassign with the row's stable identifiers
// (source, taskId, taskUrl). The backend overlays the override on every
// subsequent fetch so the new assignee + their manager chain immediately
// see the row in their Workspace; the original assignee is preserved on
// the override row so we can revert without data loss.

import { useEffect, useMemo, useRef, useState } from 'react';
import { reassignSourceTask, clearSourceReassignment } from '../../services/queueReassignmentsApi';
import { MEMBERS, MEMBERS_BY_EMAIL } from '../../data/members';

const SOURCE_LABEL = {
  onboarding: 'Onboarding',
  amendments: 'Amendments',
  redlines: 'Redlines',
  incentive_plans: 'Incentive Plans',
};

export default function ReassignTaskModal({ task, onClose, onReassigned }) {
  const backdropRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Close on Escape, focus the search on open.
  useEffect(() => {
    const h = e => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    document.addEventListener('keydown', h);
    inputRef.current?.focus();
    return () => document.removeEventListener('keydown', h);
  }, [onClose, submitting]);

  const sortedMembers = useMemo(
    () => [...MEMBERS].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [],
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sortedMembers.filter(m => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
    : sortedMembers;

  // Reset highlight when the search changes.
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Keep the highlighted row in view during keyboard nav.
  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const submit = async (target) => {
    if (!target?.email || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const original = task?.assigneeEmail
        ? { email: task.assigneeEmail, name: task.assigneeName || (MEMBERS_BY_EMAIL[task.assigneeEmail.toLowerCase()]?.name || null) }
        : null;
      await reassignSourceTask({
        source: task.source,
        taskId: String(task.id),
        taskUrl: task.url || null,
        taskSubject: task.subject || null,
        taskCountry: task.country || null,
        assigneeEmail: target.email,
        assigneeName: target.name || null,
        originalAssigneeEmail: original?.email || null,
        originalAssigneeName: original?.name || null,
      });
      onReassigned?.({ ...task, assigneeEmail: target.email, assigneeName: target.name });
    } catch (err) {
      setError(err?.message || 'Could not reassign');
      setSubmitting(false);
    }
  };

  const clearOverride = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await clearSourceReassignment({ source: task.source, taskId: String(task.id) });
      onReassigned?.({ ...task, _cleared: true });
    } catch (err) {
      setError(err?.message || 'Could not reset');
      setSubmitting(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIdx];
      if (target) submit(target);
    }
  };

  const sourceLabel = SOURCE_LABEL[task?.source] || task?.source || '';

  return (
    <div
      ref={backdropRef}
      onClick={ev => { if (ev.target === backdropRef.current && !submitting) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reassign-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--surface, #fff)', borderRadius: 16, width: '100%', maxWidth: 480,
        maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0efed', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="bi-arrow-left-right" style={{ fontSize: 15, color: '#1d4ed8' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="reassign-title" style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>
              Reassign task
            </div>
            <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sourceLabel}
              {task?.subject ? <> · <strong style={{ color: '#616161' }}>{task.subject}</strong></> : null}
              {task?.country ? <> · {task.country}</> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) onClose?.(); }}
            aria-label="Close"
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e8e8e8', background: 'var(--surface, #fff)', color: '#9e9e9e', cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Search input */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0efed' }}>
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#9e9e9e' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search by name or email…"
              disabled={submitting}
              style={{
                width: '100%', padding: '9px 12px 9px 32px', border: '1px solid #e8e8e8',
                borderRadius: 10, fontSize: 13, color: '#1b1b1b', background: 'var(--surface, #fff)',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#9e9e9e' }}>
            <i className="bi-info-circle" style={{ marginRight: 4 }} />
            The new assignee — and their manager chain — will see this task in their Workspace immediately. Country owners keep visibility regardless.
          </div>
        </div>

        {/* Member list */}
        <div ref={listRef} role="listbox" style={{ flex: 1, overflowY: 'auto', minHeight: 200, maxHeight: 380 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: '#9e9e9e' }}>
              No matches
            </div>
          ) : filtered.map((m, idx) => {
            const isActive = idx === activeIdx;
            const isCurrent = task?.assigneeEmail && (task.assigneeEmail.toLowerCase() === (m.email || '').toLowerCase());
            return (
              <button
                key={m.email}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={isActive}
                disabled={submitting || isCurrent}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => submit(m)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '10px 20px', textAlign: 'left',
                  border: 'none', background: isActive ? '#eff6ff' : 'transparent',
                  cursor: submitting ? 'wait' : isCurrent ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: isCurrent ? 0.55 : 1,
                  borderBottom: '1px solid #f5f4f2',
                }}
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3eff8', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {(m.name || m.email || '?').split(' ').map(w => w[0]?.toUpperCase()).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name || m.email}
                  </div>
                  <div style={{ fontSize: 11, color: '#9e9e9e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.email}{m.team ? ` · ${m.team}` : ''}
                  </div>
                </div>
                {isCurrent && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#15803d', background: '#e8f5e9', padding: '2px 8px', borderRadius: 128 }}>
                    Current
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #f0efed', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {error ? (
            <span style={{ fontSize: 11, color: '#d42d35', fontWeight: 600 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 4 }} />
              {error}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: '#9e9e9e' }}>
              ↑↓ to navigate &middot; Enter to assign &middot; Esc to close
            </span>
          )}
          {task?.hasOverride && (
            <button
              type="button"
              onClick={clearOverride}
              disabled={submitting}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid #e8e8e8',
                background: 'var(--surface, #fff)', color: '#616161',
                fontSize: 12, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reset to original
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
