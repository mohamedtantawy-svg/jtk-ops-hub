'use client';

import { lazy, Suspense } from 'react';

// 2026-05-22 (final cut): WorkspacePicker retired from the live flow.
// All departments (HRX, Global Immigration, Payroll Operations, Benefits
// Operations) are now multi-tenant under the HR Hub shell via the Phase
// 11+ dept-scope isolation (org_node_id stamp on every row + per-dept
// read filter + super-admin TopNav picker chip). The legacy four-card
// landing was a holdover from before that work; new users + returning
// users both land directly on HR Hub's LoginScreen now, sign in with
// Google, and the existing /api/v1/me + /dept-scope/current chain
// resolves them into their own department's data on first paint.
//
// What's intentionally NOT deleted in this PR:
//   • WorkspacePicker.jsx, workspaceRegistry.js, MembershipGate, and the
//     three legacy workspace apps (command-center/, payroll/, gix/) all
//     live in the tree but are unreachable from this router. Keeping
//     them avoids a sprawling delete that would risk hitting another
//     file we don't see today; a follow-up can prune them once we
//     confirm nobody depends on the legacy paths.
//   • The `ops_hub_workspace_selected` + `ops_hub_workspace_memberships`
//     localStorage keys some users still have on their machines are
//     harmless leftovers — never read by the new flow.
//
// Failure mode: if HrApp's lazy import ever fails (e.g. chunk 404
// after deploy + stale CDN), the Suspense fallback below stays visible.
// That's the same fallback the picker used and the same fallback
// HrApp's pre-2026-05-22 path used, so we're not introducing a new
// failure surface.

const HrApp = lazy(() => import('../../App'));

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

export default function WorkspaceRouter() {
  // Single-mount: HR Hub for everyone, authenticated or not. HrApp
  // already handles the unauthenticated case by rendering LoginScreen
  // (Google OAuth → callback → email in localStorage → re-render with
  // authenticated dashboard). Post-login the user lands in their
  // home department via getCurrentDeptId — no picker, no detour.
  return (
    <Suspense fallback={loadingScreen()}>
      <HrApp />
    </Suspense>
  );
}
