// ── OrgChartCanvas (Phase 2, 2026-05-20) ───────────────────────────────────
// Slack-style visual org chart. Cards for each department / team / sub-
// team, with leaf teams hosting up to MAX_INLINE_MEMBERS member chips —
// overflow collapses into a "+N more" tile that opens the team's detail
// drawer. Pan via click-and-drag, zoom via cmd/ctrl + scroll. The +/–
// controls + a "fit" button live in a floating toolbar bottom-right.
//
// Connector lines are SVG paths drawn underneath the cards. Each parent →
// child relationship draws a vertical stem from the parent's bottom, a
// horizontal rail at the midpoint of ROW_GAP, and a vertical drop to each
// child's top — a clean orthogonal layout that matches the reference
// design.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import {
  layoutOrgChart,
  CARD_W, CARD_H, MEMBER_W, MEMBER_H,
  ROW_HEIGHT, PADDING,
} from '../../utils/orgChartLayout';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.6;
const FIT_PADDING = 32;

export default function OrgChartCanvas({
  tree, rootNodes, members, search, canEdit,
  onSelectNode, onEdit, onAddChild, onArchive, onAddMember, onSelectMember,
  sumDescendants,
  // Phase 4 — member move + multi-select
  selectedEmails = new Set(),
  onToggleSelect,
  onDropMembers,        // (memberEmails: string[], targetNode) => void
}) {
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(null);
  // Phase 4 — drag-and-drop state. `dragSourceEmails` carries either the
  // single dragged member's email or the full selected set when starting
  // a drag from a selected card. `dragTargetId` highlights the hovered
  // drop zone.
  const [dragSourceEmails, setDragSourceEmails] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);

  const layout = useMemo(
    () => layoutOrgChart({ tree, rootNodes, members }),
    [tree, rootNodes, members],
  );

  // ── Pan handling ────────────────────────────────────────────────────────
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    // Skip if the click started on a card — don't conflict with card clicks.
    if (e.target.closest('[data-org-card]') || e.target.closest('[data-org-control]')) return;
    e.preventDefault();
    dragging.current = { x: e.clientX, y: e.clientY, startPan: pan };
    wrapRef.current.style.cursor = 'grabbing';
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.x;
    const dy = e.clientY - dragging.current.y;
    setPan({ x: dragging.current.startPan.x + dx, y: dragging.current.startPan.y + dy });
  };
  const onPointerUp = () => {
    dragging.current = null;
    if (wrapRef.current) wrapRef.current.style.cursor = 'grab';
  };

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wheel-zoom (cmd/ctrl + scroll) ──────────────────────────────────────
  const onWheel = (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom(z => clamp(z + delta, MIN_ZOOM, MAX_ZOOM));
  };

  // ── Fit-to-screen ──────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !layout) return;
    const wrapW = wrap.clientWidth - FIT_PADDING * 2;
    const wrapH = wrap.clientHeight - FIT_PADDING * 2;
    if (wrapW <= 0 || wrapH <= 0) return;
    const fitZoom = clamp(Math.min(wrapW / layout.width, wrapH / layout.height), MIN_ZOOM, 1);
    setZoom(fitZoom);
    setPan({
      x: (wrap.clientWidth - layout.width * fitZoom) / 2,
      y: (wrap.clientHeight - layout.height * fitZoom) / 2,
    });
  }, [layout]);

  // Fit on first mount + whenever the layout dimensions change drastically.
  useEffect(() => {
    if (!layout.items.length) return;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width, layout.height]);

  // ── Search highlight ────────────────────────────────────────────────────
  const matchesSearch = (item) => {
    if (!search) return false;
    const lc = search.toLowerCase().trim();
    if (!lc) return false;
    if (item.kind === 'node') {
      const n = item.data;
      return n.name.toLowerCase().includes(lc)
        || (n.slug || '').toLowerCase().includes(lc)
        || (n.leadEmail || '').toLowerCase().includes(lc);
    }
    if (item.kind === 'member') {
      const m = item.data;
      return (m.name || '').toLowerCase().includes(lc)
        || (m.email || '').toLowerCase().includes(lc)
        || (m.title || '').toLowerCase().includes(lc);
    }
    return false;
  };

  if (!layout.items.length) {
    return (
      <EmptyState
        icon="bi-diagram-3"
        title="The chart is empty"
        subtitle="Create a department to see it here."
      />
    );
  }

  // Index for fast parent lookups in the connector pass.
  const byId = new Map();
  for (const it of layout.items) byId.set(it.id, it);

  // Build connector paths.
  const connectors = [];
  for (const it of layout.items) {
    if (!it.parentId) continue;
    const parent = byId.get(it.parentId);
    if (!parent) continue;
    const px = parent.x + parent.width / 2;
    const py = parent.y + parent.height;
    const cx = it.x + it.width / 2;
    const cy = it.y;
    const midY = py + (cy - py) / 2;
    connectors.push({
      id: `${parent.id}-${it.id}`,
      d: `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`,
    });
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 240px)',
        minHeight: 480,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div
        ref={stageRef}
        style={{
          position: 'absolute',
          left: pan.x, top: pan.y,
          width: layout.width,
          height: layout.height,
          transform: `scale(${zoom})`,
          transformOrigin: '0 0',
          transition: dragging.current ? 'none' : 'transform .12s ease-out',
        }}
      >
        {/* Connectors */}
        <svg
          width={layout.width}
          height={layout.height}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        >
          {connectors.map(c => (
            <path
              key={c.id}
              d={c.d}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        {/* Cards */}
        {layout.items.map(it => {
          const highlight = matchesSearch(it);
          if (it.kind === 'node') {
            return (
              <NodeCard
                key={it.id}
                item={it}
                highlight={highlight}
                canEdit={canEdit}
                onSelect={onSelectNode}
                onEdit={onEdit}
                onAddChild={onAddChild}
                onAddMember={onAddMember}
                onArchive={onArchive}
                sumDescendants={sumDescendants}
                isDropTarget={dragTargetId === it.id}
                onDragOver={(e) => {
                  if (!dragSourceEmails || !canEdit) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragTargetId !== it.id) setDragTargetId(it.id);
                }}
                onDragLeave={() => { if (dragTargetId === it.id) setDragTargetId(null); }}
                onDrop={(e) => {
                  if (!dragSourceEmails || !canEdit) return;
                  e.preventDefault();
                  setDragTargetId(null);
                  onDropMembers?.(dragSourceEmails, it.data);
                  setDragSourceEmails(null);
                }}
              />
            );
          }
          if (it.kind === 'member') {
            const isSelected = selectedEmails.has(it.data.email);
            return (
              <MemberCard
                key={it.id}
                item={it}
                highlight={highlight}
                isSelected={isSelected}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onToggleSelect={onToggleSelect}
                onDragStart={(e) => {
                  if (!canEdit) return;
                  // If the dragged card is part of the selection, drag the
                  // entire selection. Otherwise drag just this email.
                  const payload = isSelected && selectedEmails.size > 1
                    ? Array.from(selectedEmails)
                    : [it.data.email];
                  setDragSourceEmails(payload);
                  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', payload.join(',')); } catch {}
                }}
                onDragEnd={() => { setDragSourceEmails(null); setDragTargetId(null); }}
              />
            );
          }
          // member-more
          return (
            <MoreCard
              key={it.id}
              item={it}
              onSelect={() => onSelectNode?.(byId.get(it.parentId)?.data)}
            />
          );
        })}
      </div>

      {/* Floating controls */}
      <div data-org-control style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'inline-flex',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        <CtrlBtn icon="bi-zoom-out" label="Zoom out" onClick={() => setZoom(z => clamp(z - 0.15, MIN_ZOOM, MAX_ZOOM))} />
        <CtrlBtn icon="bi-aspect-ratio" label="Fit"   onClick={fit} />
        <CtrlBtn icon="bi-zoom-in"  label="Zoom in"  onClick={() => setZoom(z => clamp(z + 0.15, MIN_ZOOM, MAX_ZOOM))} />
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 10px',
          fontSize: 'var(--font-xs)',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          borderLeft: '1px solid var(--border)',
          minWidth: 52,
        }}>{Math.round(zoom * 100)}%</div>
      </div>
    </div>
  );
}

function NodeCard({ item, highlight, canEdit, onSelect, onEdit, onAddChild, onAddMember, onArchive,
  sumDescendants, isDropTarget, onDragOver, onDragLeave, onDrop }) {
  const node = item.data;
  const accent = node.color || (node.kind === 'department' ? '#7c3aed' : '#1f74b3');
  const icon = node.icon || (node.kind === 'department' ? 'bi-building' : 'bi-people');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  // Visual: a drop target gets a thick accent ring + a subtle highlight so
  // admins can see exactly where the drop will land before releasing.
  const borderColor = isDropTarget ? accent : (highlight ? accent : 'var(--border)');
  const shadow = isDropTarget
    ? `0 0 0 4px ${accent}55, 0 4px 12px ${accent}33`
    : (highlight ? `0 0 0 3px ${accent}33` : '0 1px 3px rgba(0,0,0,0.05)');
  return (
    <div
      data-org-card
      style={{
        position: 'absolute',
        left: item.x, top: item.y,
        width: CARD_W, height: CARD_H,
        background: isDropTarget ? `${accent}11` : 'var(--surface)',
        border: `1px solid ${borderColor}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 12,
        boxShadow: shadow,
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column',
        cursor: 'pointer',
        transition: 'border-color .12s, box-shadow .12s, transform .12s, background .12s',
      }}
      onClick={() => onSelect?.(node)}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `${accent}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className={`bi ${icon}`} style={{ color: accent, fontSize: 14 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--font-sm)',
            fontWeight: 700,
            color: 'var(--text)',
            lineHeight: 1.25,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>{node.name}</div>
          <div style={{
            fontSize: 'var(--font-xs)',
            color: 'var(--text-muted)',
            textTransform: 'capitalize',
            marginTop: 2,
          }}>{node.kind}{node.leadEmail ? ` · ${node.leadEmail.split('@')[0]}` : ''}</div>
        </div>
        {/* Phase 9 (2026-05-20): show recursive headcount so EMEA's badge
            reflects every person in its subtree, not just direct attaches.
            Falls back to direct count if the helper isn't supplied. */}
        <span title={`${(sumDescendants ? sumDescendants(node.id).members : (node.memberCount || 0))} members in subtree`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 7px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--surface-3)',
            color: 'var(--text-secondary)',
            fontSize: 10, fontWeight: 700,
            flexShrink: 0,
          }}>
          <i className="bi bi-person-fill" style={{ fontSize: 9 }} />
          {sumDescendants ? sumDescendants(node.id).members : (node.memberCount || 0)}
        </span>
      </div>
      <div style={{
        marginTop: 'auto',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 'var(--font-xs)',
        color: 'var(--text-muted)',
      }}>
        {(node.countryCodes || []).slice(0, 4).map(c => (
          <span key={c} style={{ fontSize: 13 }} title={c}>{flagFor(c)}</span>
        ))}
        {(node.countryCodes || []).length > 4 && (
          <span style={{ fontWeight: 600 }}>+{node.countryCodes.length - 4}</span>
        )}
        {canEdit && (
          <div ref={menuRef} style={{ marginLeft: 'auto', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Actions"
              onClick={() => setMenuOpen(p => !p)}
              style={{
                width: 22, height: 22,
                background: menuOpen ? 'var(--surface-3)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={e => { if (!menuOpen) e.currentTarget.style.background = 'transparent'; }}
            >
              <i className="bi bi-three-dots" style={{ fontSize: 11 }} />
            </button>
            {menuOpen && (
              // Menu opens downward (top: calc(100% + 4px)) so cards near the
              // very top of the chart canvas don't clip the menu against the
              // canvas's overflow:hidden boundary. The action button sits
              // along the card's bottom edge so a downward menu still flows
              // naturally.
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 12px 30px rgba(0,0,0,0.14)',
                minWidth: 180, overflow: 'hidden', zIndex: 5,
              }}>
                <CardMenuItem icon="bi-pencil"      label="Edit"               onClick={() => { setMenuOpen(false); onEdit?.(node); }} />
                <CardMenuItem icon="bi-person-plus" label="Add member"         onClick={() => { setMenuOpen(false); onAddMember?.(node); }} />
                <CardMenuItem icon="bi-plus-lg"     label="Add team"           onClick={() => { setMenuOpen(false); onAddChild?.(node, 'team'); }} />
                {node.kind === 'department' && (
                  <CardMenuItem icon="bi-diagram-2" label="Add sub-department" onClick={() => { setMenuOpen(false); onAddChild?.(node, 'department'); }} />
                )}
                <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />
                <CardMenuItem icon="bi-archive" label="Archive" danger onClick={() => { setMenuOpen(false); onArchive?.(node); }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({ item, highlight, isSelected, canEdit,
  onSelect, onToggleSelect, onDragStart, onDragEnd }) {
  const m = item.data;
  // Selection takes precedence over search-highlight visually because a
  // user actively picking members wants a stronger affordance.
  const ring = isSelected
    ? '0 0 0 3px var(--purple)'
    : (highlight ? '0 0 0 3px var(--purple-light)' : '0 1px 3px rgba(0,0,0,0.04)');
  return (
    <div
      data-org-card
      draggable={!!canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        position: 'absolute',
        left: item.x, top: item.y,
        width: MEMBER_W, height: MEMBER_H,
        background: isSelected ? 'var(--purple-light)' : 'var(--surface)',
        border: `1px solid ${isSelected || highlight ? 'var(--purple)' : 'var(--border)'}`,
        borderRadius: 12,
        boxShadow: ring,
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: canEdit ? 'grab' : 'pointer',
        transition: 'border-color .12s, box-shadow .12s, transform .12s, background .12s',
      }}
      onClick={(e) => {
        // Cmd/ctrl/shift-click toggles selection without opening the
        // detail drawer; plain click opens the drawer for inspection /
        // edit.
        if ((e.metaKey || e.ctrlKey || e.shiftKey) && canEdit) {
          e.stopPropagation();
          onToggleSelect?.(m.email);
          return;
        }
        onSelect?.(m);
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <Avatar size={40} name={m.name} initials={m.initials} src={m.avatarUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--font-sm)', fontWeight: 700,
          color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{m.name}</div>
        <div style={{
          fontSize: 'var(--font-xs)', color: 'var(--text-muted)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{m.title || '—'}</div>
      </div>
      {isSelected && (
        <i className="bi bi-check-circle-fill" style={{ fontSize: 14, color: 'var(--purple)' }} />
      )}
    </div>
  );
}

function MoreCard({ item, onSelect }) {
  const count = item.data.count;
  return (
    <button
      type="button"
      data-org-card
      onClick={onSelect}
      style={{
        position: 'absolute',
        left: item.x, top: item.y,
        width: MEMBER_W, height: MEMBER_H,
        background: 'var(--surface-2)',
        border: '1px dashed var(--border)',
        borderRadius: 12,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4,
        fontFamily: 'inherit',
        transition: 'background .12s, border-color .12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
    >
      <i className="bi bi-people-fill" style={{ fontSize: 18, color: 'var(--text-secondary)' }} />
      <div style={{ fontSize: 'var(--font-sm)', fontWeight: 700, color: 'var(--text)' }}>+{count} more</div>
      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Open team to view</div>
    </button>
  );
}

function CtrlBtn({ icon, label, onClick }) {
  return (
    <button
      data-org-control
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 36, height: 36,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <i className={`bi ${icon}`} style={{ fontSize: 13 }} />
    </button>
  );
}

function CardMenuItem({ icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'var(--red-light, #fef2f2)' : 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 12px',
        background: 'transparent', border: 'none',
        textAlign: 'left',
        fontSize: 'var(--font-sm)', fontWeight: 500,
        color: danger ? 'var(--red-solid, #b91c1c)' : 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <i className={`bi ${icon}`} style={{ fontSize: 12, width: 16, textAlign: 'center' }} />
      {label}
    </button>
  );
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// Lightweight flag lookup — kept inline so the chart doesn't drag in the
// full FLAGS map for what's a decorative country indicator. The 12 codes
// below are the regions that touch HR Experience teams most often per
// orgConfig.js + members.js; anything else falls back to a generic glyph.
const QUICK_FLAGS = {
  GB:'🇬🇧', US:'🇺🇸', DE:'🇩🇪', FR:'🇫🇷', NL:'🇳🇱', SG:'🇸🇬',
  BR:'🇧🇷', AU:'🇦🇺', AE:'🇦🇪', CA:'🇨🇦', PH:'🇵🇭', IN:'🇮🇳',
  JP:'🇯🇵', MX:'🇲🇽', PL:'🇵🇱', ES:'🇪🇸', IT:'🇮🇹', PT:'🇵🇹',
};
function flagFor(code) {
  if (!code) return '';
  if (QUICK_FLAGS[code]) return QUICK_FLAGS[code];
  // Generic Unicode-region indicator for any other ISO-2.
  if (/^[A-Z]{2}$/.test(code)) {
    return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  return '🏳';
}
