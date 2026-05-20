// ── OrgMovePreviewModal (Phase 4, 2026-05-20) ──────────────────────────────
// Confirmation modal shown after a drag-and-drop or bulk-move action.
// Phase 4 surfaces the move impact in plain language — Phase 5 layers in
// the ticket / rule / dashboard reference counts once those backends
// expose preview endpoints.
//
// Two shapes:
//   • Single move:  payload.members = [member]
//   • Bulk move:    payload.members = [member, member, …]
// Both target a single org_node via payload.target.

import { useState } from 'react';
import Avatar from '../ui/Avatar';

export default function OrgMovePreviewModal({
  open, payload, onClose, onConfirm,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open || !payload) return null;
  const { members = [], target } = payload;
  const count = members.length;
  const isBulk = count > 1;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(payload);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not move');
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
          width: 'min(480px, 92vw)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '20px 22px 14px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--purple-light)', color: 'var(--purple)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi bi-arrow-left-right" style={{ fontSize: 16 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text)' }}>
              {isBulk ? `Move ${count} members to ${target.name}?` : `Move ${members[0]?.name || 'this member'} to ${target.name}?`}
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
              {isBulk
                ? `Each member's allocation is updated immediately. Their open tickets keep the same assignee — reassign separately if needed.`
                : `Their allocation updates immediately. Open tickets keep the same assignee — reassign separately if needed.`}
            </div>
          </div>
        </div>

        {/* Member list preview */}
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {members.slice(0, 8).map(m => (
            <div key={m.email} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 22px',
              borderBottom: '1px solid var(--border-light)',
            }}>
              <Avatar size={28} name={m.name} initials={m.initials} src={m.avatarUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title || m.email}</div>
              </div>
            </div>
          ))}
          {members.length > 8 && (
            <div style={{
              padding: '10px 22px',
              fontSize: 'var(--font-sm)',
              color: 'var(--text-muted)',
              textAlign: 'center',
              background: 'var(--surface-2)',
            }}>… and {members.length - 8} more</div>
          )}
        </div>

        {error && (
          <div role="alert" style={{
            margin: '12px 22px 0',
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--red-light, #fef2f2)',
            color: 'var(--red-solid, #b91c1c)',
            fontSize: 'var(--font-sm)', fontWeight: 500,
          }}>{error}</div>
        )}

        <div style={{
          padding: '14px 22px',
          background: 'var(--surface-2)',
          borderTop: '1px solid var(--border-light)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{
              padding: '8px 16px', height: 36,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-base)', fontWeight: 600,
              fontFamily: 'inherit',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >Cancel</button>
          <button type="button" onClick={handleConfirm} disabled={busy}
            style={{
              padding: '8px 16px', height: 36,
              background: 'var(--purple)', border: 'none',
              borderRadius: 'var(--radius-lg)', color: 'white',
              fontSize: 'var(--font-base)', fontWeight: 600,
              fontFamily: 'inherit',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >{busy ? 'Moving…' : (isBulk ? `Move ${count} members` : 'Move')}</button>
        </div>
      </div>
    </div>
  );
}
