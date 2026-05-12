'use client';

import { useEffect, useRef, useState } from 'react';

import { useWorkspace, useWorkspaceSignOut } from '../WorkspaceContext';

// Workspace top nav. Uses HR's CSS classes (deel-topnav, deel-nav-items,
// deel-nav-item) so the visual is identical to HR Hub's chrome — logo,
// tab style, hover states, active-tab pill, dark-mode support. The
// notification panel, search, and quick-create dropdown from HR are
// intentionally omitted (they need backend wiring that isn't in place
// for the new workspaces yet — Zendesk/Jira/Workbench, announcements,
// urgent assist endpoints per workspace).

const dropdown = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-lg)',
  zIndex: 300,
  borderRadius: 12,
  padding: '6px 0',
  minWidth: 240,
};

const dropdownItem = {
  padding: '8px 14px',
  fontSize: 14,
  color: 'var(--text)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  transition: 'background .15s',
};

function Avatar({ name, email, size = 32 }) {
  const initials = (() => {
    const n = (name || email || '').trim();
    if (!n) return '··';
    const words = n.split(/[\s.@]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  })();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--purple)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size === 32 ? 12 : 11, fontWeight: 700,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

export default function WorkspaceTopNav() {
  const { workspace, email, isAdmin, activeTab, setActiveTab } = useWorkspace();
  const signOut = useWorkspaceSignOut();

  const [showUser, setShowUser] = useState(false);
  const userRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setShowUser(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter admin-only tabs for non-admins.
  const visibleTabs = workspace.tabs.filter(t => !t.adminOnly || isAdmin);

  // Workspace-specific accent for the active-tab pill (overrides HR's purple
  // default). HR's `deel-nav-item.active` uses rgba(124,58,237,0.1) — we
  // override inline to use the workspace's accent color so users see Payroll
  // green / GIX blue / CC purple consistently.
  const activeBg = `${workspace.accent}1F`; // ~12% alpha hex suffix

  return (
    <div className="deel-topnav" style={{ position: 'sticky' }}>
      {/* Left: brand + workspace label */}
      <div className="deel-logo" style={{ flexShrink: 0, lineHeight: 1, marginRight: 8 }}>
        <span style={{
          fontFamily: 'Inter, -apple-system, sans-serif',
          fontWeight: 800,
          fontSize: 24,
          color: 'var(--text)',
          letterSpacing: '-0.04em',
        }}>deel.</span>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginRight: 12,
        flexShrink: 0,
        paddingLeft: 12,
        borderLeft: '1px solid var(--border)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: workspace.accent + '22',
          color: workspace.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>
          <i className={`bi ${workspace.icon}`} />
        </div>
        <span style={{
          fontSize: 'var(--font-md)',
          fontWeight: 'var(--fw-semibold)',
          color: 'var(--text)',
          letterSpacing: 0.1,
        }}>{workspace.label}</span>
      </div>

      {/* Center: tabs — same DOM shape as HR's DeelTopNav so the layout +
          label-hidden-at-narrow-viewport rule from index.css apply identically. */}
      <div className="deel-nav-items">
        {visibleTabs.map(tab => {
          const active = activeTab === tab.id;
          return (
            <div
              key={tab.id}
              className={`deel-nav-item${active ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              aria-current={active ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setActiveTab(tab.id)}
              title={tab.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                letterSpacing: '0.01em',
                ...(active ? { background: activeBg, color: workspace.accent } : null),
              }}
            >
              {tab.icon && <i className={`bi ${tab.icon}`} style={{ fontSize: 14 }} />}
              <span className="deel-nav-item-label">{tab.label}</span>
            </div>
          );
        })}
      </div>

      {/* Right: search-shape (placeholder), user menu */}
      <div className="deel-nav-right">
        <button
          type="button"
          className="deel-search-btn"
          onClick={() => {}}
          aria-label="Search (coming soon)"
          disabled
          style={{ opacity: 0.6, cursor: 'not-allowed' }}
        >
          <i className="bi bi-search" />
          <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 4,
            background: 'var(--surface-2)', color: 'var(--text-muted)',
          }}>⌘K</span>
        </button>

        <div ref={userRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="deel-icon-btn"
            onClick={() => setShowUser(p => !p)}
            aria-label="User menu"
            style={{ width: 'auto', padding: '4px 8px', gap: 8 }}
          >
            <Avatar name={email} email={email} size={32} />
            {isAdmin && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: 'var(--purple)',
                background: 'var(--purple-light)',
                border: '1px solid var(--purple-mid)',
                padding: '2px 6px',
                borderRadius: 999,
              }}>Admin</span>
            )}
          </button>
          {showUser && (
            <div style={dropdown}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{email}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {workspace.label} · {isAdmin ? 'Admin' : 'Member'}
                </div>
              </div>
              <div
                style={dropdownItem}
                role="button"
                tabIndex={0}
                onClick={() => { setShowUser(false); signOut(); }}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (signOut(), setShowUser(false))}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <i className="bi bi-box-arrow-right" />
                <span>Sign out</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
