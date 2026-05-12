'use client';

import TeamView from '../../_shared/TeamView';
import { useWorkspace } from '../../_shared/WorkspaceContext';
import { GIX_ROSTER, GIX_ADMINS } from '../data/allowlist';

// GIX Hub's Team tab. Thin wrapper over the shared TeamView with this
// workspace's roster + admin list piped in.

export default function TeamPage() {
  const { workspace, email } = useWorkspace();
  return (
    <TeamView
      workspace={workspace}
      roster={GIX_ROSTER}
      admins={GIX_ADMINS}
      currentEmail={email}
    />
  );
}
