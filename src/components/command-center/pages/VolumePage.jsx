'use client';

// ── Command Center · Volume & throughput ────────────────────────────────────
// Org-wide HR Hub created-vs-resolved over a selectable window (7 / 30 / 90 days)
// + per-department totals. Net backlog delta flags whether the org is keeping up.

import React from 'react';
import { getCommandCenterVolume } from '../../../services/commandCenterApi';
import {
  CC_ACCENT, Card, StatRow, StatTile, MiniStat, SectionTitle,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

const WINDOWS = [7, 30, 90];

function TrendChart({ series }) {
  const max = Math.max(1, ...series.map(d => Math.max(d.created, d.resolved)));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: series.length > 45 ? 1 : 2, height: 130 }}>
      {series.map((d, i) => (
        <div key={i} title={`${d.date}: ${d.created} created · ${d.resolved} resolved`}
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1, height: '100%' }}>
          <div style={{ height: `${(d.created / max) * 100}%`, background: CC_ACCENT, borderRadius: '2px 2px 0 0', minHeight: d.created > 0 ? 2 : 0 }} />
          <div style={{ height: `${(d.resolved / max) * 100}%`, background: '#15803d', borderRadius: '0 0 2px 2px', minHeight: d.resolved > 0 ? 2 : 0 }} />
        </div>
      ))}
    </div>
  );
}

function WindowPicker({ days, onChange, disabled }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
      {WINDOWS.map(w => (
        <button key={w} type="button" disabled={disabled} onClick={() => onChange(w)}
          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: disabled ? 'default' : 'pointer', fontSize: 12, fontWeight: 600,
            background: days === w ? 'var(--surface)' : 'transparent', color: days === w ? CC_ACCENT : 'var(--text-secondary)', boxShadow: days === w ? 'var(--shadow-sm)' : 'none' }}>
          {w}d
        </button>
      ))}
    </div>
  );
}

export default function VolumePage() {
  const [days, setDays] = React.useState(30);
  const { data, loading, error, reload } = useCcResource(() => getCommandCenterVolume(days));
  // Re-fetch when the window changes (mount fetch is deduped by the hook's in-flight guard).
  React.useEffect(() => { reload(); }, [days, reload]);

  if (loading && !data) return <LoadingState rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const series = data?.series || [];
  const departments = data?.departments || [];
  const t = data?.totals || {};
  const win = data?.windowDays || days;
  const net = (t.created ?? 0) - (t.resolved ?? 0);

  return (
    <div>
      <style>{`.cc-v-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}@media(max-width:1100px){.cc-v-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.cc-v-grid{grid-template-columns:1fr}}`}</style>

      <SectionTitle title={`HR Hub volume — last ${win} days`} hint="Created vs resolved across all departments" right={<WindowPicker days={days} onChange={setDays} disabled={loading} />} />
      <StatRow style={{ marginBottom: 18 }}>
        <StatTile label={`Created (${win}d)`} value={t.created ?? 0} icon="bi-arrow-down-circle" />
        <StatTile label={`Resolved (${win}d)`} value={t.resolved ?? 0} icon="bi-check2-circle" tone="#15803d" />
        <StatTile label="Net backlog Δ" value={`${net > 0 ? '+' : ''}${net}`} icon="bi-graph-up-arrow" tone={net > 0 ? '#dc2626' : '#15803d'} />
        <StatTile label="Open now" value={t.openNow ?? 0} icon="bi-inbox" />
      </StatRow>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span><i className="bi bi-square-fill" style={{ color: CC_ACCENT }} /> Created</span>
          <span><i className="bi bi-square-fill" style={{ color: '#15803d' }} /> Resolved</span>
        </div>
        {series.length === 0 ? <EmptyState text="No HR Hub volume in this window." /> : <TrendChart series={series} />}
      </Card>

      <SectionTitle title={`By department — ${win} days`} hint="Busiest first" />
      {departments.length === 0
        ? <EmptyState text="No department volume yet." />
        : (
          <div className="cc-v-grid">
            {departments.map(d => (
              <Card key={d.id}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 12 }} title={d.name}>{d.name}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <MiniStat label="Created" value={d.created} />
                  <MiniStat label="Resolved" value={d.resolved} tone="good" />
                  <MiniStat label="Open" value={d.openNow} />
                </div>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
