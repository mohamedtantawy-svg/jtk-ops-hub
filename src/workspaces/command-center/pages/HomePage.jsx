'use client';

const card = {
  background: '#fff',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  border: '1px solid #ece8e1',
};

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
  marginTop: 20,
};

const metricLabel = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: '#9e9e9e',
  fontWeight: 600,
};

const metricValue = {
  fontSize: 32,
  fontWeight: 700,
  color: '#1b1b1b',
  marginTop: 8,
};

const metricCaption = {
  fontSize: 12,
  color: '#9e9e9e',
  marginTop: 6,
};

export default function HomePage() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Command Center</h1>
        <span style={{ fontSize: 12, color: '#9e9e9e' }}>
          Cross-team overview · numbers only
        </span>
      </div>
      <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 0' }}>
        High-level numbers across HR, Payroll, and GIX. Detailed queues stay inside each team's hub.
      </p>

      <div style={grid}>
        {[
          { team: 'HR Hub', tickets: '—', sla: '—' },
          { team: 'Payroll Hub', tickets: '—', sla: '—' },
          { team: 'GIX Hub', tickets: '—', sla: '—' },
        ].map(row => (
          <div key={row.team} style={card}>
            <div style={metricLabel}>{row.team}</div>
            <div style={metricValue}>{row.tickets}</div>
            <div style={metricCaption}>Open tickets · SLA {row.sla}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Wiring</div>
        <div style={{ fontSize: 13, color: '#6b6b6b', lineHeight: 1.6 }}>
          Numbers populate once each team's workspace API is provisioned with its own credentials.
          No live integrations are wired yet — this view will aggregate read-only metrics across all
          enabled workspaces.
        </div>
      </div>
    </div>
  );
}
