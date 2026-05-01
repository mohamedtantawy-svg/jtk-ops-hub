import { useState, useMemo, useContext, useCallback } from 'react';
import { TOOLS, FUNCTIONS, FLAGS, SLA_MINS } from '../../data/constants';
import { MEMBERS } from '../../data/members';
import { HOURLY_VOLUME } from '../../data/feed';
import { SettingsContext, PermissionsContext, IntegrationsContext } from '../../App';
import { slaInfo } from '../../utils/helpers';
// Queue data hooks are mounted in App.jsx — read via IntegrationsContext.
import { useQueueSlaSettings } from '../../hooks/useQueueSlaSettings';
import {
  normalizeOnboarding,
  normalizePausedOnboarding,
  normalizeOffboarding,
  normalizeAmendments,
  normalizeRedlines,
  normalizeWorkbench,
  normalizeIncentivePlans,
} from '../../utils/normalizeSourceRows';
import Avatar from '../ui/Avatar';
import MultiFilter from '../analytics/MultiFilter';
import PeakTimesHeatmap from '../analytics/PeakTimesHeatmap';
import ProcessingTimeByTool from '../analytics/ProcessingTimeByTool';
import TaskBreakdownChart from '../analytics/TaskBreakdownChart';
import PredictiveRisks from '../analytics/PredictiveRisks';
import AgentProductivity from '../analytics/AgentProductivity';

const DATE_RANGES = [
  { id: '7d',  label: '7 Days',  days: 7 },
  { id: '30d', label: '30 Days', days: 30 },
  { id: '90d', label: '90 Days', days: 90 },
];

const REGIONS = [
  { id: 'all',  label: 'All Regions' },
  { id: 'EMEA', label: 'EMEA' },
  { id: 'APAC', label: 'APAC' },
  { id: 'AMER', label: 'AMER' },
];

const Analytics = ({ tasks, currentUser, subFilter, escalations = [] }) => {
  const settings = useContext(SettingsContext);
  const perms = useContext(PermissionsContext);

  // ── Role-adaptive scoping ──────────────────────────────────────────────
  const ds = perms?.dataScope || 'own_tasks_only';
  const isOwnScope = ds === 'own_tasks_only';
  const isTeamScope = ds === 'team_tasks';
  const isAllScope = ds === 'all_tasks' || ds === 'regional_tasks';
  const isRegional = ds === 'regional_tasks';
  const isAdmin = ds === 'all_tasks';
  const isManager = !isOwnScope;

  // ── Filter state (simple pills for agents, MultiFilter for managers) ──
  const [sortCol, setSortCol] = useState('slaComp');
  const [sortDir, setSortDir] = useState('desc');
  const [dateRange, setDateRange] = useState('7d');
  const [regionFilter, setRegionFilter] = useState('all');
  const [multiFilters, setMultiFilters] = useState(null);

  const handleFilterChange = useCallback((filters) => {
    setMultiFilters(filters);
  }, []);

  // ── Base task set (exclude slack) ──────────────────────────────────────
  const allTasks = tasks.filter(t => t.source !== 'slack');

  // ── Derive filtered tasks ─────────────────────────────────────────────
  const all = useMemo(() => {
    let filtered = allTasks;

    if (isManager && multiFilters) {
      // MultiFilter-based filtering for managers
      const { regions, countries, types, agents, rangeDays } = multiFilters;
      const rangeMins = (rangeDays || 30) * 24 * 60;

      // Region filter
      if (regions && !regions.includes('all') && regions.length > 0) {
        filtered = filtered.filter(t => {
          const member = MEMBERS.find(m => m.id === t.assigneeId);
          return regions.some(r => member?.region === r || t.region === r);
        });
      }

      // Country filter
      if (countries && !countries.includes('all') && countries.length > 0) {
        filtered = filtered.filter(t => countries.includes(t.country));
      }

      // Type filter
      if (types && !types.includes('all') && types.length > 0) {
        filtered = filtered.filter(t => types.includes(t.type));
      }

      // Agent name filter
      if (agents && !agents.includes('all') && agents.length > 0) {
        filtered = filtered.filter(t => {
          const member = MEMBERS.find(m => m.id === t.assigneeId);
          return member && agents.includes(member.name);
        });
      }

      // Date range
      filtered = filtered.filter(t => (t.minutesAgo ?? 0) <= rangeMins);
    } else {
      // Simple pill-based filtering for agents
      const rangeDays = DATE_RANGES.find(r => r.id === dateRange)?.days || 7;
      const rangeMins = rangeDays * 24 * 60;

      if (regionFilter !== 'all') {
        filtered = filtered.filter(t => {
          const member = MEMBERS.find(m => m.id === t.assigneeId);
          return member?.region === regionFilter || t.region === regionFilter;
        });
      }

      filtered = filtered.filter(t => (t.minutesAgo ?? 0) <= rangeMins);
    }

    // Scope by role
    if (isOwnScope) {
      filtered = filtered.filter(t => t.assigneeId === currentUser?.id);
    } else if (isTeamScope) {
      const teamMembers = MEMBERS.filter(m => m.team === currentUser?.team);
      const teamIds = new Set(teamMembers.map(m => m.id));
      filtered = filtered.filter(t => teamIds.has(t.assigneeId));
    }
    // isAllScope: no additional filtering needed

    return filtered;
  }, [allTasks, isManager, multiFilters, dateRange, regionFilter, isOwnScope, isTeamScope, currentUser]);

  // ── Derived data from scoped tasks ────────────────────────────────────
  const resolved = all.filter(t => t.status === 'resolved');
  const open = all.filter(t => t.status !== 'resolved');
  const resolvedWithTime = resolved.filter(t => (t.minutesSinceLastResponse ?? t.minutesAgo) != null);
  const avgRes = resolvedWithTime.length > 0
    ? Math.round(resolvedWithTime.reduce((a, t) => a + (t.minutesSinceLastResponse ?? t.minutesAgo ?? 0), 0) / resolvedWithTime.length)
    : '-';

  // ── KPI computations from real data ───────────────────────────────────
  const myResponseTimes = useMemo(() => {
    const rts = all
      .filter(t => t.minutesSinceLastResponse != null)
      .map(t => t.minutesSinceLastResponse);
    return rts.length > 0
      ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length)
      : 0;
  }, [all]);

  const avgResponseLabel = useMemo(() => {
    if (myResponseTimes === 0) return '--';
    if (myResponseTimes < 60) return `${myResponseTimes}m`;
    return `${Math.floor(myResponseTimes / 60)}h ${myResponseTimes % 60}m`;
  }, [myResponseTimes]);

  // Mount the same Deel queue hooks Briefing / Queue use so the SLA
  // compliance KPI here covers all 7 work streams instead of just the
  // ZD/Jira tickets in `tasks`. Honours the per-row `slaMinsOverride`
  // (server-stamped from app_settings.queue_sla_thresholds) AND the
  // business-day clock automatically because we use the canonical
  // helpers (slaInfo + slaBreachStatus from normalizeSourceRows).
  const { queueUnified: queueUnifiedA } = useContext(IntegrationsContext);
  const onboardingDataA = queueUnifiedA?.onboardingData || { items: [] };
  const pausedOnboardingDataA = queueUnifiedA?.pausedOnboardingData || { items: [] };
  const offboardingDataA = queueUnifiedA?.offboardingData || { items: [] };
  const changeRequestDataA = queueUnifiedA?.changeRequestData || { amendments: [], redlines: [] };
  const workbenchDataA = queueUnifiedA?.workbenchData || { tasks: [] };
  const incentivePlansDataA = queueUnifiedA?.incentivePlansData || { items: [] };
  const { sla: queueSlaA } = useQueueSlaSettings();
  const onbRowsA = useMemo(() => normalizeOnboarding(onboardingDataA.items, queueSlaA), [onboardingDataA.items, queueSlaA]);
  const pausedOnbRowsA = useMemo(() => normalizePausedOnboarding(pausedOnboardingDataA.items, queueSlaA), [pausedOnboardingDataA.items, queueSlaA]);
  const offRowsA = useMemo(() => normalizeOffboarding(offboardingDataA.items, queueSlaA), [offboardingDataA.items, queueSlaA]);
  const amendRowsA = useMemo(() => normalizeAmendments(changeRequestDataA.amendments, queueSlaA), [changeRequestDataA.amendments, queueSlaA]);
  const redlineRowsA = useMemo(() => normalizeRedlines(changeRequestDataA.redlines, queueSlaA), [changeRequestDataA.redlines, queueSlaA]);
  const wbRowsA = useMemo(() => normalizeWorkbench(workbenchDataA.tasks, queueSlaA), [workbenchDataA.tasks, queueSlaA]);
  const ipRowsA = useMemo(() => normalizeIncentivePlans(incentivePlansDataA.items, queueSlaA), [incentivePlansDataA.items, queueSlaA]);

  const slaCompliance = useMemo(() => {
    // Tickets — slaInfo() returns null for resolved/waiting (excludes
    // them from the calc) and reads task.slaMinsOverride before falling
    // back to SLA_MINS, so the per-queue Team-tab settings flow through.
    let pool = 0, breached = 0;
    for (const t of all) {
      const s = slaInfo(t);
      if (!s) continue;
      pool++;
      if (s.breach) breached++;
    }
    // Resolved tickets still count toward compliance — once resolved the
    // SLA evaluation is final (in-window or breached at resolution time).
    for (const t of resolved) {
      const limitMins = Number.isFinite(t.slaMinsOverride) && t.slaMinsOverride > 0
        ? t.slaMinsOverride
        : (SLA_MINS[t.type] || 1440);
      const elapsed = t.minutesSinceLastResponse ?? t.minutesAgo ?? 0;
      pool++;
      if (elapsed > limitMins) breached++;
    }
    // Deel sources — slaBreachStatus is the per-row biz-day computation.
    const deelRows = [...onbRowsA, ...pausedOnbRowsA, ...offRowsA, ...amendRowsA, ...redlineRowsA, ...wbRowsA, ...ipRowsA];
    for (const r of deelRows) {
      pool++;
      if (r.slaBreachStatus === 'SLA_BREACHED') breached++;
    }
    if (pool === 0) return 100;
    return Math.round(((pool - breached) / pool) * 100);
  }, [all, resolved, onbRowsA, pausedOnbRowsA, offRowsA, amendRowsA, redlineRowsA, wbRowsA, ipRowsA]);

  // ── Escalation rate KPI (real data) ───────────────────────────────────
  const escalatedTasks = all.filter(t => t.status === 'escalated');
  const escalCount = escalatedTasks.length;
  const escalRate = all.length > 0 ? ((escalCount / all.length) * 100).toFixed(1) : '0.0';

  // ── Chart data ────────────────────────────────────────────────────────
  const maxHV = Math.max(...HOURLY_VOLUME.map(h => h.v));
  const bySrc = Object.entries(TOOLS)
    .map(([k, v]) => ({ key: k, label: v.label, color: v.dot, count: all.filter(t => t.source === k).length }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count);
  const byFn = Object.entries(FUNCTIONS)
    .map(([k, v]) => ({ key: k, label: v.label, color: v.color, count: all.filter(t => t.type === k).length }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const cKeys = [...new Set(all.map(t => t.country))];
  const byCtry = cKeys.map(c => ({ c, count: all.filter(t => t.country === c).length })).sort((a, b) => b.count - a.count);

  // ── Agent stats with REAL data (replaces all mocks) ───────────────────
  const agentStats = useMemo(() => {
    const scopeAgents = isOwnScope
      ? MEMBERS.filter(m => m.id === currentUser?.id)
      : isTeamScope
        ? MEMBERS.filter(m => m.role === 'agent' && m.team === currentUser?.team)
        : MEMBERS.filter(m => m.role === 'agent');

    return scopeAgents.map(a => {
      const agentTasks = all.filter(t => t.assigneeId === a.id);
      const assigned = agentTasks.length;
      const resolvedTasks = agentTasks.filter(t => t.status === 'resolved');
      const resolvedCount = resolvedTasks.length;
      const openCount = agentTasks.filter(t => t.status !== 'resolved').length;

      // Real avg response time from minutesSinceLastResponse
      const responseTimes = agentTasks
        .filter(t => t.minutesSinceLastResponse != null)
        .map(t => t.minutesSinceLastResponse);
      const avgT = responseTimes.length > 0
        ? Math.round(responseTimes.reduce((x, y) => x + y, 0) / responseTimes.length)
        : 0;

      // Real escalation rate
      const escalated = agentTasks.filter(t => t.status === 'escalated').length;
      const agentEscalRate = assigned > 0 ? parseFloat(((escalated / assigned) * 100).toFixed(1)) : 0;

      // Real avg first response (use minutesSinceLastResponse as proxy)
      const avgFirstResp = avgT > 0
        ? (avgT < 60 ? `${avgT}m` : `${Math.floor(avgT / 60)}h ${avgT % 60}m`)
        : '--';

      // Real SLA compliance — honours per-task slaMinsOverride
      // (server-stamped from queue_sla_thresholds) before falling back
      // to type-based SLA_MINS, so the agent-level number agrees with
      // the per-row pill in the Queue.
      const slaComp = resolvedCount > 0
        ? Math.round((resolvedTasks.filter(t => {
            const limitMins = Number.isFinite(t.slaMinsOverride) && t.slaMinsOverride > 0
              ? t.slaMinsOverride
              : (SLA_MINS[t.type] || 1440);
            const elapsed = t.minutesSinceLastResponse ?? t.minutesAgo ?? 0;
            return elapsed <= limitMins;
          }).length / resolvedCount) * 100)
        : 100;

      return { a, assigned, resolved: resolvedCount, open: openCount, avgT, escalRate: agentEscalRate, avgFirstResp, slaComp };
    });
  }, [all, isOwnScope, isTeamScope, currentUser]);

  const sortedAgents = [...agentStats].sort((a, b) => {
    const v = sortDir === 'asc' ? 1 : -1;
    if (sortCol === 'resolved')  return v * (a.resolved - b.resolved);
    if (sortCol === 'open')      return v * (a.open - b.open);
    if (sortCol === 'assigned')  return v * (a.assigned - b.assigned);
    if (sortCol === 'avgT')      return v * (a.avgT - b.avgT);
    if (sortCol === 'escalRate') return v * (a.escalRate - b.escalRate);
    if (sortCol === 'slaComp')   return v * (a.slaComp - b.slaComp);
    return 0;
  });

  const toggleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }) => sortCol === col
    ? <i className={`bi-caret-${sortDir === 'asc' ? 'up' : 'down'}-fill`} style={{ fontSize: 9, marginLeft: 3, color: '#1b1b1b' }} aria-label={sortDir === 'asc' ? 'sorted ascending' : 'sorted descending'}></i>
    : <i className="bi-chevron-expand" style={{ fontSize: 9, marginLeft: 3, color: '#dedede' }} aria-label="sortable"></i>;

  const maxSrc = Math.max(...bySrc.map(x => x.count), 1) || 1;
  const maxFn = Math.max(...byFn.map(x => x.count), 1) || 1;
  const maxCtry = Math.max(...byCtry.map(x => x.count), 1) || 1;

  const selectedRange = DATE_RANGES.find(r => r.id === dateRange) || DATE_RANGES[0];
  const selectedRegion = REGIONS.find(r => r.id === regionFilter) || REGIONS[0];

  const subtitleText = isManager
    ? (multiFilters?.rangeDays
        ? `Showing data for last ${multiFilters.rangeDays} days`
        : 'Showing data for last 30 days')
    : regionFilter === 'all'
      ? `Showing data for last ${selectedRange.days} days`
      : `${selectedRegion.label} Performance — last ${selectedRange.days} days`;

  // ── Scoped members for sub-components ─────────────────────────────────
  const scopedMembers = useMemo(() => {
    if (isOwnScope) return MEMBERS.filter(m => m.id === currentUser?.id);
    if (isTeamScope) return MEMBERS.filter(m => m.team === currentUser?.team);
    return MEMBERS;
  }, [isOwnScope, isTeamScope, currentUser]);

  const Bar = ({ pct, color, height = 8, value }) => {
    const [hov, setHov] = useState(false);
    return (
      <div style={{ position: 'relative', background: '#f2f2f2', borderRadius: 128, height, flex: 1, overflow: 'visible', cursor: 'default' }}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
        <div title={value} style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color, borderRadius: 128, transition: 'width .7s ease' }}></div>
        {hov && value !== undefined && (
          <div style={{ position: 'absolute', top: '-28px', left: `${Math.min(pct, 80)}%`, transform: 'translateX(-50%)', background: '#1b1b1b', color: 'white', borderRadius: 8, padding: '3px 8px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', zIndex: 50, pointerEvents: 'none' }}>{value}</div>
        )}
      </div>
    );
  };

  const activeTab = subFilter || 'Overview';

  // ── KPI card definitions (role-adaptive labels) ───────────────────────
  const kpiPrefix = isOwnScope ? 'My' : isTeamScope ? 'Team' : 'Org';
  const kpiCards = [
    {
      label: isOwnScope ? 'My Tasks' : `${kpiPrefix} Tasks`,
      value: all.length,
      sub: `${open.length} still open`,
      color: '#1b1b1b',
      icon: 'bi-inbox',
      iconBg: '#f7f5f2',
    },
    {
      label: isOwnScope ? 'My Resolved' : 'Resolved',
      value: resolved.length,
      sub: avgRes !== '-' ? `Avg ${avgRes}m to resolve` : 'No resolved tasks',
      color: '#29811e',
      icon: 'bi-check-circle-fill',
      iconBg: '#e8f5e3',
    },
    {
      label: 'Avg Response Time',
      value: avgResponseLabel,
      sub: myResponseTimes > 0 ? `${myResponseTimes} min average` : 'No response data',
      color: '#ed8d00',
      icon: 'bi-clock-fill',
      iconBg: '#fff8e6',
    },
    {
      label: 'SLA Compliance',
      value: `${slaCompliance}%`,
      sub: `${resolved.length} resolved tasks measured`,
      color: slaCompliance >= 90 ? '#29811e' : slaCompliance >= 75 ? '#ed8d00' : '#d42d35',
      icon: 'bi-shield-check',
      iconBg: slaCompliance >= 90 ? '#e8f5e3' : slaCompliance >= 75 ? '#fff8e6' : '#ffe2de',
    },
  ];

  // ── Empty state ───────────────────────────────────────────────────────
  if (tasks.length === 0) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#9e9e9e' }}>
          <i className="bi-bar-chart" style={{ fontSize: 40, marginBottom: 12, opacity: .4 }}></i>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No data available for the selected period</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Try adjusting your filters or check back later</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>

      {/* ── Subtitle + Filters ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 24px 0', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: '#9e9e9e', margin: 0 }}>{subtitleText}</p>

        {/* Simple pill filters for agents (non-managers) */}
        {!isManager && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {settings.analytics_show_region_filter !== false && (
              <div style={{ display: 'flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2 }}>
                {REGIONS.map(r => {
                  const active = regionFilter === r.id;
                  return (
                    <button key={r.id} onClick={() => setRegionFilter(r.id)} style={{ padding: '4px 12px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--font-sm)', fontWeight: active ? 600 : 400, background: active ? 'var(--purple)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)', border: active ? 'none' : '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.15s' }}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', background: '#f7f5f2', borderRadius: 128, padding: 3, gap: 2 }}>
              {DATE_RANGES.map(r => {
                const active = dateRange === r.id;
                return (
                  <button key={r.id} onClick={() => setDateRange(r.id)} style={{ padding: '4px 12px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--font-sm)', fontWeight: active ? 600 : 400, background: active ? 'var(--purple)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)', border: active ? 'none' : '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.15s' }}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* MultiFilter for managers */}
      {isManager && (
        <div style={{ padding: '0 24px' }}>
          <MultiFilter
            members={scopedMembers}
            tasks={allTasks}
            onFilterChange={handleFilterChange}
            showDateRange={true}
          />
        </div>
      )}

      <div style={{ padding: '16px 24px' }}>

        {/* ── 4 KPI Cards ─────────────────────────────────────────────────── */}
        {(activeTab === 'Overview' || activeTab === 'SLA') && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
              {kpiCards.map(s => (
                <div key={s.label} style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, padding: '14px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'box-shadow .15s' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{ width: 36, height: 36, background: s.iconBg, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                    <i className={s.icon} style={{ color: s.color, fontSize: 16 }}></i>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                  <div style={{ fontSize: 13, color: '#1b1b1b', fontWeight: 700, marginTop: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: '#616161', marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Escalation Rate card (managers / admin only) */}
            {isManager && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, padding: '20px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'box-shadow .15s', display: 'flex', alignItems: 'center', gap: 20 }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{ width: 40, height: 40, background: '#fef3ee', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className="bi-arrow-up-circle-fill" style={{ color: '#ed5e2a', fontSize: 17 }}></i>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#ed5e2a', lineHeight: 1, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>{escalRate}%</div>
                    </div>
                    <div style={{ fontSize: 13, color: '#1b1b1b', fontWeight: 700, marginTop: 6 }}>Escalation Rate</div>
                    <div style={{ fontSize: 12, color: '#616161', marginTop: 2 }}>{escalCount} escalation{escalCount !== 1 ? 's' : ''} from {all.length} total tasks</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Tasks by Source + Tasks by Function (all roles) ─────────────── */}
        {(activeTab === 'Overview' || activeTab === 'Sources') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'box-shadow .15s' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}>
              <div style={{ fontWeight: 600, color: '#9e9e9e', fontSize: 13, marginBottom: 16 }}>Tasks by source</div>
              {bySrc.map(x => (
                <div key={x.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: '#616161', fontWeight: 500 }}>{x.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: x.color, fontVariantNumeric: 'tabular-nums' }}>{x.count}</span>
                  </div>
                  <Bar pct={(x.count / maxSrc) * 100} color={x.color} value={x.count} />
                </div>
              ))}
            </div>
            <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'box-shadow .15s' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}>
              <div style={{ fontWeight: 600, color: '#9e9e9e', fontSize: 13, marginBottom: 16 }}>Tasks by function</div>
              {byFn.map(x => (
                <div key={x.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: '#616161', fontWeight: 500 }}>{x.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: x.color, fontVariantNumeric: 'tabular-nums' }}>{x.count}</span>
                  </div>
                  <Bar pct={(x.count / maxFn) * 100} color={x.color} value={x.count} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Hourly Volume + Tasks by Country (managers+, except country needs isAllScope) ── */}
        {(activeTab === 'Overview' || activeTab === 'SLA') && isManager && (
          <div style={{ display: 'grid', gridTemplateColumns: isAllScope ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 14 }}>
            {/* Hourly Volume */}
            <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'box-shadow .15s' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}>
              <div style={{ fontWeight: 600, color: '#9e9e9e', fontSize: 13, marginBottom: 16 }}>Hourly volume</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 90, marginBottom: 4 }}>
                {HOURLY_VOLUME.map(h => {
                  const isPeak = h.v === maxHV;
                  return (
                    <div key={h.h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end', position: 'relative' }}>
                      <span style={{ fontSize: 9.5, color: isPeak ? '#29811e' : '#9e9e9e', fontWeight: isPeak ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{h.v}</span>
                      <div title={`${h.h}:00 — ${h.v} tasks`} style={{ width: '100%', background: isPeak ? '#29811e' : '#1f74b3', borderRadius: '4px 4px 0 0', height: `${(h.v / maxHV) * 70}px`, transition: 'height .6s ease', minHeight: 3, opacity: isPeak ? 1 : .55, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = isPeak ? '1' : '.55'}></div>
                      <span style={{ fontSize: 9, color: '#9e9e9e', fontWeight: isPeak ? 600 : 400 }}>{h.h}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: '#9e9e9e', textAlign: 'center' }}>
                Peak: <span style={{ color: '#29811e', fontWeight: 700 }}>11:00</span> — {maxHV} tasks
              </div>
            </div>

            {/* Tasks by Country (regional/admin scope) */}
            {isAllScope && (
              <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'box-shadow .15s' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'}>
                <div style={{ fontWeight: 600, color: '#9e9e9e', fontSize: 13, marginBottom: 16 }}>Tasks by country</div>
                {byCtry.map(x => (
                  <div key={x.c} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: '#616161' }}>{FLAGS[x.c]} {x.c}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#616161', fontVariantNumeric: 'tabular-nums' }}>{x.count}</span>
                    </div>
                    <Bar pct={(x.count / maxCtry) * 100} color='#29811e' value={x.count} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Processing Time by Tool (all roles) ────────────────────────── */}
        {(activeTab === 'Overview' || activeTab === 'Sources') && (
          <div style={{ marginBottom: 14 }}>
            <ProcessingTimeByTool tasks={all} />
          </div>
        )}

        {/* ── Task Breakdown Chart (all roles, own resolved for agents) ─── */}
        {(activeTab === 'Overview' || activeTab === 'SLA') && (
          <div style={{ marginBottom: 14 }}>
            <TaskBreakdownChart tasks={all} />
          </div>
        )}

        {/* ── Peak Times Heatmap (managers+) ──────────────────────────────── */}
        {isManager && (activeTab === 'Overview' || activeTab === 'SLA') && (
          <div style={{ marginBottom: 14 }}>
            <PeakTimesHeatmap tasks={all} />
          </div>
        )}

        {/* ── Agent Productivity table (managers+) ───────────────────────── */}
        {isManager && (activeTab === 'Overview' || activeTab === 'Team Performance') && (
          <div style={{ marginBottom: 14 }}>
            <AgentProductivity
              tasks={all}
              members={scopedMembers}
            />
          </div>
        )}

        {/* ── Legacy agent performance table (kept for inline detail, agents don't see this) ── */}
        {isManager && (activeTab === 'Team Performance') && sortedAgents.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #e8e8e8', borderRadius: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ fontWeight: 700, color: '#1b1b1b', fontSize: 14, marginBottom: 16 }}>Agent Performance Detail</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 60px 80px 80px 90px 90px', gap: 6, padding: '12px 16px', background: '#fafaf9', borderBottom: '1px solid #f2f2f2' }}>
              {[
                { k: '', l: 'Agent' },
                { k: 'assigned', l: 'Assigned' },
                { k: 'resolved', l: 'Resolved' },
                { k: 'open', l: 'Open' },
                { k: 'avgT', l: 'Avg time' },
                { k: 'escalRate', l: 'Esc rate' },
                { k: '', l: 'Avg 1st resp' },
                { k: 'slaComp', l: 'SLA comp%' },
              ].map(({ k, l }) => (
                <span key={l} onClick={k ? () => toggleSort(k) : undefined} style={{ color: k && sortCol === k ? 'var(--text, #1b1b1b)' : 'var(--text-muted, #9e9e9e)', fontSize: 13, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal', textAlign: l === 'Agent' ? 'left' : 'center', cursor: k ? 'pointer' : 'default', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: l === 'Agent' ? 'flex-start' : 'center', gap: 2 }}>
                  {l}{k && <SortIcon col={k} />}
                </span>
              ))}
            </div>
            {sortedAgents.map(({ a, assigned, resolved: res, open: op, avgT, escalRate: er, avgFirstResp, slaComp }) => (
              <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 60px 80px 80px 90px 90px', gap: 6, padding: '12px 16px', minHeight: 48, borderBottom: '1px solid #f2f2f2', alignItems: 'center', transition: 'background .1s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9f8f6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar name={a.name} size={28} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1b1b1b' }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: '#616161' }}>{FLAGS[a.country]} {a.team}</div>
                  </div>
                </div>
                <span style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#616161', fontVariantNumeric: 'tabular-nums' }}>{assigned}</span>
                <span style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#29811e', fontVariantNumeric: 'tabular-nums' }}>{res}</span>
                <span style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#ed8d00', fontVariantNumeric: 'tabular-nums' }}>{op}</span>
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#1b1b1b', fontVariantNumeric: 'tabular-nums' }}>{avgT}m</div>
                <span style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: er > 5 ? '#d42d35' : er > 3 ? '#ed8d00' : '#29811e', fontVariantNumeric: 'tabular-nums' }}>{er}%</span>
                <span style={{ textAlign: 'center', fontSize: 12, color: '#616161', fontVariantNumeric: 'tabular-nums' }}>{avgFirstResp}</span>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: slaComp >= 95 ? '#29811e' : slaComp >= 90 ? '#1f74b3' : '#ed8d00', background: slaComp >= 95 ? '#e8f5e3' : slaComp >= 90 ? '#e8f0fe' : '#fff8e6', padding: '2px 8px', borderRadius: 128, fontVariantNumeric: 'tabular-nums' }}>{slaComp}%</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Predictive Risks (regional manager / admin only) ───────────── */}
        {isAllScope && (activeTab === 'Overview' || activeTab === 'SLA') && (
          <div style={{ marginBottom: 14 }}>
            <PredictiveRisks
              tasks={all}
              members={scopedMembers}
              escalations={escalations}
            />
          </div>
        )}

      </div>
    </div>
  );
};

export default Analytics;
