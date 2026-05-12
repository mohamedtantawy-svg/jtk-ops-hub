// DELETE /api/v1/workspaces/[workspaceId]/members/[email]
//   Remove a member (soft-delete; sets status='removed' for audit).
// PATCH  /api/v1/workspaces/[workspaceId]/members/[email]
//   Update a member's role. Body: { role: 'admin' | 'member' }
//
// Admin only. Prevents removing/demoting the last admin so no workspace is
// orphaned.

import { NextResponse } from 'next/server';

import { getAuthUser } from '../../../../../../../src/lib/auth-helpers';
import {
  removeMember,
  updateRole,
  isWorkspaceAdmin,
  countAdmins,
} from '../../../../../../../src/lib/workspace-members';

async function requireAdmin(req, workspaceId) {
  const user = getAuthUser(req);
  if (!user?.email) return { ok: false, status: 401, error: 'Unauthorized' };
  try {
    const admin = await isWorkspaceAdmin(workspaceId, user.email);
    if (!admin) return { ok: false, status: 403, error: 'Workspace admin required' };
    return { ok: true, user };
  } catch (err) {
    if (err.code === 'INVALID_WORKSPACE') return { ok: false, status: 404, error: 'Workspace not found' };
    throw err;
  }
}

export async function DELETE(req, ctx) {
  const { workspaceId, email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail || '').trim().toLowerCase();
  const gate = await requireAdmin(req, workspaceId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    // Last-admin guard: if the target is the only admin, refuse. (Demote
    // another member first, then remove.)
    const isTargetAdmin = await isWorkspaceAdmin(workspaceId, email);
    if (isTargetAdmin) {
      const total = await countAdmins(workspaceId);
      if (total <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin. Promote another member first.' },
          { status: 409 },
        );
      }
    }
    const removed = await removeMember(workspaceId, email, gate.user.email);
    if (!removed) return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[workspace-members:remove]', err);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  const { workspaceId, email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail || '').trim().toLowerCase();
  const gate = await requireAdmin(req, workspaceId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body; try { body = await req.json(); } catch { body = {}; }
  const role = body.role === 'admin' ? 'admin' : 'member';

  try {
    // Last-admin guard for demote: don't demote the only admin.
    if (role === 'member') {
      const isCurrentlyAdmin = await isWorkspaceAdmin(workspaceId, email);
      if (isCurrentlyAdmin) {
        const total = await countAdmins(workspaceId);
        if (total <= 1) {
          return NextResponse.json(
            { error: 'Cannot demote the last admin. Promote another member first.' },
            { status: 409 },
          );
        }
      }
    }
    const updated = await updateRole(workspaceId, email, role);
    if (!updated) return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    return NextResponse.json({ member: updated });
  } catch (err) {
    if (err.code === 'BAD_INPUT') return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[workspace-members:patch]', err);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}
