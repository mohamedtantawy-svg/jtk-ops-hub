// ── AnnouncementPoll ─────────────────────────────────────────────────────────
// Renders the poll attached to an announcement: vote options before you've
// voted (radio for single-choice, checkboxes + Submit for multi), and result
// bars once you've voted or the poll has closed. Aggregate-only — it never
// shows WHO voted, so it's privacy-safe by default.
//
// Shared by the announcement detail drawer + the acknowledge popup so the two
// surfaces stay byte-identical. Pure presentation: all persistence flows
// through the `onVote(optionIds)` callback the parent wires to the hook.
//
// Props:
//   poll        { options:[{id,label}], allowMultiple, closesAt }
//   tallies     { [optionId]: count }
//   myVote      string[]  — option ids the caller currently has selected
//   totalVoters number    — distinct voters (a multi-select voter counts once)
//   onVote      (optionIds:string[]) => void   — omit/null for read-only
//   compact     boolean   — tighter padding for the popup surface
import { useMemo, useState } from 'react';

export default function AnnouncementPoll({ poll, tallies = {}, myVote = [], totalVoters = 0, onVote, compact = false }) {
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const closed = useMemo(() => {
    if (!poll?.closesAt) return false;
    const t = Date.parse(poll.closesAt);
    return Number.isFinite(t) && Date.now() > t;
  }, [poll?.closesAt]);

  const readOnly = typeof onVote !== 'function' || closed;
  const hasVoted = Array.isArray(myVote) && myVote.length > 0;

  // Start in "vote" mode only when the viewer can still vote and hasn't yet.
  const [editing, setEditing] = useState(!hasVoted && !readOnly);
  const [sel, setSel] = useState(() => new Set(myVote));
  const [busy, setBusy] = useState(false);

  if (options.length === 0) return null;

  const showResults = !editing || closed;
  const total = Number(totalVoters) || 0;

  const submit = async (ids) => {
    if (busy || typeof onVote !== 'function') return;
    setBusy(true);
    try {
      await onVote(ids);
      setSel(new Set(ids));
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const pickSingle = (id) => submit([id]);
  const toggleMulti = (id) => {
    setSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 12, padding: compact ? '12px 14px' : '14px 16px',
      background: 'var(--surface-2)', marginTop: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <i className="bi-bar-chart-fill" style={{ fontSize: 13, color: 'var(--purple, #6b3fa0)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-secondary)' }}>POLL</span>
        {poll.allowMultiple && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>· choose one or more</span>
        )}
        <span style={{ flex: 1 }} />
        {closed
          ? <span style={{ fontSize: 10, fontWeight: 700, color: '#991b1b', background: '#fee2e2', padding: '2px 8px', borderRadius: 128 }}>Closed</span>
          : poll.closesAt
            ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Closes {new Date(poll.closesAt).toLocaleString()}</span>
            : null}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map(opt => {
          const count = Number(tallies[opt.id]) || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = sel.has(opt.id) || (showResults && Array.isArray(myVote) && myVote.includes(opt.id));

          if (showResults) {
            return (
              <div key={opt.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-light)', background: 'var(--surface)' }}>
                <div style={{
                  position: 'absolute', inset: 0, width: `${Math.min(100, pct)}%`,
                  background: mine ? 'var(--purple-mid, #ede9fe)' : 'var(--surface-3, #f0efed)',
                  transition: 'width .25s ease',
                }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
                  {mine && <i className="bi-check-circle-fill" style={{ fontSize: 12, color: 'var(--purple, #6b3fa0)', flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: mine ? 700 : 500, color: 'var(--text)', overflowWrap: 'anywhere' }}>{opt.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{pct}%</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 44, textAlign: 'right' }}>{count} {count === 1 ? 'vote' : 'votes'}</span>
                </div>
              </div>
            );
          }

          // Vote mode
          return (
            <button
              key={opt.id}
              type="button"
              disabled={busy}
              aria-pressed={mine}
              onClick={() => poll.allowMultiple ? toggleMulti(opt.id) : pickSingle(opt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '9px 12px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
                border: `1px solid ${mine ? 'var(--purple, #6b3fa0)' : 'var(--border)'}`,
                background: mine ? 'var(--purple-mid, #ede9fe)' : 'var(--surface)',
                color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, fontWeight: mine ? 700 : 500,
                transition: 'all .12s',
              }}
            >
              <i
                className={poll.allowMultiple
                  ? (mine ? 'bi-check-square-fill' : 'bi-square')
                  : (mine ? 'bi-check-circle-fill' : 'bi-circle')}
                style={{ fontSize: 14, color: mine ? 'var(--purple, #6b3fa0)' : 'var(--text-muted)', flexShrink: 0 }}
              />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Footer: multi-select submit, totals, change-vote affordance */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {total === 0 ? 'No votes yet' : `${total} ${total === 1 ? 'person' : 'people'} voted`}
        </span>
        <span style={{ flex: 1 }} />
        {editing && poll.allowMultiple && !readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit([...sel])}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
              background: 'var(--purple, #6b3fa0)', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            }}
          >
            {hasVoted ? 'Update vote' : 'Submit vote'}
          </button>
        )}
        {showResults && !closed && !readOnly && (
          <button
            type="button"
            onClick={() => { setSel(new Set(myVote)); setEditing(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple, #6b3fa0)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', padding: 0 }}
          >
            Change vote
          </button>
        )}
      </div>
    </div>
  );
}
