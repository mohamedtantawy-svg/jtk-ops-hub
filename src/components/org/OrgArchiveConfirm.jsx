// ── OrgArchiveConfirm (Phase 1, 2026-05-20) ────────────────────────────────
// Centered confirmation modal for soft-deleting a node. Phase 4 swaps this
// for the impact-preview modal that shows the affected ticket / rule /
// dashboard counts; for now we surface the count of active members + child
// nodes the server reports back if the archive is refused (409).

import { useState } from 'react';

export default function OrgArchiveConfirm({ open, node, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [impact, setImpact] = useState(null);

  if (!open || !node) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    setImpact(null);
    try {
      await onConfirm(node);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not archive.');
      // apiFetch attaches the parsed JSON payload to `err.body`. The DELETE
      // route returns { error, impact: { activeChildren, activeMembers } }
      // on 409 — surface those counts so the admin knows what to clear out.
      if (err?.body?.impact) setImpact(err.body.impact);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1500,
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(440px, 92vw)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.20)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 22px 8px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--orange-light)', color: 'var(--orange)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi bi-archive" style={{ fontSize: 16 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text)' }}>
              Archive “{node.name}”?
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
              Archived nodes are hidden from the org chart and dropdowns. History
              is preserved — you can restore the node any time.
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" style={{
            margin: '8px 22px',
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--red-light, #fef2f2)',
            color: 'var(--red-solid, #b91c1c)',
            fontSize: 'var(--font-sm)', fontWeight: 500,
          }}>
            {error}
            {impact && (impact.activeChildren > 0 || impact.activeMembers > 0) && (
              <div style={{ marginTop: 6, fontWeight: 400, color: 'var(--red-solid, #b91c1c)' }}>
                {impact.activeChildren > 0 && <div>• {impact.activeChildren} active child node{impact.activeChildren === 1 ? '' : 's'}</div>}
                {impact.activeMembers > 0 && <div>• {impact.activeMembers} active member{impact.activeMembers === 1 ? '' : 's'}</div>}
                <div style={{ marginTop: 6 }}>Move them out first, then try again.</div>
              </div>
            )}
          </div>
        )}

        <div style={{
          padding: '14px 22px 18px',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          borderTop: '1px solid var(--border-light)',
          marginTop: 12,
        }}>
          <button
            type="button" onClick={onClose} disabled={busy}
            style={{
              padding: '8px 16px', height: 36,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-base)', fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >Cancel</button>
          <button
            type="button" onClick={handleConfirm} disabled={busy}
            style={{
              padding: '8px 16px', height: 36,
              background: 'var(--red-solid, #b91c1c)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              color: 'white',
              fontSize: 'var(--font-base)', fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: busy ? 0.7 : 1,
            }}
          >{busy ? 'Archiving…' : 'Archive'}</button>
        </div>
      </div>
    </div>
  );
}
