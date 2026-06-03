// ── orgChartLayout (Phase 12a redesign — 2026-05-20) ──────────────────────
// Tidy-tree layout for the Org chart. Phase 12a's redesign moves the chart
// from "show every node + every member chip by default" to an expansion-
// controlled model that scales to 10+ depts × 50+ teams × 2500+ members:
//
//   • Default depth-2: every department + every team rendered. Sub-teams
//     and members are HIDDEN by default.
//   • One sub-team subtree open at a time (auto-collapse siblings). The
//     caller passes `expansion.expandedTeamId` — only that team's
//     sub-teams render in the chart.
//   • Members are opt-in per node via `expansion.showMembers` (Set of
//     node ids). A node with showMembers=true gets its direct member
//     chips appended under its card (capped at MAX_INLINE_MEMBERS with
//     a "+N more" tile for overflow).
//   • Leads are embedded INSIDE each node card (handled by NodeCard;
//     the layout just provides positions). No separate lead chip.
//
// The chart auto-fits zoom + pan to the visible item set; expansion
// changes naturally re-run the layout + re-fit.

export const CARD_W = 260;
export const CARD_H = 140;
export const MEMBER_W = 168;
export const MEMBER_H = 84;
export const COL_GAP = 28;
export const ROW_GAP = 64;
export const ROW_HEIGHT = CARD_H + ROW_GAP;
export const MEMBER_ROW_HEIGHT = MEMBER_H + 12;
export const PADDING = 48;
export const MAX_INLINE_MEMBERS = 8;

function widthOf(kind) {
  return kind === 'member' || kind === 'member-more' ? MEMBER_W : CARD_W;
}

function heightOf(kind) {
  return kind === 'member' || kind === 'member-more' ? MEMBER_H : CARD_H;
}

// Recursively build the visible subtree for a node, gating descent on
// the caller's expansion state. The shape returned is an intermediate
// tree (with subtree widths) that the position pass below converts to
// flat positioned items.
function buildSubtree(node, depth, ctx) {
  if (!node || node.isArchived) return null;
  const children = [];
  const kids = (ctx.tree.byParent.get(node.id) || []).filter(k => !k.isArchived);

  // Decide which children to descend into based on the node's kind +
  // the expansion state. The rules:
  //   • Department root  → always descend into its teams + sub-depts.
  //   • Team under dept  → only descend into its sub-teams when
  //                        expansion.expandedTeamId matches this node.
  //   • Sub-team         → descend further only if the deeper level is
  //                        also explicitly expanded (rare today; safe
  //                        default = collapsed).
  for (const kid of kids) {
    let descend = false;
    if (node.kind === 'department') {
      // Teams + sub-depts under a department: always visible by default.
      descend = true;
    } else if (node.kind === 'team') {
      // Sub-teams: only when their direct parent is the expanded team.
      if (ctx.expansion.expandedTeamId === node.id) descend = true;
      // Deeper-nested expansion (rare today, future-proofed).
      if (ctx.expansion.expandedSubTeamId === node.id) descend = true;
    }
    if (descend) {
      const sub = buildSubtree(kid, depth + 1, ctx);
      if (sub) children.push(sub);
    }
  }

  // Members of this specific node — only when explicitly toggled on.
  // Capped at MAX_INLINE_MEMBERS; overflow becomes a "+N more" tile that
  // opens the node's detail drawer.
  if (ctx.expansion.showMembers.has(node.id)) {
    const nodeMembers = (ctx.membersByNode.get(node.id) || []);
    const visible = nodeMembers.slice(0, MAX_INLINE_MEMBERS);
    const extra = nodeMembers.length - visible.length;
    for (const m of visible) {
      children.push({
        id: `m:${m.email}`,
        kind: 'member',
        width: MEMBER_W,
        height: MEMBER_H,
        depth: depth + 1,
        parentId: node.id,
        children: [],
        data: m,
      });
    }
    if (extra > 0) {
      children.push({
        id: `m-more:${node.id}`,
        kind: 'member-more',
        width: MEMBER_W,
        height: MEMBER_H,
        depth: depth + 1,
        parentId: node.id,
        children: [],
        data: { count: extra, nodeId: node.id },
      });
    }
  }

  const ownWidth = widthOf('node');
  const childrenWidth = children.reduce(
    (sum, c, i) => sum + c.width + (i > 0 ? COL_GAP : 0),
    0,
  );
  const width = Math.max(ownWidth, childrenWidth);

  return {
    id: node.id,
    kind: 'node',
    width,
    height: CARD_H,
    depth,
    parentId: node.parentId,
    children,
    data: node,
  };
}

// Top-down placement once subtree widths are known.
function place(item, x, y, out) {
  const centre = x + item.width / 2;
  const placedX = centre - widthOf(item.kind) / 2;
  out.push({
    id: item.id,
    kind: item.kind,
    x: placedX,
    y,
    width: widthOf(item.kind),
    height: heightOf(item.kind),
    depth: item.depth,
    parentId: item.parentId,
    data: item.data,
  });
  let cursor = x;
  const childRowHeight = item.children.some(c => c.kind !== 'member' && c.kind !== 'member-more')
    ? ROW_HEIGHT
    : MEMBER_ROW_HEIGHT;
  for (const c of item.children) {
    place(c, cursor, y + childRowHeight, out);
    cursor += c.width + COL_GAP;
  }
}

// Command Center is the executive department; it's identified by its stable
// slug. In the org chart it renders as the single super-root with every other
// department hanging off it. This is VISUAL ONLY — Command Center and every
// other department remain parent_id=NULL top-level nodes in the data, so
// dept-scope tenancy (which resolves a member's dept by walking parent_id up
// to the NULL root) is completely unchanged. 2026-06-03, Mohamed.
export function isCommandCenterNode(node) {
  return !!node && node.slug === 'command-center';
}

/**
 * Build the visible layout for a forest of root nodes.
 *
 * @param {Object} args
 *   tree         — { byId, byParent } from useOrgNodes
 *   rootNodes    — array of root (top-level dept) nodes
 *   members      — flat merged member list with `orgNodeId` set
 *   expansion    — controls which subtrees + which members render:
 *     {
 *       expandedTeamId:    string | null,
 *       expandedSubTeamId: string | null,
 *       showMembers:       Set<string>,
 *     }
 *
 * @returns { items, width, height } where items is the flat positioned set.
 */
export function layoutOrgChart({ tree, rootNodes, members, expansion }) {
  const exp = {
    expandedTeamId: expansion?.expandedTeamId || null,
    expandedSubTeamId: expansion?.expandedSubTeamId || null,
    showMembers: expansion?.showMembers || new Set(),
  };

  // Build member-by-node lookup. Sorted alphabetically so the chart
  // doesn't shuffle on every fetch.
  const membersByNode = new Map();
  for (const m of members || []) {
    if (!m.orgNodeId) continue;
    if (!membersByNode.has(m.orgNodeId)) membersByNode.set(m.orgNodeId, []);
    membersByNode.get(m.orgNodeId).push(m);
  }
  for (const list of membersByNode.values()) {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  const ctx = { tree, membersByNode, expansion: exp };
  const liveRoots = (rootNodes || []).filter(n => !n.isArchived);

  // Command Center renders as the executive super-root: one card on top with
  // every other department hanging off it (a connector line to each), the
  // same way a department sits above its teams. Visual only — see
  // isCommandCenterNode. Departments build one depth deeper and have their
  // connector re-pointed at the CC card; everything below them (teams,
  // sub-teams, members) keeps its real parent_id so those connectors are
  // unaffected.
  const ccRoot = liveRoots.find(isCommandCenterNode);
  let subtrees;
  if (ccRoot && liveRoots.length > 1) {
    const ccSubtree = buildSubtree(ccRoot, 0, ctx);
    const deptSubtrees = liveRoots
      .filter(n => n !== ccRoot)
      .map(n => buildSubtree(n, 1, ctx))
      .filter(Boolean)
      .map(st => ({ ...st, parentId: ccRoot.id }));
    ccSubtree.children = [...ccSubtree.children, ...deptSubtrees];
    ccSubtree.width = Math.max(
      CARD_W,
      ccSubtree.children.reduce((sum, c, i) => sum + c.width + (i > 0 ? COL_GAP : 0), 0),
    );
    subtrees = [ccSubtree];
  } else {
    subtrees = liveRoots.map(n => buildSubtree(n, 0, ctx)).filter(Boolean);
  }

  const out = [];
  let cursor = PADDING;
  let maxDepth = 0;
  for (const root of subtrees) {
    place(root, cursor, PADDING, out);
    cursor += root.width + COL_GAP * 2;
    const depths = [];
    (function walk(it) { depths.push(it.depth); for (const c of it.children) walk(c); })(root);
    maxDepth = Math.max(maxDepth, Math.max(...depths, 0));
  }

  const width = Math.max(cursor + PADDING - COL_GAP * 2, 600);
  const height = (maxDepth + 1) * ROW_HEIGHT + PADDING * 2;

  return { items: out, width, height };
}

// ── People org chart (2026-06-02) ──────────────────────────────────────────
// A pure manager → reports hierarchy of MEMBERS, rendered with the same
// canvas (pan/zoom/connectors) but ONLY member cards — no department/team
// structure cards. This is the "People" half of the Chart toggle Mohamed
// asked for: the structure chart (layoutOrgChart) and the people chart never
// mix, so the awkward "team card with member cards crammed underneath" view
// is gone.
//
// Hierarchy = managerEmail → reports, with an org-STRUCTURE fallback so the
// chart matches the structure view (Command Center on top, departments under
// it). Many ICs have no explicit managerEmail (seeded rosters), which used to
// dump them as detached top-level roots — the "weird" floating cards Mohamed
// flagged 2026-06-03. Resolution order for each member's parent:
//   1. managerEmail, when it resolves to someone in the set.
//   2. else their top-level department's lead (orphan IC → dept director).
//   3. else the Command Center lead (dept leads + anyone unplaced → apex).
// Only the CC lead (or, with no CC node, each dept lead) ends up a true root.
// Depth-0 always shows direct reports; deeper levels are opt-in via
// `expansion.peopleExpanded` so a 170-person org isn't dumped at once.
export function layoutPeopleChart({ members, expansion, tree, rootNodes }) {
  const expanded = expansion?.peopleExpanded || null;   // Set<emailLc> | null

  const byEmail = new Map();
  for (const m of members || []) {
    if (m?.email) byEmail.set(String(m.email).toLowerCase(), m);
  }

  // Command Center lead = the apex everyone ultimately rolls up to. Walk
  // org_nodes parent_id up to the top-level department for any node id so an
  // orphan can be attached under their department's lead.
  const byId = tree?.byId || null;
  const ccNode = (rootNodes || []).find(n => n && !n.isArchived && isCommandCenterNode(n));
  const ccLeadLc = ccNode?.leadEmail ? String(ccNode.leadEmail).toLowerCase() : null;
  const topDeptCache = new Map();
  const topDeptForNodeId = (nodeId) => {
    if (!byId || !nodeId) return null;
    if (topDeptCache.has(nodeId)) return topDeptCache.get(nodeId);
    let cur = byId.get(nodeId);
    let guard = 0;
    while (cur && cur.parentId && guard++ < 100) cur = byId.get(cur.parentId);
    topDeptCache.set(nodeId, cur || null);
    return cur || null;
  };
  // Structural fallback parent for a member with no usable managerEmail.
  // Always points "up" (dept lead → CC lead → root), so it can't create a
  // new cycle; build()'s seen-guard still backstops bad managerEmail data.
  const fallbackParentFor = (m) => {
    const selfLc = String(m.email).toLowerCase();
    const dept = m.orgNodeId ? topDeptForNodeId(m.orgNodeId) : null;
    if (dept && !isCommandCenterNode(dept) && dept.leadEmail) {
      const deptLeadLc = String(dept.leadEmail).toLowerCase();
      if (deptLeadLc !== selfLc && byEmail.has(deptLeadLc)) return deptLeadLc;
    }
    if (ccLeadLc && ccLeadLc !== selfLc && byEmail.has(ccLeadLc)) return ccLeadLc;
    return null;
  };

  // Group reports under their resolved parent (manager, else structural
  // fallback). Only members with no resolvable parent become __root__.
  const byManager = new Map();
  for (const m of members || []) {
    if (!m?.email) continue;
    const self = String(m.email).toLowerCase();
    const mgr = String(m.managerEmail || '').toLowerCase();
    const key = (mgr && mgr !== self && byEmail.has(mgr))
      ? mgr
      : (fallbackParentFor(m) || '__root__');
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key).push(m);
  }
  for (const list of byManager.values()) {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  const roots = byManager.get('__root__') || [];

  // depth 0 always expanded so the first paint shows top leaders + their
  // direct reports; deeper nodes follow the explicit expansion set.
  const isOpen = (emailLc, depth) =>
    depth === 0 ? true : (expanded ? expanded.has(emailLc) : false);

  // parentEmailLc is the ACTUAL tree parent (manager OR structural fallback),
  // threaded down from the caller — NOT m.managerEmail, which is wrong for any
  // member attached via the fallback. The connector pass keys off this id.
  function build(m, depth, seen, parentEmailLc) {
    const emailLc = String(m.email).toLowerCase();
    const reports = byManager.get(emailLc) || [];
    // Cycle guard — bad managerEmail data (A→B→A) must not infinite-loop.
    const cyclic = seen.has(emailLc);
    const open = !cyclic && reports.length > 0 && isOpen(emailLc, depth);
    const nextSeen = cyclic ? seen : new Set(seen).add(emailLc);
    const children = open ? reports.map(r => build(r, depth + 1, nextSeen, emailLc)) : [];
    const childrenWidth = children.reduce((s, c, i) => s + c.width + (i > 0 ? COL_GAP : 0), 0);
    return {
      id: `p:${emailLc}`,
      kind: 'member',
      width: Math.max(MEMBER_W, childrenWidth),
      height: MEMBER_H,
      depth,
      parentId: parentEmailLc ? `p:${parentEmailLc}` : null,
      children,
      // _reportCount + _expanded drive the card's expand chevron in people
      // mode; _people flags the card so MemberCard renders the chevron only
      // here (not for structure-mode inline member chips).
      data: { ...m, _reportCount: reports.length, _expanded: open, _people: true },
    };
  }

  const subtrees = roots.map(r => build(r, 0, new Set(), null));
  const out = [];
  let cursor = PADDING;
  let maxDepth = 0;
  for (const root of subtrees) {
    place(root, cursor, PADDING, out);
    cursor += root.width + COL_GAP * 2;
    (function walk(it) { maxDepth = Math.max(maxDepth, it.depth); for (const c of it.children) walk(c); })(root);
  }

  const width = Math.max(cursor + PADDING - COL_GAP * 2, 600);
  const height = (maxDepth + 1) * MEMBER_ROW_HEIGHT + PADDING * 2;
  return { items: out, width, height };
}
