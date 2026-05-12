'use client';

const card = {
  background: '#fff',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  border: '1px solid #ece8e1',
};

export default function HomePage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Payroll Hub</h1>
      <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 20px' }}>
        Welcome to your workspace. Pick a tab above to get started.
      </p>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>What's here</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#6b6b6b', lineHeight: 1.8 }}>
          <li><strong>Workspace</strong> — Zendesk, Jira, and Workbench tickets (integrations pending).</li>
          <li><strong>OOO</strong> — out-of-office coverage and handovers for the Payroll team.</li>
          <li><strong>Urgent Assist</strong> — escalation queue for time-sensitive payroll requests.</li>
          <li><strong>Announcements</strong> — team-wide updates and acknowledgements.</li>
        </ul>
      </div>
    </div>
  );
}
