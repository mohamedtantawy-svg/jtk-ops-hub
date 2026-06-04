// ── PendingCoverageBanner ─────────────────────────────────────────────
// Home-page surface for coverage invitations awaiting the caller's
// response (Mohamed 2026-06-04 — "it needs to be showing also on the home
// page"). Distinct from CoverageBanner, which is the purple, informational
// "you're currently covering X" banner. This one is amber = action needed:
// it lists pending asks and the "Respond" button opens the accept/decline
// popup (CoverageInvitationModal, mounted once in App.jsx) via the
// `ooo:openCoverageInvite` event, passing the invite so it paints instantly.
//
// Mounted on every home surface (BriefingView for managers, AgentHome for
// agents) since anyone — any role — can be asked to cover.

import { usePendingCoverages } from '../../hooks/usePendingCoverages';

function fmtRange(start, end) {
  if (!start || !end) return '';
  const fmt = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return String(iso);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function openInvite(invite) {
  try {
    window.dispatchEvent(new CustomEvent('ooo:openCoverageInvite', {
      detail: { handoverId: invite.handover_id, invite },
    }));
  } catch { /* no-op */ }
}

export default function PendingCoverageBanner() {
  const { items } = usePendingCoverages();
  if (!items || items.length === 0) return null;

  const isMulti = items.length > 1;
  const first = items[0];

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', margin: '0 0 12px', borderRadius: 12,
        background: '#FEF3C7', border: '1px solid #FDE68A',
        color: '#92400E', fontSize: 13, lineHeight: 1.4,
      }}
    >
      <i className="bi-person-raised-hand" style={{ fontSize: 16, color: '#B45309', flexShrink: 0 }} />
      {isMulti ? (
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700 }}>{items.length} coverage requests</span> need your response.
        </span>
      ) : (
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700 }}>{first.requester_name}</span> asked you to cover their OOO
          {fmtRange(first.start_date, first.end_date) ? ` (${fmtRange(first.start_date, first.end_date)})` : ''}.
        </span>
      )}
      <button
        type="button"
        onClick={() => openInvite(first)}
        style={{
          padding: '6px 14px', borderRadius: 999,
          border: '1px solid #B45309', background: '#B45309',
          color: 'white', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        {isMulti ? 'Review' : 'Respond'} →
      </button>
    </div>
  );
}
