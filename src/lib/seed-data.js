// IMPORTANT: This seed data must match src/data/members.js
// TODO: Import MEMBERS from src/data/members.js instead of duplicating
//
// Comprehensive seed data for all tables
// Matches the data shapes expected by the normalize layer and frontend

const now = new Date();
const minsAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();
const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();
const daysFromNow = (d) => new Date(now.getTime() + d * 86400000).toISOString().split('T')[0];

export const SEED_TASKS = [
  // --- EMEA tasks (assignees 1,2,5,7,10,16,17) ---
  {
    external_id: 'ZD-4821', source: 'zendesk', subject: 'Cannot access payroll portal after system migration',
    description: 'Since the recent system migration I have been unable to log into the payroll portal. I have tried resetting my password multiple times but the issue persists.',
    status: 'open', priority: 'high', assignee_id: 1, country_code: 'UK', tags: ['Access Issue'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4821', reporter_id: 'James Whitfield',
    source_created_at: minsAgo(97),
  },
  {
    external_id: 'JR-1102', source: 'jira', subject: 'Equipment allocation — new Berlin office onboarding batch',
    description: 'New batch of 12 employees starting in the Berlin office next Monday. Need laptops, monitors, and access badges provisioned.',
    status: 'in_progress', priority: 'medium', assignee_id: 2, country_code: 'DE', tags: ['Onboarding'],
    external_url: 'https://deel.atlassian.net/browse/JR-1102', reporter_id: 'HR Berlin',
    source_created_at: minsAgo(145),
  },
  {
    external_id: 'ZD-4830', source: 'zendesk', subject: 'Payroll discrepancy — overtime not reflected in March payslip',
    description: 'My March payslip does not include the 16 hours of approved overtime I worked. Manager has confirmed the hours.',
    status: 'open', priority: 'high', assignee_id: 5, country_code: 'FR', tags: ['Payment Issue'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4830', reporter_id: 'Sophie Moreau',
    source_created_at: minsAgo(62),
  },
  {
    external_id: 'WB-0091', source: 'workbench', subject: 'Benefits enrollment deadline approaching — UAE team',
    description: 'Annual benefits enrollment window closes in 3 days. 4 UAE employees have not yet completed their selections.',
    status: 'open', priority: 'medium', assignee_id: 7, country_code: 'AE', tags: ['Benefits'],
    reporter_id: 'System', source_created_at: minsAgo(180),
  },
  {
    external_id: 'ZD-4833', source: 'zendesk', subject: 'Employment contract amendment — salary adjustment NL',
    description: 'Requesting contract amendment to reflect the approved salary adjustment effective next quarter.',
    status: 'in_progress', priority: 'medium', assignee_id: 10, country_code: 'NL', tags: ['Amendment'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4833', reporter_id: 'Pieter Van Dijk',
    source_created_at: minsAgo(320),
  },
  {
    external_id: 'ZD-4840', source: 'zendesk', subject: 'Visa sponsorship query — UK Skilled Worker Visa',
    description: 'I need to understand the process for transferring my Skilled Worker Visa sponsorship to Deel as my new employer.',
    status: 'open', priority: 'high', assignee_id: 16, country_code: 'AE', tags: ['Immigration'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4840', reporter_id: 'Ahmed Hassan',
    source_created_at: minsAgo(45),
  },
  {
    external_id: 'GM-0301', source: 'gmail', subject: 'Re: PL employee tax certificate request',
    description: 'Following up on the tax certificate request for our Polish team member. The deadline is end of this week.',
    status: 'open', priority: 'medium', assignee_id: 17, country_code: 'PL', tags: ['Document Request'],
    reporter_id: 'Anna Nowak', source_created_at: minsAgo(110),
  },
  // --- APAC tasks (assignees 4,6,18,19) ---
  {
    external_id: 'ZD-4835', source: 'zendesk', subject: 'Immigration status check — SG employment pass',
    description: 'My Singapore Employment Pass renewal application was submitted 6 weeks ago. I need an update on the status.',
    status: 'in_progress', priority: 'critical', assignee_id: 4, country_code: 'SG', tags: ['Immigration'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4835', reporter_id: 'Wei Liang',
    source_created_at: minsAgo(220),
  },
  {
    external_id: 'JR-1108', source: 'jira', subject: 'Annual leave policy clarification — Australia',
    description: 'Multiple team members in AU have raised questions about carry-over policy for unused annual leave.',
    status: 'open', priority: 'low', assignee_id: 6, country_code: 'AU', tags: ['Leave Request'],
    external_url: 'https://deel.atlassian.net/browse/JR-1108', reporter_id: 'AU Team Leads',
    source_created_at: minsAgo(350),
  },
  {
    external_id: 'WB-0095', source: 'workbench', subject: 'Compliance training overdue — Japan office',
    description: 'Three employees in the Japan office have not completed mandatory compliance training due last week.',
    status: 'open', priority: 'high', assignee_id: 18, country_code: 'JP', tags: ['Compliance'],
    reporter_id: 'System', source_created_at: minsAgo(480),
  },
  {
    external_id: 'ZD-4842', source: 'zendesk', subject: 'Offboarding request — KR contractor end of contract',
    description: 'Contractor in Korea reaching end of contract on April 30. Need to initiate offboarding process.',
    status: 'in_progress', priority: 'medium', assignee_id: 19, country_code: 'KR', tags: ['Offboarding'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4842', reporter_id: 'Manager Kim',
    source_created_at: minsAgo(190),
  },
  // --- AMER tasks (assignees 3,8,9,20) ---
  {
    external_id: 'ZD-4825', source: 'zendesk', subject: 'Health insurance enrollment error — BR team',
    description: 'The health insurance provider shows incorrect plan selection for two Brazilian employees.',
    status: 'open', priority: 'high', assignee_id: 3, country_code: 'BR', tags: ['Benefits'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4825', reporter_id: 'Lucia Ferreira',
    source_created_at: minsAgo(130),
  },
  {
    external_id: 'JR-1105', source: 'jira', subject: 'Remote work policy update — Canada employees',
    description: 'Need to update employment contracts for CA employees to reflect the new hybrid work policy.',
    status: 'in_progress', priority: 'medium', assignee_id: 8, country_code: 'CA', tags: ['Amendment'],
    external_url: 'https://deel.atlassian.net/browse/JR-1105', reporter_id: 'People Ops CA',
    source_created_at: minsAgo(280),
  },
  {
    external_id: 'ZD-4838', source: 'zendesk', subject: 'US employee requesting FMLA leave documentation',
    description: 'Employee needs FMLA leave documentation for an upcoming medical procedure scheduled in May.',
    status: 'open', priority: 'medium', assignee_id: 9, country_code: 'US', tags: ['Leave Request'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4838', reporter_id: 'Rachel Thompson',
    source_created_at: minsAgo(85),
  },
  {
    external_id: 'GM-0288', source: 'gmail', subject: 'Expense reimbursement delay — MX team',
    description: 'Three Mexico employees have been waiting over 30 days for expense reimbursements. Escalation requested.',
    status: 'open', priority: 'high', assignee_id: 20, country_code: 'MX', tags: ['Expenses'],
    external_url: null, reporter_id: 'Carlos Mendez',
    source_created_at: minsAgo(55),
  },
  // --- Unassigned tasks ---
  {
    external_id: 'ZD-4845', source: 'zendesk', subject: 'New hire onboarding — 5 employees starting next week',
    description: 'Batch onboarding for 5 new hires across UK, DE, and FR. Documents and equipment need to be ready.',
    status: 'open', priority: 'high', assignee_id: null, country_code: 'UK', tags: ['Onboarding'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4845', reporter_id: 'HR EMEA',
    source_created_at: minsAgo(25),
  },
  {
    external_id: 'WB-0098', source: 'workbench', subject: 'Anomaly detected — duplicate payment batch US',
    description: 'Workbench flagged a potential duplicate payment batch for US employees in the April payroll run.',
    status: 'open', priority: 'critical', assignee_id: null, country_code: 'US', tags: ['Anomaly Alert'],
    reporter_id: 'System', source_created_at: minsAgo(15),
  },
  {
    external_id: 'ZD-4847', source: 'zendesk', subject: 'Employee promotion — compensation review IN',
    description: 'Promotion approved for an India-based employee. Need to process compensation adjustment and new contract.',
    status: 'open', priority: 'medium', assignee_id: null, country_code: 'IN', tags: ['Compensation'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4847', reporter_id: 'Priya Manager',
    source_created_at: minsAgo(40),
  },
  // --- Waiting / Snoozed tasks ---
  {
    external_id: 'ZD-4810', source: 'zendesk', subject: 'Background check pending — DE new hire',
    description: 'Waiting for background check results from external provider for German new hire starting May 1.',
    status: 'pending', priority: 'medium', assignee_id: 2, country_code: 'DE', tags: ['Onboarding'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4810', reporter_id: 'HR Berlin',
    source_created_at: minsAgo(2880),
    snoozed_until: daysFromNow(3) + 'T09:00:00Z',
  },
  {
    external_id: 'JR-1095', source: 'jira', subject: 'Office lease renewal negotiations — SG',
    description: 'Waiting for legal review of new lease terms for Singapore office expansion.',
    status: 'pending', priority: 'low', assignee_id: 4, country_code: 'SG', tags: ['Scheduling'],
    external_url: 'https://deel.atlassian.net/browse/JR-1095', reporter_id: 'Facilities SG',
    source_created_at: minsAgo(4320),
  },
  // --- Resolved tasks ---
  {
    external_id: 'ZD-4800', source: 'zendesk', subject: 'Password reset — SSO integration fix',
    description: 'Employee was locked out due to SSO integration issue. Reset and verified access.',
    status: 'resolved', priority: 'high', assignee_id: 1, country_code: 'UK', tags: ['Access Issue'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4800', reporter_id: 'Tom Harris',
    source_created_at: minsAgo(1440),
  },
  {
    external_id: 'ZD-4805', source: 'zendesk', subject: 'Tax form correction — US W-4 update',
    description: 'Employee W-4 form updated and resubmitted to payroll provider.',
    status: 'resolved', priority: 'medium', assignee_id: 9, country_code: 'US', tags: ['Document Request'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4805', reporter_id: 'Mike Johnson',
    source_created_at: minsAgo(2160),
  },
  {
    external_id: 'ZD-4808', source: 'zendesk', subject: 'Benefits enrollment completed — AU batch',
    description: 'All 8 Australian employees have completed their annual benefits enrollment.',
    status: 'resolved', priority: 'medium', assignee_id: 6, country_code: 'AU', tags: ['Benefits'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4808', reporter_id: 'AU HR',
    source_created_at: minsAgo(4320),
  },
  {
    external_id: 'GM-0275', source: 'gmail', subject: 'Re: Relocation package query — FR to NL',
    description: 'Relocation package details confirmed and communicated to the employee.',
    status: 'resolved', priority: 'medium', assignee_id: 10, country_code: 'FR', tags: ['Compensation'],
    reporter_id: 'Pierre Dupont', source_created_at: minsAgo(3000),
  },
  {
    external_id: 'ZD-4812', source: 'zendesk', subject: 'Record update — name change after marriage',
    description: 'Updated employee records across all systems following legal name change.',
    status: 'resolved', priority: 'low', assignee_id: 3, country_code: 'BR', tags: ['Record Update'],
    external_url: 'https://deel.zendesk.com/agent/tickets/4812', reporter_id: 'Maria Santos',
    source_created_at: minsAgo(5760),
  },
  {
    external_id: 'WB-0085', source: 'workbench', subject: 'Compliance audit — Q1 EMEA documentation',
    description: 'Q1 compliance documentation audit completed. All records verified and archived.',
    status: 'resolved', priority: 'high', assignee_id: 7, country_code: 'AE', tags: ['Compliance'],
    reporter_id: 'System', source_created_at: minsAgo(7200),
  },
];

export const SEED_TASK_ACTIVITY = [
  // ZD-4821
  { ext_id: 'ZD-4821', event_type: 'created', event_text: 'Task received from Zendesk', actor_name: 'System', offset_mins: 97 },
  { ext_id: 'ZD-4821', event_type: 'assigned', event_text: 'Assigned to Sarah Chen', actor_name: 'System', offset_mins: 95 },
  // JR-1102
  { ext_id: 'JR-1102', event_type: 'created', event_text: 'Task received from Jira', actor_name: 'System', offset_mins: 145 },
  { ext_id: 'JR-1102', event_type: 'assigned', event_text: 'Assigned to James Okafor', actor_name: 'System', offset_mins: 143 },
  { ext_id: 'JR-1102', event_type: 'status', event_text: 'Status changed to In Progress', actor_name: 'James Okafor', offset_mins: 120 },
  // ZD-4835
  { ext_id: 'ZD-4835', event_type: 'created', event_text: 'Task received from Zendesk', actor_name: 'System', offset_mins: 220 },
  { ext_id: 'ZD-4835', event_type: 'assigned', event_text: 'Assigned to Priya Sharma', actor_name: 'System', offset_mins: 218 },
  { ext_id: 'ZD-4835', event_type: 'status', event_text: 'Status changed to In Progress', actor_name: 'Priya Sharma', offset_mins: 200 },
  { ext_id: 'ZD-4835', event_type: 'note', event_text: 'Contacted MOM for status update on EP renewal', actor_name: 'Priya Sharma', offset_mins: 180 },
  // ZD-4800 (resolved)
  { ext_id: 'ZD-4800', event_type: 'created', event_text: 'Task received from Zendesk', actor_name: 'System', offset_mins: 1440 },
  { ext_id: 'ZD-4800', event_type: 'assigned', event_text: 'Assigned to Sarah Chen', actor_name: 'System', offset_mins: 1438 },
  { ext_id: 'ZD-4800', event_type: 'status', event_text: 'Status changed to In Progress', actor_name: 'Sarah Chen', offset_mins: 1420 },
  { ext_id: 'ZD-4800', event_type: 'status', event_text: 'Status changed to Resolved', actor_name: 'Sarah Chen', offset_mins: 1380 },
];

export const SEED_TASK_NOTES = [
  { ext_id: 'ZD-4821', author_id: 1, author_name: 'Sarah Chen', body: 'Employee is a key stakeholder in the Q2 migration project — prioritising this ticket.', is_internal: true },
  { ext_id: 'ZD-4835', author_id: 4, author_name: 'Priya Sharma', body: 'Contacted MOM helpline. They confirmed EP is in final review stage, expected response within 2 weeks.', is_internal: false },
  { ext_id: 'ZD-4835', author_id: 12, author_name: 'Jenny Liu', body: 'Escalated internally — Wei Liang has a project deadline dependent on this. Keep me posted.', is_internal: true },
  { ext_id: 'GM-0288', author_id: 20, author_name: 'Isabella Reyes', body: 'Finance confirmed the reimbursement batch was stuck in approval. Should process by EOD tomorrow.', is_internal: false },
];

export const SEED_ESCALATIONS = [
  {
    ext_id: 'ZD-4835', subject: 'Immigration status check — SG employment pass',
    reason: 'Employment pass renewal has been pending for 6 weeks with no response from MOM. Employee at risk of work authorization lapse.',
    escalated_by: 'Priya Sharma', manager_id: 12, manager_name: 'Jenny Liu',
    status: 'active', manager_response_status: 'acknowledged',
    manager_response: 'Will follow up directly with our immigration partner. This is highest priority.',
    escalation_source: 'ticket', offset_days: 1,
  },
  {
    ext_id: 'GM-0288', subject: 'Expense reimbursement delay — MX team',
    reason: 'Three employees waiting 30+ days for expense reimbursements. Team morale impacted.',
    escalated_by: 'Isabella Reyes', manager_id: 13, manager_name: 'Carlos Reyes',
    status: 'pending', manager_response_status: 'pending_response',
    escalation_source: 'ticket', offset_days: 0,
  },
  {
    ext_id: null, subject: 'Recurring payroll discrepancies in FR region',
    reason: 'Multiple payroll issues reported across French employees in the past 2 months. Systematic issue suspected.',
    escalated_by: 'Tom Walsh', manager_id: 11, manager_name: 'Alex Thompson',
    status: 'active', manager_response_status: 'acknowledged',
    manager_response: 'Setting up a call with the payroll provider to investigate the root cause.',
    escalation_source: 'ticket', offset_days: 3,
  },
];

export const SEED_PROJECTS = [
  {
    title: 'Q2 Onboarding Automation', type: 'process_improvement', status: 'active',
    priority: 'high', owner_id: 11, team_id: 'EMEA',
    deadline: daysFromNow(45), description: 'Automate the onboarding checklist and document collection process to reduce manual work by 60%.',
    progress: 35,
  },
  {
    title: 'APAC Compliance Audit', type: 'compliance', status: 'active',
    priority: 'critical', owner_id: 12, team_id: 'APAC',
    deadline: daysFromNow(20), description: 'Complete regulatory compliance audit for all APAC entities. Required before Q3 expansion.',
    progress: 65,
  },
  {
    title: 'Knowledge Base Migration', type: 'other', status: 'active',
    priority: 'medium', owner_id: 14, team_id: 'ALL',
    deadline: daysFromNow(60), description: 'Migrate all SOPs and process documentation from Notion to the new Knowledge Hub.',
    progress: 20,
  },
  {
    title: 'AMER Benefits Harmonization', type: 'process_improvement', status: 'active',
    priority: 'high', owner_id: 13, team_id: 'AMER',
    deadline: daysFromNow(30), description: 'Standardize benefits offerings across US, CA, BR, and MX entities.',
    progress: 50,
  },
  {
    title: 'Agent Performance Dashboard', type: 'reporting', status: 'completed',
    priority: 'medium', owner_id: 14, team_id: 'ALL',
    deadline: daysFromNow(-10), description: 'Build real-time performance dashboards for team leads to track agent metrics.',
    progress: 100,
  },
  {
    title: 'Payroll Provider Migration — EMEA', type: 'other', status: 'planning',
    priority: 'high', owner_id: 15, team_id: 'EMEA',
    deadline: daysFromNow(90), description: 'Migrate EMEA payroll processing from legacy provider to new integrated platform.',
    progress: 10,
  },
];

export const SEED_REQUESTS = [
  {
    subject: 'Legal review of updated NDA template', description: 'New NDA template needs legal approval before we can use it for Q2 onboarding batch.',
    to_team: 'Legal', status: 'open', priority: 'high', from_member_id: 11,
    external_ref: 'LEG-2026-041', due_date: daysFromNow(5),
  },
  {
    subject: 'IT provisioning for Berlin batch onboarding', description: '12 laptops and access badges needed by April 14 for new Berlin office hires.',
    to_team: 'IT', status: 'in_progress', priority: 'high', from_member_id: 2,
    external_ref: 'IT-2026-089', due_date: daysFromNow(3),
  },
  {
    subject: 'Finance approval for Q2 APAC team expansion budget', description: 'Budget approval needed for 3 additional headcount in APAC region.',
    to_team: 'Finance', status: 'open', priority: 'medium', from_member_id: 12,
    external_ref: 'FIN-2026-033', due_date: daysFromNow(14),
  },
  {
    subject: 'Payroll data export for compliance audit', description: 'Need payroll data export for all APAC entities for the past 12 months.',
    to_team: 'Payroll', status: 'resolved', priority: 'high', from_member_id: 12,
    external_ref: 'PAY-2026-017', due_date: daysFromNow(-2),
    resolved_at: daysAgo(1),
  },
  {
    subject: 'Translation service for MX employee handbook', description: 'Updated employee handbook needs Spanish translation for Mexico team.',
    to_team: 'Operations', status: 'open', priority: 'low', from_member_id: 13,
    external_ref: 'OPS-2026-055', due_date: daysFromNow(21),
  },
];

export const SEED_ANNOUNCEMENTS = [
  {
    type: 'alert', title: 'HRX Continuity & Redundancy Plan',
    body: 'Following a review of our regional coverage gaps, we are implementing a continuity plan to ensure no single point of failure in our operations. All team leads must review their backup coverage by end of week.\n\n**Action Required:** Review and update your team\'s coverage matrix in the shared document.',
    target: 'all', priority: 'high', is_popup: true, status: 'sent', author_id: 14, pinned: true,
    link: 'https://letsdeel.slack.com/archives/ops-alerts',
  },
  {
    type: 'update', title: 'Zendesk Integration — Auto-tagging Live',
    body: 'The new auto-tagging feature for Zendesk tickets is now live. Tickets will automatically be categorized based on subject line and description content. This should reduce manual triage time by approximately 40%.\n\nPlease report any misclassifications in the #ops-feedback channel.',
    target: 'all', priority: 'medium', is_popup: false, status: 'sent', author_id: 14,
  },
  {
    type: 'guidance', title: 'Updated SOP: Seniority Date Updates Beyond 5 Years',
    body: 'Effective immediately, all seniority date update requests that fall beyond the 5-year mark must follow the new verification workflow outlined in SOP section 3.2.\n\n**Key changes:**\n- Requires manager + HR lead dual approval\n- Supporting documentation must be uploaded before processing\n- Compliance team notification is automatic',
    target: 'all', priority: 'medium', is_popup: false, status: 'sent', author_id: 15, pinned: true,
  },
  {
    type: 'announce', title: 'APAC Team Offsite — May 15-16, Singapore',
    body: 'We\'re excited to announce the APAC team offsite! Two days of team building, strategy sessions, and knowledge sharing at our Singapore office.\n\n**RSVP by April 20** — travel and accommodation will be arranged by the operations team.',
    target: 'APAC', priority: 'medium', is_popup: false, status: 'sent', author_id: 12,
  },
  {
    type: 'kudos', title: 'Shoutout: Sarah Chen — 100% SLA for March',
    body: 'Huge congratulations to Sarah Chen for achieving 100% SLA compliance across all 47 tickets handled in March. This is an outstanding achievement that reflects her dedication and efficiency.\n\nKeep up the amazing work! ',
    target: 'all', priority: 'low', is_popup: false, status: 'sent', author_id: 11,
  },
  {
    type: 'update', title: 'New Workbench Anomaly Detection Rules',
    body: 'We\'ve updated the anomaly detection rules in Workbench. New rules include:\n- Duplicate payment batch detection\n- Unusual overtime patterns\n- Missing mandatory fields in new contracts\n\nFalse positives can be dismissed directly from the queue.',
    target: 'all', priority: 'medium', is_popup: false, status: 'sent', author_id: 14,
  },
  {
    type: 'alert', title: 'Payroll Freeze — April 25-27',
    body: 'Payroll processing will be frozen from April 25-27 for the quarterly system maintenance window. All payroll adjustments must be submitted by April 24 EOD.\n\n**Impact:** No payment modifications can be processed during this period.',
    target: 'all', priority: 'high', is_popup: true, status: 'sent', author_id: 15,
  },
  {
    type: 'announce', title: 'Q2 AMER Coverage Realignment — Draft',
    body: 'We are planning a coverage realignment for the AMER region to better balance workload across agents. This is a draft for review — final plan will be shared next week.',
    target: 'AMER', priority: 'medium', is_popup: false, status: 'draft', author_id: 13,
  },
];
