// ── PerformanceView ─────────────────────────────────────────────────────────
// The "Performance" sub-tab under HR Hub. Term performance management:
// monthly reviews (scored evaluation + qualitative check-in), history,
// warnings, promotions — org-tree-scoped (member sees self; TL/RM see their
// tree; admin all) and dept-scoped. Phase A ships the role-adaptive shell +
// internal sub-nav; the data surfaces (My Performance / My Team / Settings)
// are filled in by Phases C–F. Reuses the HR Hub board design tokens.
import { useState, useMemo, useContext } from 'react';
import { PermissionsContext } from '../../App';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import PerformanceSettings from './performance/PerformanceSettings';
import MyPerformance from './performance/MyPerformance';
import TeamReviews from './performance/TeamReviews';

export default function PerformanceView({ user }) {
  const perms = useContext(PermissionsContext);
  const deptState = useCurrentDept();
  // Managerial = anyone who isn't an own-tasks-only agent.
  const isManagerial = perms?.dataScope === 'all_tasks'
    || perms?.dataScope === 'regional_tasks'
    || perms?.dataScope === 'team_tasks';
  const canManage = perms?.canManagePerformance === true;

  const SECTIONS = useMemo(() => {
    const out = [{ key: 'me', label: 'My Performance', icon: 'bi-person-badge' }];
    if (isManagerial) out.push({ key: 'team', label: 'My Team', icon: 'bi-people-fill' });
    if (canManage) out.push({ key: 'settings', label: 'Settings', icon: 'bi-sliders' });
    return out;
  }, [isManagerial, canManage]);

  const [section, setSection] = useState('me');
  const active = SECTIONS.find(s => s.key === section) || SECTIONS[0];

  return (
    <div style={{ padding: '4px 0 24px' }}>
      {/* Section sub-nav (within Performance) */}
      <div role="tablist" aria-label="Performance section" style={segRail}>
        {SECTIONS.map(s => {
          const on = active.key === s.key;
          return (
            <button key={s.key} role="tab" aria-selected={on} onClick={() => setSection(s.key)}
              style={{ ...segBtn, ...(on ? segBtnOn : {}) }}>
              <i className={`bi ${s.icon}`} style={{ marginRight: 6, fontSize: 13 }} />
              {s.label}
            </button>
          );
        })}
      </div>

      {active.key === 'me' && <MyPerformance user={user} />}
      {active.key === 'team' && <TeamReviews user={user} canManage={canManage} />}
      {active.key === 'settings' && <PerformanceSettings canManage={canManage} />}
    </div>
  );
}

const segRail = { display: 'inline-flex', gap: 2, padding: 3, borderRadius: 128, background: 'var(--surface-2)', border: '1px solid var(--border-light)', flexWrap: 'wrap' };
const segBtn = { display: 'inline-flex', alignItems: 'center', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 128, cursor: 'pointer' };
const segBtnOn = { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow-sm)' };
