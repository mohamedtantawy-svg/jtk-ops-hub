'use client';

import { WorkspaceProvider, useWorkspace } from '../_shared/WorkspaceContext';
import WorkspaceShell from '../_shared/WorkspaceShell';
import HomePage from './pages/HomePage';

function CommandCenterContent() {
  const { activeTab } = useWorkspace();
  switch (activeTab) {
    case 'home':
    default:
      return <HomePage />;
  }
}

export default function CommandCenterApp({ email, workspace }) {
  return (
    <WorkspaceProvider workspace={workspace} email={email}>
      <WorkspaceShell>
        <CommandCenterContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
