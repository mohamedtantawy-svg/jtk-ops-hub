'use client';

// ── Command Center · Capacity & load ────────────────────────────────────────
// Cross-department load signal: open HR Hub work per person, banded. The
// detailed capacity model (Kristina's) lives in each dept's Leaders Hub — this
// is the executive cross-dept view, computed from internal data (no live scans).

import React from 'react';
import { getCommandCenterCapacity } from '../../../services/commandCenterApi';
import {
  Card, StatRow, StatTile, SectionTitle,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

const BAND = { low: { c: '#15803d', l: 'Low' }, good: { c: '#1f74b3', l: 'Good' }, high: { c: '#dc2626', l: 'High' } };

function Col({ value, label, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 60 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function DeptCapRow({ dept, maxLpp }) {
  const b = BAND[dept.band] || BAND.good;
  const pct = maxLpp > 0 ? Math.round((dept.loadPerPerson / maxLpp) * 100) : 0;
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 200px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dept.name}>{dept.name}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: b.c, flexShrink: 0 }}>{b.l}</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3, var(--border))', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: b.c, transition: 'width .4s' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        <Col value={dept.loadPerPerson} label="Open / person" color={b.c} />
        <Col value={dept.open} label="Open" />
        <Col value={dept.headcount} label="People" />
      </div>
    </Card>
  );
}

export default function CapacityPage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterCapacity);

  if (loading && !data) return <LoadingState rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];
  const t = data?.totals || {};
  const maxLpp = Math.max(1, ...departments.map(d => d.loadPerPerson || 0));

  return (
    <div>
      <SectionTitle title="Capacity & load" hint="Open HR Hub work per person across departments. Detailed capacity lives in each dept's Leaders Hub." />
      <StatRow style={{ marginBottom: 22 }}>
        <StatTile label="Open work" value={t.open ?? 0} icon="bi-inbox" />
        <StatTile label="People" value={t.headcount ?? 0} icon="bi-people" />
        <StatTile label="Avg open / person" value={t.loadPerPerson ?? 0} icon="bi-speedometer" />
      </StatRow>

      <SectionTitle title="By department" hint="Highest load first" />
      {departments.length === 0
        ? <EmptyState text="No departments yet." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{departments.map(d => <DeptCapRow key={d.id} dept={d} maxLpp={maxLpp} />)}</div>}
    </div>
  );
}
