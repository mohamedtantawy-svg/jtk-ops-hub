export const DEFAULT_SETTINGS = {

  // ── SLA Configuration ──
  sla_enabled: true,
  sla_thresholds: { 'Access Issue': 240, 'Document Request': 240, 'Offboarding': 240, 'Anomaly Alert': 120, 'Payment Issue': 1440, 'Benefits': 1440, 'Leave Request': 1440, 'Leave Query': 1440, 'Scheduling': 1440, 'Compensation': 2880, 'Promotion': 1440, 'Recruitment': 1440, 'Record Update': 1440, 'Equipment': 2880, 'Policy Query': 1440, 'Onboarding': 2880, 'Immigration': 2880 },
  sla_breach_notify_lead: true,
  sla_breach_notify_admin: true,
  sla_warning_pct: 75,

  // ── Queue & Task Management ──
  aging_warn_mins: 30,
  aging_hot_mins: 60,
  aging_urgent_mins: 120,
  auto_assign_mode: 'manual', // manual | round_robin | load_balance
  default_task_status: 'new',
  show_resolved_in_queue: true,
  max_tasks_per_agent: 25,
  enable_bulk_actions: true,
  enable_keyboard_shortcuts: true,
  queue_sort_default: 'newest', // newest | oldest | priority | sla

  // ── Source Integrations ──
  sources_enabled: { zendesk: true, jira: true, gmail: true, slack: true, workbench: true, calendar: true, looker: true },
  source_urls: { zendesk: 'https://deel.zendesk.com', jira: 'https://deel.atlassian.net', gmail: 'https://mail.google.com', slack: 'https://app.slack.com/client/deel', workbench: 'https://workbench.deel.com', calendar: 'https://calendar.google.com', looker: 'https://deel.looker.com' },

  // ── AI & Suggested Replies ──
  ai_replies_enabled: true,
  ai_reply_tone: 'professional', // professional | friendly | concise
  ai_auto_translate: false,
  ai_require_review: false,
  ai_signature_template: 'Best regards,\n{agent_name}\nHRX Team — Deel',

  // ── Escalation Settings ──
  escal_auto_route: true,
  escal_sla_mins: 120,
  escal_who_can: 'all', // all | leads_only
  escal_notify_slack: true,
  escal_require_note: true,

  // ── Notifications ──
  notif_sound: true,
  notif_desktop: true,
  notif_new_ticket: true,
  notif_sla_warning: true,
  notif_sla_breach: true,
  notif_escalation: true,
  notif_digest: 'daily', // off | daily | weekly
  notificationSources: { zendesk: true, gmail: false, jira: true, slack: true, workbench: true, calendar: true, looker: true },

  // ── UI & Display ──
  default_view: 'my-queue',
  sidebar_default_open: true,
  show_onboarding_new_users: true,
  queue_columns: { ticket: true, source: true, function: true, assignee: true, country: true, time: true, status: true },
  compact_rows: false,

  // ── Access Control ──
  agent_see_all_queues: false,
  agent_see_analytics: true,
  agent_see_team_view: false,
  lead_see_all_teams: false,
  lead_can_reassign: true,
  lead_can_create_tasks: true,
  mask_sensitive_data: false,
  audit_log: true,

  // ── Branding ──
  app_name: 'HRX Ops Hub',
  primary_color: '#1f74b3',
  brand_dark: '#0a5a99',

  // ── Calendar & Deadlines ──
  deadline_warning_days: 7,
  calendar_default_view: 'week',

  // ── Export & Reporting ──
  auto_export: false,
  auto_export_freq: 'weekly', // daily | weekly | monthly
  export_format: 'csv', // csv | xlsx
  data_retention_days: 90,

  // ── Navigation & Sidebar ──
  nav_enabled_views: { briefing: true, 'my-queue': true, slack: true, alerts: true, escalations: true, team: true, analytics: true, calendar: true, 'knowledge-hub': true, projects: true, announcements: true, settings: true },
  nav_sidebar_order: ['briefing', 'my-queue', 'slack', 'alerts', 'escalations', 'team', 'analytics', 'calendar', 'knowledge-hub', 'projects', 'announcements', 'settings'],
  nav_quick_create_items: { task: true, escalation: true, project: true, announcement: true, outbound_request: true, report: true },
  nav_show_ticker: true,
  nav_global_search_shortcut: '\u2318K',

  // ── Briefing Dashboard ──
  briefing_show_digest_banner: true,
  briefing_show_health_score: true,
  briefing_health_sla_weight: 40,
  briefing_health_resolution_weight: 30,
  briefing_health_response_weight: 20,
  briefing_health_capacity_weight: 10,
  briefing_show_kpi_cards: true,
  briefing_show_admin_actions: true,
  briefing_show_executive_grid: true,
  briefing_executive_grid_roles: ['admin', 'regional_mgr'],
  briefing_show_volume_trend: true,
  briefing_show_start_dates: true,
  briefing_start_dates_lookahead_days: 14,
  briefing_show_priority_tasks: true,
  briefing_show_recent_activity: true,
  briefing_recent_activity_count: 20,

  // ── Queue Advanced ──
  queue_show_inbound_outbound_toggle: true,
  queue_filter_chips: { source: true, at_risk: true, breaching: true, unassigned: true, hide_meetings: true },
  queue_detail_tabs: { overview: true, notes: true, timeline: true },
  queue_show_ai_summary: true,
  queue_show_quick_reply: true,
  queue_reply_templates: ['Thank you for reaching out. We are looking into this.', 'This has been resolved. Please let us know if you need anything else.', 'We need additional information to proceed. Could you please provide...'],
  queue_translate_languages: ['Spanish', 'French', 'German', 'Portuguese', 'Japanese'],
  queue_show_linked_tickets: true,
  queue_show_offboarding_tracker: true,

  // ── Slack Integration ──
  slack_show_escalations_tab: true,
  slack_show_litigation_tab: true,
  slack_litigation_min_role: 'lead',
  slack_ai_suggested_reply: true,
  slack_channels: [],

  // ── Alerts ──
  alerts_auto_flag_sla_breach: true,
  alerts_auto_flag_escalation: true,
  alerts_auto_flag_keywords: ['urgent', 'legal', 'compliance', 'lawsuit', 'audit'],
  alerts_severity_levels: { critical: true, high: true, medium: true, low: true },

  // ── Escalations Advanced ──
  escal_severity_levels: ['critical', 'high', 'medium', 'low'],
  escal_chain: ['agent', 'lead', 'regional_mgr'],
  escal_critical_notify_rm: true,
  escal_response_sla_by_severity: { critical: 30, high: 60, medium: 120, low: 240 },

  // ── Team View ──
  team_show_kpi_cards: true,
  team_kpi_cards: ['total_open', 'new_today', 'in_progress', 'active_alerts'],
  team_show_region_filter: true,
  team_regions: ['EMEA', 'APAC', 'AMER'],
  team_show_parental_leave_tracker: true,
  team_show_eod_summary: true,
  team_eod_template: 'Resolved: {resolved} | Still Open: {open} | SLA Breached: {breached}',

  // ── Analytics ──
  analytics_kpi_cards: ['received', 'resolved', 'in_progress', 'active_alerts', 'escalation_rate'],
  analytics_date_ranges: [7, 30, 90],
  analytics_show_region_filter: true,
  analytics_tabs: { overview: true, sla: true, sources: true, team_performance: true },
  analytics_agent_columns: ['assigned', 'resolved', 'avg_time', 'escalation_rate', 'first_response', 'sla_compliance'],

  // ── Projects ──
  projects_enabled: true,
  projects_sub_tabs: ['all', 'my_projects', 'active', 'completed'],
  projects_types: ['Migration', 'Process Improvement', 'Audit', 'Training', 'Integration', 'Custom'],
  projects_statuses: ['planning', 'in_progress', 'review', 'completed', 'on_hold'],
  projects_show_milestones: true,
  projects_show_linked_tasks: true,

  // ── Announcements ──
  announcements_enabled: true,
  announcements_tabs: ['comms', 'alerts'],
  announcements_show_seen_count: true,
  announcements_targeting_scopes: ['All Regions', 'EMEA', 'APAC', 'AMER', 'Team', 'Everyone'],
  announcements_min_compose_role: 'lead',
  announcements_allow_pinning: true,

  // ── Knowledge Hub Advanced ──
  kb_show_search_tab: true,
  kb_show_ask_claude_tab: true,
  kb_claude_categories: ['Onboarding', 'Offboarding', 'Benefits', 'Leave', 'Immigration', 'Payroll', 'Compliance', 'Policy', 'General'],
  kb_quick_links: [
    { label: 'Zendesk Service Desk', url: 'https://deel.zendesk.com', icon: 'bi-headset' },
    { label: 'Jira Board', url: 'https://deel.atlassian.net', icon: 'bi-kanban' },
    { label: 'Confluence Docs', url: 'https://deel.atlassian.net/wiki', icon: 'bi-journal-text' },
    { label: 'Slack Workspace', url: 'https://app.slack.com/client/deel', icon: 'bi-chat-dots' },
  ],
  kb_country_resources: [
    { country: 'UK', label: 'UK Tracker', url: '' },
    { country: 'DE', label: 'Germany Tracker', url: '' },
    { country: 'FR', label: 'France Tracker', url: '' },
    { country: 'SG', label: 'Singapore Tracker', url: '' },
    { country: 'AU', label: 'Australia Tracker', url: '' },
    { country: 'US', label: 'US Tracker', url: '' },
    { country: 'NL', label: 'Netherlands Tracker', url: '' },
    { country: 'JP', label: 'Japan Tracker', url: '' },
  ],

};

export const SETTINGS_CATS = [
  { id: 'sla',           icon: 'bi-clock-history',          label: 'SLA Configuration',      ariaLabel: 'SLA Configuration settings' },
  { id: 'queue',         icon: 'bi-inbox-fill',             label: 'Queue & Tasks' },
  { id: 'sources',       icon: 'bi-plug-fill',              label: 'Source Integrations' },
  { id: 'ai',            icon: 'bi-stars',                  label: 'AI & Suggested Replies' },
  { id: 'escalation',    icon: 'bi-arrow-up-circle-fill',   label: 'Escalation Rules' },
  { id: 'notif',         icon: 'bi-bell-fill',              label: 'Notifications' },
  { id: 'ui',            icon: 'bi-palette-fill',           label: 'UI & Display' },
  { id: 'access',        icon: 'bi-shield-lock-fill',       label: 'Access Control' },
  { id: 'brand',         icon: 'bi-brush-fill',             label: 'Branding' },
  { id: 'calendar',      icon: 'bi-calendar3',              label: 'Calendar & Deadlines' },
  { id: 'team',          icon: 'bi-people-fill',            label: 'Team Management' },
  { id: 'kb',            icon: 'bi-book-half',              label: 'Knowledge Hub Config' },
  { id: 'export',        icon: 'bi-cloud-download-fill',    label: 'Export & Reporting' },
  { id: 'nav',           icon: 'bi-layout-sidebar',         label: 'Navigation & Sidebar' },
  { id: 'briefing',      icon: 'bi-speedometer2',           label: 'Briefing Dashboard' },
  { id: 'slack',         icon: 'bi-chat-left-text-fill',    label: 'Slack Integration' },
  { id: 'alerts',        icon: 'bi-exclamation-triangle-fill', label: 'Alerts' },
  { id: 'analytics',     icon: 'bi-graph-up',               label: 'Analytics' },
  { id: 'projects',      icon: 'bi-kanban-fill',            label: 'Projects' },
  { id: 'announcements', icon: 'bi-broadcast-pin',          label: 'Announcements' },
  { id: 'danger',        icon: 'bi-exclamation-octagon-fill', label: 'Danger Zone' },
];
