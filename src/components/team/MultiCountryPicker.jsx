// ── MultiCountryPicker ──────────────────────────────────────────────────────
// Inline multi-select country picker for the Team tab's "Countries" column.
// Renders a chip-summary trigger; clicking opens a dropdown with a search
// box, a checkbox per country (flag + ISO code + full name), and a
// "Selected" group pinned at the top so the current set is always visible.
// Saves on close (or via the Save button) by calling onSave with the new
// array of ISO codes.
//
// Read-only mode (canEdit=false) hides the trigger's hover affordance and
// disables clicks — used for viewers who don't have permission to edit
// country ownership.

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FLAGS, getCountryName, getFlag } from '../../data/constants';

// Build the canonical country option list once. Source: every 2-letter ISO
// code we know a flag for. Sorted by full name so search-by-name lands on
// "Albania" before "Algeria" naturally. We exclude the legacy "UK" alias
// to avoid duplicate Great Britain rows.
function buildCountryOptions() {
  const seen = new Set();
  const opts = [];
  for (const code of Object.keys(FLAGS || {})) {
    const upper = code.toUpperCase();
    if (upper === 'UK') continue;
    if (seen.has(upper)) continue;
    seen.add(upper);
    opts.push({
      code: upper,
      name: getCountryName(upper) || upper,
      flag: getFlag(upper) || '',
    });
  }
  opts.sort((a, b) => a.name.localeCompare(b.name));
  return opts;
}

const COUNTRY_OPTIONS = buildCountryOptions();
const CANONICAL_CODES = new Set(COUNTRY_OPTIONS.map(o => o.code));

// Some saved member.countries entries can be ISO-shaped (matches /^[A-Z]{2}$/
// on the server) but not in FLAGS — typically legacy values like `UK` instead
// of `GB`, or codes from old seeds. Without this synthesizer those rows
// silently survived every save: the picker counted them in `selected.length`
// (badge says "6 countries") but rendered no checkbox to uncheck them, so
// Ewa Kotowska (2026-05-11 feedback "I removed countries from Raquel but she
// is still showing as assigned to 6") couldn't get the count down past the
// visible ones. Building a synthetic option per unknown code lets the user
// see + clear them.
function buildUnknownOptions(selected) {
  if (!Array.isArray(selected) || selected.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const raw of selected) {
    if (typeof raw !== 'string') continue;
    const upper = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) continue;
    if (CANONICAL_CODES.has(upper)) continue;
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push({ code: upper, name: `Unknown (${upper})`, flag: '🌐', unknown: true });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export default function MultiCountryPicker({
  selected = [],
  onSave,
  disabled = false,
  canEdit = true,
  align = 'left',
  size = 'md',
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => normaliseList(selected));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Popover position — computed from the trigger's bounding rect every time
  // open flips true, and on scroll / resize while open. Stored as either
  // {top, left} (align='left') or {top, right} (align='right'). Null while
  // closed, drives the position:fixed dropdown render below.
  const [pos, setPos] = useState(null);
  const ref = useRef(null);      // trigger wrapper
  const popRef = useRef(null);   // popover (when open)
  const inputRef = useRef(null);

  // Keep the draft in sync if the parent re-pushes a new selection (e.g.
  // after a successful save the optimistic update flows back through).
  useEffect(() => { setDraft(normaliseList(selected)); }, [selected]);

  // Anchor the popover to the trigger via position:fixed AND render it
  // through a portal to document.body. The portal is the load-bearing
  // half: every top-level view is wrapped in `<div className="page-enter">`
  // which carries a CSS `pageIn` animation with `transform: translateY(…)`.
  // Any non-`none` transform on an ancestor makes that ancestor the new
  // containing block for position:fixed descendants — so without the
  // portal, the popover's `top:` coordinates were being interpreted
  // relative to `.page-enter` instead of the viewport. When the user had
  // scrolled the Home/Team/Leaders-Hub table down past the first row,
  // `.page-enter` sat above the viewport (e.g. viewport-y -1232), and the
  // popover rendered at viewport-y ≈ `.page-enter.top + r.bottom + 6`
  // ≈ -833 — i.e. hidden above the viewport. Clicking the trigger again
  // toggled `open` back to false, so to the user it looked like the
  // picker "automatically closed" on click (Madeleine 2026-05-19, same
  // symptom Mohamed/Madeleine reported 2026-05-15 which PR #652's
  // position:fixed fix solved for `overflow:hidden` but NOT for the
  // transform-creates-containing-block edge case).
  //
  // Portaling the popover under document.body escapes the transformed
  // ancestor entirely so `top:` reads against the viewport again; the
  // outside-click + scroll-recalc effects below keep working because
  // refs propagate through portals.
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const next = { top: Math.round(r.bottom + 6) };
      if (align === 'right') {
        next.right = Math.max(8, Math.round(window.innerWidth - r.right));
      } else {
        next.left = Math.round(r.left);
      }
      setPos(next);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, align]);

  // Outside-click closes the popover (without saving — Save / Clear are
  // explicit). Mousedown so we close before the next click hits another
  // chip / button. With the popover rendered at position:fixed it lives
  // outside ref.current in the visual stacking order, so the check has to
  // exempt the popover ref as well.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Auto-focus the search box on open so keyboard users can start typing
  // without an extra click.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const selectedSet = useMemo(() => new Set(draft), [draft]);

  // Include synthetic rows for any saved code that isn't in COUNTRY_OPTIONS
  // (legacy / unknown ISO-shaped codes). They get the canonical "selected →
  // pinned to top" treatment below so users can spot and clear them.
  const allOptions = useMemo(() => {
    const extras = buildUnknownOptions(draft);
    return extras.length === 0 ? COUNTRY_OPTIONS : [...extras, ...COUNTRY_OPTIONS];
  }, [draft]);

  // Count of synthetic / unknown codes currently in the draft. Drives the
  // "Remove unknown codes" affordance + the on-row warning chip.
  const unknownCount = useMemo(() => buildUnknownOptions(draft).length, [draft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(o =>
      o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
    );
  }, [query, allOptions]);

  // Pin selected entries to the top of the dropdown so the user can see
  // (and uncheck) what's already on this member without scrolling.
  const orderedOptions = useMemo(() => {
    if (selectedSet.size === 0) return filtered;
    const sel = [];
    const rest = [];
    for (const o of filtered) {
      if (selectedSet.has(o.code)) sel.push(o);
      else rest.push(o);
    }
    return [...sel, ...rest];
  }, [filtered, selectedSet]);

  const toggle = (code) => {
    setDraft(prev => prev.includes(code)
      ? prev.filter(c => c !== code)
      : [...prev, code].sort(),
    );
  };

  const dirty = useMemo(() => {
    const a = new Set(normaliseList(selected));
    const b = new Set(draft);
    if (a.size !== b.size) return true;
    for (const c of a) if (!b.has(c)) return true;
    return false;
  }, [selected, draft]);

  const handleSave = async () => {
    if (!onSave || !dirty) { setOpen(false); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(draft);
      if (result && result.ok === false) {
        setError(result.error || 'Failed to save');
      } else {
        setOpen(false);
      }
    } catch (err) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => setDraft([]);
  const handleCancel = () => { setDraft(normaliseList(selected)); setOpen(false); };
  // One-click cleanup of every saved code that's not in the canonical
  // FLAGS list. Visible only when there's at least one unknown to remove.
  const handleClearUnknown = () => {
    setDraft(prev => prev.filter(c => CANONICAL_CODES.has(c)));
  };

  // ── Trigger ────────────────────────────────────────────────────────────
  const triggerHeight = size === 'sm' ? 26 : 30;
  const triggerCount = selected.length;
  const triggerLabel = triggerCount === 0
    ? (canEdit ? 'Add countries' : 'No countries')
    : `${triggerCount} ${triggerCount === 1 ? 'country' : 'countries'}`;

  // Pre-render up to 3 flags as a compact preview alongside the count, so
  // a glance at the row reveals the regions a member covers.
  const preview = selected.slice(0, 3).map(c => getFlag(c)).filter(Boolean).join(' ');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled || (!canEdit && triggerCount === 0)}
        onClick={() => canEdit && setOpen(o => !o)}
        title={canEdit ? 'Edit country ownership' : 'You don’t have permission to edit country ownership'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: triggerHeight,
          padding: '0 10px',
          borderRadius: 128,
          border: open ? '1px solid #7c3aed' : (canEdit ? '1px solid #e8e8e8' : '1px solid transparent'),
          background: open ? '#f3eff8' : (triggerCount > 0 ? '#f7f5f2' : (canEdit ? 'white' : 'transparent')),
          color: triggerCount > 0 ? '#1b1b1b' : '#9e9e9e',
          fontSize: 11,
          fontWeight: 600,
          cursor: canEdit ? 'pointer' : 'default',
          transition: 'all .15s',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        <i className="bi-globe2" style={{ fontSize: 11, color: triggerCount > 0 ? '#7c3aed' : '#9e9e9e' }} />
        {preview && <span style={{ fontSize: 12, lineHeight: 1 }}>{preview}</span>}
        <span>{triggerLabel}</span>
        {canEdit && <i className={open ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 9, opacity: 0.6 }} />}
      </button>

      {open && pos && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Country ownership picker"
          style={{
            position: 'fixed',
            top: pos.top,
            ...(pos.right != null ? { right: pos.right } : { left: pos.left }),
            width: 320,
            background: 'var(--surface)',
            border: '1px solid #e8e8e8',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
            zIndex: 1400,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 420,
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 10px',
            borderBottom: '1px solid #f0efed',
          }}>
            <i className="bi-search" style={{ fontSize: 11, color: '#9e9e9e' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${COUNTRY_OPTIONS.length} countries…`}
              style={{
                flex: 1, border: 'none', outline: 'none',
                fontSize: 12, color: '#1b1b1b', background: 'transparent',
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') { setQuery(''); handleCancel(); }
              }}
            />
            {query && (
              <i className="bi-x-circle-fill"
                onClick={() => setQuery('')}
                style={{ fontSize: 12, color: '#9e9e9e', cursor: 'pointer' }}
              />
            )}
          </div>

          {/* Selected count + clear */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px',
            background: '#fafaf9',
            borderBottom: '1px solid #f0efed',
            fontSize: 11,
          }}>
            <span style={{ color: '#616161', fontWeight: 600 }}>
              {draft.length} selected
              {unknownCount > 0 && (
                <span style={{ marginLeft: 6, color: '#b45309', fontWeight: 600 }}>
                  · {unknownCount} unknown
                </span>
              )}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {unknownCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearUnknown}
                  title="Remove every code that doesn't match a recognized country (typically legacy values from older seeds)"
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: 11, color: '#b45309', fontWeight: 600, padding: 0,
                  }}
                >
                  Remove unknown
                </button>
              )}
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: 11, color: '#7c3aed', fontWeight: 600, padding: 0,
                  }}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {orderedOptions.length === 0 && (
              <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: '#9e9e9e' }}>
                No countries match &ldquo;{query}&rdquo;
              </div>
            )}
            {orderedOptions.map(opt => {
              const checked = selectedSet.has(opt.code);
              const isUnknown = !!opt.unknown;
              return (
                <div
                  key={opt.code}
                  onClick={() => toggle(opt.code)}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#f9f8f6'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = checked ? (isUnknown ? '#fff8e6' : '#f3eff8') : 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    background: checked ? (isUnknown ? '#fff8e6' : '#f3eff8') : 'transparent',
                    color: checked ? (isUnknown ? '#92400e' : '#5b2ba0') : '#1b1b1b',
                    transition: 'background .1s',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 16, height: 16, borderRadius: 4,
                      border: checked
                        ? (isUnknown ? '2px solid #d97706' : '2px solid #7c3aed')
                        : '2px solid #d5d5d5',
                      background: checked ? (isUnknown ? '#d97706' : '#7c3aed') : 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {checked && <i className="bi-check2" style={{ fontSize: 10, color: 'white' }} />}
                  </span>
                  <span style={{ fontSize: 14, lineHeight: 1, width: 18 }}>
                    {isUnknown ? <i className="bi-question-circle-fill" style={{ fontSize: 12, color: '#d97706' }} /> : opt.flag}
                  </span>
                  <span style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", monospace',
                    fontSize: 11, fontWeight: 600,
                    color: checked ? (isUnknown ? '#92400e' : '#5b2ba0') : '#9e9e9e',
                    width: 26,
                  }}>
                    {opt.code}
                  </span>
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: checked ? 600 : 500,
                  }}
                  title={isUnknown ? 'Code is saved on this member but doesn’t match a recognized country — uncheck to remove' : undefined}
                  >
                    {opt.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Error + Save bar */}
          {error && (
            <div style={{
              padding: '6px 12px',
              background: '#fef2f2',
              borderTop: '1px solid #fca5a5',
              color: '#991b1b',
              fontSize: 11,
            }}>
              {error}
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 6,
            padding: '8px 10px',
            borderTop: '1px solid #f0efed',
          }}>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '5px 12px',
                borderRadius: 128,
                border: '1px solid #e8e8e8',
                background: 'var(--surface)',
                fontSize: 11, fontWeight: 600, color: '#616161',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              style={{
                padding: '5px 14px',
                borderRadius: 128,
                border: 'none',
                background: !dirty || saving ? '#e8e8e8' : '#7c3aed',
                color: !dirty || saving ? '#9e9e9e' : 'white',
                fontSize: 11, fontWeight: 700,
                cursor: !dirty || saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : (dirty ? 'Save' : 'No changes')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function normaliseList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (typeof c !== 'string') continue;
    const upper = c.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) continue;
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  return out.sort();
}
