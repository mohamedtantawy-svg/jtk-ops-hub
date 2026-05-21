import { useState, useMemo } from 'react';
import { FUNCTIONS } from '../../data/constants';

// ---------------------------------------------------------------------------
// TaskBreakdownChart — resolved tasks by type with period toggle.
// Ljubica asked for daily / weekly / monthly / quarterly breakdown.
// ---------------------------------------------------------------------------

const PERIODS = [
  { id: 'daily', label: 'Daily', days: 1 },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'monthly', label: 'Monthly', days: 30 },
  { id: 'quarterly', label: 'Quarterly', days: 90 },
];

const PILL_BASE = {
  padding: '5px 14px',
  borderRadius: 128,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  transition: 'all 0.15s',
};

export default function TaskBreakdownChart({ tasks = [] }) {
  const [period, setPeriod] = useState('weekly');

  const periodDays = PERIODS.find((p) => p.id === period)?.days || 7;
  const periodMins = periodDays * 24 * 60;

  const data = useMemo(() => {
    const resolved = tasks.filter(
      (t) => t.status === 'resolved' && (t.minutesAgo ?? 0) <= periodMins
    );

    const groups = {};
    resolved.forEach((t) => {
      const typ = t.type || 'Policy Query';
      if (!groups[typ]) groups[typ] = 0;
      groups[typ] += 1;
    });

    const total = resolved.length || 1;

    return Object.entries(groups)
      .map(([typ, count]) => {
        const fn = FUNCTIONS[typ] || { label: typ, color: 'var(--text-muted)', bg: '#f7f5f2' };
        return {
          key: typ,
          label: fn.label,
          color: fn.color,
          bg: fn.bg,
          count,
          pct: ((count / total) * 100).toFixed(1),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [tasks, periodMins]);

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const totalResolved = data.reduce((s, d) => s + d.count, 0);

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="bi-pie-chart" style={{ fontSize: 16, color: '#7c3aed' }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Task Breakdown
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              background: 'var(--surface-3)',
              padding: '2px 8px',
              borderRadius: 128,
              fontWeight: 600,
            }}
          >
            {totalResolved} resolved
          </span>
        </div>

        {/* Period toggle pills */}
        <div style={{ display: 'flex', background: 'var(--surface-3)', borderRadius: 128, padding: 3, gap: 2 }}>
          {PERIODS.map((p) => {
            const active = period === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                style={{
                  ...PILL_BASE,
                  background: active ? '#7c3aed' : 'transparent',
                  color: active ? '#fff' : '#616161',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {data.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>
          No resolved tasks in this period
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map((d) => {
            const barPct = (d.count / maxCount) * 100;
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Dot + label */}
                <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: d.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={d.key}
                  >
                    {d.label}
                  </span>
                </div>

                {/* Bar */}
                <div style={{ flex: 1, background: '#f2f2f2', borderRadius: 128, height: 10, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(3, barPct)}%`,
                      height: '100%',
                      background: d.color,
                      borderRadius: 128,
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>

                {/* Count + pct */}
                <div style={{ width: 70, textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{d.count}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>({d.pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
