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
  // 'my-queue' is the route id; users see "Workspace" in the nav.
  'my-queue',
  // Removed 2026-05-03: projects, escalations, calendar, knowledge-hub,
  // analytics — entire features deleted from the product. The DB tables
  // (escalations, projects, requests) and any historical data are kept
  // intact; only the UI surfaces and quick-create entries are gone.
  'alerts',
  'announcements',
  'approval-queue',
  'slack',
  // 'team' route still exists, but lives inside Leaders Hub via a
  // sub-toggle now — it isn't a primary nav entry of its own.
  'team',
  'feedback',
  'hr-hub',
  // 'leader-alerts' is the route id; users see "Leaders Hub" in the nav.
  'leader-alerts',
  'urgent-assist',
  'settings',
];

// Views that require managerial access regardless of base tier. Agents and
// stackable per-feature-admin grants (HR Hub Admin) don't see these unless
// their base type is at least Team Lead. Used to derive `VIEWS_AGENT` and
// to keep the at_*_admin types from accidentally unlocking managerial
// surfaces. Update whenever a new managerial-only tab lands.
//
// 2026-05-03: 'team' added per the agent-side audit (A-F2). Although the
// `'team'` route is just a sub-toggle inside Leaders Hub, the Home quick-
// action tile in BriefingView calls `setView('team')` directly — which
// previously bypassed the topnav gating and let agents land on Leaders
// Hub via the side door. Putting `'team'` in this set means agents'
// `perms.canView('team')` now returns false everywhere (topnav, quick-
// tile, and direct URL deep-link `?view=team`), matching the strict rule
// "Agents must NEVER access the Team tab or Leaders Alerts".
const MANAGERIAL_ONLY_VIEWS = new Set(['leader-alerts', 'team']);

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
  // HR Hub admin power: edit statuses, fields, dropdown options, and
  // auto-assign rules from the in-app Settings panel; edit any
  // request/comment regardless of authorship; bypass the Team-toggle
  // scope on list views. Bundled into the `at_hr_hub_admin` default
  // access type and stackable on top of any other access type.
  'can_manage_hr_hub',
  // Leaders Alerts admin power: edit categories, statuses, notification
  // policy from the Settings panel; edit/soft-delete any alert or
  // comment regardless of authorship. Bundled into `at_leader_alerts_admin`
  // and stackable on top of any other access type.
  'can_manage_leader_alerts',
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
  'briefing':      'Home',
  'my-queue':      'Workspace',
  'alerts':        'Alerts',
  'announcements': 'Announcements',
  'approval-queue':'Approval Queue',
  'slack':         'Slack',
  'team':          'Team',
  'feedback':      'Feedback',
  'hr-hub':        'HR Hub',
  'leader-alerts': 'Leaders Hub',
  'urgent-assist': 'Urgent Assist',
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
  'can_manage_hr_hub':         'Manage HR Hub',
  'can_manage_leader_alerts':  'Manage Leaders Alerts',
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
// Agent baseline + per-feature admin grants strip managerial-only tabs so
// a Director-granted HR Hub Admin who's an agent doesn't accidentally see
// Leaders Alerts (or future managerial surfaces). Promotion to TL or
// above restores the full no-settings list.
const VIEWS_NO_SETTINGS_NO_MANAGERIAL = VIEWS_NO_SETTINGS.filter(v => !MANAGERIAL_ONLY_VIEWS.has(v));

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
    description: 'All non-managerial views except settings. Sees own work only.',
    views: VIEWS_NO_SETTINGS_NO_MANAGERIAL,
    actions: [...ALL_ACTIONS],
    adminPowers: [],
    dataScope: 'own_tasks_only',
    isDefault: true,
  },
  {
    // HR Hub Admin — assignable from the Team tab. Grants full edit
    // rights inside the HR Hub (statuses, fields, dropdown options,
    // auto-assign rules; can edit any request/comment regardless of
    // authorship; bypasses the Team-toggle scope on list views) WITHOUT
    // granting any other system-level admin powers. Stackable on top of
    // an agent / TL / RM access type — when a user has multiple types,
    // the union of `views` / `actions` / `adminPowers` applies.
    id: 'at_hr_hub_admin',
    name: 'HR Hub Admin',
    description: 'Full edit access to the HR Hub: statuses, fields, dropdowns, auto-assign rules, and any request or comment. Does not grant other settings access.',
    views: [...VIEWS_NO_SETTINGS_NO_MANAGERIAL],
    actions: [...ALL_ACTIONS],
    adminPowers: ['can_manage_hr_hub'],
    dataScope: 'own_tasks_only',
    isDefault: true,
  },
  {
    // Leaders Alerts Admin — assignable from the Team tab. Grants full
    // edit rights inside Leaders Alerts (categories, statuses, notification
    // policy; edit/soft-delete any alert or comment regardless of
    // authorship) AND visibility on the Leaders Alerts tab itself (so the
    // grant is meaningful for non-managers). Stackable on top of an agent
    // / TL / RM access type.
    id: 'at_leader_alerts_admin',
    name: 'Alerts Admin',
    description: 'Full edit access to Leaders Alerts: categories, statuses, notification policy, and any alert or comment. Includes visibility on the Leaders Alerts tab.',
    views: [...VIEWS_NO_SETTINGS],
    actions: [...ALL_ACTIONS],
    adminPowers: ['can_manage_leader_alerts'],
    dataScope: 'own_tasks_only',
    isDefault: true,
  },
];
