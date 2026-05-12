// ── Workspace queue scoping ─────────────────────────────────────────────────
// Decides which tickets a user sees in their workspace queue based on role.
//
// Per user requirement (2026-05-12):
//   • admin   → sees all tickets in the workspace's Zendesk group
//   • manager → sees tickets assigned to anyone who reports to them
//               (direct reports + their descendants, via roster manager_email)
//   • agent   → sees only tickets assigned to themselves
//
// "Manager" is derived from the workspace's roster file
// (src/workspaces/<team>/data/allowlist.js — ROSTER object keyed by email,
// value = manager_email). Anyone with at least one direct report is treated
// as a manager. This avoids hard-coding a separate manager list — the team
// hierarchy IS the source of truth.

import { query } from './db';

// Build the subtree of direct + indirect reports for a given manager email,
// from a roster object {email: managerEmail|null}. Returns lowercase email
// strings in the subtree (excluding the manager themselves).
function buildReportsSubtree(rosterObj, managerEmail) {
  const me = String(managerEmail || '').trim().toLowerCase();
  if (!me) return [];
  // Build reverse map: managerEmail -> [reports]
  const reportsByManager = {};
  for (const [email, mgr] of Object.entries(rosterObj || {})) {
    if (!mgr) continue;
    const k = String(mgr).toLowerCase();
    if (!reportsByManager[k]) reportsByManager[k] = [];
    reportsByManager[k].push(String(email).toLowerCase());
  }
  // BFS
  const subtree = new Set();
  const queue = [...(reportsByManager[me] || [])];
  while (queue.length) {
    const e = queue.shift();
    if (subtree.has(e)) continue;
    subtree.add(e);
    for (const child of (reportsByManager[e] || [])) {
      if (!subtree.has(child)) queue.push(child);
    }
  }
  return [...subtree];
}

// Resolve role for a user in a workspace:
//   • 'admin' if workspace_members row has role='admin'
//   • 'manager' if their email has at least one direct report in the roster
//   • 'agent' otherwise
//
// The DB query is fast (indexed); the roster check is in-memory. Returns
// { role, reports } where `reports` is the email subtree (only populated
// for managers — admins don't need it; agents see only their own assigned).
export async function resolveWorkspaceUserRole(workspaceId, email, rosterObj) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !workspaceId) return { role: 'agent', reports: [] };

  // DB-driven admin check (live, reflects admin UI changes)
  let isAdmin = false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM workspace_members
        WHERE workspace_id = $1 AND LOWER(email) = $2
          AND status = 'active' AND role = 'admin'
        LIMIT 1`,
      [workspaceId, e],
    );
    isAdmin = rows.length > 0;
  } catch (err) {
    // DB unreachable — fall back to file-based admin check via the caller.
    // This function still returns; caller decides whether to surface a 500.
    console.warn(`[workspace-scope] admin check failed for ${workspaceId}/${e}:`, err.message);
  }
  if (isAdmin) return { role: 'admin', reports: [] };

  const reports = buildReportsSubtree(rosterObj, e);
  if (reports.length > 0) return { role: 'manager', reports };

  return { role: 'agent', reports: [] };
}

// Filter a Zendesk ticket list down to what the user should see, based on
// their resolved role. Tickets are the raw shape from the Zendesk Search
// API — what matters is `assignee_id` resolved to email via the userMap.
//
//   admin   → keep all
//   manager → keep tickets where assignee's email is in `reports` OR is the manager themselves
//   agent   → keep tickets where assignee's email matches `email`
export function filterTicketsByRole({ tickets, userMap, role, email, reports }) {
  if (!Array.isArray(tickets) || !tickets.length) return [];
  if (role === 'admin') return tickets;

  const me = String(email || '').trim().toLowerCase();
  const visibleSet = new Set();
  if (role === 'manager') {
    visibleSet.add(me);
    for (const r of (reports || [])) visibleSet.add(String(r).toLowerCase());
  } else {
    visibleSet.add(me);
  }
  return tickets.filter(t => {
    if (!t.assignee_id) return false;
    const u = userMap?.[t.assignee_id];
    const assigneeEmail = String(u?.email || '').toLowerCase();
    return visibleSet.has(assigneeEmail);
  });
}
