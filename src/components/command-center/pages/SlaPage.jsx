'use client';

// ── Command Center · SLA & ageing ───────────────────────────────────────────
// Cross-department HR Hub ageing: fresh (<2d) / at-risk (2–7d) / breached (>7d)
// + urgent, per department. Queue & Deel SLA stays inside each dept's own queue
// (external, per-dept) — this is the internal HR Hub signal rolled up.

import React from 'react';
import { getCommandCenterSla } from '../../../services/commandCenterApi';
import {
  Card, StatRow, StatTile, SectionTitle,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

function StackBar({ fresh, atRisk, breached }) {
  const total = Math.max(1, fresh + atRisk + breached);
  const seg = (v, c) => (v > 0 ? <div style={{ width: `${(v / total) * 100}%`, background: c, height: '100%' }} /> : null);
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-3, var(--border))' }}>
      {seg(fresh, '#15803d')}{seg(atRisk, '#d97706')}{seg(breached, '#dc2626')}
    </div>
  );
}

function MiniCol({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function DeptSlaRow({ dept }) {
  const compColor = dept.compliance >= 90 ? '#15803d' : dept.compliance >= 75 ? '#d97706' : '#dc2626';
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 200px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dept.name}>{dept.name}</div>
        <div style={{ marginTop: 8 }}><StackBar fresh={dept.fresh} atRisk={dept.atRisk} breached={dept.breached} /></div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
        <MiniCol label="Fresh" value={dept.fresh} color="#15803d" />
        <MiniCol label="At risk" value={dept.atRisk} color="#d97706" />
        <MiniCol label="Breached" value={dept.breached} color="#dc2626" />
        <MiniCol label="Urgent" value={dept.urgent} color={dept.urgent > 0 ? '#dc2626' : 'var(--text)'} />
        <MiniCol label="Compliance" value={`${dept.compliance}%`} color={compColor} />
      </div>
    </Card>
  );
}

export default function SlaPage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterSla);

  if (loading && !data) return <LoadingState rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];
  const t = data?.totals || {};

  return (
    <div>
      <SectionTitle title="HR Hub SLA & ageing" hint="Open HR Hub requests by age. Queue & Deel SLA lives in each department's own queue." />
      <StatRow style={{ marginBottom: 22 }}>
        <StatTile label="Open" value={t.open ?? 0} icon="bi-inbox" />
        <StatTile label="Fresh (<2d)" value={t.fresh ?? 0} icon="bi-check-circle" tone="#15803d" />
        <StatTile label="At risk (2–7d)" value={t.atRisk ?? 0} icon="bi-hourglass-split" tone={(t.atRisk ?? 0) > 0 ? '#d97706' : undefined} />
        <StatTile label="Breached (>7d)" value={t.breached ?? 0} icon="bi-exclamation-triangle" tone={(t.breached ?? 0) > 0 ? '#dc2626' : undefined} />
        <StatTile label="Compliance" value={`${t.compliance ?? 100}%`} icon="bi-stopwatch" />
      </StatRow>

      <SectionTitle title="By department" hint="Most breaches first" />
      {departments.length === 0
        ? <EmptyState text="No open HR Hub requests across departments — all clear." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{departments.map(d => <DeptSlaRow key={d.id} dept={d} />)}</div>}
    </div>
  );
}
