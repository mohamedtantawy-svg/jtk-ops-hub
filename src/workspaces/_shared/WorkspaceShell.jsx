'use client';

import { useWorkspace, useWorkspaceSignOut } from './WorkspaceContext';

// Shared shell for non-HR workspaces. Header = Deel logo + workspace label
// + sign-out. Sub-nav = the workspace's tabs from the registry. Content area
// is whatever the workspace app renders for the active tab.
//
// Visual style intentionally mirrors HR Hub's look (Deel orange, Inter font,
// soft surface) but the components are independent — HR's DeelTopNav has
// HR-specific state that we don't want to drag in.

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(160deg, #faf8f5 0%, #f0ede8 40%, #e8e3dc 100%)',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  color: '#1b1b1b',
};

const topBar = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 32px',
  background: '#fff',
  borderBottom: '1px solid #ece8e1',
};

const logoGroup = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const logoMark = {
  width: 36,
  height: 36,
  borderRadius: 8,
  background: '#ed5e2a',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'Georgia, serif',
  fontWeight: 700,
  fontSize: 22,
  color: '#1b1b1b',
};

const workspaceLabel = {
  fontSize: 15,
  fontWeight: 600,
  color: '#1b1b1b',
  letterSpacing: 0.2,
};

const dividerDot = {
  width: 4,
  height: 4,
  borderRadius: '50%',
  background: '#cfc8bd',
};

const signOutBtn = {
  border: '1px solid #e0ddd8',
  background: '#fff',
  color: '#1b1b1b',
  borderRadius: 10,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const subNav = {
  display: 'flex',
  gap: 4,
  padding: '0 32px',
  background: '#fff',
  borderBottom: '1px solid #ece8e1',
};

const tabBase = {
  background: 'transparent',
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  borderBottomWidth: 2,
  borderBottomStyle: 'solid',
  borderBottomColor: 'transparent',
  padding: '14px 16px',
  fontSize: 14,
  fontWeight: 500,
  color: '#6b6b6b',
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginBottom: -1,
};

const tabActive = {
  ...tabBase,
  color: '#1b1b1b',
  borderBottomColor: '#ed5e2a',
  fontWeight: 600,
};

const content = {
  flex: 1,
  padding: '32px',
  maxWidth: 1280,
  width: '100%',
  margin: '0 auto',
  boxSizing: 'border-box',
};

export default function WorkspaceShell({ children }) {
  const { workspace, email, activeTab, setActiveTab } = useWorkspace();
  const signOut = useWorkspaceSignOut();

  return (
    <div style={wrap}>
      <header style={topBar}>
        <div style={logoGroup}>
          <div style={logoMark}>d.</div>
          <span style={workspaceLabel}>{workspace.label}</span>
          {email && (
            <>
              <span style={dividerDot} />
              <span style={{ fontSize: 13, color: '#9e9e9e' }}>{email}</span>
            </>
          )}
        </div>
        <button type="button" style={signOutBtn} onClick={signOut}>
          Sign out
        </button>
      </header>

      {workspace.tabs.length > 1 && (
        <nav style={subNav}>
          {workspace.tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              style={activeTab === tab.id ? tabActive : tabBase}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <main style={content}>{children}</main>
    </div>
  );
}
