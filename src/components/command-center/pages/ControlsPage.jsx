'use client';

// ── Command Center · Controls ───────────────────────────────────────────────
// Side-by-side department comparison across every domain + executive CSV export.
// (Custom date ranges + threshold tuning are the next iteration.)

import React from 'react';
import { getCommandCenterSummary, downloadCommandCenterCsv } from '../../../services/commandCenterApi';
import {
  CC_ACCENT, Card, SectionTitle, healthTone,
  LoadingState, ErrorState, EmptyState, useCcResource,
} from '../ccUi';

const TH = { textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', whiteSpace: 'nowrap' };
const TD = { textAlign: 'right', padding: '10px', fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', borderTop: '1px solid var(--border)' };

function ExportButton() {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(false);
  const onClick = async () => {
    setErr(false); setBusy(true);
    try { await downloadCommandCenterCsv(); } catch { setErr(true); } finally { setBusy(false); }
  };
  return (
    <button type="button" disabled={busy} onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: CC_ACCENT, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
      <i className={`bi ${busy ? 'bi-arrow-clockwise' : 'bi-download'}`} /> {err ? 'Retry export' : busy ? 'Exporting…' : 'Export CSV'}
    </button>
  );
}

export default function ControlsPage() {
  const { data, loading, error, reload } = useCcResource(getCommandCenterSummary);

  if (loading && !data) return <LoadingState rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const departments = data?.departments || [];

  return (
    <div>
      <SectionTitle title="Department comparison" hint="Every department, side by side" right={<ExportButton />} />
      {departments.length === 0
        ? <EmptyState text="No departments to compare yet." />
        : (
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>Department</th>
                  <th style={TH}>Health</th><th style={TH}>Open</th><th style={TH}>Breached</th><th style={TH}>Urgent</th>
                  <th style={TH}>People</th><th style={TH}>Vacancies</th><th style={TH}>Out</th><th style={TH}>Risk crit</th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => {
                  const t = healthTone(d.health);
                  return (
                    <tr key={d.id}>
                      <td style={{ ...TD, textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.name}>{d.name}</td>
                      <td style={{ ...TD, fontWeight: 700, color: t.color }}>{d.health}</td>
                      <td style={TD}>{d.open}</td>
                      <td style={{ ...TD, color: d.breached > 0 ? '#dc2626' : 'var(--text-muted)' }}>{d.breached}</td>
                      <td style={{ ...TD, color: d.urgent > 0 ? '#dc2626' : 'var(--text-muted)' }}>{d.urgent}</td>
                      <td style={TD}>{d.headcount}</td>
                      <td style={{ ...TD, color: d.vacancies > 0 ? '#d97706' : 'var(--text-muted)' }}>{d.vacancies}</td>
                      <td style={{ ...TD, color: d.outToday > 0 ? '#d97706' : 'var(--text-muted)' }}>{d.outToday}</td>
                      <td style={{ ...TD, color: d.riskCritical > 0 ? '#dc2626' : 'var(--text-muted)' }}>{d.riskCritical}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      <div style={{ marginTop: 18, fontSize: 11, color: 'var(--text-muted)' }}>
        <i className="bi bi-info-circle" style={{ marginRight: 6 }} />
        Custom date ranges and threshold tuning are the next iteration. Reports currently use a 30-day window + live snapshots.
      </div>
    </div>
  );
}
