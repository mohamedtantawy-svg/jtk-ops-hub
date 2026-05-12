'use client';

import { WorkspaceProvider, useWorkspace } from '../_shared/WorkspaceContext';
import WorkspaceShell from '../_shared/WorkspaceShell';
import HomePage from './pages/HomePage';
import TeamPage from './pages/TeamPage';
import WorkspacePage from './pages/WorkspacePage';
import OOOPage from './pages/OOOPage';
import UrgentAssistPage from './pages/UrgentAssistPage';
import AnnouncementsPage from './pages/AnnouncementsPage';

function GIXContent() {
  const { activeTab } = useWorkspace();
  switch (activeTab) {
    case 'team': return <TeamPage />;
    case 'workspace': return <WorkspacePage />;
    case 'ooo': return <OOOPage />;
    case 'urgent-assist': return <UrgentAssistPage />;
    case 'announcements': return <AnnouncementsPage />;
    case 'home':
    default:
      return <HomePage />;
  }
}

export default function GIXApp({ email, workspace }) {
  return (
    <WorkspaceProvider workspace={workspace} email={email}>
      <WorkspaceShell>
        <GIXContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
