// ── GET /api/v1/integrations/status ───────────────────────────────────────────
// Returns the configuration status of all external integrations.
// Does NOT require auth — used by the frontend to show integration health.
import { NextResponse } from 'next/server';
import { isDeelConfigured } from '../../../../../src/lib/deel-api';
import { isJiraConfigured } from '../../../../../src/lib/jira-api';
import { isSlackConfigured } from '../../../../../src/lib/slack-api';

export async function GET() {
  return NextResponse.json({
    integrations: {
      deel: {
        configured: isDeelConfigured(),
        label: 'Deel Admin',
        description: 'People, contracts, time-off, payslips',
        endpoints: ['/integrations/deel/people', '/integrations/deel/contracts', '/integrations/deel/time-off', '/integrations/deel/org'],
      },
      jira: {
        configured: isJiraConfigured(),
        label: 'Jira',
        description: 'Issues, search, projects, comments',
        endpoints: ['/integrations/jira/search', '/integrations/jira/issues', '/integrations/jira/projects'],
      },
      slack: {
        configured: isSlackConfigured(),
        label: 'Slack',
        description: 'Channels, messages, users',
        endpoints: ['/integrations/slack/channels', '/integrations/slack/users'],
      },
    },
  });
}
