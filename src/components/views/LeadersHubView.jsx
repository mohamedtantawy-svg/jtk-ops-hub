// ── LeadersHubView ────────────────────────────────────────────────────────
// 2026-05-03 rebrand wrapper: combines the old Leaders Alerts surface and
// the Team admin surface into a single Leaders Hub tab. Managers land on
// Alerts by default (the spec); a small toggle in the header swaps to the
// Team view. The two underlying components stay untouched — we just decide
// which one to render based on a local sub-tab state.
//
// Future sub-tabs ("Reports", "Team OKRs", etc.) drop in by extending the
// SUBTABS array; the toggle UI scales without further refactor.

import { useState } from 'react';
import LeaderAlertsView from './LeaderAlertsView';
import Team from './Team';

const SUBTABS = [
  { id: 'alerts', label: 'Alerts', icon: 'bi-broadcast' },
  { id: 'team',   label: 'Team',   icon: 'bi-people'    },
];

export default function LeadersHubView({
  user, perms,
  // Alerts sub-view props.
  refreshNonce,
  // Team sub-view props.
  tasks,
  setView,
  realUser,
  onImpersonate,
  impersonating,
}) {
  const [tab, setTab] = useState('alerts');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Slim sub-tab strip — sits above the embedded view's own header.
          Matches the rest of the top-nav font sizes/colours so the
          transition between primary nav and sub-nav reads as a single
          surface. */}
      <div
        role="tablist"
        aria-label="Leaders Hub sub-views"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 24px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
        }}
      >
        {SUBTABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 30, padding: '0 12px', borderRadius: 8,
                border: active ? '1px solid var(--purple)' : '1px solid var(--border)',
                background: active ? 'rgba(124, 58, 237, 0.1)' : 'var(--surface)',
                color: active ? 'var(--purple)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: active ? 700 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              <i className={`bi ${t.icon}`} style={{ fontSize: 12 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'alerts' ? (
          <LeaderAlertsView user={user} perms={perms} refreshNonce={refreshNonce} />
        ) : (
          <Team
            user={user}
            tasks={tasks}
            setTask={() => {}}
            setView={setView}
            realUser={realUser}
            onImpersonate={onImpersonate}
            impersonating={impersonating}
          />
        )}
      </div>
    </div>
  );
}
