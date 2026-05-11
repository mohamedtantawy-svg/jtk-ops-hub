// ── CoverageBanner ────────────────────────────────────────────────────
// Slim header banner: "Covering Sofia López (May 5 → May 8). Her
// workspace is merged with yours; queues, breaches, and totals now
// include her work." Mounted at the top of BriefingView and Queue when
// the caller has any active coverages.
//
// Dismissable per-session via sessionStorage; reappears next mount
// until the underlying coverage ends.

import { useEffect, useState } from 'react';
import { useMyActiveCoverages } from '../../hooks/useMyActiveCoverages';

const DISMISS_KEY = 'ops_hub_coverage_banner_dismissed_v1';

function readDismissed() {
  if (typeof sessionStorage === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function writeDismissed(set) {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(set))); } catch {}
}

function formatRange(start, end) {
  if (!start || !end) return '';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function CoverageBanner({ onOpenOOO }) {
  const { items } = useMyActiveCoverages();
  const [dismissed, setDismissed] = useState(() => readDismissed());

  // Drop dismissals for handovers we're no longer covering — so a future
  // coverage of the same person re-shows the banner.
  useEffect(() => {
    if (!items.length) return;
    const live = new Set(items.map(i => i.handover_id));
    const stale = Array.from(dismissed).filter(id => !live.has(id));
    if (stale.length === 0) return;
    const next = new Set(Array.from(dismissed).filter(id => live.has(id)));
    setDismissed(next);
    writeDismissed(next);
  }, [items, dismissed]);

  const visible = items.filter(i => !dismissed.has(i.handover_id));
  if (visible.length === 0) return null;

  function dismiss(id) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissed(next);
  }

  // Aggregate label when covering ≥ 2 people; otherwise a single line.
  const isMulti = visible.length > 1;

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        margin: '0 0 12px',
        borderRadius: 12,
        background: 'rgba(124, 58, 237, 0.08)',
        border: '1px solid rgba(124, 58, 237, 0.30)',
        color: 'var(--purple, #7c3aed)',
        fontSize: 13, lineHeight: 1.4,
      }}
    >
      <i className="bi-people-fill" style={{ fontSize: 16, flexShrink: 0 }} />
      {isMulti ? (
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700 }}>Covering {visible.length} people right now.</span>
          {' '}Their queues, breaches, and counts are merged into yours.
        </span>
      ) : (
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700 }}>
            Covering {visible[0].requester_name} ({formatRange(visible[0].start_date, visible[0].end_date)}).
          </span>
          {' '}Their workspace is merged with yours — queues, breaches, and totals include their work.
        </span>
      )}
      {onOpenOOO && (
        <button
          type="button"
          onClick={onOpenOOO}
          style={{
            padding: '5px 12px', borderRadius: 999,
            border: '1px solid var(--purple, #7c3aed)',
            background: 'transparent',
            color: 'var(--purple, #7c3aed)',
            fontSize: 11, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}
        >
          View {isMulti ? 'coverages' : 'handover'}
        </button>
      )}
      <button
        type="button"
        onClick={() => visible.forEach(v => dismiss(v.handover_id))}
        aria-label="Dismiss for this session"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--purple, #7c3aed)', padding: 4, flexShrink: 0,
          fontFamily: 'inherit',
        }}
      >
        <i className="bi-x-lg" style={{ fontSize: 12 }} />
      </button>
    </div>
  );
}

export default CoverageBanner;
