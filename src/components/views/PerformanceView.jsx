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

      {active.key === 'me' && (
        <Placeholder
          icon="bi-graph-up-arrow"
          title="Your performance"
          body="Your monthly performance history, scores, trends, check-ins, and growth will appear here once your team's reviews are live."
        />
      )}
      {active.key === 'team' && (
        <Placeholder
          icon="bi-people-fill"
          title="Your team's performance"
          body="Run monthly reviews, see completion and score distribution, drill into each report, and manage warnings & promotions — scoped to your team."
        />
      )}
      {active.key === 'settings' && (
        <Placeholder
          icon="bi-sliders"
          title="Performance settings"
          body="Configure role-specific evaluation templates, criteria, weights, score bands, and the monthly cycle schedule for your department."
        />
      )}
    </div>
  );
}

function Placeholder({ icon, title, body }) {
  return (
    <div style={{ marginTop: 16, padding: '48px 24px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 14, background: 'var(--surface)' }}>
      <i className={`bi ${icon}`} style={{ fontSize: 34, color: 'var(--text-muted)', display: 'block', marginBottom: 14, opacity: 0.5 }} />
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 520, margin: '0 auto', lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

const segRail = { display: 'inline-flex', gap: 2, padding: 3, borderRadius: 128, background: 'var(--surface-2)', border: '1px solid var(--border-light)', flexWrap: 'wrap' };
const segBtn = { display: 'inline-flex', alignItems: 'center', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 128, cursor: 'pointer' };
const segBtnOn = { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow-sm)' };
