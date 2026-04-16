import { useState, useMemo } from 'react';
import { FUNCTIONS, SLA_MINS } from '../../data/constants';
import { MEMBERS } from '../../data/members';

// ---------------------------------------------------------------------------
// AgentProductivity — extended agent performance with capacity & weighting.
// Kristina asked for "tasks/calls/tags completed/OOO events per period
// turned into capacity %". Includes task-weight system.
// ---------------------------------------------------------------------------

const TASK_WEIGHTS = {
  Offboarding: 3,
  Onboarding: 2,
  Immigration: 2,
};
const DEFAULT_WEIGHT = 1;

function getWeight(type) {
  return TASK_WEIGHTS[type] || DEFAULT_WEIGHT;
}

function fmtTime(mins) {
  if (mins == null || isNaN(mins)) return '--';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SORT_COLS = [
  { key: 'name', label: 'Agent' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'open', label: 'Open' },
  { key: 'avgResponse', label: 'Avg Resp.' },
  { key: 'slaCompliance', label: 'SLA %' },
  { key: 'escalRate', label: 'Esc. Rate' },
  { key: 'weightedLoad', label: 'Wt. Load' },
  { key: 'capacity', label: 'Capacity %' },
];

const TH_STYLE = {
  fontSize: 11,
  fontWeight: 700,
  color: '#9e9e9e',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  padding: '8px 10px',
  textAlign: 'left',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  borderBottom: '1px solid #e8e8e8',
};

const TD_STYLE = {
  fontSize: 12,
  padding: '8px 10px',
  borderBottom: '1px solid #f2f2f2',
  color: '#1b1b1b',
};

function CapacityBar({ pct }) {
  let color = '#29811e';
  if (pct > 120) color = '#d42d35';
  else if (pct > 100) color = '#ed8d00';
  else if (pct > 80) color = '#ed8d00';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, background: '#f2f2f2', borderRadius: 128, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.min(100, (pct / 150) * 100)}%`,
            height: '100%',
            background: color,
            borderRadius: 128,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color }}>{pct}%</span>
    </div>
  );
}

function SlaCell({ pct }) {
  const color = pct >= 90 ? '#29811e' : pct >= 75 ? '#ed8d00' : '#d42d35';
  return <span style={{ fontWeight: 700, color }}>{pct}%</span>;
}

export default function AgentProductivity({ tasks = [], members: membersProp, dateRange }) {
  const [sortCol, setSortCol] = useState('capacity');
  const [sortDir, setSortDir] = useState('desc');

  const agentMembers = useMemo(
    () => (membersProp || MEMBERS).filter((m) => m.role === 'agent'),
    [membersProp]
  );

  const stats = useMemo(() => {
    const allOpen = tasks.filter((t) => t.status !== 'resolved');

    // Compute team-wide averages for capacity calc
    const allAgentLoads = agentMembers.map((a) => {
      const agentTasks = tasks.filter((t) => t.assigneeId === a.id);
      return agentTasks.reduce((sum, t) => sum + getWeight(t.type), 0);
    });
    const teamAvgLoad =
      allAgentLoads.length > 0
        ? allAgentLoads.reduce((a, b) => a + b, 0) / allAgentLoads.length
        : 1;

    return agentMembers.map((a) => {
      const agentTasks = tasks.filter((t) => t.assigneeId === a.id);
      const assigned = agentTasks.length;
      const resolved = agentTasks.filter((t) => t.status === 'resolved').length;
      const open = agentTasks.filter((t) => t.status !== 'resolved').length;

      // Avg response time (use minutesSinceLastResponse or minutesAgo)
      const responseTimes = agentTasks
        .filter((t) => t.status !== 'resolved')
        .map((t) => (t.minutesSinceLastResponse != null ? t.minutesSinceLastResponse : (t.minutesAgo ?? 0)));
      const avgResponse =
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0;

      // SLA compliance: resolved tasks within SLA limit
      const resolvedTasks = agentTasks.filter((t) => t.status === 'resolved');
      const withinSla = resolvedTasks.filter((t) => {
        const limit = SLA_MINS[t.type] || 1440;
        const elapsed = t.minutesSinceLastResponse != null ? t.minutesSinceLastResponse : (t.minutesAgo ?? 0);
        return elapsed <= limit;
      }).length;
      const slaCompliance = resolvedTasks.length > 0 ? Math.round((withinSla / resolvedTasks.length) * 100) : 100;

      // Escalation rate
      const escalated = agentTasks.filter((t) => t.status === 'escalated').length;
      const escalRate = assigned > 0 ? ((escalated / assigned) * 100).toFixed(1) : '0.0';

      // Weighted load
      const weightedLoad = agentTasks.reduce((sum, t) => sum + getWeight(t.type), 0);

      // Capacity % — based on weighted load vs team average, capped at 150
      const capacity = teamAvgLoad > 0 ? Math.min(150, Math.round((weightedLoad / teamAvgLoad) * 100)) : 0;

      return {
        id: a.id,
        name: a.name,
        initials: a.initials,
        avatarUrl: a.avatarUrl,
        team: a.team,
        assigned,
        resolved,
        open,
        avgResponse,
        slaCompliance,
        escalRate: parseFloat(escalRate),
        weightedLoad,
        capacity,
      };
    });
  }, [tasks, agentMembers]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...stats].sort((a, b) => {
      if (sortCol === 'name') return dir * a.name.localeCompare(b.name);
      const va = a[sortCol] ?? 0;
      const vb = b[sortCol] ?? 0;
      return dir * (va - vb);
    });
  }, [stats, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e8e8e8',
        borderRadius: 16,
        padding: 20,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <i className="bi-people" style={{ fontSize: 16, color: '#7c3aed' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1b1b1b' }}>Agent Productivity</span>
        <span style={{ fontSize: 12, color: '#9e9e9e', marginLeft: 'auto' }}>
          {agentMembers.length} agents
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
          <thead>
            <tr>
              {SORT_COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{
                    ...TH_STYLE,
                    color: sortCol === col.key ? '#7c3aed' : '#9e9e9e',
                  }}
                >
                  {col.label}
                  {sortCol === col.key ? (
                    <i
                      className={`bi-caret-${sortDir === 'asc' ? 'up' : 'down'}-fill`}
                      style={{ fontSize: 9, marginLeft: 3 }}
                    />
                  ) : (
                    <i className="bi-chevron-expand" style={{ fontSize: 9, marginLeft: 3, color: '#dedede' }} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                style={{ transition: 'background 0.1s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#faf8ff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Agent name + avatar */}
                <td style={{ ...TD_STYLE, display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
                  <img
                    src={row.avatarUrl}
                    alt={row.initials}
                    style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{row.name}</div>
                    <div style={{ fontSize: 10, color: '#9e9e9e' }}>{row.team}</div>
                  </div>
                </td>
                <td style={TD_STYLE}>{row.assigned}</td>
                <td style={{ ...TD_STYLE, fontWeight: 600, color: '#29811e' }}>{row.resolved}</td>
                <td style={{ ...TD_STYLE, color: row.open > 0 ? '#ed8d00' : '#9e9e9e' }}>{row.open}</td>
                <td style={TD_STYLE}>{fmtTime(row.avgResponse)}</td>
                <td style={TD_STYLE}>
                  <SlaCell pct={row.slaCompliance} />
                </td>
                <td style={{ ...TD_STYLE, color: row.escalRate > 5 ? '#d42d35' : '#1b1b1b' }}>
                  {row.escalRate}%
                </td>
                <td style={{ ...TD_STYLE, fontWeight: 600 }}>{row.weightedLoad}</td>
                <td style={TD_STYLE}>
                  <CapacityBar pct={row.capacity} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Task weight legend */}
      <div
        style={{
          marginTop: 16,
          padding: '10px 14px',
          background: '#f9f5ff',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed' }}>
          <i className="bi-info-circle" style={{ marginRight: 4 }} />
          Task Weights:
        </span>
        {Object.entries(TASK_WEIGHTS).map(([type, w]) => (
          <span key={type} style={{ fontSize: 11, color: '#616161' }}>
            <span style={{ fontWeight: 600 }}>{type}</span> = {w}x
          </span>
        ))}
        <span style={{ fontSize: 11, color: '#616161' }}>
          <span style={{ fontWeight: 600 }}>Others</span> = {DEFAULT_WEIGHT}x
        </span>
        <span style={{ fontSize: 10, color: '#9e9e9e', marginLeft: 'auto' }}>
          Capacity % = weighted load / team avg
        </span>
      </div>
    </div>
  );
}
