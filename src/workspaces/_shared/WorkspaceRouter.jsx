'use client';

import { lazy, Suspense, useState } from 'react';

import {
  detectWorkspace,
  WORKSPACE_IDS,
  getWorkspace,
  userHasAccess,
  SELECTED_WORKSPACE_KEY,
} from './workspaceRegistry';
import WorkspacePicker from './WorkspacePicker';

// Top-level decision-maker. Three states:
//   1. Unauthenticated and no URL override → show WorkspacePicker (the
//      pre-SSO card grid). Lets users explicitly pick a workspace before
//      hitting Google OAuth — essential for users on multiple allowlists.
//   2. Authenticated → resolve workspace (URL param > picker choice > email
//      allowlist > HR) and render that workspace's app. If the user lacks
//      access to the resolved workspace, fall back to the picker with an
//      "access denied" hint.
//   3. URL override (?workspace=<id>) → bypass picker and auth gate, render
//      the requested workspace. Intentional dev/preview backdoor.
//
// This file is loaded by app/page.jsx with dynamic({ssr:false}), so window
// is always defined here. Reads are synchronous — no useEffect setState
// gymnastics — to avoid React 19 strict-mode "state update before mount"
// warnings.

const HrApp = lazy(() => import('../../App'));
const CommandCenterApp = lazy(() => import('../command-center/CommandCenterApp'));
const PayrollApp = lazy(() => import('../payroll/PayrollApp'));
const GIXApp = lazy(() => import('../gix/GIXApp'));

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
  try { return localStorage.getItem('ops_hub_logged_in_email') || null; }
  catch { return null; }
}

function readUrlWorkspaceParam() {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('workspace');
  } catch { return null; }
}

function readSelectedWorkspace() {
  try { return localStorage.getItem(SELECTED_WORKSPACE_KEY) || null; }
  catch { return null; }
}

export default function WorkspaceRouter() {
  // Read localStorage + URL ONCE at mount. useState's init function runs
  // exactly once per component instance — re-renders (including React
  // strict-mode's double-render in dev) see the same snapshot, so mutations
  // performed by event handlers don't cause render-loop tearing.
  const [snapshot] = useState(() => ({
    email: readEmail(),
    urlParam: readUrlWorkspaceParam(),
    selectedWorkspace: readSelectedWorkspace(),
  }));
  const { email, urlParam, selectedWorkspace } = snapshot;

  // Pre-auth: show picker (unless URL param explicitly overrides for dev).
  if (!email && !urlParam) {
    return <WorkspacePicker initialSelected={selectedWorkspace} />;
  }

  const workspaceId = detectWorkspace({ email, urlParam, selectedWorkspace });

  // Authenticated but doesn't have access to the resolved workspace — most
  // likely they picked Command Center but aren't on the allowlist. Re-show
  // the picker with an "access denied" hint. We deliberately do NOT clear
  // selectedWorkspace here (that would be a render-time side effect); the
  // user re-picking on the card grid overwrites it via an event handler.
  if (email && !userHasAccess(workspaceId, email)) {
    return <WorkspacePicker accessDeniedFor={workspaceId} />;
  }

  // HR is the legacy app. Hand off the entire tree to it — it owns its own
  // login flow (for the URL-param dev path) and HR Hub state.
  if (workspaceId === WORKSPACE_IDS.HR) {
    return <Suspense fallback={loadingScreen()}><HrApp /></Suspense>;
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return <Suspense fallback={loadingScreen()}><HrApp /></Suspense>;
  }

  let WorkspaceApp = null;
  switch (workspaceId) {
    case WORKSPACE_IDS.COMMAND_CENTER:
      WorkspaceApp = CommandCenterApp;
      break;
    case WORKSPACE_IDS.PAYROLL:
      WorkspaceApp = PayrollApp;
      break;
    case WORKSPACE_IDS.GIX:
      WorkspaceApp = GIXApp;
      break;
    default:
      WorkspaceApp = HrApp;
  }

  return (
    <Suspense fallback={loadingScreen()}>
      <WorkspaceApp email={email} workspace={workspace} />
    </Suspense>
  );
}
