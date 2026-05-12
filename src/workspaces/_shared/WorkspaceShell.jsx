'use client';

import { useWorkspace } from './WorkspaceContext';
import WorkspaceTopNav from './nav/WorkspaceTopNav';

// Top-level chrome for non-HR workspaces. Uses HR's CSS variables + classes
// so the look + feel matches HR Hub exactly — same gradient top bar, same
// typography, same content area styling.
//
// The top bar is fixed-position (68px tall, matches HR), so the main content
// area gets a top padding equivalent to the bar height.

const TOPBAR_HEIGHT = 68;

const wrap = {
  minHeight: '100vh',
  background: 'var(--bg)',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  color: 'var(--text)',
};

const contentWrap = {
  paddingTop: TOPBAR_HEIGHT,
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
};

const main = {
  flex: 1,
  padding: '24px 32px 48px',
  maxWidth: 1440,
  width: '100%',
  margin: '0 auto',
  boxSizing: 'border-box',
};

export default function WorkspaceShell({ children }) {
  const { workspace } = useWorkspace();

  return (
    <div style={wrap} data-workspace={workspace.id}>
      <WorkspaceTopNav />
      <div style={contentWrap}>
        <main style={main}>{children}</main>
      </div>
    </div>
  );
}
