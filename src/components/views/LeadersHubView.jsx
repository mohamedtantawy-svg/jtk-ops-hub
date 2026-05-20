// ── LeadersHubView ────────────────────────────────────────────────────────
// Originally a sub-tab wrapper combining Leaders Alerts + the Team admin
// surface. Phase 3 of the Org-tab build (2026-05-20) relocates People
// management to the dedicated `org` view, so the Team sub-tab is gone and
// LeadersHub becomes a thin pass-through to LeaderAlertsView. The
// underlying Team.jsx component remains in the codebase for the Home
// page team table + queue scoping until Phase 6 deletes it; we just no
// longer expose it here.
//
// Routes that previously deep-linked into Leaders Hub → Team now resolve
// directly to the alerts surface — and managers reach the team admin via
// the Org tab. The setView/realUser/onImpersonate/impersonating props are
// left in the signature so callers (App.jsx) don't need to be updated in
// the same PR, but they're now unused.
//
// eslint-disable-next-line no-unused-vars
import LeaderAlertsView from './LeaderAlertsView';

export default function LeadersHubView({
  user, perms,
  refreshNonce,
  // Phase 3 (2026-05-20) — kept for backwards compatibility with the
  // App.jsx call site. These were previously threaded into the Team
  // sub-view; with that sub-tab removed they're no longer read.
  // eslint-disable-next-line no-unused-vars
  tasks, setView, realUser, onImpersonate, impersonating,
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <LeaderAlertsView user={user} perms={perms} refreshNonce={refreshNonce} />
    </div>
  );
}
