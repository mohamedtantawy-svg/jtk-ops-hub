// ── ActionBanner ──────────────────────────────────────────────────────
// Single-most-pressing action surfaced above the lens chips. Built from
// the lens-counts payload + the caller's role, so the user always lands
// with the one thing they should do next visible in one glance.
//
// Priority order (highest first):
//   1. Approvals pending      → manager call to action
//   2. Coverer invitations    → caller has been asked to cover
//   3. Mine missing handover  → caller hasn't submitted their handover
//   4. Drafts                 → caller has an unfinished draft
// None → no banner.

const BANNERS = [
  {
    key: 'approvals',
    test: (c) => (c?.approvals || 0) > 0,
    intent: 'amber',
    icon: 'bi-shield-check',
    body: (c) => `${c.approvals} handover${c.approvals === 1 ? '' : 's'} awaiting your approval.`,
    cta: 'Review',
    lens: 'approvals',
  },
  {
    key: 'covering_pending',
    test: (c) => (c?.covering_pending || 0) > 0,
    intent: 'amber',
    icon: 'bi-person-check',
    body: (c) => `${c.covering_pending} coverage invitation${c.covering_pending === 1 ? '' : 's'} need your response.`,
    cta: 'Open',
    lens: 'covering',
  },
  {
    key: 'mine_missing',
    test: (c) => (c?.mine_missing_handover || 0) > 0,
    intent: 'red',
    icon: 'bi-exclamation-triangle',
    body: (c) => `You have ${c.mine_missing_handover} upcoming OOO without a handover.`,
    cta: 'Submit handover',
    lens: 'mine',
  },
  {
    key: 'drafts',
    test: (c) => (c?.drafts || 0) > 0,
    intent: 'slate',
    icon: 'bi-pencil-square',
    body: (c) => `${c.drafts} unsubmitted draft${c.drafts === 1 ? '' : 's'}.`,
    cta: 'Resume',
    lens: 'drafts',
  },
];

const INTENT_STYLES = {
  red:   { bg: '#FEE2E2', border: '#FECACA', fg: '#991B1B', cta: '#B91C1C' },
  amber: { bg: '#FEF3C7', border: '#FDE68A', fg: '#92400E', cta: '#B45309' },
  slate: { bg: '#F1F5F9', border: '#E2E8F0', fg: '#334155', cta: '#475569' },
};

function ActionBanner({ counts, onJumpToLens }) {
  const banner = BANNERS.find(b => b.test(counts));
  if (!banner) return null;

  const styles = INTENT_STYLES[banner.intent] || INTENT_STYLES.slate;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: 12,
        color: styles.fg,
        fontSize: 13,
      }}
    >
      <i className={`bi ${banner.icon}`} style={{ fontSize: 16, color: styles.cta, flexShrink: 0 }} />
      <span style={{ flex: 1, fontWeight: 500 }}>{banner.body(counts)}</span>
      <button
        type="button"
        onClick={() => onJumpToLens?.(banner.lens)}
        style={{
          padding: '6px 12px',
          borderRadius: 999,
          border: `1px solid ${styles.cta}`,
          background: 'transparent',
          color: styles.cta,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {banner.cta} →
      </button>
    </div>
  );
}

export default ActionBanner;
