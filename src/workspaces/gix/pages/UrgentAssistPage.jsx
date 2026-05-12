'use client';

const card = {
  background: '#fff',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  border: '1px solid #ece8e1',
};

export default function UrgentAssistPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Urgent Assist</h1>
      <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 20px' }}>
        Escalation queue for time-sensitive GIX requests.
      </p>

      <div style={card}>
        <div style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.6 }}>
          A simple "create / assign / resolve" flow tuned for GIX's escalation patterns will live
          here. Request shape and SLA rules will be confirmed with the GIX lead before build.
        </div>
      </div>
    </div>
  );
}
