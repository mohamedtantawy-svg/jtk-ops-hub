// ── GET /api/v1/hide-task/list ─────────────────────────────────────────────
// Returns every currently-hidden task (one row per (task_source, task_id)).
// Read-only; no scoping — the hide list is GLOBAL. The FE wraps this in
// useHiddenTasks which exposes a Set<`${source}:${id}`> the queue render
// path checks against.
//
// Cached for 30s server-side because the list is small (manual approvals
// only) and every queue mount calls it. Cross-tab adoption on the FE keeps
// the cost negligible even with multiple sessions per user.
import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';
import { listActiveHidden } from '../../../../../src/lib/hide-task-helpers';
import { cacheGet, cacheSet } from '../../../../../src/lib/server-cache';

const CACHE_KEY = 'hidden_task_list';
const CACHE_TTL = 30_000;

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cached = cacheGet(CACHE_KEY, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  const items = await listActiveHidden({ limit: 5000 });
  const payload = { items, total: items.length };
  cacheSet(CACHE_KEY, payload);
  return NextResponse.json(payload);
}
