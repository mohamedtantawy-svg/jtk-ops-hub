'use client';

import QueueShell from '../../_shared/queue/QueueShell';

// GIX Hub's Workspace tab. Renders the shared HR-style queue shell scoped
// to this workspace. Source adapters (Zendesk/Jira/Workbench) are stubbed
// until per-workspace API keys are provisioned.

export default function WorkspacePage() {
  return <QueueShell />;
}
