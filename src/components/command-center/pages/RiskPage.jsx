'use client';

// ── Command Center · Risk radar ─────────────────────────────────────────────
// Open Leader Alerts, Urgent Assists, and Escalations needing executive
// attention, per department (criticals flagged + sorted first).

import React from 'react';
import { getCommandCenterRisk } from '../../../services/commandCenterApi';
import {
  Card, StatRow, StatTile, SectionTitle,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

function RiskCell({ label, value, critical }) {
  const color = value > 0 ? (critical ? '#dc2626' : 'var(--text)') : 'var(--text-muted)';
  return (
    <div style={{ textAlign: 'center', minWidth: 64 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function DeptRiskRow({ dept }) {
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: 10 }}>
        {dept.critical > 0 && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dept.name}>{dept.name}</div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
        <RiskCell label="Alerts" value={dept.alertsOpen} critical={dept.alertsCritical > 0} />
        <RiskCell label="Urgent" value={dept.urgentOpen} critical={dept.urgentCritical > 0} />
        <RiskCell label="Escalations" value={dept.escalationsOpen} />
        <RiskCell label="Critical" value={dept.critical} critical />
      </div>
    </Card>
  );
}

export default function RiskPage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterRisk);

  if (loading && !data) return <LoadingState rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];
  const t = data?.totals || {};
  const allClear = (t.total ?? 0) === 0;

  return (
    <div>
      <SectionTitle title="Risk radar" hint="Open Leader Alerts, Urgent Assists & Escalations needing attention" />
      <StatRow style={{ marginBottom: 22 }}>
        <StatTile label="Critical" value={t.critical ?? 0} icon="bi-shield-exclamation" tone={(t.critical ?? 0) > 0 ? '#dc2626' : '#15803d'} />
        <StatTile label="Alerts open" value={t.alertsOpen ?? 0} icon="bi-broadcast" />
        <StatTile label="Urgent assists" value={t.urgentOpen ?? 0} icon="bi-exclamation-octagon" />
        <StatTile label="Escalations" value={t.escalationsOpen ?? 0} icon="bi-arrow-up-right-circle" />
      </StatRow>

      <SectionTitle title="By department" hint="Most critical first" />
      {allClear
        ? <EmptyState text="No open alerts, urgent assists, or escalations — all clear across departments." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{departments.filter(d => d.total > 0).map(d => <DeptRiskRow key={d.id} dept={d} />)}</div>}
    </div>
  );
}
