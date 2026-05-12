'use client';

import { createContext, useContext, useMemo, useState, useCallback } from 'react';

// Lightweight context for non-HR workspaces. HR Hub (App.jsx) has its own
// state model and is NOT a consumer of this context — keep it that way.

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ workspace, email, role, children }) {
  const [activeTab, setActiveTab] = useState(workspace.defaultTab);
  const isAdmin = role === 'admin';

  const value = useMemo(() => ({
    workspace,
    email,
    role: role || 'member',
    isAdmin,
    activeTab,
    setActiveTab,
  }), [workspace, email, role, isAdmin, activeTab]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  }
  return ctx;
}

// Minimal sign-out shared across non-HR workspaces. Mirrors what HR's App.jsx
// does on logout: clear auth keys + the workspace pick, reload, let the
// picker show again so the user can re-select on next sign-in.
export function useWorkspaceSignOut() {
  return useCallback(() => {
    try {
      localStorage.removeItem('ops_hub_logged_in_email');
      localStorage.removeItem('ops_hub_token');
      localStorage.removeItem('ops_hub_user');
      localStorage.removeItem('ops_hub_selected_workspace');
    } catch {}
    window.location.href = '/';
  }, []);
}
