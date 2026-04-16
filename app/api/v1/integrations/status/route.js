// ── GET /api/v1/integrations/status ───────────────────────────────────────────
// Returns the configuration status of all external integrations.
import { NextResponse } from 'next/server';
import { isDeelConfigured } from '../../../../../src/lib/deel-api';
import { isJiraConfigured } from '../../../../../src/lib/jira-api';
import { isSlackConfigured } from '../../../../../src/lib/slack-api';
import { isZendeskConfigured } from '../../../../../src/lib/zendesk-api';
import { getAuthUser } from '../../../../../src/lib/auth-helpers';

export async function GET(req) {
  const user = getAuthUser(req);
  if (!user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
      zendesk: {
        configured: isZendeskConfigured(),
        label: 'Zendesk',
        description: 'Tickets, search, users, views, groups',
        endpoints: ['/integrations/zendesk/tickets', '/integrations/zendesk/search', '/integrations/zendesk/users', '/integrations/zendesk/views', '/integrations/zendesk/groups'],
      },
    },
  });
}
