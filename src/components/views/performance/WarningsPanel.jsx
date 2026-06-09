// ── WarningsPanel ───────────────────────────────────────────────────────────
// Performance warnings for one member: a timeline + (for managers) an issue
// form + resolve, and (for the member) acknowledge. Used in MyPerformance
// (own, read + acknowledge) and ReviewEditor (manager issues to the report).
import { useState } from 'react';
import { usePerfWarnings } from '../../../hooks/usePerfWarnings';
import { WARNING_LEVELS, warningLevelMeta } from '../../../lib/performance-constants';

function fmt(d) { try { return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch { return ''; } }

export default function WarningsPanel({ memberEmail, memberName, canIssue = false, isSelf = false, compact = false }) {
  const { warnings, loading, error, issue, patch, remove } = usePerfWarnings({ member: memberEmail });
  const [showForm, setShowForm] = useState(false);
  const [level, setLevel] = useState('verbal');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try { await issue({ memberEmail, memberName, level, reason: reason.trim(), detail: detail.trim() }); setReason(''); setDetail(''); setLevel('verbal'); setShowForm(false); }
    catch { /* error surfaced by hook */ }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: compact ? 8 : 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
          <i className="bi bi-exclamation-triangle" style={{ marginRight: 6 }} />Warnings {warnings.length > 0 && `(${warnings.length})`}
        </div>
        {canIssue && <button onClick={() => setShowForm(s => !s)} style={btnGhost}>{showForm ? 'Cancel' : '+ Issue warning'}</button>}
      </div>
      {error && <div style={errBox}>{error}</div>}

      {showForm && canIssue && (
        <div style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {WARNING_LEVELS.map(l => (
              <button key={l.key} onClick={() => setLevel(l.key)}
                style={{ ...pill, background: level === l.key ? l.bg : 'var(--surface-2)', color: level === l.key ? l.color : 'var(--text-secondary)', border: `1px solid ${level === l.key ? l.color + '55' : 'var(--border-light)'}`, cursor: 'pointer' }}>
                {l.label}
              </button>
            ))}
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" style={{ ...inp, width: '100%', marginBottom: 6 }} />
          <textarea value={detail} onChange={e => setDetail(e.target.value)} placeholder="Detail / context (optional)" rows={2} style={{ ...inp, width: '100%', marginBottom: 8, resize: 'vertical' }} />
          <button onClick={submit} disabled={busy || !reason.trim()} style={{ ...btnPrimary, opacity: (busy || !reason.trim()) ? 0.6 : 1 }}>{busy ? 'Issuing…' : 'Issue warning'}</button>
        </div>
      )}

      {loading && warnings.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>Loading…</div>}
      {!loading && warnings.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No warnings on record.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {warnings.map(w => {
          const meta = warningLevelMeta(w.level);
          return (
            <div key={w.id} style={{ ...card, borderLeft: `3px solid ${meta.color}`, opacity: w.isResolved ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...pill, background: meta.bg, color: meta.color }}>{meta.label}</span>
                  {w.isResolved && <span style={{ ...pill, background: '#dcfce7', color: '#15803d' }}>Resolved</span>}
                  {w.acknowledgedAt && !w.isResolved && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}><i className="bi bi-check2" /> Acknowledged</span>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(w.issuedAt)}{w.issuedByName ? ` · ${w.issuedByName}` : ''}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 6 }}>{w.reason}</div>
              {w.detail && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{w.detail}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {isSelf && !w.acknowledgedAt && <button onClick={() => patch(w.id, { acknowledge: true })} style={btnGhost}>Acknowledge</button>}
                {canIssue && !w.isResolved && <button onClick={() => patch(w.id, { resolve: true })} style={btnGhost}>Mark resolved</button>}
                {canIssue && w.isResolved && <button onClick={() => patch(w.id, { resolve: false })} style={btnGhost}>Reopen</button>}
                {canIssue && <button onClick={() => { if (window.confirm('Delete this warning?')) remove(w.id); }} style={{ ...btnGhost, color: '#dc2626' }}>Delete</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const card = { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' };
const pill = { padding: '2px 8px', borderRadius: 128, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' };
const inp = { fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' };
const btnPrimary = { fontSize: 12, fontWeight: 600, color: '#fff', background: '#7c3aed', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' };
const btnGhost = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' };
const errBox = { padding: '8px 12px', marginBottom: 8, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 };
