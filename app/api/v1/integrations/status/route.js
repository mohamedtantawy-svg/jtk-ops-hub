// ── GET /api/v1/integrations/status ───────────────────────────────────────────
// Returns the configuration status of all external integrations.
//
// Public endpoint: middleware.js bypasses JWT verification for this path
// (see the allowlist in middleware.js), which means no x-user-* headers
// reach the handler. An earlier auth check here (`if (!user.email) 401`)
// contradicted that bypass and made every call return 401 — surfaced
// during the 2026-05-12 live audit as repeated
// `[useIntegrations] Failed to fetch status: Unauthorized` warnings
// flooding the console on every page load. The payload (configured:
// true/false + labels) is non-sensitive, so making this truly public
// matches the middleware's intent.
import { NextResponse } from 'next/server';
import { isDeelConfigured } from '../../../../../src/lib/deel-api';
import { isJiraConfigured } from '../../../../../src/lib/jira-api';
import { isSlackConfigured } from '../../../../../src/lib/slack-api';
import { isZendeskConfigured } from '../../../../../src/lib/zendesk-api';

export async function GET() {
  return NextResponse.json({
    integrations: {
      deel: {
        configured: isDeelConfigured(),
        label: 'Deel Admin',
        description: 'Onboarding, offboarding, amendments, redlines, workbench, incentive plans (admin API)',
        endpoints: [
          '/integrations/deel/onboarding',
          '/integrations/deel/onboarding-paused',
          '/integrations/deel/offboarding',
          '/integrations/deel/amendments',
          '/integrations/deel/redlines',
          '/integrations/deel/workbench',
          '/integrations/deel/incentive-plans',
        ],
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
