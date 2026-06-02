'use client';

// ── Command Center · Health ─────────────────────────────────────────────────
// Composite Health Score (0–100) per department + org-wide, with a transparent
// component breakdown (backlog / resolution / urgent load / staffing).

import React from 'react';
import { getCommandCenterHealth } from '../../../services/commandCenterApi';
import {
  Card, ScoreRing, SectionTitle, healthTone,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

function CompBar({ label, value }) {
  const t = healthTone(value);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3, var(--border))', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: t.color, transition: 'width .4s' }} />
      </div>
    </div>
  );
}

function DeptHealthCard({ dept }) {
  const t = healthTone(dept.score);
  const c = dept.components || {};
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <ScoreRing value={dept.score} color={t.color} size={64} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dept.name}>{dept.name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.color, marginTop: 2 }}>{t.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{dept.open} open · {dept.breached} aged · {dept.urgent} urgent</div>
        </div>
      </div>
      <CompBar label="Backlog" value={c.backlog ?? 0} />
      <CompBar label="Resolution" value={c.resolution ?? 0} />
      <CompBar label="Urgent load" value={c.urgent ?? 0} />
      <CompBar label="Staffing" value={c.staffing ?? 0} />
    </Card>
  );
}

export default function HealthPage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterHealth);

  if (loading && !data) return <LoadingState rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];
  const org = data?.org || { score: 100, components: {} };
  const ot = healthTone(org.score);

  return (
    <div>
      <style>{`.cc-h-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}@media(max-width:1100px){.cc-h-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.cc-h-grid{grid-template-columns:1fr}}`}</style>

      <SectionTitle title="Organization health" hint="Composite of backlog, resolution, urgent load & staffing across departments" />
      <Card style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <ScoreRing value={org.score} color={ot.color} size={104} label={ot.label} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <CompBar label="Backlog (aged open)" value={org.components?.backlog ?? 0} />
          <CompBar label="Resolution (30-day throughput)" value={org.components?.resolution ?? 0} />
          <CompBar label="Urgent load" value={org.components?.urgent ?? 0} />
          <CompBar label="Staffing (filled roles)" value={org.components?.staffing ?? 0} />
        </div>
      </Card>

      <SectionTitle title="By department" hint="Lowest score first" />
      {departments.length === 0
        ? <EmptyState text="No departments to score yet." />
        : <div className="cc-h-grid">{departments.map(d => <DeptHealthCard key={d.id} dept={d} />)}</div>}
    </div>
  );
}
