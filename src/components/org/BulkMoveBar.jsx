// ── BulkMoveBar (Phase 4, 2026-05-20) ──────────────────────────────────────
// Fixed bottom-of-viewport action bar shown when one or more members are
// multi-selected on the org chart. Surfaces the count and the primary
// "Move…" action that opens the OrgMovePreviewModal with a tree-picker.

import { useEffect, useState } from 'react';

export default function BulkMoveBar({
  selectedCount, rootNodes, tree, onCancel, onChooseTarget,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [selectedCount]);

  if (selectedCount === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24, left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1400,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
      padding: '8px 12px 8px 18px',
      display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: 'inherit',
    }}>
      <span style={{
        fontSize: 'var(--font-sm)', fontWeight: 600,
        color: 'var(--text)',
      }}>
        {selectedCount} {selectedCount === 1 ? 'member' : 'members'} selected
      </span>
      <div style={{ position: 'relative' }}>
        <button
          type="button" onClick={() => setOpen(p => !p)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', height: 32,
            background: 'var(--purple)', color: 'white',
            border: 'none', borderRadius: 'var(--radius-pill)',
            fontSize: 'var(--font-sm)', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <i className="bi bi-arrow-left-right" style={{ fontSize: 12 }} />
          Move to…
        </button>
        {open && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.14)',
            minWidth: 240, maxHeight: 320, overflowY: 'auto',
            padding: 6,
          }}>
            <TargetTree
              rootNodes={rootNodes}
              tree={tree}
              onPick={(node) => { setOpen(false); onChooseTarget(node); }}
            />
          </div>
        )}
      </div>
      <button
        type="button" onClick={onCancel}
        aria-label="Clear selection"
        style={{
          padding: 6,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)',
          borderRadius: 6,
          fontFamily: 'inherit',
        }}
      >
        <i className="bi bi-x-lg" style={{ fontSize: 13 }} />
      </button>
    </div>
  );
}

function TargetTree({ rootNodes, tree, onPick, depth = 0, parentList = rootNodes }) {
  return (
    <div>
      {parentList.filter(n => !n.isArchived).map(n => {
        const kids = (tree.byParent.get(n.id) || []).filter(c => !c.isArchived);
        return (
          <div key={n.id}>
            <button
              type="button"
              onClick={() => onPick(n)}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '7px 10px',
                paddingLeft: 10 + depth * 14,
                background: 'transparent', border: 'none',
                textAlign: 'left',
                fontSize: 'var(--font-sm)', fontWeight: 500,
                color: 'var(--text)',
                cursor: 'pointer',
                borderRadius: 6,
                fontFamily: 'inherit',
              }}
            >
              <i className={`bi ${n.kind === 'department' ? 'bi-building' : 'bi-people'}`}
                style={{ fontSize: 12, color: n.color || 'var(--text-muted)' }} />
              <span style={{ flex: 1 }}>{n.name}</span>
            </button>
            {kids.length > 0 && <TargetTree rootNodes={rootNodes} tree={tree} onPick={onPick} depth={depth + 1} parentList={kids} />}
          </div>
        );
      })}
    </div>
  );
}
