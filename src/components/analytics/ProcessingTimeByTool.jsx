import { useMemo } from 'react';
import { TOOLS } from '../../data/constants';

// ---------------------------------------------------------------------------
// ProcessingTimeByTool — horizontal bar chart of avg processing time by source.
// Ljubica asked for this to identify slow tool pipelines.
// ---------------------------------------------------------------------------

function fmtHours(mins) {
  if (mins == null || isNaN(mins)) return '—';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function ProcessingTimeByTool({ tasks = [] }) {
  const data = useMemo(() => {
    // Group resolved tasks by source
    const resolved = tasks.filter((t) => t.status === 'resolved');
    const groups = {};

    resolved.forEach((t) => {
      const src = t.source || 'custom';
      if (!groups[src]) groups[src] = { totalMins: 0, count: 0 };
      // Use minutesAgo as proxy for processing time (time from creation to now for resolved)
      groups[src].totalMins += t.minutesAgo ?? 0;
      groups[src].count += 1;
    });

    return Object.entries(groups)
      .map(([src, { totalMins, count }]) => {
        const tool = TOOLS[src] || TOOLS.custom;
        const avgMins = count > 0 ? totalMins / count : 0;
        return {
          key: src,
          label: tool.label,
          icon: tool.icon,
          color: tool.color,
          bg: tool.bg,
          count,
          avgMins,
        };
      })
      .sort((a, b) => b.avgMins - a.avgMins);
  }, [tasks]);

  const maxMins = Math.max(...data.map((d) => d.avgMins), 1);

  if (data.length === 0) {
    return (
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid #e8e8e8',
          borderRadius: 16,
          padding: 20,
          textAlign: 'center',
          color: '#9e9e9e',
          fontSize: 13,
        }}
      >
        No resolved tasks to analyze
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid #e8e8e8',
        borderRadius: 16,
        padding: 20,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <i className="bi-stopwatch" style={{ fontSize: 16, color: '#7c3aed' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>
          Avg Processing Time by Source
        </span>
        <span style={{ fontSize: 12, color: '#9e9e9e', marginLeft: 'auto' }}>
          {tasks.filter((t) => t.status === 'resolved').length} resolved tasks
        </span>
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((d) => {
          const pct = (d.avgMins / maxMins) * 100;
          return (
            <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Icon + label */}
              <div
                style={{
                  width: 110,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: d.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <i className={d.icon} style={{ fontSize: 13, color: d.color }} />
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1b1b1b' }}>
                  {d.label}
                </span>
              </div>

              {/* Bar */}
              <div
                style={{
                  flex: 1,
                  background: '#f2f2f2',
                  borderRadius: 128,
                  height: 10,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    height: '100%',
                    background: d.color,
                    borderRadius: 128,
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>

              {/* Value */}
              <div style={{ width: 70, textAlign: 'right', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b' }}>
                  {fmtHours(d.avgMins)}
                </span>
                <span style={{ fontSize: 10, color: '#9e9e9e', marginLeft: 4 }}>
                  ({d.count})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
