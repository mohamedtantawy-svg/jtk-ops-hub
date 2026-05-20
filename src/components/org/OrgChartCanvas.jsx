// ── OrgChartCanvas (Phase 12a redesign — 2026-05-20) ───────────────────────
// Smart org chart. The original "render everything always" tree fell apart
// at scale (10+ depts × 50+ teams × 2500+ members). This redesign:
//
//   • Default view: every department + every team. Sub-teams + members
//     HIDDEN until clicked.
//   • Lead embedded in the card (avatar + name) instead of a separate
//     chip. No bare ack-style "+8 more" by default — members only appear
//     when an admin clicks "Show members" on a specific card.
//   • One team's sub-teams open at a time. Click expand on team B and
//     team A (if open) auto-collapses — keeps the chart fit-to-screen
//     no matter how deep you drill.
//   • Auto fit-to-screen on every expansion change so the chart stays
//     compact regardless of which subtree is currently open.
//
// Card affordances (kept from prior phases): drop-target for member
// drag-and-drop (Phase 4), Login-as-dept-admin button (Phase 10a),
// per-card action menu (edit / add / archive).

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
  // Phase 10a — per-root-dept "Login as dept admin" affordance, gated on
  // isGlobalSuperAdmin (currently mohamed only) + node.kind==='department'
  // + !node.parentId + node.leadEmail.
  isGlobalSuperAdmin,
  onLoginAsDeptAdmin,
  // Phase 12a — expansion state. Controls which sub-trees + which member
  // chips are rendered. Comes from OrgView so the state survives across
  // mode switches (chart ↔ list ↔ table) and so the audit drawer / form
  // drawer can drive expansion as well (future).
  expansion,                  // { expandedTeamId, expandedSubTeamId, showMembers: Set<string> }
  onToggleTeamExpansion,      // (nodeId, kind: 'team' | 'subTeam') => void
  onToggleShowMembers,        // (nodeId) => void
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

  // Phase 12a: lead lookup so each card can embed its lead's avatar + name
  // inline instead of forcing the admin to expand the team to see who runs
  // it. Cheap O(members) build, memoised; lookups are O(1).
  const membersByEmail = useMemo(() => {
    const map = new Map();
    for (const m of members || []) {
      if (m?.email) map.set(String(m.email).toLowerCase(), m);
    }
    return map;
  }, [members]);

  // Phase 12a: per-node subtree stats (direct + descendant teams,
  // members, vacancies). Used by the card stats row. Recursive descent
  // with a cache keyed by node id so a 50-team org doesn't re-walk the
  // subtree on every render.
  const subtreeStats = useMemo(() => {
    const cache = new Map();
    function walk(nodeId) {
      if (cache.has(nodeId)) return cache.get(nodeId);
      const node = tree.byId?.get(nodeId);
      if (!node) {
        const empty = { directTeams: 0, descendantTeams: 0, directMembers: 0, descendantMembers: 0, vacancies: 0 };
        cache.set(nodeId, empty);
        return empty;
      }
      let directTeams = 0;
      let descendantTeams = 0;
      let directMembers = node.memberCount || 0;
      let descendantMembers = node.memberCount || 0;
      let vacancies = node.vacantCount || 0;
      const kids = (tree.byParent?.get(nodeId) || []).filter(k => !k.isArchived);
      for (const kid of kids) {
        if (kid.kind === 'team') {
          directTeams += 1;
          descendantTeams += 1;
        }
        const childStats = walk(kid.id);
        descendantTeams += childStats.descendantTeams;
        descendantMembers += childStats.descendantMembers;
        vacancies += childStats.vacancies;
      }
      const out = { directTeams, descendantTeams, directMembers, descendantMembers, vacancies };
      cache.set(nodeId, out);
      return out;
    }
    return walk;
  }, [tree]);

  const layout = useMemo(
    () => layoutOrgChart({ tree, rootNodes, members, expansion }),
    [tree, rootNodes, members, expansion],
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
            const node = it.data;
            const lead = node.leadEmail
              ? membersByEmail.get(String(node.leadEmail).toLowerCase()) || null
              : null;
            const stats = subtreeStats(node.id);
            // A node "can expand" when it has at least one team child (sub-team).
            // Departments and root-level teams without sub-teams render the
            // expand button disabled / hidden.
            const childKidsAreTeams = (tree.byParent?.get(node.id) || [])
              .some(k => !k.isArchived && k.kind === 'team');
            const isTeamUnderDept = node.kind === 'team'
              && tree.byId?.get(node.parentId)?.kind === 'department';
            const isSubTeam = node.kind === 'team' && !isTeamUnderDept;
            const isExpanded = isTeamUnderDept
              ? expansion?.expandedTeamId === node.id
              : isSubTeam
                ? expansion?.expandedSubTeamId === node.id
                : false;
            const canToggleExpand = childKidsAreTeams && (isTeamUnderDept || isSubTeam);
            const isShowingMembers = expansion?.showMembers?.has(node.id) === true;
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
                lead={lead}
                stats={stats}
                canToggleExpand={canToggleExpand}
                isExpanded={isExpanded}
                isShowingMembers={isShowingMembers}
                onToggleExpand={() => {
                  if (!canToggleExpand) return;
                  onToggleTeamExpansion?.(node.id, isTeamUnderDept ? 'team' : 'subTeam');
                }}
                onToggleShowMembers={() => onToggleShowMembers?.(node.id)}
                isGlobalSuperAdmin={isGlobalSuperAdmin}
                onLoginAsDeptAdmin={onLoginAsDeptAdmin}
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

// ── NodeCard (Phase 12a redesign — 2026-05-20) ────────────────────────────
// Department / team / sub-team card. Embeds the lead inline (avatar +
// name) so the admin doesn't have to expand to see who runs the team.
// Stats row shows direct teams + descendant members. Actions row has
// per-card "Expand" + "Show members" toggles that drive the chart's
// expansion state.
function NodeCard({
  item, highlight, canEdit,
  onSelect, onEdit, onAddChild, onAddMember, onArchive,
  // Phase 12a inputs
  lead,                       // Member | null — looked up from membersByEmail
  stats,                      // { directTeams, descendantMembers, vacancies, ... }
  canToggleExpand,            // true iff this node has team-kind children
  isExpanded,                 // true iff this node is currently expanded
  isShowingMembers,           // true iff this card's members are rendered
  onToggleExpand,
  onToggleShowMembers,
  // Phase 10a — preserved
  isGlobalSuperAdmin,
  onLoginAsDeptAdmin,
  // Phase 4 — drop-target plumbing preserved
  isDropTarget, onDragOver, onDragLeave, onDrop,
}) {
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

  const borderColor = isDropTarget ? accent : (highlight ? accent : 'var(--border)');
  const shadow = isDropTarget
    ? `0 0 0 4px ${accent}55, 0 4px 12px ${accent}33`
    : (highlight ? `0 0 0 3px ${accent}33` : '0 1px 3px rgba(0,0,0,0.05)');
  const kindLabel = node.kind === 'department' ? 'Dept' : 'Team';
  const memberCount = stats?.descendantMembers ?? (node.memberCount || 0);
  const directTeams = stats?.directTeams ?? 0;
  const leadName = lead?.name || (node.leadEmail ? node.leadEmail.split('@')[0] : null);
  const leadInitials = lead?.initials || (leadName ? leadName.slice(0, 2).toUpperCase() : '?');

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
        padding: '10px 14px 8px',
        display: 'flex', flexDirection: 'column',
        cursor: 'pointer',
        transition: 'border-color .12s, box-shadow .12s, transform .12s, background .12s',
        overflow: 'hidden',
      }}
      onClick={() => onSelect?.(node)}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header row: icon + name + kind chip */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
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
            fontSize: 'var(--font-md)', fontWeight: 700,
            color: 'var(--text)', lineHeight: 1.2,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>{node.name}</div>
        </div>
        <span style={{
          padding: '2px 8px',
          borderRadius: 'var(--radius-pill)',
          background: node.kind === 'department' ? `${accent}22` : 'var(--surface-3)',
          color: node.kind === 'department' ? accent : 'var(--text-secondary)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}>{kindLabel}</span>
      </div>

      {/* Lead row — embedded inline; the lead is the team's identity */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px',
        background: 'var(--surface-2)',
        borderRadius: 8,
        marginBottom: 6,
        minHeight: 32,
      }}>
        {lead ? (
          <Avatar size={22} name={lead.name} initials={leadInitials} src={lead.avatarUrl} />
        ) : (
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: 'var(--surface-3)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: 'var(--text-muted)', flexShrink: 0,
          }}>?</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 'var(--font-xs)', color: 'var(--text-muted)',
            lineHeight: 1, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
          }}>Lead</div>
          <div style={{
            fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text)',
            lineHeight: 1.2, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{leadName || 'Unassigned'}</div>
        </div>
      </div>

      {/* Stats row — counts + country flags */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 'var(--font-xs)', color: 'var(--text-secondary)',
        marginBottom: 6,
      }}>
        {directTeams > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
            <i className="bi bi-diagram-3" style={{ fontSize: 10 }} />
            {directTeams} {directTeams === 1 ? 'team' : 'teams'}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}
          title={`${memberCount} member${memberCount === 1 ? '' : 's'} in subtree`}>
          <i className="bi bi-person-fill" style={{ fontSize: 10 }} />
          {memberCount}
        </span>
        {(node.countryCodes || []).length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
            {(node.countryCodes || []).slice(0, 3).map(c => (
              <span key={c} style={{ fontSize: 11 }} title={c}>{flagFor(c)}</span>
            ))}
            {(node.countryCodes || []).length > 3 && (
              <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>+{node.countryCodes.length - 3}</span>
            )}
          </span>
        )}
      </div>

      {/* Actions row — expand / show-members / login / ... */}
      <div style={{
        marginTop: 'auto',
        display: 'flex', alignItems: 'center', gap: 6,
      }} onClick={e => e.stopPropagation()}>
        {canToggleExpand && (
          <button
            type="button" data-org-control
            onClick={onToggleExpand}
            aria-pressed={isExpanded}
            aria-label={isExpanded ? 'Collapse sub-teams' : 'Expand sub-teams'}
            style={pillBtnStyle(isExpanded ? accent : 'var(--text-secondary)', isExpanded ? `${accent}22` : 'var(--surface-2)', isExpanded ? accent : 'var(--border)')}
          >
            <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ fontSize: 9 }} />
            {isExpanded ? 'Hide' : 'Expand'}
          </button>
        )}
        {memberCount > 0 && (
          <button
            type="button" data-org-control
            onClick={onToggleShowMembers}
            aria-pressed={isShowingMembers}
            aria-label={isShowingMembers ? 'Hide team members' : 'Show team members'}
            style={pillBtnStyle(isShowingMembers ? accent : 'var(--text-secondary)', isShowingMembers ? `${accent}22` : 'var(--surface-2)', isShowingMembers ? accent : 'var(--border)')}
          >
            <i className={`bi ${isShowingMembers ? 'bi-eye-slash' : 'bi-eye'}`} style={{ fontSize: 9 }} />
            {isShowingMembers ? 'Hide members' : 'Show members'}
          </button>
        )}
        {/* Phase 10a Login-as-admin — top-level departments only, super-admin only */}
        {isGlobalSuperAdmin
          && node.kind === 'department'
          && !node.parentId
          && node.leadEmail && (
          <button
            type="button" data-org-control
            onClick={() => onLoginAsDeptAdmin?.(node.leadEmail)}
            aria-label={`Login as ${node.leadEmail}`}
            title={`Login as ${node.leadEmail.split('@')[0]} (${node.name} admin)`}
            style={pillBtnStyle('var(--purple)', 'var(--purple-light)', 'var(--purple)')}
          >
            <i className="bi bi-box-arrow-in-right" style={{ fontSize: 9 }} />
            Login
          </button>
        )}
        {canEdit && (
          <div ref={menuRef} style={{ marginLeft: 'auto', position: 'relative' }}>
            <button
              type="button"
              aria-label="Actions"
              onClick={() => setMenuOpen(p => !p)}
              style={{
                width: 24, height: 24,
                background: menuOpen ? 'var(--surface-3)' : 'transparent',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                color: 'var(--text-secondary)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={e => { if (!menuOpen) e.currentTarget.style.background = 'transparent'; }}
            >
              <i className="bi bi-three-dots" style={{ fontSize: 11 }} />
            </button>
            {menuOpen && (
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

// Reusable pill button style used by the per-card action buttons. The
// `color` argument is the accent / text colour; `bg` + `border` adjust
// independently so the active/inactive variants share one factory.
function pillBtnStyle(color, bg, border) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 9px', height: 22,
    background: bg,
    color,
    border: `1px solid ${border}`,
    borderRadius: 'var(--radius-pill)',
    fontSize: 10, fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'background .12s, color .12s, border-color .12s',
    whiteSpace: 'nowrap',
  };
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
