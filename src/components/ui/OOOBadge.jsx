// ── OOOBadge ───────────────────────────────────────────────────────────
// Compact OOO indicator. Two render modes:
//   variant="pill"     — dated pill next to a name, e.g. for Team table
//                        rows: "OOO May 5 → May 8 · Covered by Pedro R."
//   variant="overlay"  — small calendar-x glyph + tooltip; pinned over
//                        an Avatar component.
//
// All inputs are pre-resolved by the parent (events + coverers). The
// component is purely presentational so future surfaces can drop it in
// next to any avatar without re-querying.

import { isoDate, eventTiming } from '../../lib/handover-helpers';

const COLOURS = {
  active:   { bg: '#FEE2E2', fg: '#B91C1C', border: '#FCA5A5' }, // red — out right now
  upcoming: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' }, // amber — upcoming
};

function formatRange(start, end) {
  if (!start || !end) return '';
  // Inputs are YYYY-MM-DD. Parse without timezone drift via Date.UTC.
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

/**
 * @param {Object} props
 * @param {Object[]} [props.events]           — time_off_events rows for this person
 * @param {Object} [props.currentEvent]       — optional pre-picked event to render
 * @param {string} [props.variant='pill']     — 'pill' | 'overlay'
 * @param {boolean} [props.includeUpcoming]   — show a future event when no
 *                                              currently-active one (default true)
 * @param {number} [props.upcomingHorizonDays=7] — how far ahead to consider
 *                                                  "upcoming" worth surfacing
 * @param {Object[]} [props.coverers]         — coverer rows, optional, for tooltip
 * @param {Function} [props.memberLookup]     — (email) → { name } for coverer labels
 * @param {string} [props.todayIso]           — override for testing; defaults to UTC today
 */
function OOOBadge({
  events,
  currentEvent,
  variant = 'pill',
  includeUpcoming = true,
  upcomingHorizonDays = 7,
  coverers,
  memberLookup,
  todayIso,
}) {
  const today = todayIso || isoDate();

  // Pick the most relevant event: active today wins, otherwise the
  // nearest upcoming within horizon (if includeUpcoming).
  let event = currentEvent || null;
  if (!event && Array.isArray(events) && events.length > 0) {
    const active = events.find(e => e && eventTiming(e, today) === 'active');
    if (active) {
      event = active;
    } else if (includeUpcoming) {
      const sorted = events
        .filter(e => e && e.start_date && eventTiming(e, today) === 'upcoming')
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      const horizon = sorted[0];
      if (horizon) {
        const [y, m, d] = horizon.start_date.split('-').map(Number);
        const startUtc = Date.UTC(y, m - 1, d);
        const todayUtc = Date.UTC(
          Number(today.slice(0, 4)),
          Number(today.slice(5, 7)) - 1,
          Number(today.slice(8, 10)),
        );
        const days = Math.round((startUtc - todayUtc) / 86400000);
        if (days <= upcomingHorizonDays) event = horizon;
      }
    }
  }

  if (!event) return null;

  const timing = eventTiming(event, today);
  if (timing === 'past') return null;

  const colours = timing === 'active' ? COLOURS.active : COLOURS.upcoming;
  const range = formatRange(event.start_date, event.end_date);
  const coverNames = (Array.isArray(coverers) ? coverers : [])
    .filter(c => c && c.acceptance_status === 'accepted')
    .map(c => memberLookup?.(c.email)?.name || c.email);
  const tooltip = timing === 'active'
    ? `OOO until ${formatRange(event.end_date, event.end_date)}${coverNames.length ? ` · Covered by ${coverNames.join(', ')}` : ''}`
    : `Upcoming OOO ${range}${coverNames.length ? ` · Covered by ${coverNames.join(', ')}` : ''}`;

  if (variant === 'overlay') {
    return (
      <span
        title={tooltip}
        aria-label={tooltip}
        style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: 14, height: 14,
          borderRadius: '50%',
          background: colours.bg,
          border: `1.5px solid var(--surface, white)`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colours.fg,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          pointerEvents: 'none',
        }}
      >
        <i className="bi-calendar-x-fill" style={{ fontSize: 8 }} />
      </span>
    );
  }

  // Default: pill
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: colours.bg,
        color: colours.fg,
        border: `1px solid ${colours.border}`,
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      <i className="bi-calendar-x" style={{ fontSize: 10 }} />
      <span>OOO {range}</span>
    </span>
  );
}

export default OOOBadge;
