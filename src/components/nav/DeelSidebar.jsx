import { useState, useContext } from 'react';
import { PermissionsContext } from '../../App';

const NAV_GROUPS = [
  {
    items: [
      { id: 'briefing',      icon: 'bi-house',            label: 'Home' },
      { id: 'my-queue',      icon: 'bi-inbox',            label: 'Queue' },
      { id: 'projects',      icon: 'bi-kanban',           label: 'Projects' },
      { id: 'calendar',      icon: 'bi-calendar3',        label: 'Calendar' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'knowledge-hub', icon: 'bi-book',             label: 'Knowledge Hub' },
      { id: 'comms',         icon: 'bi-chat-dots',        label: 'Comms' },
      { id: 'slack',         icon: 'bi-slack',            label: 'Slack' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'team',          icon: 'bi-people',           label: 'Team' },
      { id: 'analytics',     icon: 'bi-bar-chart-line',   label: 'Analytics' },
      { id: 'alerts',        icon: 'bi-exclamation-triangle', label: 'Alerts' },
      { id: 'escalations',   icon: 'bi-arrow-up-circle',  label: 'Escalations', badge: true },
      { id: 'gm-reporting',  icon: 'bi-clipboard-data',   label: 'GM Reporting' },
    ],
  },
];

const DeelSidebar = ({ view, setView, user, escalCount }) => {
  const perms = useContext(PermissionsContext);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('ops_hub_theme') === 'dark'; } catch(e) { return false; }
  });

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    const theme = next ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ops_hub_theme', theme); } catch(e) {}
  };

  const roleLabel = perms?.accessTypeName || 'Agent';

  return (
    <div style={{
      width: 220, flexShrink: 0, height: '100vh', position: 'fixed', left: 0, top: 0,
      background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 100,
    }}>
      {/* Logo / org */}
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: -1, lineHeight: 1 }}>d.</div>
          <div style={{
            width: 28, height: 28, borderRadius: 'var(--radius-md)', background: 'var(--purple-accent)',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--font-xs)', fontWeight: 700, flexShrink: 0,
          }}>AT</div>
          <div>
            <div style={{ fontSize: 'var(--font-base)', fontWeight: 'var(--fw-semibold)', color: 'var(--text)', lineHeight: '16px' }}>Admin Tasks</div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', lineHeight: '14px' }}>All groups</div>
          </div>
        </div>
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 'var(--space-1)' }}>
            {group.label && (
              <div style={{
                fontSize: 10, fontWeight: 'var(--fw-semibold)', color: 'var(--text-disabled)',
                letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
                padding: '10px 10px 4px',
              }}>{group.label}</div>
            )}
            {group.items.map(nav => {
              const active = view === nav.id;
              const badge = nav.badge && escalCount > 0 ? escalCount : 0;
              return (
                <div key={nav.id} onClick={() => setView(nav.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: '9px 10px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                    marginBottom: 1, transition: 'background .12s',
                    background: active ? 'var(--surface-3)' : 'transparent',
                    fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    fontSize: 'var(--font-md)',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                  <i className={`bi ${nav.icon}`} style={{
                    fontSize: 16, width: 18, textAlign: 'center', flexShrink: 0,
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                  }}></i>
                  <span style={{ flex: 1 }}>{nav.label}</span>
                  {badge > 0 && (
                    <span style={{
                      background: 'var(--red-solid)', color: 'white', fontSize: 10,
                      fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-pill)',
                      lineHeight: '14px',
                    }}>{badge}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom utilities */}
      <div style={{ borderTop: '1px solid var(--border-light)', padding: 'var(--space-2) var(--space-2) var(--space-1)' }}>
        {/* Settings */}
        <div onClick={() => setView('settings')}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '9px 10px',
            borderRadius: 'var(--radius-lg)', cursor: 'pointer', transition: 'background .12s',
            color: view === 'settings' ? 'var(--text)' : 'var(--text-secondary)',
            background: view === 'settings' ? 'var(--surface-3)' : 'transparent',
            fontWeight: view === 'settings' ? 'var(--fw-semibold)' : 'var(--fw-normal)',
            fontSize: 'var(--font-md)', marginBottom: 1,
          }}
          onMouseEnter={e => { if (view !== 'settings') e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={e => { if (view !== 'settings') e.currentTarget.style.background = 'transparent'; }}>
          <i className="bi bi-gear" style={{ fontSize: 16, width: 18, textAlign: 'center', color: view === 'settings' ? 'var(--text)' : 'var(--text-muted)' }}></i>
          <span style={{ flex: 1 }}>Settings</span>
        </div>

        {/* Dark mode */}
        <div onClick={toggleDarkMode}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '9px 10px',
            borderRadius: 'var(--radius-lg)', cursor: 'pointer', transition: 'background .12s',
            color: 'var(--text-secondary)', fontSize: 'var(--font-md)', marginBottom: 'var(--space-1)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <i className={darkMode ? 'bi bi-sun-fill' : 'bi bi-moon-fill'}
            style={{ fontSize: 16, width: 18, textAlign: 'center', color: 'var(--text-muted)' }}></i>
          <span style={{ flex: 1 }}>{darkMode ? 'Light mode' : 'Dark mode'}</span>
        </div>
      </div>

      {/* User section */}
      <div style={{ padding: 'var(--space-2) var(--space-2) var(--space-3)', borderTop: '1px solid var(--border-light)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '8px 10px',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: 'var(--purple-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 'var(--font-sm)', fontWeight: 700, flexShrink: 0,
          }}>{user?.initials || 'U'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--font-base)', fontWeight: 'var(--fw-semibold)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name?.split(' ')[0]}
            </div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{roleLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeelSidebar;
