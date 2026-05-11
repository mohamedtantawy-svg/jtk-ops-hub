// ── LogHandbackModal ──────────────────────────────────────────────────
// Phase 5 of HANDOVERS_PLAN.md. Coverer-facing modal that closes an
// active handover. Two sections:
//   1. Summary — what happened during the OOO window (required, min 10
//      chars to enforce a genuine handback rather than an empty tick)
//   2. Open items — optional list of pointers the requester needs to
//      pick up. Each row is { label, url } — kept simple for v1; full
//      source/id pointers can be edited inline later.
//
// On submit, transitions the handover to `completed` and ends the
// workspace merge. The detail slide-out reloads + the OOOView refreshes
// events + counts so the row immediately moves to the past lane.

import { useState } from 'react';
import { logHandback } from '../../services/handoversApi';

function LogHandbackModal({ handover, onClose, onSubmitted, onToast }) {
  const [summary, setSummary] = useState('');
  const [items, setItems] = useState([{ label: '', url: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function updateItem(idx, key, value) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it));
  }
  function addItem() {
    setItems(prev => [...prev, { label: '', url: '' }]);
  }
  function removeItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (summary.trim().length < 10) {
      setError('Summary must be at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cleanItems = items
        .map(i => ({ label: (i.label || '').trim(), url: (i.url || '').trim() }))
        .filter(i => i.label || i.url);
      const res = await logHandback(handover.id, {
        summary: summary.trim(),
        open_items: cleanItems.map(i => ({ kind: 'note', label: i.label, url: i.url || null })),
      });
      onToast?.({ kind: 'success', message: 'Handback logged — handover completed.' });
      onSubmitted?.(res?.handover);
    } catch (err) {
      setError(err?.message || 'Failed to log handback');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div role="presentation" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60 }} />
      <div role="dialog" aria-modal="true" aria-label="Log handback"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(560px, 95vw)', maxHeight: '92vh',
          background: 'var(--surface)', borderRadius: 16,
          boxShadow: '0 20px 60px rgba(15,23,42,0.20)',
          zIndex: 61, display: 'flex', flexDirection: 'column',
          fontFamily: 'inherit', overflow: 'hidden',
        }}>
        <header style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Log handback</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Hand the workspace back to the requester. Submitting completes the handover.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6, fontFamily: 'inherit',
          }}>
            <i className="bi-x-lg" style={{ fontSize: 16 }} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ padding: '10px 12px', background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>
              {error}
            </div>
          )}

          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: 'var(--text)' }}>
              Summary of what happened
            </span>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value.slice(0, 5000))}
              placeholder="What did you handle? Anything still open? What does the requester need to know first thing?"
              rows={6}
              style={{
                width: '100%', resize: 'vertical', padding: 10,
                border: '1px solid var(--border)', borderRadius: 10,
                fontFamily: 'inherit', fontSize: 13, color: 'var(--text)',
                background: 'var(--surface)',
              }}
            />
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
              {summary.trim().length}/10 minimum · {5000 - summary.length} chars left
            </div>
          </label>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Open items (optional)</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Pointers the requester should pick up</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={item.label}
                    onChange={e => updateItem(i, 'label', e.target.value.slice(0, 200))}
                    placeholder="Short label (e.g. SafetyWing termination pending)"
                    style={{
                      flex: 1, height: 32, padding: '0 10px',
                      border: '1px solid var(--border)', borderRadius: 8,
                      fontFamily: 'inherit', fontSize: 12,
                      background: 'var(--surface)', color: 'var(--text)',
                    }}
                  />
                  <input
                    value={item.url}
                    onChange={e => updateItem(i, 'url', e.target.value.slice(0, 500))}
                    placeholder="URL (optional)"
                    style={{
                      width: 200, height: 32, padding: '0 10px',
                      border: '1px solid var(--border)', borderRadius: 8,
                      fontFamily: 'inherit', fontSize: 12,
                      background: 'var(--surface)', color: 'var(--text)',
                    }}
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      aria-label={`Remove item ${i + 1}`}
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--text-secondary)', padding: 4, fontFamily: 'inherit',
                      }}
                    >
                      <i className="bi-x-lg" style={{ fontSize: 11 }} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItem}
              style={{
                marginTop: 6,
                padding: '6px 12px', borderRadius: 8,
                border: '1px dashed var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <i className="bi-plus-lg" style={{ marginRight: 6, fontSize: 11 }} />
              Add item
            </button>
          </div>
        </div>

        <footer style={{
          padding: '14px 22px', borderTop: '1px solid var(--border-light)',
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
        }}>
          <button type="button" onClick={onClose} disabled={busy} style={{
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
          }}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy || summary.trim().length < 10} style={{
            padding: '8px 16px', borderRadius: 8,
            background: 'var(--purple, #7c3aed)',
            color: 'white', border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', opacity: (busy || summary.trim().length < 10) ? 0.55 : 1,
          }}>{busy ? 'Submitting…' : 'Submit handback & complete'}</button>
        </footer>
      </div>
    </>
  );
}

export default LogHandbackModal;
