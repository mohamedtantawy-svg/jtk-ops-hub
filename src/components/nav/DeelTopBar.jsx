import { useState, useRef, useEffect } from 'react';

const VIEW_TITLES = {
  briefing:      'Home',
  'my-queue':    'Queue',
  projects:      'Projects',
  calendar:      'Calendar',
  'knowledge-hub': 'Knowledge Hub',
  slack:         'Slack',
  team:          'Team',
  analytics:     'Analytics',
  alerts:        'Alerts',
  escalations:   'Escalations',
  settings:      'Settings',
};

const DeelTopBar = ({ view, onSearch, notifs, markAllRead, onCreateTask }) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef(null);
  const unreadCount = notifs ? notifs.filter(n => !n.read).length : 0;

  useEffect(() => {
    const handler = e => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const dropdownBase = {
    position: 'absolute', top: 'calc(100% + 8px)', background: 'white',
    border: '1px solid #e8e8e8', boxShadow: '0 4px 20px rgba(0,0,0,0.10)', zIndex: 200,
  };

  return (
    <div style={{
      height: 52, background: 'white', borderBottom: '1px solid #e8e8e8',
      display: 'flex', alignItems: 'center', padding: '0 24px',
      gap: 12, flexShrink: 0,
    }}>
      {/* Page title */}
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1b1b1b' }}>
          {VIEW_TITLES[view] || 'Ops Hub'}
        </span>
      </div>

      {/* Search */}
      <button onClick={onSearch}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
          borderRadius: 128, background: '#f4f4f4', border: '1px solid #e8e8e8',
          cursor: 'pointer', fontSize: 13, color: '#9e9e9e', transition: 'background .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#ececec'}
        onMouseLeave={e => e.currentTarget.style.background = '#f4f4f4'}>
        <i className="bi bi-search" style={{ fontSize: 13, color: '#9e9e9e' }}></i>
        <span>Search</span>
        <span style={{
          background: '#e4e4e4', borderRadius: 5, padding: '2px 7px',
          fontSize: 11, color: '#9e9e9e', fontWeight: 500, letterSpacing: '.02em',
        }}>⌘K</span>
      </button>

      {/* New Task */}
      <button onClick={onCreateTask}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 34,
          padding: '0 16px 0 12px', borderRadius: 128, border: 'none',
          background: '#1b1b1b', color: 'white', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', transition: 'background .15s', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#333'}
        onMouseLeave={e => e.currentTarget.style.background = '#1b1b1b'}>
        <i className="bi bi-plus-lg" style={{ fontSize: 14 }}></i>New Task
      </button>

      {/* Notifications */}
      <div ref={notifRef} style={{ position: 'relative' }}>
        <button className="deel-icon-btn" onClick={() => setShowNotifs(p => !p)}
          aria-label="Notifications" style={{ position: 'relative' }}>
          <i className="bi bi-bell" style={{ fontSize: 16 }}></i>
          {unreadCount > 0 && (
            <span className="deel-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>

        {showNotifs && (
          <div style={{ ...dropdownBase, right: 0, borderRadius: 16, width: 380, maxHeight: 440, overflowY: 'auto' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px 14px', borderBottom: '1px solid #e8e8e8',
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1b1b1b' }}>Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{
                  background: 'none', border: 'none', color: '#1f74b3',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: 0,
                }}>Mark all read</button>
              )}
            </div>
            {notifs && notifs.length > 0 ? notifs.slice(0, 15).map(n => (
              <div key={n.id} onClick={() => setShowNotifs(false)}
                onMouseEnter={e => e.currentTarget.style.background = n.read ? '#f9f9f9' : '#eef0ed'}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? 'white' : '#f7f5f2'}
                style={{
                  display: 'flex', gap: 12, padding: '12px 20px',
                  borderBottom: '1px solid #f2f2f2',
                  background: n.read ? 'white' : '#f7f5f2',
                  cursor: 'pointer', transition: 'background .15s', alignItems: 'flex-start',
                }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                  background: n.read ? 'transparent'
                    : n.type === 'escalation' ? '#d42d35'
                    : n.type === 'success' ? '#29811e' : '#1f74b3',
                }}></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: '#1b1b1b', lineHeight: '18px' }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: '#616161', marginTop: 2, lineHeight: '16px' }}>{n.body}</div>
                  <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 4 }}>{n.time}</div>
                </div>
                <i className="bi bi-chevron-right" style={{ fontSize: 12, color: '#c0c0c0', marginTop: 4, flexShrink: 0 }}></i>
              </div>
            )) : (
              <div style={{ padding: 40, textAlign: 'center', color: '#9e9e9e', fontSize: 14 }}>
                <i className="bi bi-bell-slash" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: '#d0d0d0' }}></i>
                No notifications yet
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeelTopBar;
