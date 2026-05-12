'use client';

import QueueShell from '../../_shared/queue/QueueShell';

// Payroll Hub's Workspace tab. Renders the shared HR-style queue shell
// scoped to this workspace. Source adapters (Zendesk/Jira/Workbench) are
// stubbed until per-workspace API keys are provisioned — the UI is fully
// in place; data flows in the moment adapters are wired.

export default function WorkspacePage() {
  return <QueueShell />;
}
