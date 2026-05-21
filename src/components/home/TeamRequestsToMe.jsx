import { useMemo } from 'react';

const PRIORITY_COLORS = {
  high: { bg: '#FEE2E2', color: '#DC2626' },
  medium: { bg: '#FEF3C7', color: '#D97706' },
  low: { bg: '#E0E7FF', color: '#4F46E5' },
};

const TeamRequestsToMe = ({ requests = [], currentUser = {}, members = [], onViewRequest }) => {
  const teamRequests = useMemo(() => {
    if (!currentUser?.id && !currentUser?.email) return [];
    const directReportIds = new Set(
      members
        .filter(m => m.managerId === currentUser.id || m.managerEmail === currentUser.email)
        .map(m => m.id)
    );
    return requests.filter(r =>
      directReportIds.has(r.from_member_id) &&
      r.status !== 'resolved' &&
      r.status !== 'closed'
    );
  }, [requests, currentUser, members]);

  const getMemberName = (memberId) => {
    const member = members.find(m => m.id === memberId);
    return member ? member.name : 'Unknown';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const getPriorityStyle = (priority) => {
    const p = (priority || 'low').toLowerCase();
    return PRIORITY_COLORS[p] || PRIORITY_COLORS.low;
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #f3eff8, #EDE9FE)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="bi-people" style={{ fontSize: 13, color: '#7c3aed' }}></i>
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', flex: 1 }}>Team Requests to Me</span>
        {teamRequests.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: '#7c3aed', borderRadius: 10, padding: '2px 8px' }}>
            {teamRequests.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {teamRequests.length === 0 ? (
          <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            <i className="bi-check-circle" style={{ fontSize: 20, display: 'block', marginBottom: 6, opacity: 0.4 }}></i>
            No pending team requests
          </div>
        ) : (
          teamRequests.map((req, idx) => (
            <div
              key={req.id || idx}
              onClick={() => onViewRequest && onViewRequest(req)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
                borderBottom: idx < teamRequests.length - 1 ? '1px solid #f5f5f5' : 'none',
                cursor: onViewRequest ? 'pointer' : 'default', transition: 'background .12s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Subject & from */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {req.subject || req.title || 'Untitled Request'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  <i className="bi-person" style={{ marginRight: 3 }}></i>
                  {getMemberName(req.from_member_id)}
                </div>
              </div>

              {/* Priority pill */}
              {req.priority && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: getPriorityStyle(req.priority).bg,
                  color: getPriorityStyle(req.priority).color,
                  textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 0
                }}>
                  {req.priority}
                </span>
              )}

              {/* Status pill */}
              {req.status && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: 'var(--surface-3)', color: '#666', flexShrink: 0
                }}>
                  {req.status}
                </span>
              )}

              {/* Date */}
              <span style={{ fontSize: 11, color: '#b0b0b0', flexShrink: 0, minWidth: 50, textAlign: 'right' }}>
                {formatDate(req.createdAt || req.date)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TeamRequestsToMe;
