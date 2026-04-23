// ---------------------------------------------------------------------------
// Access Control — views, actions, admin powers, data scopes & default types
//
// Access levels (from Access Mapping spreadsheet):
//   Agent           → sees own work only, all tabs except settings
//   Team Lead       → sees own + direct reports' work, all tabs except settings
//   Regional Manager→ sees own + all reports chain, all tabs INCLUDING settings
//   Admin/Director  → sees everyone, all tabs INCLUDING settings, full power
//
// All levels can create tasks, escalate, reassign, etc.
// Only RM + Admin can access Settings and admin powers.
// ---------------------------------------------------------------------------

export const ALL_VIEWS = [
  'briefing',
  'my-queue',
  'calendar',
  'projects',
  'escalations',
  'alerts',
  'hr-reports',
  'knowledge-hub',
  'analytics',
  'announcements',
  'approval-queue',
  'slack',
  'team',
  'settings',
];

export const ALL_ACTIONS = [
  // Task actions
  'can_create_task',
  'can_resolve_task',
  'can_snooze_task',
  'can_reassign',
  'can_bulk_action',
  // Escalation actions
  'can_escalate',
  'can_create_escalation',
  'can_respond_escalation',
  // Communication actions
  'can_compose_announcements',
  'can_pin_announcement',
  'can_send_reminder',
  // Project actions
  'can_create_project',
  'can_edit_project',
  'can_delete_project',
  // Request actions
  'can_create_request',
  // Data actions
  'can_export',
  // Team actions
  'can_manage_team',
];

export const ALL_ADMIN_POWERS = [
  'can_manage_settings',
  'can_manage_access_control',
  'can_manage_users',
  'can_manage_org',
];

export const DATA_SCOPES = [
  'own_tasks_only',
  'team_tasks',
  'regional_tasks',
  'all_tasks',
];

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

export const VIEW_LABELS = {
  'briefing':      'Briefing',
  'my-queue':      'My Queue',
  'calendar':      'Calendar',
  'projects':      'Projects',
  'escalations':   'Escalations',
  'alerts':        'Alerts',
  'hr-reports':    'HR Reports',
  'knowledge-hub': 'Knowledge Hub',
  'analytics':     'Analytics',
  'announcements': 'Announcements',
  'approval-queue':'Approval Queue',
  'slack':         'Slack',
  'team':          'Team',
  'settings':      'Settings',
};

export const ACTION_LABELS = {
  'can_create_task':          'Create Task',
  'can_resolve_task':         'Resolve / Close Task',
  'can_snooze_task':          'Snooze Task',
  'can_reassign':             'Reassign Task',
  'can_bulk_action':          'Bulk Actions',
  'can_escalate':             'Escalate (from ticket)',
  'can_create_escalation':    'Create Escalation',
  'can_respond_escalation':   'Respond to Escalation',
  'can_compose_announcements':'Compose Announcements',
  'can_pin_announcement':     'Pin Announcement',
  'can_send_reminder':        'Send Reminder',
  'can_create_project':       'Create Project',
  'can_edit_project':         'Edit Project',
  'can_delete_project':       'Delete Project',
  'can_create_request':       'Create Outbound Request',
  'can_export':               'Export Data',
  'can_manage_team':          'Manage Team',
};

export const ADMIN_POWER_LABELS = {
  'can_manage_settings':       'Manage Settings',
  'can_manage_access_control': 'Manage Access Control',
  'can_manage_users':          'Manage Users',
  'can_manage_org':            'Manage Org Structure',
};

export const DATA_SCOPE_LABELS = {
  own_tasks_only:  'Own tasks only',
  team_tasks:      'Team tasks (direct reports)',
  regional_tasks:  'Regional tasks (full reporting chain)',
  all_tasks:       'All tasks',
};

// ---------------------------------------------------------------------------
// Views available to each tier
// ---------------------------------------------------------------------------
const VIEWS_ALL = [...ALL_VIEWS];
const VIEWS_NO_SETTINGS = ALL_VIEWS.filter(v => v !== 'settings');

// ---------------------------------------------------------------------------
// Default access types — these define the 4-tier permission system
// ---------------------------------------------------------------------------

export const DEFAULT_ACCESS_TYPES = [
  {
    id: 'at_admin',
    name: 'Admin',
    description: 'Full access to all views, actions, and admin powers. Sees all tasks.',
    views: VIEWS_ALL,
    actions: [...ALL_ACTIONS],
    adminPowers: [...ALL_ADMIN_POWERS],
    dataScope: 'all_tasks',
    isDefault: true,
  },
  {
    id: 'at_regional_mgr',
    name: 'Regional Manager',
    description: 'Full access including settings. Sees own work + TL summaries + all team members under TLs.',
    views: VIEWS_ALL,
    actions: [...ALL_ACTIONS],
    adminPowers: [...ALL_ADMIN_POWERS],
    dataScope: 'regional_tasks',
    isDefault: true,
  },
  {
    id: 'at_lead',
    name: 'Team Lead',
    description: 'All views except settings. Sees own work + direct team members\' work.',
    views: VIEWS_NO_SETTINGS,
    actions: [...ALL_ACTIONS],
    adminPowers: [],
    dataScope: 'team_tasks',
    isDefault: true,
  },
  {
    id: 'at_agent',
    name: 'Agent',
    description: 'All views except settings. Sees own work only.',
    views: VIEWS_NO_SETTINGS,
    actions: [...ALL_ACTIONS],
    adminPowers: [],
    dataScope: 'own_tasks_only',
    isDefault: true,
  },
];
