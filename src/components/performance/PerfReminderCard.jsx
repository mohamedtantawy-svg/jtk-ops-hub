// ── PerfReminderCard ────────────────────────────────────────────────────────
// Home-page nudge for the Performance tab. Renders nothing when there's
// nothing pending. Otherwise shows up to two lines:
//   • managerDue    → "N performance reviews to complete this month"
//   • memberPending → "Your monthly check-in is open"
// Clicking anywhere routes to HR Hub → Performance (onOpen). Shared by
// AgentHome, TeamLeadHome and BriefingView so the reminder looks identical
// everywhere. perfBadge = { managerDue, memberPending, count }.
export default function PerfReminderCard({ perfBadge, onOpen, style }) {
  const managerDue = Number(perfBadge?.managerDue || 0);
  const memberPending = Number(perfBadge?.memberPending || 0);
  if (managerDue <= 0 && memberPending <= 0) return null;

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
        padding: '14px 16px', borderRadius: 14,
        border: '1px solid rgba(124,58,237,0.28)',
        background: 'linear-gradient(135deg, rgba(124,58,237,0.10), rgba(124,58,237,0.03))',
        ...style,
      }}
    >
      <div style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 11,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(124,58,237,0.16)', color: '#7c3aed', fontSize: 18,
      }}>
        <i className="bi bi-clipboard2-check" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
          Performance check-in
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          {managerDue > 0 && (
            <span>
              <strong style={{ color: '#7c3aed' }}>{managerDue}</strong> team review{managerDue === 1 ? '' : 's'} to complete this month
            </span>
          )}
          {managerDue > 0 && memberPending > 0 && <span> · </span>}
          {memberPending > 0 && <span>Your monthly check-in is open</span>}
        </div>
      </div>
      <i className="bi bi-chevron-right" style={{ color: '#7c3aed', fontSize: 14, flexShrink: 0 }} />
    </div>
  );
}
