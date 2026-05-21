import { useState, useMemo } from 'react';

const OOOAlert = ({ tasks = [], onLeaveEmails = new Set(), members = [], onReassign, onViewTask }) => {
  const [expanded, setExpanded] = useState(false);

  const oooTasks = useMemo(() => {
    if (!onLeaveEmails || onLeaveEmails.size === 0) return [];
    return tasks.filter(t =>
      t.assigneeEmail &&
      onLeaveEmails.has(t.assigneeEmail) &&
      t.status !== 'resolved' &&
      t.status !== 'closed'
    );
  }, [tasks, onLeaveEmails]);

  const getMemberName = (email) => {
    const member = members.find(m => m.email === email);
    return member ? member.name : email;
  };

  const formatTimeSince = (updatedMinsAgo) => {
    if (!updatedMinsAgo && updatedMinsAgo !== 0) return '';
    if (updatedMinsAgo < 60) return `${Math.round(updatedMinsAgo)}m ago`;
    if (updatedMinsAgo < 1440) return `${Math.round(updatedMinsAgo / 60)}h ago`;
    return `${Math.round(updatedMinsAgo / 1440)}d ago`;
  };

  if (oooTasks.length === 0) return null;

  return (
    <div style={{ background: '#FFF5F5', border: '1px solid #FED7D7', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header / Banner */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        style={{
          width: '100%', padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left'
        }}
      >
        <div style={{ width: 30, height: 30, borderRadius: 9, background: '#FED7D7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className="bi-exclamation-triangle-fill" style={{ fontSize: 13, color: '#E53E3E' }}></i>
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#C53030' }}>
            {oooTasks.length} ticket{oooTasks.length !== 1 ? 's' : ''} assigned to OOO members
          </span>
          <span style={{ fontSize: 11, color: '#E53E3E', marginLeft: 8, fontWeight: 500 }}>
            Needs reassignment
          </span>
        </div>
        <i className={expanded ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 12, color: '#E53E3E' }}></i>
      </button>

      {/* Expandable ticket list */}
      {expanded && (
        <div style={{ borderTop: '1px solid #FED7D7', padding: '4px 16px 12px' }}>
          {oooTasks.map(task => (
            <div
              key={task.id || task.ticketId}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px',
                borderBottom: '1px solid #FED7D7'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: onViewTask ? 'pointer' : 'default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => onViewTask && onViewTask(task)}
                >
                  {task.subject || task.title || 'Untitled'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8 }}>
                  <span>
                    <i className="bi-person" style={{ marginRight: 3 }}></i>
                    {getMemberName(task.assigneeEmail)}
                  </span>
                  {task.updatedMinsAgo != null && (
                    <span>
                      <i className="bi-clock" style={{ marginRight: 3 }}></i>
                      Updated {formatTimeSince(task.updatedMinsAgo)}
                    </span>
                  )}
                </div>
              </div>
              {onReassign && (
                <button
                  onClick={() => onReassign(task)}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 14, border: '1px solid #E53E3E',
                    background: 'var(--surface)', color: '#E53E3E', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', flexShrink: 0, transition: 'all .15s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#E53E3E'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#E53E3E'; }}
                >
                  Reassign
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OOOAlert;
