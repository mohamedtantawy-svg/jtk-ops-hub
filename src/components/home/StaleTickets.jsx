import { useState, useMemo } from 'react';

const DAY_OPTIONS = [1, 3, 5, 7, 14];

const StaleTickets = ({ tasks = [], defaultDays = 3 }) => {
  const [days, setDays] = useState(defaultDays);
  const [expandedGroups, setExpandedGroups] = useState({});

  const thresholdMins = days * 24 * 60;

  const staleByType = useMemo(() => {
    const stale = tasks.filter(t =>
      t.updatedMinsAgo != null &&
      t.updatedMinsAgo > thresholdMins &&
      t.status !== 'resolved' &&
      t.status !== 'closed'
    );

    const grouped = {};
    stale.forEach(t => {
      const type = t.type || 'Other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(t);
    });

    // Sort groups by count descending
    return Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
  }, [tasks, thresholdMins]);

  const totalStale = staleByType.reduce((sum, [, items]) => sum + items.length, 0);

  const toggleGroup = (type) => {
    setExpandedGroups(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const formatAge = (minsAgo) => {
    if (!minsAgo && minsAgo !== 0) return '';
    const d = Math.floor(minsAgo / 1440);
    const h = Math.floor((minsAgo % 1440) / 60);
    if (d > 0) return `${d}d ${h}h`;
    return `${h}h`;
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid #e8e8e8', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-hourglass-split" style={{ fontSize: 13, color: '#D97706' }}></i>
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b', flex: 1 }}>Stale Tickets</span>

        {/* Days dropdown */}
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          style={{
            height: 28, padding: '0 8px', borderRadius: 8, border: '1px solid #e8e8e8',
            fontSize: 11, fontWeight: 600, color: '#666', background: '#fafafa',
            cursor: 'pointer', outline: 'none', fontFamily: 'inherit'
          }}
        >
          {DAY_OPTIONS.map(d => (
            <option key={d} value={d}>{d} day{d !== 1 ? 's' : ''}</option>
          ))}
        </select>

        {totalStale > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: '#D97706', borderRadius: 10, padding: '2px 8px' }}>
            {totalStale}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {totalStale === 0 ? (
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <i className="bi-check-circle-fill" style={{ fontSize: 24, color: '#16A34A', display: 'block', marginBottom: 8 }}></i>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>All tickets active</div>
            <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 4 }}>No tickets stale for {days}+ day{days !== 1 ? 's' : ''}</div>
          </div>
        ) : (
          staleByType.map(([type, items]) => (
            <div key={type}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(type)}
                style={{
                  width: '100%', padding: '10px 20px', background: '#fafafa', border: 'none',
                  borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', gap: 8, textAlign: 'left'
                }}
              >
                <i className={expandedGroups[type] ? 'bi-chevron-down' : 'bi-chevron-right'} style={{ fontSize: 10, color: '#9e9e9e' }}></i>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', flex: 1 }}>{type}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#D97706', background: '#FEF3C7',
                  borderRadius: 10, padding: '1px 7px'
                }}>
                  {items.length}
                </span>
              </button>

              {/* Expanded tickets */}
              {expandedGroups[type] && items.map(task => (
                <div
                  key={task.id || task.ticketId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px 8px 36px',
                    borderBottom: '1px solid #f5f5f5'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#1b1b1b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {task.subject || task.title || 'Untitled'}
                    </div>
                    {task.assigneeEmail && (
                      <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 1 }}>
                        {task.assigneeName || task.assigneeEmail}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706', flexShrink: 0 }}>
                    {formatAge(task.updatedMinsAgo)} idle
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default StaleTickets;
