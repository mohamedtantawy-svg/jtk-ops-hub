// GET  /api/v1/workspaces/[workspaceId]/members
//   List members for a workspace (admin only). Supports ?search=&limit=&offset=.
// POST /api/v1/workspaces/[workspaceId]/members
//   Add a member (admin only). Body: { email, role }
//
// Auth: any authenticated session. Authorization: the caller must be an
// active admin in the requested workspace. HR Hub is NOT a valid workspace
// here.

import { NextResponse } from 'next/server';

import { getAuthUser } from '../../../../../../src/lib/auth-helpers';
import {
  listMembers,
  addMember,
  isWorkspaceAdmin,
} from '../../../../../../src/lib/workspace-members';

async function requireAdmin(req, workspaceId) {
  const user = getAuthUser(req);
  if (!user?.email) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  try {
    const admin = await isWorkspaceAdmin(workspaceId, user.email);
    if (!admin) {
      return { ok: false, status: 403, error: 'Workspace admin required' };
    }
    return { ok: true, user };
  } catch (err) {
    if (err.code === 'INVALID_WORKSPACE') {
      return { ok: false, status: 404, error: 'Workspace not found' };
    }
    throw err;
  }
}

export async function GET(req, ctx) {
  const { workspaceId } = await ctx.params;
  const gate = await requireAdmin(req, workspaceId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(req.url);
  try {
    const data = await listMembers(workspaceId, {
      search: url.searchParams.get('search') || '',
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[workspace-members:list]', err);
    return NextResponse.json({ error: 'Failed to list members' }, { status: 500 });
  }
}

export async function POST(req, ctx) {
  const { workspaceId } = await ctx.params;
  const gate = await requireAdmin(req, workspaceId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = String(body.email || '').trim();
  const role = body.role === 'admin' ? 'admin' : 'member';
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  try {
    const member = await addMember(workspaceId, email, role, gate.user.email);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    if (err.code === 'BAD_INPUT') {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace-members:add]', err);
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 });
  }
}
