'use client';

// ── Command Center department app ───────────────────────────────────────────
// Full-screen takeover rendered by App.jsx when the effective department is the
// Command Center (a CC member's home dept, or the super-admin switching in). It
// is the executive workspace: its own top nav + report tabs, each a page of
// cross-department sections. NOT a global tab — a department of its own.
//
// Access is already enforced upstream (App renders this only when dept.slug ===
// 'command-center') and on every data endpoint (canViewCommandCenter). The
// super-admin can leave via the dept switcher; CC members live here.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CC_ACCENT } from './ccUi';
import HomePage from './pages/HomePage';
import HealthPage from './pages/HealthPage';
import SlaPage from './pages/SlaPage';
import VolumePage from './pages/VolumePage';
import CapacityPage from './pages/CapacityPage';
import PeoplePage from './pages/PeoplePage';
import RiskPage from './pages/RiskPage';
import ControlsPage from './pages/ControlsPage';

const TABS = [
  { id: 'home',     label: 'Home',     icon: 'bi-house' },
  { id: 'health',   label: 'Health',   icon: 'bi-heart-pulse' },
  { id: 'sla',      label: 'SLA',      icon: 'bi-stopwatch' },
  { id: 'volume',   label: 'Volume',   icon: 'bi-bar-chart-line' },
  { id: 'capacity', label: 'Capacity', icon: 'bi-people' },
  { id: 'people',   label: 'People',   icon: 'bi-person-badge' },
  { id: 'risk',     label: 'Risk',     icon: 'bi-shield-exclamation' },
  { id: 'controls', label: 'Controls', icon: 'bi-sliders' },
];
const TAB_IDS = new Set(TABS.map(t => t.id));

function initialsOf(nameOrEmail) {
  const n = (nameOrEmail || '').trim();
  if (!n) return '··';
  const w = n.split(/[\s.@]+/).filter(Boolean);
  return (w.length >= 2 ? w[0][0] + w[1][0] : n.slice(0, 2)).toUpperCase();
}

function signOut() {
  try {
    localStorage.removeItem('ops_hub_logged_in_email');
    localStorage.removeItem('ops_hub_token');
    localStorage.removeItem('ops_hub_token_ts');
    localStorage.removeItem('ops_hub_user');
  } catch { /* ignore */ }
  window.location.href = '/';
}

export default function CommandCenterApp({ user, deptState }) {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('cc');
      return t && TAB_IDS.has(t) ? t : 'home';
    } catch { return 'home'; }
  });
  const [showUser, setShowUser] = useState(false);
  const [showDept, setShowDept] = useState(false);
  const userRef = useRef(null);
  const deptRef = useRef(null);

  // Mirror the active tab into ?cc=… so a refresh restores it.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('cc') !== activeTab) {
        url.searchParams.set('cc', activeTab);
        window.history.replaceState({}, '', url);
      }
    } catch { /* ignore */ }
  }, [activeTab]);

  // Outside-click for both dropdowns.
  useEffect(() => {
    const onDown = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setShowUser(false);
      if (deptRef.current && !deptRef.current.contains(e.target)) setShowDept(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const isSuperAdmin = deptState?.isGlobalSuperAdmin === true;
  const depts = Array.isArray(deptState?.depts) ? deptState.depts : [];
  const email = user?.email || '';
  const name = user?.name || email;

  const switchDept = useCallback((id) => {
    setShowDept(false);
    deptState?.setDept?.(id);
  }, [deptState]);

  const renderPage = () => {
    switch (activeTab) {
      case 'home':     return <HomePage />;
      case 'health':   return <HealthPage />;
      case 'sla':      return <SlaPage />;
      case 'volume':   return <VolumePage />;
      case 'capacity': return <CapacityPage />;
      case 'people':   return <PeoplePage />;
      case 'risk':     return <RiskPage />;
      case 'controls': return <ControlsPage />;
      default:         return <HomePage />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }} data-cc-app="1">
      <style>{`
        .cc-nav-item{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-secondary);letter-spacing:.01em;transition:background .12s,color .12s;white-space:nowrap}
        .cc-nav-item:hover{background:var(--surface-2);color:var(--text)}
        .cc-nav-item.active{background:${'var(--purple, #7c3aed)'}1f;color:${'var(--purple, #7c3aed)'};font-weight:600}
        .cc-nav-scroll{display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none}
        .cc-nav-scroll::-webkit-scrollbar{display:none}
        @media(max-width:1080px){.cc-nav-item .cc-nav-label{display:none}}
      `}</style>

      {/* Top bar */}
      <div className="deel-topnav" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="deel-logo" style={{ flexShrink: 0, lineHeight: 1, marginRight: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 24, color: 'var(--text)', letterSpacing: '-0.04em' }}>deel.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 14, flexShrink: 0, paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: CC_ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
            <i className="bi bi-speedometer2" />
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.1, whiteSpace: 'nowrap' }}>Command Center</span>
        </div>

        {/* Tabs */}
        <div className="cc-nav-scroll" style={{ flex: 1, minWidth: 0 }}>
          {TABS.map(t => (
            <div
              key={t.id}
              className={`cc-nav-item${activeTab === t.id ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              aria-current={activeTab === t.id ? 'page' : undefined}
              title={t.label}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setActiveTab(t.id))}
            >
              <i className={`bi ${t.icon}`} style={{ fontSize: 14 }} />
              <span className="cc-nav-label">{t.label}</span>
            </div>
          ))}
        </div>

        {/* Right: super-admin dept switcher + user menu */}
        <div className="deel-nav-right" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isSuperAdmin && depts.length > 0 && (
            <div ref={deptRef} style={{ position: 'relative' }}>
              <button type="button" onClick={() => setShowDept(p => !p)} title="Switch department"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>
                <i className="bi bi-arrow-left-right" />
                <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Command Center</span>
                <i className="bi bi-chevron-down" style={{ fontSize: 10, opacity: 0.6 }} />
              </button>
              {showDept && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: 12, padding: '6px 0', minWidth: 220, zIndex: 300, maxHeight: 360, overflowY: 'auto' }}>
                  <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>Switch department</div>
                  {depts.map(d => (
                    <div key={d.id} role="button" tabIndex={0}
                      onClick={() => switchDept(d.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && switchDept(d.id)}
                      style={{ padding: '8px 14px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <i className="bi bi-diagram-3" style={{ opacity: 0.6, fontSize: 12 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      {d.slug === 'command-center' ? <i className="bi bi-check2" style={{ marginLeft: 'auto', color: CC_ACCENT }} /> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={userRef} style={{ position: 'relative' }}>
            <button type="button" onClick={() => setShowUser(p => !p)} aria-label="User menu"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: CC_ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{initialsOf(name)}</div>
            </button>
            {showUser && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: 12, padding: '6px 0', minWidth: 240, zIndex: 300 }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{email} · Executive</div>
                </div>
                <div role="button" tabIndex={0} onClick={() => { setShowUser(false); signOut(); }}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && signOut()}
                  style={{ padding: '8px 14px', fontSize: 14, color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <i className="bi bi-box-arrow-right" /> <span>Sign out</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <main style={{ maxWidth: 1280, width: '100%', margin: '0 auto', padding: '24px 32px 64px', boxSizing: 'border-box' }}>
        {renderPage()}
      </main>
    </div>
  );
}
