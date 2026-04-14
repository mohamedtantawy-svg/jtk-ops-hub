import { useMemo } from 'react';

const DailySummary = ({ tasks = [], escalations = [], scope = 'team' }) => {
  const stats = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msSinceStart = now - startOfDay;
    const minsSinceStart = msSinceStart / 60000;

    const resolvedToday = tasks.filter(t =>
      (t.status === 'resolved' || t.status === 'closed') &&
      t.resolvedMinsAgo != null &&
      t.resolvedMinsAgo <= minsSinceStart
    );

    const newToday = tasks.filter(t =>
      t.createdMinsAgo != null &&
      t.createdMinsAgo <= minsSinceStart
    );

    const escalatedToday = escalations.filter(e =>
      e.createdMinsAgo != null &&
      e.createdMinsAgo <= minsSinceStart
    );

    const breachesToday = tasks.filter(t =>
      t.slaBreached === true &&
      t.breachedMinsAgo != null &&
      t.breachedMinsAgo <= minsSinceStart
    );

    // Busiest hour calculation
    const hourBuckets = {};
    newToday.forEach(t => {
      if (t.createdMinsAgo != null) {
        const createdTime = new Date(now.getTime() - t.createdMinsAgo * 60000);
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

    // Simple capacity estimate: resolved / (resolved + open active) as percentage
    const openActive = tasks.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;
    const totalWork = resolvedToday.length + openActive;
    const capacity = totalWork > 0 ? Math.round((resolvedToday.length / totalWork) * 100) : 100;

    const busiestStr = busiestHour !== null ? formatHour(busiestHour) : null;

    // Build summary string
    const parts = [];
    parts.push(`${resolvedToday.length} task${resolvedToday.length !== 1 ? 's' : ''} resolved`);
    parts.push(`${newToday.length} new received`);
    if (escalatedToday.length > 0) parts.push(`${escalatedToday.length} escalated`);
    if (breachesToday.length > 0) parts.push(`${breachesToday.length} SLA breach${breachesToday.length !== 1 ? 'es' : ''}`);

    let summary = `Today: ${parts.join(', ')}. ${scope === 'team' ? 'Team' : 'Ops'} running at ${capacity}% capacity.`;
    if (busiestStr) summary += ` Busiest period: ${busiestStr}.`;

    return {
      resolved: resolvedToday.length,
      newCount: newToday.length,
      escalated: escalatedToday.length,
      breaches: breachesToday.length,
      capacity,
      busiestHour: busiestStr,
      summary
    };
  }, [tasks, escalations, scope]);

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
        <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 'auto', fontWeight: 500 }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
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
        {statItems.map(item => (
          <div
            key={item.label}
            style={{
              flex: 1, background: 'white', borderRadius: 10, padding: '10px 8px',
              textAlign: 'center', border: '1px solid #E5E7EB'
            }}
          >
            <i className={item.icon} style={{ fontSize: 14, color: item.color, display: 'block', marginBottom: 4 }}></i>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1b1b1b' }}>{item.value}</div>
            <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
        {/* Capacity gauge */}
        <div
          style={{
            flex: 1, background: 'white', borderRadius: 10, padding: '10px 8px',
            textAlign: 'center', border: '1px solid #E5E7EB'
          }}
        >
          <i className="bi-speedometer2" style={{ fontSize: 14, color: stats.capacity >= 70 ? '#16A34A' : stats.capacity >= 40 ? '#D97706' : '#DC2626', display: 'block', marginBottom: 4 }}></i>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1b1b1b' }}>{stats.capacity}%</div>
          <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, marginTop: 2 }}>Capacity</div>
        </div>
      </div>
    </div>
  );
};

export default DailySummary;
