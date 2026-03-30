/**
 * Seed script — populates the database with demo data.
 * Run: npm run seed
 */
import { pool } from './db';
import { logger } from '../../shared/logger';

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Members ───────────────────────────────────────────────────────────
    // IDs match FE numeric IDs (as strings). Insert admin/mgr/leads first, then agents.
    await client.query(`
      INSERT INTO members (id, name, initials, email, role, team, region, country, lead_id, is_active, created_at, updated_at) VALUES
        ('14', 'Mohamed Tantawy', 'MT', 'mohamed.tantawy@deel.com',  'admin',        'ALL',  'ALL',  'AE', NULL, true, NOW(), NOW()),
        ('15', 'Duygu Cakalli',   'DC', 'duygu.cakalli@deel.com',    'regional_mgr', 'ALL',  'ALL',  'AE', '14', true, NOW(), NOW()),
        ('11', 'Alex Thompson',   'AT', 'alex.thompson@deel.com',    'lead',         'EMEA', 'EMEA', 'UK', '15', true, NOW(), NOW()),
        ('12', 'Jenny Liu',       'JL', 'jenny.liu@deel.com',        'lead',         'APAC', 'APAC', 'SG', '15', true, NOW(), NOW()),
        ('13', 'Carlos Reyes',    'CR', 'carlos.reyes@deel.com',     'lead',         'AMER', 'AMER', 'US', '15', true, NOW(), NOW()),
        ('1',  'Sarah Chen',      'SC', 'sarah.chen@deel.com',       'agent',        'EMEA', 'EMEA', 'UK', '11', true, NOW(), NOW()),
        ('2',  'James Okafor',    'JO', 'james.okafor@deel.com',     'agent',        'EMEA', 'EMEA', 'DE', '11', true, NOW(), NOW()),
        ('3',  'Maria González',  'MG', 'maria.gonzalez@deel.com',   'agent',        'AMER', 'AMER', 'BR', '13', true, NOW(), NOW()),
        ('4',  'Priya Sharma',    'PS', 'priya.sharma@deel.com',     'agent',        'APAC', 'APAC', 'SG', '12', true, NOW(), NOW()),
        ('5',  'Tom Walsh',       'TW', 'tom.walsh@deel.com',        'agent',        'EMEA', 'EMEA', 'FR', '11', true, NOW(), NOW()),
        ('6',  'Yuki Tanaka',     'YT', 'yuki.tanaka@deel.com',      'agent',        'APAC', 'APAC', 'AU', '12', true, NOW(), NOW()),
        ('7',  'Aisha Mohammed',  'AM', 'aisha.mohammed@deel.com',   'agent',        'EMEA', 'EMEA', 'AE', '11', true, NOW(), NOW()),
        ('8',  'David Kim',       'DK', 'david.kim@deel.com',        'agent',        'AMER', 'AMER', 'CA', '13', true, NOW(), NOW()),
        ('9',  'Elena Petrova',   'EP', 'elena.petrova@deel.com',    'agent',        'AMER', 'AMER', 'US', '13', true, NOW(), NOW()),
        ('10', 'Lucas Dubois',    'LD', 'lucas.dubois@deel.com',     'agent',        'EMEA', 'EMEA', 'NL', '11', true, NOW(), NOW()),
        ('16', 'Fatima El-Amin',  'FE', 'fatima.el-amin@deel.com',   'agent',        'EMEA', 'EMEA', 'AE', '11', true, NOW(), NOW()),
        ('17', 'Renata Kowalski', 'RK', 'renata.kowalski@deel.com',  'agent',        'EMEA', 'EMEA', 'PL', '11', true, NOW(), NOW()),
        ('18', 'Kenji Watanabe',  'KW', 'kenji.watanabe@deel.com',   'agent',        'APAC', 'APAC', 'JP', '12', true, NOW(), NOW()),
        ('19', 'Soo-Yeon Park',   'SP', 'soo-yeon.park@deel.com',    'agent',        'APAC', 'APAC', 'KR', '12', true, NOW(), NOW()),
        ('20', 'Isabella Reyes',  'IR', 'isabella.reyes@deel.com',   'agent',        'AMER', 'AMER', 'MX', '13', true, NOW(), NOW())
      ON CONFLICT (email) DO NOTHING
    `);

    // ── Tasks ─────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO tasks (id, external_id, source, subject, description, status, priority, assignee_id, country_code, tags, source_created_at, created_at, updated_at) VALUES
        ('t-001', 'ZD-10001', 'zendesk',   'Onboarding docs missing for new hire',        'Employee start date is next Monday and DocuSign not sent', 'open',        'high',     '1',  'GB', ARRAY['onboarding'], NOW() - INTERVAL '2 hours',  NOW(), NOW()),
        ('t-002', 'ZD-10002', 'zendesk',   'Benefits enrollment question - DE',           'Employee asking about pension contribution matching',       'open',        'medium',   '2',  'DE', ARRAY['benefits'],   NOW() - INTERVAL '3 hours',  NOW(), NOW()),
        ('t-003', 'JR-20001', 'jira',      'Work permit renewal - SG expiring soon',      'Skilled worker visa expires in 45 days, renewal needed',    'in_progress', 'critical', '4',  'SG', ARRAY['immigration'], NOW() - INTERVAL '6 hours',  NOW(), NOW()),
        ('t-004', 'JR-20002', 'jira',      'Termination processing - FR',                 'Client requested termination effective end of month',       'in_progress', 'high',     '5',  'FR', ARRAY['offboarding'], NOW() - INTERVAL '1 day',   NOW(), NOW()),
        ('t-005', 'ZD-10003', 'zendesk',   'Salary amendment - variable comp',            'Employee requesting variable comp addition to contract',    'open',        'medium',   '8',  'US', ARRAY['amendment'],  NOW() - INTERVAL '4 hours',  NOW(), NOW()),
        ('t-006', 'WB-30001', 'workbench', 'Compliance doc review needed - NL',           'Right-to-work verification overdue',                        'open',        'high',     '10', 'NL', ARRAY['compliance'], NOW() - INTERVAL '1 day',   NOW(), NOW()),
        ('t-007', 'ZD-10004', 'zendesk',   'Parental leave setup - AU',                   'Employee starting maternity leave next month',              'open',        'medium',   '6',  'AU', ARRAY['leave'],      NOW() - INTERVAL '5 hours',  NOW(), NOW()),
        ('t-008', 'JR-20003', 'jira',      'GDPR data deletion request',                  'Former employee requesting data erasure per GDPR Article 17','pending',    'high',     '1',  'DE', ARRAY['compliance'], NOW() - INTERVAL '2 days',  NOW(), NOW()),
        ('t-009', 'ZD-10005', 'zendesk',   'Sick leave policy question - JP',             'Employee asking about consecutive sick days policy',         'open',       'low',      '18', 'JP', ARRAY['leave'],      NOW() - INTERVAL '1 hour',  NOW(), NOW()),
        ('t-010', 'WB-30002', 'workbench', 'Payroll discrepancy - BR',                    'Employee reporting incorrect net pay for October',           'open',       'high',     '9',  'BR', ARRAY['payroll'],    NOW() - INTERVAL '3 hours', NOW(), NOW())
      ON CONFLICT (external_id, source) DO NOTHING
    `);

    // ── Escalations ───────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO escalations (id, task_id, subject, reason, escalated_by, escalated_at, manager_id, manager_name, status, severity, escalation_source, manager_response_status, sla_deadline, created_at, updated_at) VALUES
        ('e-001', 't-003', 'Work permit renewal - SG critical',    'SLA at risk, client threatening legal action',     '4',  NOW() - INTERVAL '2 hours', '12', 'Jenny Liu',      'pending',   'critical', 'ticket', 'pending_response', NOW() + INTERVAL '2 hours',  NOW(), NOW()),
        ('e-002', 't-008', 'GDPR deletion overdue',                'Legal obligation — must respond within 30 days',   '1',  NOW() - INTERVAL '1 day',   '11', 'Alex Thompson',  'responded', 'high',     'ticket', 'responded',       NOW() + INTERVAL '22 hours', NOW(), NOW())
      ON CONFLICT DO NOTHING
    `);

    // ── Projects ──────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO projects (id, title, description, status, priority, owner_id, region, progress, tags, created_at, updated_at) VALUES
        ('p-001', 'Q1 Onboarding Backlog Clearance', 'Clear all pending onboarding tasks before end of quarter', 'active', 'high',     '11', 'EMEA', 65, ARRAY['onboarding','q1'],     NOW() - INTERVAL '10 days', NOW()),
        ('p-002', 'GDPR Compliance Audit - EMEA',    'Annual GDPR compliance review for all EMEA countries',    'active', 'critical', '11', 'EMEA', 30, ARRAY['compliance','gdpr'],    NOW() - INTERVAL '5 days',  NOW()),
        ('p-003', 'Immigration Tracker Rollout',     'Deploy new immigration SLA tracking across APAC',         'active', 'medium',   '12', 'APAC', 80, ARRAY['immigration','apac'],   NOW() - INTERVAL '20 days', NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Project Milestones ────────────────────────────────────────────────
    await client.query(`
      INSERT INTO project_milestones (project_id, title, due_date, completed, sort_order) VALUES
        ('p-001', 'Identify all pending onboarding cases',     NOW()::DATE + INTERVAL '7 days',  true,  1),
        ('p-001', 'Assign cases to regional teams',            NOW()::DATE + INTERVAL '14 days', true,  2),
        ('p-001', 'Complete 80% of backlog',                   NOW()::DATE + INTERVAL '21 days', false, 3),
        ('p-001', 'Final review and close-out',                NOW()::DATE + INTERVAL '28 days', false, 4),
        ('p-002', 'Kick-off and scope definition',             NOW()::DATE - INTERVAL '3 days',  true,  1),
        ('p-002', 'Data mapping across EMEA entities',         NOW()::DATE + INTERVAL '10 days', false, 2),
        ('p-002', 'Gap analysis and remediation plan',         NOW()::DATE + INTERVAL '20 days', false, 3),
        ('p-003', 'Requirements gathering with APAC leads',    NOW()::DATE - INTERVAL '15 days', true,  1),
        ('p-003', 'Build tracker dashboard',                   NOW()::DATE - INTERVAL '5 days',  true,  2),
        ('p-003', 'Pilot with SG and AU teams',                NOW()::DATE + INTERVAL '5 days',  false, 3),
        ('p-003', 'Full APAC rollout',                         NOW()::DATE + INTERVAL '15 days', false, 4)
      ON CONFLICT DO NOTHING
    `);

    // ── Project Members ───────────────────────────────────────────────────
    await client.query(`
      INSERT INTO project_members (project_id, member_id, role) VALUES
        ('p-001', '11', 'owner'),
        ('p-001', '1',  'contributor'),
        ('p-001', '2',  'contributor'),
        ('p-001', '5',  'contributor'),
        ('p-002', '11', 'owner'),
        ('p-002', '15', 'lead'),
        ('p-002', '1',  'contributor'),
        ('p-003', '12', 'owner'),
        ('p-003', '4',  'contributor'),
        ('p-003', '6',  'contributor'),
        ('p-003', '18', 'contributor')
      ON CONFLICT DO NOTHING
    `);

    // ── Project Tasks ─────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO project_tasks (project_id, task_id) VALUES
        ('p-001', 't-001'),
        ('p-002', 't-008'),
        ('p-002', 't-006'),
        ('p-003', 't-003')
      ON CONFLICT DO NOTHING
    `);

    // ── Task Notes ────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO task_notes (task_id, author_id, author_name, body, is_internal, created_at) VALUES
        ('t-001', '1',  'Sarah Chen',     'Contacted hiring manager — DocuSign link will be resent today.',          true,  NOW() - INTERVAL '1 hour'),
        ('t-001', '11', 'Alex Thompson',  'Please escalate if not resolved by EOD.',                                true,  NOW() - INTERVAL '30 minutes'),
        ('t-003', '4',  'Priya Sharma',   'Work permit application submitted to MOM. Awaiting acknowledgment.',      true,  NOW() - INTERVAL '4 hours'),
        ('t-003', '12', 'Jenny Liu',      'Client is aware of the timeline. Keep them updated weekly.',              false, NOW() - INTERVAL '3 hours'),
        ('t-008', '1',  'Sarah Chen',     'Legal team confirmed 30-day GDPR deadline. We have 15 days remaining.',   true,  NOW() - INTERVAL '1 day'),
        ('t-010', '9',  'Elena Petrova',  'Payroll provider confirmed discrepancy due to exchange rate rounding.',   true,  NOW() - INTERVAL '2 hours')
      ON CONFLICT DO NOTHING
    `);

    // ── Task Activity ─────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO task_activity (task_id, actor_id, actor_name, event_type, event_text, metadata, occurred_at) VALUES
        ('t-001', '1',  'Sarah Chen',     'created',  'Task created from Zendesk ticket ZD-10001', '{"source":"zendesk"}'::jsonb,                    NOW() - INTERVAL '2 hours'),
        ('t-001', '1',  'Sarah Chen',     'assigned', 'Task assigned to Sarah Chen',               '{"assigneeId":"1"}'::jsonb,                     NOW() - INTERVAL '2 hours'),
        ('t-001', '1',  'Sarah Chen',     'note',     'Sarah Chen added a note',                   '{"isInternal":true}'::jsonb,                    NOW() - INTERVAL '1 hour'),
        ('t-003', '4',  'Priya Sharma',   'created',  'Task created from Jira issue JR-20001',    '{"source":"jira"}'::jsonb,                      NOW() - INTERVAL '6 hours'),
        ('t-003', '4',  'Priya Sharma',   'status',   'Status changed from open to in_progress',   '{"previousStatus":"open","newStatus":"in_progress"}'::jsonb, NOW() - INTERVAL '5 hours'),
        ('t-003', '4',  'Priya Sharma',   'escalated','Task escalated to manager Jenny Liu',       '{"managerId":"12"}'::jsonb,                     NOW() - INTERVAL '2 hours'),
        ('t-008', '1',  'Sarah Chen',     'status',   'Status changed from open to waiting',       '{"previousStatus":"open","newStatus":"waiting"}'::jsonb,    NOW() - INTERVAL '1 day')
      ON CONFLICT DO NOTHING
    `);

    // ── Requests ──────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO requests (id, task_id, subject, description, from_member_id, to_team, priority, status, due_date, created_at, updated_at) VALUES
        ('r-001', 't-004', 'Termination legal review - FR',         'Need legal sign-off on French termination package calculation', '5',  'legal',      'high',   'in_progress', NOW() + INTERVAL '5 days',  NOW() - INTERVAL '1 day',  NOW()),
        ('r-002', 't-010', 'Payroll correction - BR',               'Request payroll provider to issue corrected pay stub',          '9',  'payroll',    'high',   'open',        NOW() + INTERVAL '3 days',  NOW() - INTERVAL '2 hours', NOW()),
        ('r-003', NULL,     'IT access setup for new EMEA hires',    'Batch request for 5 new hire laptop + email provisioning',     '11', 'it',         'medium', 'waiting',     NOW() + INTERVAL '7 days',  NOW() - INTERVAL '3 days',  NOW()),
        ('r-004', 't-008', 'GDPR data erasure certification',       'Request compliance team to certify data erasure completion',    '1',  'compliance', 'critical','open',        NOW() + INTERVAL '10 days', NOW() - INTERVAL '12 hours', NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Announcements ─────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO announcements (id, type, title, body, author_id, target, status, priority, is_pinned, sent_at, created_at, updated_at) VALUES
        ('a-001', 'alert',    'System Maintenance — March 29',                'The Ops Hub will undergo scheduled maintenance on March 29 from 02:00-04:00 UTC.',    '14', 'all',  'sent',    'high',     true,  NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW()),
        ('a-002', 'update',   'New SLA Tracking Dashboard Live',              'The new SLA tracking dashboard is now available under Analytics.',                      '14', 'all',  'sent',    'medium',   false, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', NOW()),
        ('a-003', 'guidance', 'Updated GDPR Handling Procedures',             'Please review the updated GDPR data handling procedures effective immediately.',       '11', 'EMEA', 'sent',    'critical', true,  NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day',  NOW()),
        ('a-004', 'kudos',    'Shoutout: APAC Immigration Team',              'Great work by the APAC immigration team for clearing the visa backlog ahead of schedule.', '12', 'APAC', 'sent',    'low',      false, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', NOW()),
        ('a-005', 'announce', 'Q2 Goals and OKRs Published',                  'Q2 goals and OKRs have been published. Please review your team objectives.',           '14', 'all',  'draft',   'medium',   false, NULL,                       NOW(),                      NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Announcement Read Receipts ────────────────────────────────────────
    await client.query(`
      INSERT INTO announcement_reads (announcement_id, member_id) VALUES
        ('a-001', '15'), ('a-001', '11'), ('a-001', '12'), ('a-001', '1'), ('a-001', '4'),
        ('a-001', '2'),  ('a-001', '8'),  ('a-001', '6'),
        ('a-002', '11'), ('a-002', '1'),  ('a-002', '4'),  ('a-002', '8'),
        ('a-003', '1'),  ('a-003', '7'),  ('a-003', '5'),  ('a-003', '16'),
        ('a-004', '4'),  ('a-004', '6'),  ('a-004', '18')
      ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    logger.info('Seed completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Seed failed', { err });
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
