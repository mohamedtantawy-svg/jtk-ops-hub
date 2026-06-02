'use client';

// ── Command Center · Home ───────────────────────────────────────────────────
// The executive landing: org-wide totals + a per-department scorecard grid,
// enumerated live from org_nodes (adapts as departments change). Internal-data
// only — no external scans. Deeper panels live in the other tabs.

import React from 'react';
import { getCommandCenterOverview } from '../../../services/commandCenterApi';
import {
  CC_ACCENT, Card, StatRow, StatTile, MiniStat, SectionTitle,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

function DeptCard({ dept }) {
  const accent = dept.color || CC_ACCENT;
  const initial = (dept.name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: `${accent}1f`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{initial}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dept.name}>{dept.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {dept.headcount} {dept.headcount === 1 ? 'person' : 'people'}
            {dept.teamCount > 0 ? ` · ${dept.teamCount} ${dept.teamCount === 1 ? 'team' : 'teams'}` : ''}
            {dept.vacancies > 0 ? ` · ${dept.vacancies} open ${dept.vacancies === 1 ? 'role' : 'roles'}` : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-light, var(--border))' }}>
        <MiniStat label="Open" value={dept.hrHubOpen} />
        <MiniStat label="Urgent" value={dept.hrHubUrgent} tone="urgent" />
        <MiniStat label="Out today" value={dept.outToday} tone="warn" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterOverview);

  if (loading && !data) return <LoadingState rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];
  const totals = data?.totals || {};

  return (
    <div>
      <style>{`.cc-home-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}@media(max-width:1100px){.cc-home-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.cc-home-grid{grid-template-columns:1fr}}`}</style>

      <SectionTitle title="Organization at a glance" hint="Live from the Org tab — adapts automatically as departments change" />
      <StatRow style={{ marginBottom: 24 }}>
        <StatTile label="Departments" value={totals.departmentCount ?? departments.length} icon="bi-diagram-3" />
        <StatTile label="People" value={totals.headcount ?? 0} icon="bi-person-badge" />
        <StatTile label="Open HR Hub" value={totals.hrHubOpen ?? 0} icon="bi-broadcast-pin" />
        <StatTile label="Urgent" value={totals.hrHubUrgent ?? 0} icon="bi-exclamation-octagon" tone={(totals.hrHubUrgent ?? 0) > 0 ? '#dc2626' : undefined} />
        <StatTile label="Out today" value={totals.outToday ?? 0} icon="bi-airplane" />
      </StatRow>

      <SectionTitle title="Departments" />
      {departments.length === 0
        ? <EmptyState text="No active departments yet. Create one in the Org tab and it will appear here." />
        : <div className="cc-home-grid">{departments.map(d => <DeptCard key={d.id} dept={d} />)}</div>}
    </div>
  );
}
