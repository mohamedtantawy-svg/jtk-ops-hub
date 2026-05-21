import { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// PeakTimesHeatmap — 5-day x 10-hour heatmap of ticket arrival times.
// Ljubica asked for this to help with shift planning.
// ---------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const HOUR_LABELS = HOURS.map((h) => `${h}:00`);

function cellColor(count, maxCount) {
  if (maxCount === 0 || count === 0) return '#fff';
  const ratio = count / maxCount;
  if (ratio > 0.85) return '#d42d35';   // peak — red
  if (ratio > 0.6) return '#7c3aed';    // dark purple
  if (ratio > 0.35) return '#a78bfa';   // medium purple
  if (ratio > 0.15) return '#ede9fe';   // light purple
  return '#f9f5ff';                     // very light
}

export default function PeakTimesHeatmap({ tasks = [] }) {
  const [tooltip, setTooltip] = useState(null);

  // Estimate day/hour from minutesAgo.
  // minutesAgo tells us how long ago the task was created.
  // We map that back to a weekday and hour.
  const grid = useMemo(() => {
    const counts = {};
    DAYS.forEach((d) => {
      counts[d] = {};
      HOURS.forEach((h) => {
        counts[d][h] = 0;
      });
    });

    const now = new Date();
    tasks.forEach((t) => {
      const mins = t.minutesAgo ?? 0;
      if (mins <= 0) return;
      const created = new Date(now.getTime() - mins * 60000);
      const dayIdx = created.getDay(); // 0=Sun
      // Map to Mon-Fri (1-5)
      if (dayIdx === 0 || dayIdx === 6) return; // skip weekends
      const dayLabel = DAYS[dayIdx - 1];
      const hour = created.getHours();
      if (hour < 8 || hour > 17) return; // outside business hours
      counts[dayLabel][hour] += 1;
    });

    return counts;
  }, [tasks]);

  const maxCount = useMemo(() => {
    let mx = 0;
    DAYS.forEach((d) => {
      HOURS.forEach((h) => {
        if (grid[d][h] > mx) mx = grid[d][h];
      });
    });
    return mx;
  }, [grid]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <i className="bi-clock-history" style={{ fontSize: 16, color: '#7c3aed' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Peak Hours Heatmap</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>Business hours, Mon-Fri</span>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 44 }} />
              {HOUR_LABELS.map((h) => (
                <th
                  key={h}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    padding: '0 2px 6px',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day}>
                <td
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    paddingRight: 8,
                    textAlign: 'right',
                  }}
                >
                  {day}
                </td>
                {HOURS.map((hour) => {
                  const count = grid[day][hour];
                  const bg = cellColor(count, maxCount);
                  const isHovered =
                    tooltip && tooltip.day === day && tooltip.hour === hour;
                  return (
                    <td
                      key={hour}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ day, hour, count, x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        background: bg,
                        borderRadius: 6,
                        height: 32,
                        minWidth: 38,
                        textAlign: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                        color: count / (maxCount || 1) > 0.6 ? '#fff' : '#9e9e9e',
                        cursor: 'default',
                        position: 'relative',
                        outline: isHovered ? '2px solid #7c3aed' : 'none',
                        transition: 'outline 0.1s',
                      }}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y - 36,
            transform: 'translateX(-50%)',
            background: '#1b1b1b',
            color: '#fff',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            zIndex: 999,
            pointerEvents: 'none',
          }}
        >
          {tooltip.day} {tooltip.hour}:00 — {tooltip.count} task{tooltip.count !== 1 ? 's' : ''}
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 14,
          justifyContent: 'flex-end',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Low</span>
        {['#f9f5ff', '#ede9fe', '#a78bfa', '#7c3aed', '#d42d35'].map((c) => (
          <span
            key={c}
            style={{
              width: 16,
              height: 10,
              borderRadius: 3,
              background: c,
              border: '1px solid var(--border)',
              display: 'inline-block',
            }}
          />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Peak</span>
      </div>
    </div>
  );
}
