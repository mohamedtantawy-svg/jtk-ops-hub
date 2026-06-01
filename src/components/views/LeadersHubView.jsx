// ── LeadersHubView ────────────────────────────────────────────────────────
// Wraps the Leaders Hub primary tab. Two sub-tabs today:
//   • Alerts  — LeaderAlertsView (existing surface)
//   • Reports — LeaderReportsView (analytics; first report is the SLA
//               Extension Report per Jose Ruales' 2026-05-30 feedback)
//
// The Reports tab is gated on dataScope ≠ own_tasks_only so agents don't
// see team analytics (the BE returns 403 in any case — this is the FE
// half of the same gate).
//
// History:
//   • Phase 3 of Org tab (2026-05-20) collapsed the original Alerts +
//     Team sub-tabs to a single pass-through (Team moved to /org).
//   • 2026-06-01 — sub-tab restored to fit the new Reports surface
//     alongside Alerts.
//
// The setView/realUser/onImpersonate/impersonating props stay in the
// signature so the App.jsx call site doesn't need to be updated; they're
// still unused.

import { useEffect, useState } from 'react';
import LeaderAlertsView from './LeaderAlertsView';
import LeaderReportsView from '../leader-reports/LeaderReportsView';

const SUB_TAB_KEY = 'ops_hub_leaders_hub_sub_tab';

const ALL_TABS = [
  { id: 'alerts',  label: 'Alerts',  icon: 'bi-broadcast-pin', requiresManager: false },
  { id: 'reports', label: 'Reports', icon: 'bi-bar-chart-line', requiresManager: true },
];

function readSubTabFromUrl() {
  if (typeof window === 'undefined') return null;
  try { return new URL(window.location.href).searchParams.get('sub'); } catch { return null; }
}
function writeSubTabToUrl(id) {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    if (!id || id === 'alerts') u.searchParams.delete('sub');
    else u.searchParams.set('sub', id);
    window.history.replaceState({}, '', u.toString());
  } catch {}
}
function readPersisted(fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try { return localStorage.getItem(SUB_TAB_KEY) || fallback; } catch { return fallback; }
}

function SubTabBar({ tabs, active, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Leaders Hub sub-navigation"
      style={{
        display: 'flex', gap: 0,
        padding: '0 28px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}
    >
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${isActive ? '#7c3aed' : 'transparent'}`,
              color: isActive ? 'var(--text)' : 'var(--text-secondary)',
              fontWeight: isActive ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              marginBottom: -1,
              transition: 'color .12s, border-color .12s',
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <i className={t.icon} style={{ fontSize: 14 }} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function LeadersHubView({
  user, perms,
  refreshNonce,
  // eslint-disable-next-line no-unused-vars
  tasks, setView, realUser, onImpersonate, impersonating,
}) {
  // Hide the Reports tab from agents (own_tasks_only). Server-side gate
  // mirrors this — agents calling the report endpoint receive 403.
  const isManager = perms?.dataScope && perms.dataScope !== 'own_tasks_only';
  const tabs = isManager ? ALL_TABS : ALL_TABS.filter(t => !t.requiresManager);

  const [subTab, setSubTab] = useState(() => {
    const urlSub = readSubTabFromUrl();
    if (urlSub && tabs.find(t => t.id === urlSub)) return urlSub;
    const persisted = readPersisted('alerts');
    return tabs.find(t => t.id === persisted) ? persisted : 'alerts';
  });

  // If the user lost manager scope (e.g., stopped impersonating an admin)
  // while on the Reports tab, fall back to Alerts to avoid a blank view.
  useEffect(() => {
    if (!tabs.find(t => t.id === subTab)) setSubTab('alerts');
  }, [tabs, subTab]);

  useEffect(() => {
    try { localStorage.setItem(SUB_TAB_KEY, subTab); } catch {}
    writeSubTabToUrl(subTab);
  }, [subTab]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {tabs.length > 1 && <SubTabBar tabs={tabs} active={subTab} onChange={setSubTab} />}
      {subTab === 'alerts'  && <LeaderAlertsView  user={user} perms={perms} refreshNonce={refreshNonce} />}
      {subTab === 'reports' && isManager && <LeaderReportsView />}
    </div>
  );
}
