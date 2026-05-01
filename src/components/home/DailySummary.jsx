import { useMemo, useState, useEffect } from 'react';
import { slaInfo } from '../../utils/helpers';

const DailySummary = ({ tasks = [], escalations = [], scope = 'team' }) => {
  // SSR-safe time anchor — server's UTC and the client's local timezone
  // produced different values for `minsSinceStart` (and therefore different
  // resolved-today / breaches-today counts), driving the React #418
  // hydration error logged every page load. Defer the read until the
  // post-mount tick. Re-tick once a minute to keep the summary fresh.
  const [mountedAt, setMountedAt] = useState(null);
  useEffect(() => {
    setMountedAt(new Date());
    const id = setInterval(() => setMountedAt(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const stats = useMemo(() => {
    const now = mountedAt || new Date(0); // stable placeholder pre-mount
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msSinceStart = now - startOfDay;
    const minsSinceStart = msSinceStart / 60000;

    // Use updatedMinsAgo as proxy for resolved time (update happens at resolution)
    const resolvedToday = tasks.filter(t =>
      (t.status === 'resolved' || t.status === 'closed') &&
      (t.updatedMinsAgo ?? t.minutesAgo) <= minsSinceStart
    );

    // The "Resolved" tile uses the in-scope all-time resolved count so it
    // matches the Queue tab's Resolved counter (which is also all-time-in-
    // scope). Daily-only resolutions still drive the summary sentence
    // ("Today: N tasks resolved…") — that's the intent of that text.
    // Without this alignment, Home shows "Resolved 0" while Queue shows
    // "Resolved 7" for the same user, which reads as a real inconsistency.
    const resolvedAll = tasks.filter(t =>
      t.status === 'resolved' || t.status === 'closed'
    );

    const newToday = tasks.filter(t =>
      t.minutesAgo != null &&
      t.minutesAgo <= minsSinceStart
    );

    const escalatedToday = escalations.filter(e => {
      // Escalations may have createdAt timestamp — compute mins ago
      if (e.createdAt) {
        const minsAgo = (now - new Date(e.createdAt)) / 60000;
        return minsAgo <= minsSinceStart;
      }
      return false;
    });

    // Use canonical slaInfo() to detect breaches
    const breachesToday = tasks.filter(t => {
      const s = slaInfo(t);
      return s && s.breach;
    });

    // Busiest hour calculation
    const hourBuckets = {};
    newToday.forEach(t => {
      if (t.minutesAgo != null) {
        const createdTime = new Date(now.getTime() - t.minutesAgo * 60000);
        const hour = createdTime.getHours();
        hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;
      }
    });
    let busiestHour = null;
    let maxCount = 0;
    Object.entries(hourBuckets).forEach(([hour, count]) => {
      if (count > maxCount) { maxCount = count; busiestHour = parseInt(hour); }
    });

    const formatHour = (h) => {
      if (h === null) return null;
      const suffix = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 || 12;
      const nextH = (h + 1) % 24;
      const nextSuffix = nextH >= 12 ? 'pm' : 'am';
      const nextH12 = nextH % 12 || 12;
      return `${h12}${suffix}-${nextH12}${nextSuffix}`;
    };

    // "Completion" — share of today's incoming + held-over work that's
    // already been resolved today. NOT a workload metric (that's the
    // separate Workload chip on the hero ribbon, sized against a 30-task
    // baseline). Renamed away from "Capacity" because the previous label
    // collided with the Workload chip and confused agents who saw 0%
    // here while the Workload chip read "Good" for the same backlog.
    const openActive = tasks.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;
    const totalWork = resolvedToday.length + openActive;
    const completion = totalWork > 0 ? Math.round((resolvedToday.length / totalWork) * 100) : 100;

    const busiestStr = busiestHour !== null ? formatHour(busiestHour) : null;

    // Build summary string
    const parts = [];
    parts.push(`${resolvedToday.length} task${resolvedToday.length !== 1 ? 's' : ''} resolved`);
    parts.push(`${newToday.length} new received`);
    if (escalatedToday.length > 0) parts.push(`${escalatedToday.length} escalated`);
    if (breachesToday.length > 0) parts.push(`${breachesToday.length} SLA breach${breachesToday.length !== 1 ? 'es' : ''}`);

    let summary = `Today: ${parts.join(', ')}. ${scope === 'team' ? 'Team' : 'Ops'} completion rate ${completion}%.`;
    if (busiestStr) summary += ` Busiest period: ${busiestStr}.`;

    return {
      resolved: resolvedAll.length,
      resolvedToday: resolvedToday.length,
      newCount: newToday.length,
      escalated: escalatedToday.length,
      breaches: breachesToday.length,
      completion,
      busiestHour: busiestStr,
      summary
    };
  }, [tasks, escalations, scope, mountedAt]);

  const statItems = [
    { label: 'Resolved', value: stats.resolved, icon: 'bi-check-circle', color: '#16A34A' },
    { label: 'New', value: stats.newCount, icon: 'bi-plus-circle', color: '#2563EB' },
    { label: 'Escalated', value: stats.escalated, icon: 'bi-arrow-up-circle', color: '#D97706' },
    { label: 'Breaches', value: stats.breaches, icon: 'bi-exclamation-circle', color: '#DC2626' },
  ];

  return (
    <div style={{ background: '#f0f7ff', border: '1px solid #DBEAFE', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #DBEAFE', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-bar-chart-line" style={{ fontSize: 13, color: '#2563EB' }}></i>
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>Daily Summary</span>
        <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 'auto', fontWeight: 500 }} suppressHydrationWarning>
          {mountedAt ? mountedAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
        </span>
      </div>

      {/* Summary text */}
      <div style={{ padding: '14px 20px 10px' }}>
        <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
          {stats.summary}
        </p>
      </div>

      {/* Stat strip */}
      <div style={{ display: 'flex', padding: '8px 16px 14px', gap: 8 }}>
        {statItems.map(item => {
          // The Resolved tile mirrors the Queue's "Resolved" counter (all-time
          // in scope), not just today's resolutions, to keep the two surfaces
          // consistent. Include today's count in the tooltip so the day-level
          // detail isn't lost.
          const tooltip = item.label === 'Resolved'
            ? `${stats.resolved} resolved (in scope) — ${stats.resolvedToday} resolved today`
            : undefined;
          return (
            <div
              key={item.label}
              title={tooltip}
              style={{
                flex: 1, background: 'white', borderRadius: 10, padding: '10px 8px',
                textAlign: 'center', border: '1px solid #E5E7EB'
              }}
            >
              <i className={item.icon} style={{ fontSize: 14, color: item.color, display: 'block', marginBottom: 4 }}></i>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1b1b1b' }}>{item.value}</div>
              <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, marginTop: 2 }}>{item.label}</div>
            </div>
          );
        })}
        {/* Completion gauge — share of today's work that's been resolved. */}
        <div
          style={{
            flex: 1, background: 'white', borderRadius: 10, padding: '10px 8px',
            textAlign: 'center', border: '1px solid #E5E7EB'
          }}
          title="Share of today's work (incoming + carried over) that's been resolved today"
        >
          <i className="bi-speedometer2" style={{ fontSize: 14, color: stats.completion >= 70 ? '#16A34A' : stats.completion >= 40 ? '#D97706' : '#DC2626', display: 'block', marginBottom: 4 }}></i>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1b1b1b' }}>{stats.completion}%</div>
          <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, marginTop: 2 }}>Completion</div>
        </div>
      </div>
    </div>
  );
};

export default DailySummary;
