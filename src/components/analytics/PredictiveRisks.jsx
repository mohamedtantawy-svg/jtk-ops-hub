import { useMemo } from 'react';
import { FUNCTIONS, SLA_MINS } from '../../data/constants';

// ---------------------------------------------------------------------------
// PredictiveRisks — rule-based "AI" risk analysis panel.
// Kristina asked for predictive risk analytics to surface problems early.
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG = {
  critical: { color: '#d42d35', bg: '#ffe2de', border: '#d42d35', icon: 'bi-exclamation-octagon-fill', label: 'Critical' },
  high:     { color: '#ed8d00', bg: '#fff8e6', border: '#ed8d00', icon: 'bi-exclamation-triangle-fill', label: 'High' },
  medium:   { color: '#1f74b3', bg: '#e8f0fe', border: '#1f74b3', icon: 'bi-info-circle-fill', label: 'Medium' },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2 };

export default function PredictiveRisks({ tasks = [], members = [], escalations = [] }) {
  const risks = useMemo(() => {
    const results = [];
    const openTasks = tasks.filter((t) => t.status !== 'resolved');
    const allTasks = tasks;

    // ── 1. Capacity issues: agents with > 1.4x team avg workload ──────
    const agentLoads = {};
    openTasks.forEach((t) => {
      if (t.assigneeId) {
        agentLoads[t.assigneeId] = (agentLoads[t.assigneeId] || 0) + 1;
      }
    });
    const loadValues = Object.values(agentLoads);
    const teamAvg = loadValues.length > 0 ? loadValues.reduce((a, b) => a + b, 0) / loadValues.length : 0;

    if (teamAvg > 0) {
      Object.entries(agentLoads).forEach(([agentId, load]) => {
        if (load > teamAvg * 1.4) {
          const member = members.find((m) => m.id === Number(agentId));
          const name = member ? member.name : `Agent #${agentId}`;
          const ratio = (load / teamAvg).toFixed(1);
          results.push({
            severity: load > teamAvg * 2 ? 'critical' : 'high',
            title: `Capacity overload: ${name}`,
            description: `Currently handling ${load} tasks (${ratio}x team average of ${Math.round(teamAvg)}). Risk of burnout and delayed responses.`,
            action: `Consider redistributing ${Math.ceil(load - teamAvg)} tasks to less loaded agents.`,
            category: 'capacity',
          });
        }
      });
    }

    // ── 2. SLA breach trends: countries/agents with breach rate > 20% ─
    const countrySla = {};
    allTasks.forEach((t) => {
      const c = t.country || 'Unknown';
      if (!countrySla[c]) countrySla[c] = { total: 0, breached: 0 };
      countrySla[c].total += 1;
      const limit = SLA_MINS[t.type] || 1440;
      const elapsed = t.minutesSinceLastResponse != null ? t.minutesSinceLastResponse : (t.minutesAgo ?? 0);
      if (elapsed > limit && t.status !== 'resolved') {
        countrySla[c].breached += 1;
      }
    });

    Object.entries(countrySla).forEach(([country, { total, breached }]) => {
      if (total >= 3) {
        const rate = (breached / total) * 100;
        if (rate > 20) {
          results.push({
            severity: rate > 40 ? 'critical' : 'high',
            title: `SLA breach trend: ${country}`,
            description: `${breached} of ${total} tasks (${rate.toFixed(0)}%) are breaching SLA thresholds for ${country}.`,
            action: `Review country-specific bottlenecks and consider adding regional capacity.`,
            category: 'sla',
          });
        }
      }
    });

    // ── 3. Volume spikes: source/type where volume > 1.5x average ─────
    const srcCounts = {};
    allTasks.forEach((t) => {
      const src = t.source || 'custom';
      srcCounts[src] = (srcCounts[src] || 0) + 1;
    });
    const srcValues = Object.values(srcCounts);
    const srcAvg = srcValues.length > 0 ? srcValues.reduce((a, b) => a + b, 0) / srcValues.length : 0;

    if (srcAvg > 0) {
      Object.entries(srcCounts).forEach(([src, count]) => {
        if (count > srcAvg * 1.5 && count >= 5) {
          results.push({
            severity: count > srcAvg * 2.5 ? 'high' : 'medium',
            title: `Volume spike: ${src}`,
            description: `${count} tasks from ${src} (${((count / srcAvg)).toFixed(1)}x the average of ${Math.round(srcAvg)} per source).`,
            action: `Investigate root cause and consider temporary capacity boost for this channel.`,
            category: 'volume',
          });
        }
      });
    }

    const typeCounts = {};
    allTasks.forEach((t) => {
      const typ = t.type || 'Policy Query';
      typeCounts[typ] = (typeCounts[typ] || 0) + 1;
    });
    const typeValues = Object.values(typeCounts);
    const typeAvg = typeValues.length > 0 ? typeValues.reduce((a, b) => a + b, 0) / typeValues.length : 0;

    if (typeAvg > 0) {
      Object.entries(typeCounts).forEach(([typ, count]) => {
        if (count > typeAvg * 1.5 && count >= 4) {
          const fn = FUNCTIONS[typ];
          const label = fn ? fn.label : typ;
          results.push({
            severity: count > typeAvg * 2.5 ? 'high' : 'medium',
            title: `Volume spike: ${label}`,
            description: `${count} ${label} tasks (${((count / typeAvg)).toFixed(1)}x the average of ${Math.round(typeAvg)} per type).`,
            action: `Assign a specialist or set up an automation rule for ${label} tasks.`,
            category: 'volume',
          });
        }
      });
    }

    // ── 4. Stale tickets: types with avg age > 48 hours (2880 min) ────
    const typeAges = {};
    openTasks.forEach((t) => {
      const typ = t.type || 'Policy Query';
      if (!typeAges[typ]) typeAges[typ] = [];
      typeAges[typ].push(t.minutesAgo ?? 0);
    });

    Object.entries(typeAges).forEach(([typ, ages]) => {
      const avg = ages.reduce((a, b) => a + b, 0) / ages.length;
      if (avg > 2880 && ages.length >= 2) {
        const fn = FUNCTIONS[typ];
        const label = fn ? fn.label : typ;
        const hours = Math.round(avg / 60);
        results.push({
          severity: avg > 5760 ? 'critical' : 'high',
          title: `Stale tickets: ${label}`,
          description: `${ages.length} open ${label} tasks with an average age of ${hours} hours.`,
          action: `Prioritize clearing the ${label} backlog. Consider bulk-processing or escalation.`,
          category: 'stale',
        });
      }
    });

    // ── 5. Escalation trend (if escalations data is available) ────────
    if (escalations.length > 5) {
      results.push({
        severity: escalations.length > 15 ? 'high' : 'medium',
        title: `Escalation trend: ${escalations.length} active escalations`,
        description: `${escalations.length} escalations are currently active, which may indicate systemic issues in first-line resolution.`,
        action: `Review common escalation reasons and update knowledge base or training.`,
        category: 'escalation',
      });
    }

    // Sort by severity
    return results.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  }, [tasks, members, escalations]);

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
        <i className="bi-stars" style={{ fontSize: 16, color: '#7c3aed' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>AI Risk Analysis</span>
        {risks.length > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              background: risks[0].severity === 'critical' ? '#d42d35' : '#ed8d00',
              borderRadius: 128,
              padding: '2px 10px',
              marginLeft: 4,
            }}
          >
            {risks.filter((r) => r.severity === 'critical').length} critical
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {risks.length} risk{risks.length !== 1 ? 's' : ''} detected
        </span>
      </div>

      {/* Risk items */}
      {risks.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '24px 0',
            color: '#29811e',
            fontSize: 13,
          }}
        >
          <i className="bi-check-circle-fill" style={{ fontSize: 20, marginBottom: 6, display: 'block' }} />
          No risks detected — all metrics within healthy thresholds
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {risks.map((risk, idx) => {
            const cfg = SEVERITY_CONFIG[risk.severity] || SEVERITY_CONFIG.medium;
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  borderLeft: `4px solid ${cfg.border}`,
                  background: cfg.bg,
                }}
              >
                {/* Icon */}
                <i
                  className={cfg.icon}
                  style={{ fontSize: 16, color: cfg.color, marginTop: 2, flexShrink: 0 }}
                />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {risk.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: cfg.color,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 6 }}>
                    {risk.description}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#7c3aed',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <i className="bi-lightbulb" style={{ fontSize: 11 }} />
                    {risk.action}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
