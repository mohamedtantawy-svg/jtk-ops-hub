// ── OrgTreeView (Phase 1, 2026-05-20) ──────────────────────────────────────
// Polished indented tree for admin CRUD. Phase 2 ships a side-by-side
// visual chart (Slack-style cards); this view is the accessible, dense
// counterpart that admins will use day-to-day for restructuring.
//
// Per-row UI:
//   chevron · accent-coloured icon · name · kind chip · headcount badge ·
//   action menu (canEdit only — Edit / Add team / Archive)
//
// Persistent collapse state per node id in localStorage so a heavy admin
// session doesn't re-expand on reload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const COLLAPSE_KEY = 'ops_hub_org_collapsed_v1';

function readCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function writeCollapsed(set) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(set))); } catch {}
}

const KIND_CHIP = {
  department: { label: 'Department', bg: 'var(--purple-light)', color: 'var(--purple)' },
  team:       { label: 'Team',       bg: 'var(--surface-3)',    color: 'var(--text-secondary)' },
};

function matchesSearch(node, term) {
  if (!term) return true;
  return node.name.toLowerCase().includes(term)
    || (node.slug || '').toLowerCase().includes(term)
    || (node.description || '').toLowerCase().includes(term)
    || (node.leadEmail || '').toLowerCase().includes(term);
}

// Recursive descent — returns the ids of every node we should keep when a
// search filter is active. A node passes the filter if it matches OR has a
// descendant that matches; non-passing nodes are hidden.
function filterIds(tree, term) {
  if (!term) return null;
  const lc = term.toLowerCase().trim();
  if (!lc) return null;
  const keep = new Set();
  const walk = (id) => {
    const node = tree.byId.get(id);
    if (!node) return false;
    const kids = tree.byParent.get(id) || [];
    let anyChildMatched = false;
    for (const k of kids) {
      if (walk(k.id)) anyChildMatched = true;
    }
    const selfMatch = matchesSearch(node, lc);
    if (selfMatch || anyChildMatched) {
      keep.add(id);
      return true;
    }
    return false;
  };
  for (const root of tree.byParent.get('__root__') || []) walk(root.id);
  return keep;
}

export default function OrgTreeView({
  tree,
  rootNodes,
  search,
  canEdit,
  sumDescendants,
  onEdit,
  onAddChild,
  onAddMember,
  onArchive,
  onSelect,
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  const keepIds = useMemo(() => filterIds(tree, search), [tree, search]);

  // When a search term is active, auto-expand every node that's part of
  // the matched chain so results aren't hidden behind a closed chevron.
  useEffect(() => {
    if (!keepIds) return;
    setCollapsed(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of keepIds) {
        if (next.has(id)) { next.delete(id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [keepIds]);

  const toggle = useCallback((id) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeCollapsed(next);
      return next;
    });
  }, []);

  const expandAll = () => {
    setCollapsed(new Set());
    writeCollapsed(new Set());
  };
  const collapseAll = () => {
    const all = new Set();
    for (const n of tree.byId.values()) all.add(n.id);
    setCollapsed(all);
    writeCollapsed(all);
  };

  const visibleRoots = keepIds
    ? rootNodes.filter(n => keepIds.has(n.id))
    : rootNodes;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-light)',
        background: 'var(--surface-2)',
      }}>
        <div style={{
          fontSize: 'var(--font-xs)',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>Structure</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <PlainBtn onClick={expandAll} icon="bi-chevron-down">Expand all</PlainBtn>
          <PlainBtn onClick={collapseAll} icon="bi-chevron-up">Collapse all</PlainBtn>
        </div>
      </div>
      <div role="tree" aria-label="Org structure">
        {visibleRoots.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-md)',
          }}>
            {keepIds ? 'No nodes match your search.' : 'No departments yet — create the first one to get started.'}
          </div>
        ) : (
          visibleRoots.map(node => (
            <OrgNodeRow
              key={node.id}
              node={node}
              depth={0}
              tree={tree}
              collapsed={collapsed}
              toggle={toggle}
              keepIds={keepIds}
              canEdit={canEdit}
              sumDescendants={sumDescendants}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onAddMember={onAddMember}
              onArchive={onArchive}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OrgNodeRow({
  node, depth, tree, collapsed, toggle, keepIds, canEdit,
  sumDescendants, onEdit, onAddChild, onAddMember, onArchive, onSelect,
}) {
  const kids = tree.byParent.get(node.id) || [];
  const visibleKids = keepIds ? kids.filter(k => keepIds.has(k.id)) : kids;
  const hasChildren = visibleKids.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const headcount = sumDescendants(node.id);
  const accent = node.color || (node.kind === 'department' ? 'var(--purple)' : '#1f74b3');
  const chip = KIND_CHIP[node.kind] || KIND_CHIP.team;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-level={depth + 1}
        onClick={() => onSelect?.(node)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px',
          paddingLeft: 16 + depth * 24,
          borderBottom: '1px solid var(--border-light)',
          cursor: 'pointer',
          transition: 'background .12s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Chevron */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); if (hasChildren) toggle(node.id); }}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          style={{
            width: 22, height: 22, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            color: hasChildren ? 'var(--text-secondary)' : 'transparent',
            cursor: hasChildren ? 'pointer' : 'default',
            borderRadius: 6,
            transition: 'background .12s, transform .12s',
            transform: hasChildren && !isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          <i className="bi bi-chevron-down" style={{ fontSize: 11 }} />
        </button>

        {/* Accent icon */}
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: `${accent}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className={`bi ${node.icon || (node.kind === 'department' ? 'bi-building' : 'bi-people')}`}
            style={{ color: accent, fontSize: 14 }} />
        </div>

        {/* Name + slug */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--font-md)', fontWeight: 600,
            color: 'var(--text)', lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{node.name}</div>
          {node.description && (
            <div style={{
              fontSize: 'var(--font-sm)', color: 'var(--text-muted)',
              lineHeight: 1.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{node.description}</div>
          )}
        </div>

        {/* Kind chip */}
        <span style={{
          padding: '2px 8px',
          borderRadius: 'var(--radius-pill)',
          background: chip.bg, color: chip.color,
          fontSize: 'var(--font-xs)', fontWeight: 600,
          letterSpacing: '0.02em',
          flexShrink: 0,
        }}>{chip.label}</span>

        {/* Headcount badge */}
        <span title={`${headcount.members} member${headcount.members === 1 ? '' : 's'}${headcount.vacancies ? ` · ${headcount.vacancies} vacant` : ''}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 'var(--radius-pill)',
            background: 'var(--surface-3)', color: 'var(--text-secondary)',
            fontSize: 'var(--font-xs)', fontWeight: 600,
            flexShrink: 0, minWidth: 40, justifyContent: 'center',
          }}>
          <i className="bi bi-person-fill" style={{ fontSize: 10 }} />
          {headcount.members}
          {headcount.vacancies > 0 && (
            <span style={{ color: 'var(--orange)', fontWeight: 700 }}>+{headcount.vacancies}</span>
          )}
        </span>

        {/* Lead avatar dot — simple visual cue, no fetch */}
        {node.leadEmail && (
          <span title={`Lead: ${node.leadEmail}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 'var(--font-xs)', color: 'var(--text-muted)',
            maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            <i className="bi bi-person-circle" style={{ fontSize: 12 }} />
            {node.leadEmail.split('@')[0]}
          </span>
        )}

        {/* Action menu */}
        {canEdit && (
          <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Actions"
              onClick={() => setMenuOpen(p => !p)}
              style={{
                width: 28, height: 28, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                background: menuOpen ? 'var(--surface-3)' : 'transparent',
                border: '1px solid transparent',
                borderRadius: 6, cursor: 'pointer',
                color: 'var(--text-secondary)',
                transition: 'background .12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={e => e.currentTarget.style.background = menuOpen ? 'var(--surface-3)' : 'transparent'}
            >
              <i className="bi bi-three-dots" style={{ fontSize: 13 }} />
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg, 0 12px 30px rgba(0,0,0,0.12))',
                zIndex: 300, minWidth: 200, overflow: 'hidden',
              }}>
                <MenuItem icon="bi-pencil"        label="Edit"           onClick={() => { setMenuOpen(false); onEdit?.(node); }} />
                <MenuItem icon="bi-person-plus"   label="Add member"     onClick={() => { setMenuOpen(false); onAddMember?.(node); }} />
                {/* Sub-team add: every department can host teams; every team can host sub-teams. Sub-department add is admin-only via the global "+ New department" entry. */}
                <MenuItem icon="bi-plus-lg"       label="Add child team" onClick={() => { setMenuOpen(false); onAddChild?.(node, 'team'); }} />
                {node.kind === 'department' && (
                  <MenuItem icon="bi-diagram-2"   label="Add sub-department" onClick={() => { setMenuOpen(false); onAddChild?.(node, 'department'); }} />
                )}
                <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />
                <MenuItem icon="bi-archive" label="Archive" danger onClick={() => { setMenuOpen(false); onArchive?.(node); }} />
              </div>
            )}
          </div>
        )}
      </div>

      {hasChildren && !isCollapsed && visibleKids.map(k => (
        <OrgNodeRow
          key={k.id}
          node={k}
          depth={depth + 1}
          tree={tree}
          collapsed={collapsed}
          toggle={toggle}
          keepIds={keepIds}
          canEdit={canEdit}
          sumDescendants={sumDescendants}
          onEdit={onEdit}
          onAddChild={onAddChild}
          onAddMember={onAddMember}
          onArchive={onArchive}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function MenuItem({ icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'var(--red-light, #fef2f2)' : 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 14px',
        background: 'transparent', border: 'none',
        textAlign: 'left',
        fontSize: 'var(--font-base)',
        fontWeight: 500,
        color: danger ? 'var(--red-solid, #b91c1c)' : 'var(--text)',
        cursor: 'pointer',
        transition: 'background .1s',
        fontFamily: 'inherit',
      }}
    >
      <i className={`bi ${icon}`} style={{ fontSize: 13, width: 16, textAlign: 'center' }} />
      {label}
    </button>
  );
}

function PlainBtn({ icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 'var(--font-xs)', fontWeight: 600,
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background .1s',
      }}
    >
      <i className={`bi ${icon}`} style={{ fontSize: 10 }} />
      {children}
    </button>
  );
}
