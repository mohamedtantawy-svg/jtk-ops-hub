// ── orgChartLayout (Phase 2, 2026-05-20) ──────────────────────────────────
// Pure-function layout pass for the visual org chart. Given the parent →
// children index from useOrgNodes plus the list of members (with their
// orgNodeId), produces a flat array of positioned items the canvas can
// render in any order — alongside the bounding box, so the parent
// component can fit-to-screen.
//
// Layout strategy: tidy-tree, single pass.
//   • Bottom-up width compute: each node's subtree-width is the sum of
//     its children's widths plus inter-sibling gaps, or its own card
//     width when it has no visible children.
//   • Top-down position pass: each node is placed centred over its
//     children. Vertical position is depth × ROW_HEIGHT.
//   • Member cards collapse into a stacked "+ N more" if a node hosts
//     too many to render individually (cap = 6 visible at the lowest
//     visible depth).
//
// The chart is non-interactive in the layout layer; the canvas binds
// click + drag + zoom on top of the positioned items.

export const CARD_W = 188;
export const CARD_H = 104;
export const MEMBER_W = 168;
export const MEMBER_H = 84;
export const COL_GAP = 24;
export const ROW_GAP = 56;
export const ROW_HEIGHT = CARD_H + ROW_GAP;
export const MEMBER_ROW_HEIGHT = MEMBER_H + 12;
export const PADDING = 48;
export const MAX_INLINE_MEMBERS = 6;

function widthOf(item) {
  return item.kind === 'member' ? MEMBER_W : CARD_W;
}

// Recursively compute the rendered subtree of a node — including a flat
// list of member items the chart shows under leaf teams. Returns an
// object with { id, kind, x?, y?, width, children: [], data }.
function buildSubtree(nodeId, ctx, depth) {
  const node = ctx.tree.byId.get(nodeId);
  if (!node) return null;
  if (node.isArchived) return null;

  const kids = (ctx.tree.byParent.get(nodeId) || []).filter(k => !k.isArchived);
  const items = kids
    .map(k => buildSubtree(k.id, ctx, depth + 1))
    .filter(Boolean);

  // Leaf nodes attach their direct members (and any descendants' members
  // when the node has no child nodes — bubbling up the member list keeps
  // the chart from feeling empty when a team has no sub-teams).
  if (items.length === 0) {
    const members = ctx.membersByNode.get(nodeId) || [];
    if (members.length > 0) {
      const visible = members.slice(0, MAX_INLINE_MEMBERS);
      const extra = members.length - visible.length;
      for (let i = 0; i < visible.length; i += 1) {
        items.push({
          id: `m:${visible[i].email}`,
          kind: 'member',
          width: MEMBER_W,
          height: MEMBER_H,
          depth: depth + 1,
          parentId: nodeId,
          children: [],
          data: visible[i],
        });
      }
      if (extra > 0) {
        items.push({
          id: `m-more:${nodeId}`,
          kind: 'member-more',
          width: MEMBER_W,
          height: MEMBER_H,
          depth: depth + 1,
          parentId: nodeId,
          children: [],
          data: { count: extra, nodeId },
        });
      }
    }
  }

  const ownWidth = widthOf({ kind: node.kind });
  const childrenWidth = items.reduce((sum, c, i) => sum + c.width + (i > 0 ? COL_GAP : 0), 0);
  const width = Math.max(ownWidth, childrenWidth);

  return {
    id: node.id,
    kind: 'node',
    width,
    height: CARD_H,
    depth,
    parentId: node.parentId,
    children: items,
    data: node,
  };
}

// Top-down placement once subtree widths are known.
function place(item, x, y, out) {
  const centre = x + item.width / 2;
  const placedX = centre - widthOf({ kind: item.kind === 'node' ? 'node' : item.kind }) / 2;
  const placedY = y;
  out.push({
    id: item.id,
    kind: item.kind,
    x: placedX,
    y: placedY,
    width: item.kind === 'node' ? CARD_W : MEMBER_W,
    height: item.kind === 'node' ? CARD_H : MEMBER_H,
    depth: item.depth,
    parentId: item.parentId,
    data: item.data,
  });
  let cursor = x;
  for (const c of item.children) {
    place(c, cursor, y + ROW_HEIGHT, out);
    cursor += c.width + COL_GAP;
  }
}

/**
 * Build the layout for a forest of root nodes.
 * @param {Object} args
 *   tree         — { byId, byParent } from useOrgNodes
 *   rootNodes    — array of root org_nodes
 *   members      — flat array of merged members (with `orgNodeId` per the
 *                  Phase 0 schema). Members whose org_node_id is null are
 *                  ignored — Phase 3's allocation modal moves them onto
 *                  the tree.
 * @returns       — { items, width, height }
 */
export function layoutOrgChart({ tree, rootNodes, members }) {
  const membersByNode = new Map();
  for (const m of members || []) {
    if (!m.orgNodeId) continue;
    if (!membersByNode.has(m.orgNodeId)) membersByNode.set(m.orgNodeId, []);
    membersByNode.get(m.orgNodeId).push(m);
  }
  // Stable order — alphabetical by name so the chart doesn't shuffle on
  // every fetch.
  for (const list of membersByNode.values()) {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  const ctx = { tree, membersByNode };
  const subtrees = (rootNodes || [])
    .filter(n => !n.isArchived)
    .map(n => buildSubtree(n.id, ctx, 0))
    .filter(Boolean);

  const out = [];
  let cursor = PADDING;
  let maxDepthHeight = 0;
  for (const root of subtrees) {
    place(root, cursor, PADDING, out);
    cursor += root.width + COL_GAP * 2;
    // Approximate height using deepest leaf — actual depth resolved below
    // when we measure positioned items.
    const depths = [];
    (function walk(it) { depths.push(it.depth); for (const c of it.children) walk(c); })(root);
    const dh = (Math.max(...depths, 0) + 1) * ROW_HEIGHT;
    if (dh > maxDepthHeight) maxDepthHeight = dh;
  }

  const width = Math.max(cursor + PADDING - COL_GAP * 2, 600);
  const height = maxDepthHeight + PADDING * 2;

  return { items: out, width, height };
}
