// ── Country Handover Doc — field primitives ──────────────────────────────
// Small, opinionated input components used by CountryHandoverDocView. Each
// accepts (value, onChange, disabled) so the editor can drive autosave
// without each field reinventing the contract. No external deps beyond
// React + bootstrap-icons.

import { useEffect, useMemo, useRef, useState } from 'react';

const ROW = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 14,
};

const LABEL = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
};

const HINT = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  fontStyle: 'italic',
};

const INPUT_BASE = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--text)',
  outline: 'none',
};

const READ_ONLY_BLOCK = {
  padding: '8px 10px',
  borderRadius: 8,
  background: 'rgba(15,23,42,0.03)',
  color: 'var(--text)',
  fontSize: 13,
  minHeight: 36,
  whiteSpace: 'pre-wrap',
  border: '1px solid var(--border)',
};

export function Field({ label, hint, required, children, error }) {
  return (
    <div style={ROW}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <label style={LABEL}>
          {label}
          {required && <span style={{ color: '#B91C1C', marginLeft: 4 }}>*</span>}
        </label>
        {error && <span style={{ color: '#B91C1C', fontSize: 11 }}>{error}</span>}
      </div>
      {children}
      {hint && <div style={HINT}>{hint}</div>}
    </div>
  );
}

// ── TextInput ─────────────────────────────────────────────────────────────
export function TextInput({ value, onChange, placeholder, disabled, readOnly }) {
  if (readOnly) {
    return <div style={READ_ONLY_BLOCK}>{value || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</div>;
  }
  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange?.(e.target.value)}
      style={INPUT_BASE}
    />
  );
}

// ── URL input ─────────────────────────────────────────────────────────────
// Validates `https://` prefix. Empty string is valid (optional field).
export function UrlInput({ value, onChange, placeholder = 'https://…', disabled, readOnly }) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && value && !/^https?:\/\//i.test(value);
  if (readOnly) {
    return (
      <div style={READ_ONLY_BLOCK}>
        {value
          ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--purple)', wordBreak: 'break-all' }}>{value}</a>
          : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
      </div>
    );
  }
  return (
    <>
      <input
        type="url"
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => onChange?.(e.target.value)}
        onBlur={() => setTouched(true)}
        style={{ ...INPUT_BASE, borderColor: invalid ? '#B91C1C' : 'var(--border)' }}
      />
      {invalid && <div style={{ ...HINT, color: '#B91C1C', fontStyle: 'normal' }}>URL must start with https://</div>}
    </>
  );
}

// ── MarkdownTextarea ──────────────────────────────────────────────────────
// Plain textarea now — we render whatever's stored as markdown text. A
// preview tab is a Phase F nice-to-have.
export function MarkdownTextarea({ value, onChange, placeholder, disabled, readOnly, minRows = 3 }) {
  if (readOnly) {
    return <div style={READ_ONLY_BLOCK}>{value || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</div>;
  }
  return (
    <textarea
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      rows={minRows}
      onChange={e => onChange?.(e.target.value)}
      style={{ ...INPUT_BASE, resize: 'vertical', minHeight: 28 * minRows, lineHeight: 1.5 }}
    />
  );
}

// ── Toggle (Yes / No / Unknown) ───────────────────────────────────────────
// Null = "Unknown / not yet specified" — distinct from false.
export function TristateToggle({ value, onChange, disabled, readOnly, trueLabel = 'Yes', falseLabel = 'No' }) {
  const opts = [
    { v: true,  label: trueLabel },
    { v: false, label: falseLabel },
    { v: null,  label: 'Unknown' },
  ];
  if (readOnly) {
    const hit = opts.find(o => o.v === value);
    return <div style={READ_ONLY_BLOCK}>{hit?.label || '—'}</div>;
  }
  return (
    <div role="radiogroup" style={{ display: 'inline-flex', borderRadius: 8, background: 'rgba(15,23,42,0.05)', padding: 2 }}>
      {opts.map(o => {
        const active = value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange?.(o.v)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontFamily: 'inherit',
              border: 'none',
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-secondary)',
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── SegmentedControl (enum) ───────────────────────────────────────────────
export function SegmentedControl({ value, onChange, options = [], disabled, readOnly }) {
  if (readOnly) {
    const hit = options.find(o => o.value === value);
    return <div style={READ_ONLY_BLOCK}>{hit?.label || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</div>;
  }
  return (
    <div role="radiogroup" style={{ display: 'inline-flex', borderRadius: 8, background: 'rgba(15,23,42,0.05)', padding: 2 }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange?.(active ? null : o.value)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontFamily: 'inherit',
              border: 'none',
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-secondary)',
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── TagInput ──────────────────────────────────────────────────────────────
// Enter / comma / blur adds the typed token to the list. Deduplicates and
// trims. Backspace on empty input removes the last tag.
export function TagInput({ value = [], onChange, placeholder, disabled, readOnly }) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(value) ? value : [];

  if (readOnly) {
    if (list.length === 0) {
      return <div style={READ_ONLY_BLOCK}><span style={{ color: 'var(--text-secondary)' }}>—</span></div>;
    }
    return (
      <div style={{ ...READ_ONLY_BLOCK, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {list.map(t => (
          <span key={t} style={{
            display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
            background: 'rgba(124, 58, 237, 0.10)', color: 'var(--purple)',
            borderRadius: 999, fontSize: 12, fontWeight: 600,
          }}>{t}</span>
        ))}
      </div>
    );
  }

  function commit(token) {
    const t = (token || '').trim();
    if (!t) return;
    if (list.includes(t)) return;
    onChange?.([...list, t]);
    setDraft('');
  }

  function removeAt(i) {
    const next = list.slice();
    next.splice(i, 1);
    onChange?.(next);
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && list.length > 0) {
      e.preventDefault();
      removeAt(list.length - 1);
    }
  }

  return (
    <div style={{ ...INPUT_BASE, display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, minHeight: 38 }}>
      {list.map((t, i) => (
        <span key={t + i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 4px 2px 8px',
          background: 'rgba(124, 58, 237, 0.10)', color: 'var(--purple)',
          borderRadius: 999, fontSize: 12, fontWeight: 600,
        }}>
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => removeAt(i)}
            disabled={disabled}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--purple)', padding: '0 4px', fontSize: 14, lineHeight: 1,
            }}
          >×</button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={list.length === 0 ? placeholder : ''}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => commit(draft)}
        style={{ flex: 1, minWidth: 100, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: 'inherit', color: 'var(--text)' }}
      />
    </div>
  );
}

// ── MemberPicker ──────────────────────────────────────────────────────────
// Single-select typeahead over the members roster. Stores email.
export function MemberPicker({ value, onChange, members = [], placeholder = 'Search by name or email…', disabled, readOnly }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const wrapRef = useRef(null);

  const member = useMemo(() => members.find(m => (m?.email || '').toLowerCase() === (value || '').toLowerCase()), [value, members]);

  // Reset query when the value changes from outside.
  useEffect(() => { setQuery(''); }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (members || [])
      .filter(m => (m.email || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, members]);

  // Click-outside closes the popup.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (readOnly) {
    return <div style={READ_ONLY_BLOCK}>{value ? (member?.name ? `${member.name} · ${value}` : value) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</div>;
  }

  function pick(m) {
    onChange?.(m.email);
    setQuery('');
    setOpen(false);
    setHover(0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {value ? (
        <div style={{
          ...INPUT_BASE,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member?.name ? `${member.name} · ${value}` : value}
          </span>
          <button
            type="button"
            onClick={() => onChange?.('')}
            disabled={disabled}
            aria-label="Clear"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, padding: '0 4px' }}
          >×</button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); setHover(0); }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={e => {
            if (!open) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHover(h => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter' && matches[hover]) { e.preventDefault(); pick(matches[hover]); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
          style={INPUT_BASE}
        />
      )}
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 6px 24px rgba(15,23,42,0.14)', zIndex: 10, overflow: 'hidden',
        }}>
          {matches.map((m, i) => (
            <button
              key={m.email}
              type="button"
              onMouseEnter={() => setHover(i)}
              onClick={() => pick(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 10px',
                background: i === hover ? 'rgba(124, 58, 237, 0.08)' : 'transparent',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, color: 'var(--text)', textAlign: 'left',
              }}
            >
              <strong>{m.name || m.email}</strong>
              {m.name && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>· {m.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Repeater ──────────────────────────────────────────────────────────────
// Generic add/remove rows. Each row is rendered by the caller's render(row,
// index, update) prop. emptyRow() returns the shape inserted when "Add" is
// clicked. Storage shape: array of row objects.
export function Repeater({
  value = [], onChange, renderRow, emptyRow, addLabel = 'Add', disabled, readOnly,
  emptyHint = 'No entries yet.',
}) {
  const list = Array.isArray(value) ? value : [];

  if (readOnly && list.length === 0) {
    return <div style={READ_ONLY_BLOCK}><span style={{ color: 'var(--text-secondary)' }}>—</span></div>;
  }

  function update(i, next) {
    const out = list.slice();
    out[i] = next;
    onChange?.(out);
  }
  function add() {
    onChange?.([...list, typeof emptyRow === 'function' ? emptyRow() : {}]);
  }
  function remove(i) {
    const out = list.slice();
    out.splice(i, 1);
    onChange?.(out);
  }
  function moveUp(i) {
    if (i === 0) return;
    const out = list.slice();
    [out[i - 1], out[i]] = [out[i], out[i - 1]];
    onChange?.(out);
  }
  function moveDown(i) {
    if (i === list.length - 1) return;
    const out = list.slice();
    [out[i + 1], out[i]] = [out[i], out[i + 1]];
    onChange?.(out);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {list.length === 0 && (
        <div style={{ ...HINT, padding: '6px 0' }}>{emptyHint}</div>
      )}
      {list.map((row, i) => (
        <div
          key={i}
          style={{
            position: 'relative',
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'rgba(15,23,42,0.02)',
          }}
        >
          {!readOnly && (
            <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 2 }}>
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={disabled || i === 0}
                aria-label="Move up"
                style={iconBtn(disabled || i === 0)}
              ><i className="bi bi-arrow-up" /></button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={disabled || i === list.length - 1}
                aria-label="Move down"
                style={iconBtn(disabled || i === list.length - 1)}
              ><i className="bi bi-arrow-down" /></button>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={disabled}
                aria-label="Remove row"
                style={iconBtn(disabled, '#B91C1C')}
              ><i className="bi bi-trash" /></button>
            </div>
          )}
          {renderRow(row, i, (next) => update(i, next))}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          style={{
            alignSelf: 'flex-start',
            padding: '6px 12px',
            border: '1px dashed var(--border)',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <i className="bi bi-plus-lg" style={{ marginRight: 4 }} />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function iconBtn(disabled, color) {
  return {
    width: 24, height: 24,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: 6,
    background: 'transparent',
    color: disabled ? 'rgba(15,23,42,0.25)' : (color || 'var(--text-secondary)'),
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  };
}

// ── Plain "ordered text rows" repeater ────────────────────────────────────
// Convenience wrapper for pre_onboarding_steps where each row is just a
// single text string under `{ text: '...' }`.
export function OrderedTextRepeater({ value, onChange, disabled, readOnly, placeholder = 'Step description' }) {
  return (
    <Repeater
      value={value}
      onChange={onChange}
      disabled={disabled}
      readOnly={readOnly}
      addLabel="Add step"
      emptyRow={() => ({ text: '' })}
      emptyHint="No steps yet."
      renderRow={(row, i, update) => (
        <Field label={`Step ${i + 1}`}>
          <MarkdownTextarea
            value={row?.text || ''}
            onChange={(v) => update({ ...row, text: v })}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            minRows={1}
          />
        </Field>
      )}
    />
  );
}
