// ── useOrgNodes (Phase 1, 2026-05-20) ──────────────────────────────────────
// Fetches the org tree from /api/v1/org/nodes, caches it in localStorage so
// the first paint is instant, and exposes mutation helpers (create / patch /
// archive / move / reorder). After each mutation the local state is updated
// optimistically and reconciled with the server response, mirroring the
// pattern in useTeamMembers and useAnnouncements.
//
// All callers receive a flat `nodes` array plus a derived `tree` (parent →
// children index keyed by node id, null parent = roots) so the UI can render
// either shape without re-walking the array.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listOrgNodes,
  createOrgNode,
  patchOrgNode,
  archiveOrgNode,
  moveOrgNode,
  reorderOrgNode,
} from '../services/orgApi';

const CACHE_KEY = 'ops_hub_org_nodes_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.ts || 0) > CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, ts: Date.now() }));
  } catch {}
}

function buildTree(nodes) {
  const byParent = new Map();
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  for (const n of nodes) {
    const key = n.parentId || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  // Stable sort: sortOrder ascending, then name ascending.
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) {
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      }
      return a.name.localeCompare(b.name);
    });
  }
  return { byParent, byId };
}

export function useOrgNodes() {
  const cached = readCache();
  const [nodes, setNodes] = useState(() => cached?.nodes || []);
  const [editPowers, setEditPowers] = useState(() => cached?.editPowers || { canManageGlobal: false });
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      const res = await listOrgNodes();
      setNodes(res.nodes || []);
      setEditPowers(res.editPowers || { canManageGlobal: false });
      writeCache({ nodes: res.nodes || [], editPowers: res.editPowers });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // No interval — the FE explicitly reloads after every mutation. Long-
    // poll / SSE wiring lands once we need multi-admin live collaboration.
  }, [reload, version]);

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // ── Recursive headcount helper. Walks every descendant under a node and
  //    sums their memberCount + vacantCount (vacancy inclusion can be
  //    toggled by the caller). Cheap enough at hundreds of nodes; if the
  //    org grows past ~5k we'll memoise per-id.
  const sumDescendants = useCallback((rootId, { includeVacancies = true } = {}) => {
    const start = tree.byId.get(rootId);
    if (!start) return { members: 0, vacancies: 0 };
    let members = start.memberCount || 0;
    let vacancies = start.vacantCount || 0;
    const stack = (tree.byParent.get(rootId) || []).slice();
    while (stack.length) {
      const cur = stack.pop();
      members += cur.memberCount || 0;
      vacancies += cur.vacantCount || 0;
      const kids = tree.byParent.get(cur.id);
      if (kids) stack.push(...kids);
    }
    return { members, vacancies: includeVacancies ? vacancies : 0 };
  }, [tree]);

  const rootNodes = useMemo(() => tree.byParent.get('__root__') || [], [tree]);

  // ── Mutations: each one reloads on success. We don't optimistic-update
  //    individual fields because the server may rewrite sort_order on
  //    create/move and uniqueness validation can fail; a roundtrip-then-
  //    reload keeps the FE state honest.
  const createNode = useCallback(async (payload) => {
    const res = await createOrgNode(payload);
    setVersion(v => v + 1);
    return res.node;
  }, []);
  const updateNode = useCallback(async (id, patch) => {
    const res = await patchOrgNode(id, patch);
    setVersion(v => v + 1);
    return res.node;
  }, []);
  const archiveNode = useCallback(async (id) => {
    const res = await archiveOrgNode(id);
    setVersion(v => v + 1);
    return res.node;
  }, []);
  const moveNode = useCallback(async (id, parentId) => {
    const res = await moveOrgNode(id, { parentId });
    setVersion(v => v + 1);
    return res.node;
  }, []);
  const reorderNode = useCallback(async (id, newSortOrder) => {
    const res = await reorderOrgNode(id, newSortOrder);
    setVersion(v => v + 1);
    return res.node;
  }, []);

  return {
    nodes,
    rootNodes,
    tree,
    loading,
    error,
    editPowers,
    canEdit: editPowers.canManageGlobal === true,
    reload,
    sumDescendants,
    createNode,
    updateNode,
    archiveNode,
    moveNode,
    reorderNode,
  };
}
