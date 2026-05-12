'use client';

import { WorkspaceProvider, useWorkspace } from '../_shared/WorkspaceContext';
import WorkspaceShell from '../_shared/WorkspaceShell';
import HomePage from './pages/HomePage';
import TeamPage from './pages/TeamPage';
import WorkspacePage from './pages/WorkspacePage';
import OOOPage from './pages/OOOPage';
import UrgentAssistPage from './pages/UrgentAssistPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import AdminPage from './pages/AdminPage';

function GIXContent() {
  const { activeTab } = useWorkspace();
  switch (activeTab) {
    case 'team': return <TeamPage />;
    case 'workspace': return <WorkspacePage />;
    case 'ooo': return <OOOPage />;
    case 'urgent-assist': return <UrgentAssistPage />;
    case 'announcements': return <AnnouncementsPage />;
    case 'admin': return <AdminPage />;
    case 'home':
    default:
      return <HomePage />;
  }
}

export default function GIXApp({ email, workspace, role }) {
  return (
    <WorkspaceProvider workspace={workspace} email={email} role={role}>
      <WorkspaceShell>
        <GIXContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
