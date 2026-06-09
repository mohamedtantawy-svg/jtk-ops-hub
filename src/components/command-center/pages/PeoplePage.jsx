'use client';

// ── Command Center · People & coverage ──────────────────────────────────────
// Headcount, open roles, and who's on leave (today / next 7 days) across
// departments, with a coverage signal.

import React from 'react';
import { getCommandCenterPeople } from '../../../services/commandCenterApi';
import {
  Card, StatRow, StatTile, MiniStat, SectionTitle,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

function DeptPeopleCard({ dept }) {
  const covColor = dept.coverage >= 90 ? '#15803d' : dept.coverage >= 75 ? '#d97706' : '#dc2626';
  const perfTone = dept.perfAvg == null ? undefined : dept.perfAvg >= 3.5 ? 'good' : dept.perfAvg >= 2.5 ? undefined : 'warn';
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={dept.name}>{dept.name}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: covColor, flexShrink: 0 }}>{dept.coverage}% covered</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <MiniStat label="People" value={dept.headcount} />
        <MiniStat label="Vacancies" value={dept.vacancies} tone={dept.vacancies > 0 ? 'warn' : undefined} />
        <MiniStat label="Out today" value={dept.outToday} tone="warn" />
        <MiniStat label="Next 7d" value={dept.upcoming} />
        <MiniStat label="Avg perf" value={dept.perfAvg != null ? dept.perfAvg.toFixed(1) : '—'} tone={perfTone} />
      </div>
    </Card>
  );
}

export default function PeoplePage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterPeople);

  if (loading && !data) return <LoadingState rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];
  const t = data?.totals || {};

  return (
    <div>
      <style>{`.cc-p-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}@media(max-width:1100px){.cc-p-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.cc-p-grid{grid-template-columns:1fr}}`}</style>

      <SectionTitle title="People & coverage" hint="Headcount, open roles, and who's on leave across departments" />
      <StatRow style={{ marginBottom: 22 }}>
        <StatTile label="People" value={t.headcount ?? 0} icon="bi-people-fill" />
        <StatTile label="Open roles" value={t.vacancies ?? 0} icon="bi-person-plus" tone={(t.vacancies ?? 0) > 0 ? '#d97706' : undefined} />
        <StatTile label="Out today" value={t.outToday ?? 0} icon="bi-airplane" tone={(t.outToday ?? 0) > 0 ? '#d97706' : undefined} />
        <StatTile label="Out next 7d" value={t.upcoming ?? 0} icon="bi-calendar-week" />
        <StatTile label="Avg performance" value={t.perfAvg != null ? t.perfAvg.toFixed(1) : '—'} icon="bi-clipboard2-check" tone={t.perfAvg != null && t.perfAvg >= 3.5 ? '#15803d' : t.perfAvg != null && t.perfAvg < 2.5 ? '#d97706' : undefined} />
      </StatRow>

      <SectionTitle title="By department" hint={t.perfPeriod ? `Largest first · performance as of ${t.perfPeriod}` : 'Largest first'} />
      {departments.length === 0
        ? <EmptyState text="No departments yet." />
        : <div className="cc-p-grid">{departments.map(d => <DeptPeopleCard key={d.id} dept={d} />)}</div>}
    </div>
  );
}
