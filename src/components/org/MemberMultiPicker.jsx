// ── MemberMultiPicker (Phase 12a, 2026-05-25) ──────────────────────────────
// Multi-select email picker scoped to a candidate list of org members.
// Renders a chip rail of currently-selected members + a searchable dropdown
// to add more. Pre-existing assignees who aren't in the candidate list
// (e.g. a lead who moved depts after a row was created) still render so
// nothing silently disappears — they just get a neutral "off-team" label.
//
// Read-only mode (disabled / canEdit=false) hides the trigger and the
// chip remove buttons so viewers see the same data without editing.

import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';

function normaliseEmail(s) {
  return String(s || '').trim().toLowerCase();
}

export default function MemberMultiPicker({
  selected = [],
  onChange,
  candidates = [],
  oooEmails,
  disabled = false,
  placeholder = 'Add member…',
  emptyHint = 'No members assigned',
  maxSelected = 24,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // Outside-click closes the dropdown (per skill §3.3).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const candidateByEmail = useMemo(() => {
    const m = new Map();
    for (const c of candidates) {
      const e = normaliseEmail(c.email);
      if (e) m.set(e, c);
    }
    return m;
  }, [candidates]);

  const selectedEmails = useMemo(
    () => Array.from(new Set((selected || []).map(normaliseEmail).filter(Boolean))),
    [selected],
  );
  const selectedSet = useMemo(() => new Set(selectedEmails), [selectedEmails]);

  const oooSet = oooEmails instanceof Set
    ? oooEmails
    : new Set((oooEmails || []).map(normaliseEmail));

  // Visible chips include both in-roster members AND any selected emails
  // that aren't currently in the candidate list (so legacy / moved members
  // still surface and can be removed).
  const chips = selectedEmails.map(email => {
    const m = candidateByEmail.get(email);
    return {
      email,
      name: m?.name || email.split('@')[0],
      initials: m?.initials || (m?.name || email).slice(0, 2).toUpperCase(),
      avatarUrl: m?.avatarUrl || null,
      offTeam: !m,
    };
  });

  const lc = search.trim().toLowerCase();
  const filteredCandidates = useMemo(() => {
    const list = [];
    for (const c of candidates) {
      const e = normaliseEmail(c.email);
      if (!e || selectedSet.has(e)) continue;
      if (!lc
        || (c.name || '').toLowerCase().includes(lc)
        || e.includes(lc)
        || (c.title || '').toLowerCase().includes(lc)) {
        list.push(c);
      }
    }
    // Sort by name for predictable scanning.
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list.slice(0, 50);
  }, [candidates, selectedSet, lc]);

  const addEmail = (email) => {
    const e = normaliseEmail(email);
    if (!e || selectedSet.has(e)) return;
    if (selectedEmails.length >= maxSelected) return;
    const next = [...selectedEmails, e];
    onChange?.(next);
    setSearch('');
    inputRef.current?.focus();
  };

  const removeEmail = (email) => {
    const e = normaliseEmail(email);
    const next = selectedEmails.filter(x => x !== e);
    onChange?.(next);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 180 }}>
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          minHeight: 32, padding: chips.length ? '4px 6px' : '6px 8px',
          background: disabled ? 'var(--surface-2)' : 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          cursor: disabled ? 'not-allowed' : 'text',
          alignItems: 'center',
          opacity: disabled ? 0.7 : 1,
        }}
        onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus(); } }}
      >
        {chips.length === 0 && !open && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12, paddingLeft: 2 }}>
            {disabled ? emptyHint : placeholder}
          </span>
        )}
        {chips.map(chip => (
          <span
            key={chip.email}
            title={chip.email + (chip.offTeam ? ' (no longer in this dept)' : '') + (oooSet.has(chip.email) ? ' • On leave' : '')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '2px 6px 2px 2px',
              background: chip.offTeam ? 'var(--orange-light)' : 'var(--surface-2)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12, color: chip.offTeam ? 'var(--orange)' : 'var(--text)',
              maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            <Avatar name={chip.name} initials={chip.initials} src={chip.avatarUrl} size="xs" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.name}</span>
            {oooSet.has(chip.email) && (
              <i
                className="bi bi-calendar-x"
                aria-label="On leave"
                style={{ color: '#B91C1C', fontSize: 11 }}
              />
            )}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeEmail(chip.email); }}
                aria-label={`Remove ${chip.name}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16,
                  padding: 0, background: 'transparent',
                  border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 12, lineHeight: 1,
                  borderRadius: '50%',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <i className="bi bi-x" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={chips.length ? '' : placeholder}
            style={{
              flex: 1, minWidth: 80,
              border: 'none', outline: 'none',
              background: 'transparent',
              fontSize: 12, color: 'var(--text)',
              fontFamily: 'inherit',
              padding: '4px 2px',
            }}
          />
        )}
      </div>
      {open && !disabled && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.14)',
            maxHeight: 280, overflow: 'auto',
            zIndex: 60,
          }}
        >
          {filteredCandidates.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              {lc ? 'No matches.' : 'Everyone in this dept is already selected.'}
            </div>
          ) : (
            filteredCandidates.map(c => {
              const e = normaliseEmail(c.email);
              const isOoo = oooSet.has(e);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => addEmail(e)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid var(--border-light)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
                >
                  <Avatar name={c.name} initials={c.initials} src={c.avatarUrl} size="sm" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: 600, color: 'var(--text)', fontSize: 12,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{c.name}</div>
                    <div style={{
                      color: 'var(--text-muted)', fontSize: 11,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{e}{c.title ? ` · ${c.title}` : ''}</div>
                  </div>
                  {isOoo && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 6px', borderRadius: 'var(--radius-pill)',
                      background: '#FEE2E2', color: '#B91C1C',
                      fontSize: 10, fontWeight: 600,
                    }}>
                      <i className="bi bi-calendar-x" /> OOO
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
