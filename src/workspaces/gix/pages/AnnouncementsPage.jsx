'use client';

const card = {
  background: '#fff',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  border: '1px solid #ece8e1',
};

export default function AnnouncementsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Announcements</h1>
      <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 20px' }}>
        Team-wide updates and acknowledgements for the GIX team.
      </p>

      <div style={card}>
        <div style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.6 }}>
          Compose, schedule, and track acks for GIX announcements. Scoped strictly to this
          workspace — no overlap with HR Hub or Payroll announcements.
        </div>
      </div>
    </div>
  );
}
