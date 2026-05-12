'use client';

import TeamView from '../../_shared/TeamView';
import { useWorkspace } from '../../_shared/WorkspaceContext';
import { PAYROLL_ROSTER, PAYROLL_ADMINS } from '../data/allowlist';

// Payroll Hub's Team tab. Thin wrapper over the shared TeamView with this
// workspace's roster + admin list piped in.

export default function TeamPage() {
  const { workspace, email } = useWorkspace();
  return (
    <TeamView
      workspace={workspace}
      roster={PAYROLL_ROSTER}
      admins={PAYROLL_ADMINS}
      currentEmail={email}
    />
  );
}
