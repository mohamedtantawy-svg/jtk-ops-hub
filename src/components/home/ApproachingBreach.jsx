import { useMemo } from 'react';

const SOURCE_ICONS = {
  email: 'bi-envelope',
  chat: 'bi-chat-dots',
  slack: 'bi-slack',
  phone: 'bi-telephone',
  portal: 'bi-globe',
  jira: 'bi-kanban',
  default: 'bi-ticket-perforated',
};

const ApproachingBreach = ({ tasks = [], slaInfo, onViewTask, limit = 5 }) => {
  const approachingTasks = useMemo(() => {
    if (typeof slaInfo !== 'function') return [];

    return tasks
      .map(task => {
        const info = slaInfo(task);
        if (!info || info.breach || info.remain == null) return null;
        if (info.remain >= 120) return null;
        return { ...task, _sla: info };
      })
      .filter(Boolean)
      .sort((a, b) => a._sla.remain - b._sla.remain)
      .slice(0, limit);
  }, [tasks, slaInfo, limit]);

  const formatRemaining = (mins) => {
    if (mins <= 0) return 'Now';
    if (mins < 60) return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const getUrgencyColor = (mins) => {
    if (mins <= 30) return '#DC2626'; // red - critical
    if (mins <= 60) return '#EA580C'; // orange - urgent
    return '#D97706'; // amber - warning
  };

  const getSourceIcon = (source) => {
    const s = (source || '').toLowerCase();
    return SOURCE_ICONS[s] || SOURCE_ICONS.default;
  };

  return (
    <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-alarm" style={{ fontSize: 13, color: '#D97706' }}></i>
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b', flex: 1 }}>Approaching Breach</span>
        {approachingTasks.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: '#D97706', borderRadius: 10, padding: '2px 8px' }}>
            {approachingTasks.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {approachingTasks.length === 0 ? (
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <i className="bi-shield-check" style={{ fontSize: 24, color: '#16A34A', display: 'block', marginBottom: 8 }}></i>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>No tickets approaching breach</div>
            <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 4 }}>All SLAs looking healthy</div>
          </div>
        ) : (
          approachingTasks.map((task, idx) => {
            const urgencyColor = getUrgencyColor(task._sla.remain);
            return (
              <div
                key={task.id || task.ticketId || idx}
                onClick={() => onViewTask && onViewTask(task)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
                  borderBottom: idx < approachingTasks.length - 1 ? '1px solid #f5f5f5' : 'none',
                  cursor: onViewTask ? 'pointer' : 'default', transition: 'background .12s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#FFFBEB'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Source icon */}
                <div style={{ width: 24, height: 24, borderRadius: 6, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={getSourceIcon(task.source)} style={{ fontSize: 11, color: '#666' }}></i>
                </div>

                {/* Ticket info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {task.subject || task.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>
                    {task.assigneeName || task.assigneeEmail || 'Unassigned'}
                    {task._sla.slaName && <span> &middot; {task._sla.slaName}</span>}
                  </div>
                </div>

                {/* Time remaining */}
                <div style={{
                  fontSize: 13, fontWeight: 800, color: urgencyColor, flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 4
                }}>
                  <i className="bi-clock" style={{ fontSize: 11 }}></i>
                  {formatRemaining(task._sla.remain)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ApproachingBreach;
