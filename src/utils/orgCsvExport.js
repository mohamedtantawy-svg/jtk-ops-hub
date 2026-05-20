// ── orgCsvExport (Phase 7, 2026-05-20) ─────────────────────────────────────
// CSV export utilities for the Org tab. Two products:
//
//   • Org structure CSV — one row per node with depth + path columns so an
//     admin can drop the file into a spreadsheet and immediately read the
//     hierarchy.
//   • Members CSV — one row per member with the resolved node path,
//     manager, role, region, etc.
//
// Pure functions; the caller takes care of the actual download (anchor
// click + revokeObjectURL).

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

function nodePath(nodeId, byId) {
  const out = [];
  let cur = byId.get(nodeId);
  let safety = 0;
  while (cur && safety < 16) {
    out.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
    safety += 1;
  }
  return out.join(' › ');
}

function nodeDepth(nodeId, byId) {
  let d = 0;
  let cur = byId.get(nodeId);
  while (cur && d < 32) {
    cur = cur.parentId ? byId.get(cur.parentId) : null;
    if (cur) d += 1;
  }
  return d;
}

/**
 * Build a CSV string for the full structure.
 */
export function buildStructureCsv(nodes, tree) {
  const header = ['id', 'parent_id', 'kind', 'depth', 'path', 'name', 'slug', 'lead_email', 'country_codes', 'slack_channel', 'member_count', 'vacant_count', 'is_archived', 'created_at', 'updated_at'];
  const lines = [csvRow(header)];
  for (const n of nodes) {
    lines.push(csvRow([
      n.id,
      n.parentId || '',
      n.kind,
      nodeDepth(n.id, tree.byId),
      nodePath(n.id, tree.byId),
      n.name,
      n.slug,
      n.leadEmail || '',
      (n.countryCodes || []).join('|'),
      n.slackChannel || '',
      n.memberCount || 0,
      n.vacantCount || 0,
      n.isArchived ? 'true' : 'false',
      n.createdAt || '',
      n.updatedAt || '',
    ]));
  }
  return lines.join('\n');
}

/**
 * Build a CSV string for the merged member roster, with org-node paths.
 */
export function buildMembersCsv(members, tree) {
  const header = ['email', 'name', 'title', 'access', 'manager_email', 'service', 'team', 'region', 'country', 'org_node_id', 'org_path', 'on_leave', 'is_announcements_admin', 'is_access_admin', 'last_seen_at'];
  const lines = [csvRow(header)];
  for (const m of members) {
    lines.push(csvRow([
      m.email,
      m.name,
      m.title || '',
      m.access || '',
      m.managerEmail || '',
      m.service || '',
      m.team || '',
      m.region || '',
      m.country || '',
      m.orgNodeId || '',
      m.orgNodeId ? nodePath(m.orgNodeId, tree.byId) : '',
      m.onLeave ? 'true' : 'false',
      m.isAnnouncementsAdmin ? 'true' : 'false',
      m.isAccessAdmin ? 'true' : 'false',
      m.lastSeenAt || '',
    ]));
  }
  return lines.join('\n');
}

/**
 * Trigger a CSV file download from a string.
 */
export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
