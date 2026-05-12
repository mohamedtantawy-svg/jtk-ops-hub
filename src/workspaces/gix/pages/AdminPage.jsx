'use client';

import AdminView from '../../_shared/AdminView';
import { useWorkspace } from '../../_shared/WorkspaceContext';

// GIX Hub's Admin tab. The tab itself is hidden from non-admins in
// WorkspaceShell, but we also guard here defensively — anyone who navigates
// to it directly (via setActiveTab in devtools) sees an empty state instead
// of the admin UI.

export default function AdminPage() {
  const { workspace, email, isAdmin } = useWorkspace();

  if (!isAdmin) {
    return (
      <div style={{
        background: '#fff', borderRadius: 16, padding: 28, border: '1px solid #ece8e1',
        boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>Admin</h1>
        <p style={{ fontSize: 14, color: '#6b6b6b', margin: 0 }}>
          You need workspace admin permission to manage members here.
        </p>
      </div>
    );
  }

  return <AdminView workspace={workspace} currentEmail={email} />;
}
