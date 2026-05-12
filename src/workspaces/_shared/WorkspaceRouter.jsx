'use client';

import { lazy, Suspense, useState, useEffect } from 'react';

import {
  detectWorkspace,
  WORKSPACE_IDS,
  getWorkspace,
  userHasAccess,
  SELECTED_WORKSPACE_KEY,
} from './workspaceRegistry';
import WorkspacePicker from './WorkspacePicker';
import { fetchMemberships } from './membersApi';

// Top-level decision-maker. Authoritative for which workspace mounts.
//
// 1. Unauthenticated → WorkspacePicker (URL param does NOT bypass auth).
// 2. Authenticated + HR resolved → mount HR App.jsx (no membership check;
//    HR is open to all @deel.com via SSO).
// 3. Authenticated + non-HR resolved → MembershipGate fetches the user's
//    DB-backed memberships (the workspace_members table) before rendering.
//    If the user is on the allowlist, the workspace mounts with their role
//    in context (so admin tabs can be conditionally shown). If not, the
//    picker re-renders with an access-denied banner.
//
// File-based `userHasAccess` is kept as a defensive bootstrap fallback for
// when the memberships endpoint is unreachable — without it, an API
// outage would lock every user out of every non-HR workspace.

const HrApp = lazy(() => import('../../App'));
const CommandCenterApp = lazy(() => import('../command-center/CommandCenterApp'));
const PayrollApp = lazy(() => import('../payroll/PayrollApp'));
const GIXApp = lazy(() => import('../gix/GIXApp'));

const MEMBERSHIPS_CACHE_KEY = 'ops_hub_workspace_memberships';
const MEMBERSHIPS_TTL_MS = 5 * 60 * 1000;

function loadingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #f5f5f7)',
      color: 'var(--text-muted, #6b6b6b)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 14,
    }}>
      Loading Ops Hub…
    </div>
  );
}

function readEmail() {
  try { return localStorage.getItem('ops_hub_logged_in_email') || null; } catch { return null; }
}
function readUrlWorkspaceParam() {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('workspace');
  } catch { return null; }
}
function readSelectedWorkspace() {
  try { return localStorage.getItem(SELECTED_WORKSPACE_KEY) || null; } catch { return null; }
}

function readCachedMemberships(email) {
  try {
    const raw = localStorage.getItem(MEMBERSHIPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.email !== email) return null;
    if (Date.now() - (parsed.ts || 0) > MEMBERSHIPS_TTL_MS) return null;
    return parsed.memberships || [];
  } catch { return null; }
}
function writeCachedMemberships(email, memberships) {
  try {
    localStorage.setItem(MEMBERSHIPS_CACHE_KEY, JSON.stringify({ email, memberships, ts: Date.now() }));
  } catch {}
}

function resolveRole(memberships, workspaceId) {
  if (!Array.isArray(memberships)) return null;
  const hit = memberships.find(m => m.workspaceId === workspaceId);
  return hit?.role || null;
}

// Gate that fetches memberships before rendering the workspace. Caches in
// localStorage with a short TTL so navigations within the session are fast.
function MembershipGate({ workspaceId, workspace, email, WorkspaceApp }) {
  const cached = readCachedMemberships(email);
  const [memberships, setMemberships] = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Always background-refresh, even if we have cache — gives the user the
    // freshest role on every nav without blocking render.
    fetchMemberships()
      .then(data => {
        if (cancelled) return;
        const list = data?.memberships || [];
        writeCachedMemberships(email, list);
        setMemberships(list);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        // If we already had cached data, keep using it. Only fail if we
        // have nothing.
        if (!cached) setError(err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [email, cached]);

  // While loading and no cache, show the loader.
  if (loading && !memberships) return loadingScreen();

  // Determine access:
  //   - Primary: DB memberships (what the user actually has now)
  //   - Fallback: file-based allowlist (defensive — covers API outage)
  const hasDbAccess = Array.isArray(memberships)
    && memberships.some(m => m.workspaceId === workspaceId);
  const hasFileAccess = userHasAccess(workspaceId, email);

  if (!hasDbAccess && !hasFileAccess) {
    return <WorkspacePicker accessDeniedFor={workspaceId} />;
  }

  // Role comes from DB if available; otherwise default to 'member' (file
  // allowlist doesn't carry role info).
  const role = resolveRole(memberships, workspaceId) || 'member';

  return (
    <Suspense fallback={loadingScreen()}>
      <WorkspaceApp email={email} workspace={workspace} role={role} />
    </Suspense>
  );
}

export default function WorkspaceRouter() {
  // Read localStorage + URL ONCE at mount (snapshot survives strict-mode
  // double-render in dev).
  const [snapshot] = useState(() => ({
    email: readEmail(),
    urlParam: readUrlWorkspaceParam(),
    selectedWorkspace: readSelectedWorkspace(),
  }));
  const { email, urlParam, selectedWorkspace } = snapshot;

  if (!email) {
    return <WorkspacePicker initialSelected={selectedWorkspace} />;
  }

  const workspaceId = detectWorkspace({ email, urlParam, selectedWorkspace });

  if (workspaceId === WORKSPACE_IDS.HR) {
    return <Suspense fallback={loadingScreen()}><HrApp /></Suspense>;
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return <Suspense fallback={loadingScreen()}><HrApp /></Suspense>;
  }

  let WorkspaceApp;
  switch (workspaceId) {
    case WORKSPACE_IDS.COMMAND_CENTER: WorkspaceApp = CommandCenterApp; break;
    case WORKSPACE_IDS.PAYROLL:        WorkspaceApp = PayrollApp;       break;
    case WORKSPACE_IDS.GIX:            WorkspaceApp = GIXApp;           break;
    default:                            WorkspaceApp = HrApp;
  }

  return (
    <MembershipGate
      workspaceId={workspaceId}
      workspace={workspace}
      email={email}
      WorkspaceApp={WorkspaceApp}
    />
  );
}
