// ── LensChips ─────────────────────────────────────────────────────────
// Sticky lens chip row for the OOO header. Each chip renders its label
// + live count; chips with count=0 hide unless they're the active one
// (so an admin without any approvals doesn't see a permanent "Approvals
// 0" chip). The active chip uses the same purple accent the rest of the
// app uses for selected state.
//
// `counts` shape — see /api/v1/handovers/lens-counts. Missing keys are
// treated as 0.

import { LENSES } from '../../lib/handover-helpers';

// Lenses with this flag hide their chip when count = 0 unless active.
const HIDE_WHEN_EMPTY = new Set(['approvals', 'drafts']);

function chipCount(counts, lensId) {
  if (!counts) return 0;
  if (lensId === 'covering') return counts.covering || 0;
  if (lensId === 'all')      return counts.all || 0;
  return counts[lensId] || 0;
}

function LensChips({ lens, counts, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="OOO lenses"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      {LENSES.map(l => {
        const count = chipCount(counts, l.id);
        const active = lens === l.id;
        if (HIDE_WHEN_EMPTY.has(l.id) && count === 0 && !active) return null;
        return (
          <button
            key={l.id}
            role="tab"
            type="button"
            aria-selected={active}
            title={l.hint}
            onClick={() => onChange?.(l.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 999,
              border: active ? '1px solid var(--purple)' : '1px solid var(--border)',
              background: active ? 'rgba(124, 58, 237, 0.10)' : 'var(--surface)',
              color: active ? 'var(--purple)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
              transition: 'all .12s',
            }}
          >
            {l.label}
            {count > 0 && (
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 9,
                  background: active ? 'var(--purple)' : 'rgba(15,23,42,0.06)',
                  color: active ? 'white' : 'var(--text-secondary)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default LensChips;
