import { useMemo } from 'react';
import { resolveUserPermissions, canAccessView, canPerformAction, getDataScope, hasAdminPower, scopeTasks, scopeMembers, scopeEscalations } from '../utils/permissions';

export const usePermissions = (user, accessTypes, userAccessMap) => {
  return useMemo(() => {
    // Pass the full user object so resolveUserPermissions can fall back to
    // a role-derived accessType when the email isn't in DEFAULT_USER_ACCESS_MAP
    // (override-only roster members like Olga — see permissions.js).
    const accessType = resolveUserPermissions(user, accessTypes, userAccessMap);

    return {
      raw: accessType,
      canView: (viewId) => canAccessView(accessType, viewId),
      canDo: (actionId) => canPerformAction(accessType, actionId),
      dataScope: getDataScope(accessType),
      isAdmin: hasAdminPower(accessType, 'can_manage_settings'),
      canManageAccess: hasAdminPower(accessType, 'can_manage_access_control'),
      canManageUsers: hasAdminPower(accessType, 'can_manage_users'),
      canManageOrg: hasAdminPower(accessType, 'can_manage_org'),
      accessTypeName: accessType?.name || 'Agent',
      accessTypeId: accessType?.id || 'at_agent',
      scopeTasks: (tasks, allMembers) => scopeTasks(tasks, user, accessType, allMembers),
      scopeMembers: (allMembers) => scopeMembers(allMembers, user, accessType),
      scopeEscalations: (escalations, allMembers) => scopeEscalations(escalations, user, accessType, allMembers),
    };
  }, [user, accessTypes, userAccessMap]);
};
