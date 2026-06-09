import { useMemo } from 'react';
import { resolveUserPermissions, canAccessView, canPerformAction, getDataScope, hasAdminPower, scopeTasks, scopeMembers, scopeEscalations } from '../utils/permissions';
import { COMMAND_CENTER_SEED_VIEWERS } from '../data/accessControl';

export const usePermissions = (user, accessTypes, userAccessMap) => {
  return useMemo(() => {
    // Pass the full user object so resolveUserPermissions can fall back to
    // a role-derived accessType when the email isn't in DEFAULT_USER_ACCESS_MAP
    // (override-only roster members like Olga — see permissions.js).
    const accessType = resolveUserPermissions(user, accessTypes, userAccessMap);

    // Per-user announcements admin grant — additive permission set on
    // team_member_overrides via the Team-tab "Manage permissions" modal.
    // True for app-wide admins automatically; flag promotes specific
    // people (typically TLs / agents) to full announcements control.
    const isAnnouncementsAdmin = user?.isAnnouncementsAdmin === true
      || hasAdminPower(accessType, 'can_manage_settings');

    // Per-user access-admin grant — same shape as announcements-admin but
    // for the Team roster (add/edit/remove members, grant other per-user
    // permissions). Admins and regional managers always qualify; the flag
    // promotes specific Team Leads / agents who actually run their teams.
    const accessRoleAllowsRoster = accessType?.id === 'at_admin' || accessType?.id === 'at_regional_mgr';
    const canManageRoster = user?.isAccessAdmin === true || accessRoleAllowsRoster;

    // Per-user HR Hub admin grant — read from team_member_overrides.is_hr_hub_admin
    // by the server, surfaced on the user object as `isHrHubAdmin`. Full
    // app admins also qualify; the flag stacks on top of any base access
    // type so a TL or agent can edit HR Hub config without escalating.
    const canManageHrHub = user?.isHrHubAdmin === true
      || hasAdminPower(accessType, 'can_manage_hr_hub')
      || hasAdminPower(accessType, 'can_manage_settings');

    // Per-user Performance admin grant — same shape as HR Hub Admin. Read
    // from team_member_overrides.is_performance_admin by the server, surfaced
    // as `isPerformanceAdmin`. Full app admins also qualify; the flag stacks
    // on top of any base access type so a TL or agent can edit Performance
    // config without escalating.
    const canManagePerformance = user?.isPerformanceAdmin === true
      || hasAdminPower(accessType, 'can_manage_performance')
      || hasAdminPower(accessType, 'can_manage_settings');

    // Per-user Leaders Alerts admin grant — same shape as HR Hub Admin.
    // Read from team_member_overrides.is_leader_alerts_admin by the
    // server, surfaced as `isLeaderAlertsAdmin`. Full admins always
    // qualify; the per-user flag delegates Settings + edit-anyone's-alert
    // power to specific TLs / agents without escalating their main tier.
    const canManageLeaderAlerts = user?.isLeaderAlertsAdmin === true
      || hasAdminPower(accessType, 'can_manage_leader_alerts')
      || hasAdminPower(accessType, 'can_manage_settings');

    // Command Center viewer — read-only access to the executive cross-
    // department oversight surface. Kept in EXACT lockstep with the server
    // gate canViewCommandCenter() in src/lib/command-center-access.js:
    // super-admin / seeded leadership roster (both in COMMAND_CENTER_SEED_VIEWERS)
    // OR full admin OR the per-user is_command_center_viewer grant. We
    // deliberately do NOT key off can_manage_settings (Regional Managers hold
    // it) nor the access-type power alone (the server can't see the FE type
    // map, so relying on it would let the tab render while the data endpoints
    // 403). Regional Managers are excluded by design.
    const emailLc = String(user?.email || '').toLowerCase();
    const isFullAdmin = String(user?.access || user?.role || '').toLowerCase() === 'admin'
      || accessType?.id === 'at_admin';
    const canViewCommandCenter = !!emailLc && (
      COMMAND_CENTER_SEED_VIEWERS.has(emailLc)
      || isFullAdmin
      || user?.isCommandCenterViewer === true
    );

    return {
      raw: accessType,
      canView: (viewId) => canAccessView(accessType, viewId),
      canDo: (actionId) => canPerformAction(accessType, actionId),
      dataScope: getDataScope(accessType),
      isAdmin: hasAdminPower(accessType, 'can_manage_settings'),
      canManageAccess: hasAdminPower(accessType, 'can_manage_access_control'),
      canManageUsers: hasAdminPower(accessType, 'can_manage_users'),
      canManageOrg: hasAdminPower(accessType, 'can_manage_org'),
      // Announcements-admin: full control over compose, approve, archive,
      // override, send-acknowledgements. Combines the four-tier admin gate
      // with per-user grants from the Team tab.
      canManageAnnouncements: isAnnouncementsAdmin,
      // Access-admin: add / edit / remove team members + grant other per-
      // user permissions from the Team tab. Admins and regional managers
      // always qualify by role; the per-user flag delegates to specific
      // people without escalating their main access tier.
      canManageRoster,
      // HR Hub admin — schema/dropdowns/auto-assign editing in the HR Hub
      // Settings panel; bypass scope on lists; edit any request/comment.
      canManageHrHub,
      // Leaders Alerts admin — categories/statuses/notification-policy
      // editing in the Settings panel; edit/soft-delete any alert or
      // comment regardless of authorship.
      canManageLeaderAlerts,
      // Performance admin — edit Performance schemas/templates + cross-team
      // performance config. Combines the admin gate with per-user grants.
      canManagePerformance,
      // Read-only executive Command Center gate (cross-department oversight).
      // Used for the nav tab, the App.jsx mount, and the URL-gate; mirrors the
      // server-side canViewCommandCenter() so visibility and data agree.
      canViewCommandCenter,
      accessTypeName: accessType?.name || 'Agent',
      accessTypeId: accessType?.id || 'at_agent',
      // `extraEmails` lets callers widen the visible set with active
      // handover coverage subtrees so a coverer sees the OOO person's
      // team's tasks/members without changing their base scope.
      scopeTasks: (tasks, allMembers, extraEmails) => scopeTasks(tasks, user, accessType, allMembers, extraEmails),
      scopeMembers: (allMembers, extraEmails) => scopeMembers(allMembers, user, accessType, extraEmails),
      scopeEscalations: (escalations, allMembers) => scopeEscalations(escalations, user, accessType, allMembers),
    };
  }, [user, accessTypes, userAccessMap]);
};
