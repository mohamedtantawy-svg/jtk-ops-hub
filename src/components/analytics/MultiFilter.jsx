import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FUNCTIONS, getFlag, getCountryName } from '../../data/constants';

// ---------------------------------------------------------------------------
// MultiFilter — multi-dimensional filter bar (used on Home + Analytics)
// Kristina requested multi-select across region, country, type, agent, date.
// ---------------------------------------------------------------------------

const PILL_BASE = {
  padding: '5px 14px',
  borderRadius: 128,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid #e8e8e8',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const PILL_ACTIVE = {
  ...PILL_BASE,
  background: '#7c3aed',
  color: '#fff',
  borderColor: '#7c3aed',
};

const PILL_INACTIVE = {
  ...PILL_BASE,
  background: 'var(--surface)',
  color: '#616161',
  borderColor: '#e8e8e8',
};

const DROPDOWN_STYLE = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  background: 'var(--surface)',
  border: '1px solid #e8e8e8',
  borderRadius: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,.10)',
  maxHeight: 200,
  overflowY: 'auto',
  zIndex: 200,
  minWidth: 180,
  padding: '6px 0',
};

const CHECK_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 14px',
  fontSize: 12,
  cursor: 'pointer',
  color: '#1b1b1b',
  transition: 'background 0.1s',
};

const DATE_OPTIONS = [
  { id: '7d', label: '7 Days', days: 7 },
  { id: '30d', label: '30 Days', days: 30 },
  { id: '90d', label: '90 Days', days: 90 },
  { id: 'custom', label: 'Custom', days: null },
];

function Checkbox({ checked }) {
  return (
    <span
      style={{
        width: 15,
        height: 15,
        borderRadius: 4,
        border: checked ? '2px solid #7c3aed' : '2px solid #ccc',
        background: checked ? '#7c3aed' : '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'all 0.12s',
      }}
    >
      {checked && (
        <i className="bi-check" style={{ fontSize: 11, color: '#fff', lineHeight: 1 }} />
      )}
    </span>
  );
}

function DropdownFilter({ label, icon, options, selected, onToggle, onSelectAll, onClear, formatOption }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const display = (opt) => (typeof formatOption === 'function' ? formatOption(opt) : opt);

  const isAll = selected.includes('all') || selected.length === options.length;
  const pillLabel =
    isAll
      ? `${label}: All`
      : selected.length === 1
        ? `${label}: ${display(selected[0])}`
        : `${label}: ${selected.length}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={selected.includes('all') ? PILL_INACTIVE : PILL_ACTIVE}
      >
        {icon && <i className={icon} style={{ fontSize: 12 }} />}
        {pillLabel}
        <i className={open ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 10, marginLeft: 2 }} />
      </button>

      {open && (
        <div style={DROPDOWN_STYLE}>
          {/* Select All / Clear */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 14px 6px', borderBottom: '1px solid #f2f2f2', marginBottom: 2 }}>
            <span
              onClick={() => { onSelectAll(); }}
              style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', cursor: 'pointer' }}
            >
              Select All
            </span>
            <span
              onClick={() => { onClear(); }}
              style={{ fontSize: 11, fontWeight: 600, color: '#d42d35', cursor: 'pointer' }}
            >
              Clear
            </span>
          </div>
          {options.map((opt) => {
            const isChecked = selected.includes('all') || selected.includes(opt);
            return (
              <div
                key={opt}
                onClick={() => onToggle(opt)}
                style={{
                  ...CHECK_ROW,
                  background: isChecked ? '#f9f5ff' : 'transparent',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f0ff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isChecked ? '#f9f5ff' : 'transparent'; }}
              >
                <Checkbox checked={isChecked} />
                <span style={{ fontWeight: isChecked ? 600 : 400 }}>{display(opt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MultiFilter({
  members = [],
  tasks = [],
  onFilterChange,
  regions = ['EMEA', 'APAC', 'LATAM', 'NAM', 'LATAM + NAM'],
  showDateRange = true,
}) {
  const [regionFilter, setRegionFilter] = useState(['all']);
  const [countryFilter, setCountryFilter] = useState(['all']);
  const [typeFilter, setTypeFilter] = useState(['all']);
  const [agentFilter, setAgentFilter] = useState(['all']);
  const [dateRange, setDateRange] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Derive option lists
  const countryOptions = useMemo(
    () => [...new Set(tasks.map((t) => t.country).filter(Boolean))].sort(),
    [tasks]
  );
  const typeOptions = useMemo(() => Object.keys(FUNCTIONS).sort(), []);
  const agentOptions = useMemo(
    () => members.map((m) => m.name).sort(),
    [members]
  );

  // Notify parent on any change
  const notifyChange = useCallback(() => {
    if (!onFilterChange) return;
    const rangeDays =
      dateRange === 'custom'
        ? customFrom && customTo
          ? Math.ceil((new Date(customTo) - new Date(customFrom)) / (1000 * 60 * 60 * 24))
          : 30
        : DATE_OPTIONS.find((d) => d.id === dateRange)?.days || 30;
    onFilterChange({
      regions: regionFilter,
      countries: countryFilter,
      types: typeFilter,
      agents: agentFilter,
      dateRange,
      rangeDays,
      customFrom: dateRange === 'custom' ? customFrom : null,
      customTo: dateRange === 'custom' ? customTo : null,
    });
  }, [regionFilter, countryFilter, typeFilter, agentFilter, dateRange, customFrom, customTo, onFilterChange]);

  useEffect(() => { notifyChange(); }, [notifyChange]);

  // Generic multi-select helpers
  function makeToggle(setter, allOptions) {
    return (val) => {
      setter((prev) => {
        if (prev.includes('all')) {
          // currently "all" — uncheck this val means select everything except val
          const next = allOptions.filter((o) => o !== val);
          return next.length === 0 ? ['all'] : next;
        }
        if (prev.includes(val)) {
          const next = prev.filter((v) => v !== val);
          return next.length === 0 ? ['all'] : next;
        }
        const next = [...prev, val];
        return next.length === allOptions.length ? ['all'] : next;
      });
    };
  }

  function makeSelectAll(setter) {
    return () => setter(['all']);
  }

  function makeClear(setter) {
    return () => setter([]);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 0',
        overflowX: 'auto',
        flexWrap: 'nowrap',
        minHeight: 44,
      }}
    >
      {/* Region */}
      <DropdownFilter
        label="Region"
        icon="bi-globe2"
        options={regions}
        selected={regionFilter}
        onToggle={makeToggle(setRegionFilter, regions)}
        onSelectAll={makeSelectAll(setRegionFilter)}
        onClear={makeClear(setRegionFilter)}
      />

      {/* Country */}
      <DropdownFilter
        label="Country"
        icon="bi-geo-alt"
        options={countryOptions}
        selected={countryFilter}
        onToggle={makeToggle(setCountryFilter, countryOptions)}
        onSelectAll={makeSelectAll(setCountryFilter)}
        onClear={makeClear(setCountryFilter)}
        formatOption={(cc) => `${getFlag(cc)} ${getCountryName(cc) || cc}`.trim()}
      />

      {/* Type */}
      <DropdownFilter
        label="Type"
        icon="bi-tag"
        options={typeOptions}
        selected={typeFilter}
        onToggle={makeToggle(setTypeFilter, typeOptions)}
        onSelectAll={makeSelectAll(setTypeFilter)}
        onClear={makeClear(setTypeFilter)}
      />

      {/* Agent */}
      <DropdownFilter
        label="Agent"
        icon="bi-person"
        options={agentOptions}
        selected={agentFilter}
        onToggle={makeToggle(setAgentFilter, agentOptions)}
        onSelectAll={makeSelectAll(setAgentFilter)}
        onClear={makeClear(setAgentFilter)}
      />

      {/* Date Range */}
      {showDateRange && (
        <>
          <div style={{ width: 1, height: 24, background: '#e8e8e8', margin: '0 4px', flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {DATE_OPTIONS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDateRange(d.id)}
                style={dateRange === d.id ? PILL_ACTIVE : PILL_INACTIVE}
              >
                {d.label}
              </button>
            ))}
          </div>
          {dateRange === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{
                  padding: '4px 8px',
                  border: '1px solid #e8e8e8',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#1b1b1b',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: 12, color: '#9e9e9e' }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{
                  padding: '4px 8px',
                  border: '1px solid #e8e8e8',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#1b1b1b',
                  outline: 'none',
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
