'use client';

const card = {
  background: '#fff',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  border: '1px solid #ece8e1',
};

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 16,
};

const sourceLabel = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: '#9e9e9e',
  fontWeight: 600,
};

const sourceTitle = {
  fontSize: 18,
  fontWeight: 700,
  color: '#1b1b1b',
  marginTop: 6,
};

const sourceStatus = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  color: '#9c5b00',
  background: '#fff3e0',
  border: '1px solid #ffdfb3',
  padding: '3px 10px',
  borderRadius: 999,
  marginTop: 12,
};

const SOURCES = [
  {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'GIX support tickets and visa-related customer requests.',
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Cross-team immigration cases and engineering escalations.',
  },
  {
    id: 'workbench',
    name: 'Workbench',
    description: 'Internal immigration case tasks and document tracking.',
  },
];

export default function WorkspacePage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Workspace</h1>
      <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 20px' }}>
        Three sources will feed the GIX queue once each integration is provisioned with its own API
        credentials.
      </p>

      <div style={grid}>
        {SOURCES.map(s => (
          <div key={s.id} style={card}>
            <div style={sourceLabel}>Source</div>
            <div style={sourceTitle}>{s.name}</div>
            <div style={{ fontSize: 13, color: '#6b6b6b', marginTop: 8, lineHeight: 1.6 }}>
              {s.description}
            </div>
            <div style={sourceStatus}>Not connected</div>
          </div>
        ))}
      </div>
    </div>
  );
}
