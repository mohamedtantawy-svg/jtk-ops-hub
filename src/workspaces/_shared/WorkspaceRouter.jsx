'use client';

import { lazy, Suspense } from 'react';

import { detectWorkspace, WORKSPACE_IDS, getWorkspace } from './workspaceRegistry';

// Top-level decision-maker. Reads the logged-in email (set by HR's OAuth
// callback into localStorage) plus the optional `?workspace=<id>` URL param,
// then renders ONE of the workspace apps.
//
// HR Hub (`../../App`) is the default fallback. New workspaces live under
// `src/workspaces/<team>/` and are code-split via React.lazy so a Payroll
// user never downloads the Command Center bundle and vice versa.
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

export default function WorkspaceRouter() {
  const email = readEmail();
  const urlParam = readUrlWorkspaceParam();
  const workspaceId = detectWorkspace({ email, urlParam });

  // HR is the legacy app. Hand off the entire tree to it — it owns its own
  // login screen, routing, and state.
  if (workspaceId === WORKSPACE_IDS.HR) {
    return <Suspense fallback={loadingScreen()}><HrApp /></Suspense>;
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    // Unknown workspace id (probably a bad URL param). Fall through to HR.
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
