'use client';

import { createContext, useContext, useMemo, useState, useCallback } from 'react';

// Lightweight context for non-HR workspaces. HR Hub (App.jsx) has its own
// state model and is NOT a consumer of this context — keep it that way.

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ workspace, email, children }) {
  const [activeTab, setActiveTab] = useState(workspace.defaultTab);

  const value = useMemo(() => ({
    workspace,
    email,
    activeTab,
    setActiveTab,
  }), [workspace, email, activeTab]);

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
// does on logout: clear auth keys, reload, let the login flow restart.
export function useWorkspaceSignOut() {
  return useCallback(() => {
    try {
      localStorage.removeItem('ops_hub_logged_in_email');
      localStorage.removeItem('ops_hub_token');
      localStorage.removeItem('ops_hub_user');
    } catch {}
    window.location.href = '/';
  }, []);
}
