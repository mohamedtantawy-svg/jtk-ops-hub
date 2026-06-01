// ── CapacityCountryWorkloadTable (Phase 1 — 2026-06-01) ───────────────────
// Renders the live per-country demand for the caller's dept. One row per
// country with owners (or open demand) in the dept. Mirrors Kristina
// Fomina's sheet 1 layout: country, EOR HC, per-source task counts,
// Total Tasks/mo, # Owners, Tasks/mo per Owner, Owner(s).
//
// Notes on the data model (matches Phase 1's server-side aggregator):
//   • Counts are LIVE actionable-queue snapshots, not 30-day averages.
//     Labelled "/mo" in the header because that's the audit's terminology
//     and the Phase 7 follow-up adds a true rolling average; the snapshot
//     IS the closest single-number proxy for current demand.
//   • Zendesk / Jira / EVL columns stay at 0 in Phase 1 — those fetchers
//     live inside /api/v1/queue and aren't yet exported into the
//     aggregator. Phase 1B extracts them. Columns surface anyway so the
//     audit's shape stays intact and Phase 1B is a drop-in.
//   • Owners are resolved against the live roster (MEMBERS_BY_EMAIL) so a
//     freshly-onboarded teammate appears here on next hydration without
//     a code change.
//
// UI affordances:
//   • Sortable on every numeric column (header click toggles ASC/DESC).
//   • Per-row hover lifts background a notch.
//   • Sticky header so scrolling a long list still shows the columns.
//   • Country shows ISO + flag + full name (Intl.DisplayNames resolves
//     anything not in the explicit COUNTRY_CODE_TO_NAME map).
//   • Empty state: when there's no demand or owners (a brand-new dept),
//     a polite copy guides toward Settings → assign countries / enter HC.

import { useMemo, useState } from 'react';
import { MEMBERS_BY_EMAIL } from '../../data/members';
import { getCountryName, getFlag } from '../../data/constants';

const COLUMNS = [
  { key: 'country',       label: 'Country',           align: 'left',  width: 220, sticky: true },
  { key: 'eorHc',         label: 'EOR HC',            align: 'right', width: 80,  numeric: true },
  { key: 'amend',         label: 'Amend / mo',        align: 'right', width: 90,  numeric: true },
  { key: 'resign',        label: 'Resign / mo',       align: 'right', width: 90,  numeric: true },
  { key: 'term',          label: 'Term / mo',         align: 'right', width: 90,  numeric: true },
  { key: 'onboard',       label: 'Onboard / mo',      align: 'right', width: 100, numeric: true },
  { key: 'evl',           label: 'EVL / mo',          align: 'right', width: 80,  numeric: true,  beta: true  },
  { key: 'jira',          label: 'JIRA / mo',         align: 'right', width: 80,  numeric: true,  beta: true  },
  { key: 'zd',            label: 'ZD / mo',           align: 'right', width: 80,  numeric: true,  beta: true  },
  { key: 'wb',            label: 'WB / mo',           align: 'right', width: 80,  numeric: true },
  { key: 'redlines',      label: 'Redlines / mo',     align: 'right', width: 100, numeric: true },
  { key: 'incentive',     label: 'Incentive / mo',    align: 'right', width: 100, numeric: true },
  { key: 'immig',         label: 'Immigration / mo',  align: 'right', width: 120, numeric: true,  immigOnly: true },
  { key: 'totalTasks',    label: 'Total Tasks / mo',  align: 'right', width: 120, numeric: true, emphasis: true },
  { key: 'numOwners',     label: '# Owners',          align: 'right', width: 80,  numeric: true },
  { key: 'tasksPerOwner', label: 'Tasks / mo / Owner',align: 'right', width: 140, numeric: true, emphasis: true },
  { key: 'ownerEmails',   label: 'Owner(s)',          align: 'left',  width: 280 },
];

function resolveOwnerNames(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return '—';
  return emails.map(e => {
    const m = MEMBERS_BY_EMAIL[(e || '').toLowerCase()];
    return m?.name || e;
  }).join(', ');
}

function renderCountryCell(row) {
  if (row.country === 'UNKNOWN') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <i className="bi-question-circle" style={{ fontSize: 14 }} />
        <em>Unknown country</em>
      </span>
    );
  }
  const flag = getFlag(row.country);
  const name = getCountryName(row.country) || row.country;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{flag}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{name}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
        padding: '2px 6px', borderRadius: 4,
        background: 'var(--surface-2)', border: '1px solid var(--border-light)',
        letterSpacing: '0.05em',
      }}>
        {row.country}
      </span>
    </span>
  );
}

export default function CapacityCountryWorkloadTable({ rows = [], showImmigColumn = false, cachedAt = null }) {
  const [sortKey, setSortKey] = useState('totalTasks');
  const [sortDir, setSortDir] = useState('desc');

  const visibleCols = useMemo(
    () => COLUMNS.filter(c => !c.immigOnly || showImmigColumn),
    [showImmigColumn],
  );

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'country') {
        const an = getCountryName(av) || av || '';
        const bn = getCountryName(bv) || bv || '';
        return sortDir === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      if (sortKey === 'ownerEmails') {
        const an = resolveOwnerNames(av);
        const bn = resolveOwnerNames(bv);
        return sortDir === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  const onHeaderClick = (col) => {
    if (sortKey === col.key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(col.key);
      setSortDir(col.numeric ? 'desc' : 'asc');
    }
  };

  // Totals row — sum of every numeric column, displayed at the bottom
  // (sticky-ish: it's part of the scroll for now; can pin later if asked).
  const totals = useMemo(() => {
    const t = { eorHc: 0, amend: 0, resign: 0, term: 0, onboard: 0,
                evl: 0, jira: 0, zd: 0, wb: 0, redlines: 0, incentive: 0,
                immig: 0, totalTasks: 0, numOwners: 0 };
    const ownerSet = new Set();
    for (const r of sorted) {
      t.eorHc += Number(r.eorHc) || 0;
      t.amend += Number(r.amend) || 0;
      t.resign += Number(r.resign) || 0;
      t.term += Number(r.term) || 0;
      t.onboard += Number(r.onboard) || 0;
      t.evl += Number(r.evl) || 0;
      t.jira += Number(r.jira) || 0;
      t.zd += Number(r.zd) || 0;
      t.wb += Number(r.wb) || 0;
      t.redlines += Number(r.redlines) || 0;
      t.incentive += Number(r.incentive) || 0;
      t.immig += Number(r.immig) || 0;
      t.totalTasks += Number(r.totalTasks) || 0;
      for (const e of (r.ownerEmails || [])) ownerSet.add((e || '').toLowerCase());
    }
    t.numOwners = ownerSet.size;
    t.tasksPerOwner = ownerSet.size > 0 ? +(t.totalTasks / ownerSet.size).toFixed(1) : 0;
    return t;
  }, [sorted]);

  if (rows.length === 0) {
    return (
      <div style={emptyCard}>
        <i className="bi-globe-europe-africa" style={{ fontSize: 32, color: 'var(--text-disabled)', marginBottom: 12 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No country demand yet</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, maxWidth: 480 }}>
          Either this department has no active demand from the connected Deel sources, or no team member has any country assigned yet. Assign countries to members via Team → Countries to populate the owner column.
        </div>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        .cap-cwt-wrap { background: var(--surface); border: 1px solid var(--border-light); border-radius: 14px; overflow: hidden; }
        .cap-cwt-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 320px); }
        .cap-cwt-table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 1400px; font-size: 12.5px; }
        .cap-cwt-table thead th {
          position: sticky; top: 0; z-index: 2;
          background: var(--surface-2);
          color: var(--text-secondary);
          font-weight: 700; font-size: 11px;
          letter-spacing: 0.04em; text-transform: uppercase;
          border-bottom: 1px solid var(--border);
          padding: 10px 12px;
          white-space: nowrap;
          cursor: pointer;
          user-select: none;
        }
        .cap-cwt-table thead th:hover { color: var(--text); }
        .cap-cwt-table thead th.sticky-col { left: 0; z-index: 3; }
        .cap-cwt-table tbody td {
          padding: 9px 12px;
          border-bottom: 1px solid var(--border-light);
          color: var(--text);
          vertical-align: middle;
          white-space: nowrap;
        }
        .cap-cwt-table tbody td.sticky-col { position: sticky; left: 0; background: var(--surface); z-index: 1; }
        .cap-cwt-table tbody tr:hover td { background: var(--surface-2); }
        .cap-cwt-table tbody tr:hover td.sticky-col { background: var(--surface-2); }
        .cap-cwt-table tbody td.emphasis { font-weight: 700; }
        .cap-cwt-table tbody td.muted { color: var(--text-muted); }
        .cap-cwt-table tbody td.numeric { font-variant-numeric: tabular-nums; }
        .cap-cwt-totals td {
          font-weight: 700;
          background: var(--surface-2);
          border-top: 2px solid var(--border);
          border-bottom: none !important;
        }
        .cap-cwt-totals td.sticky-col { background: var(--surface-2) !important; }
        .cap-cwt-beta {
          display: inline-block; margin-left: 4px;
          font-size: 9px; font-weight: 700;
          padding: 1px 5px; border-radius: 4px;
          background: #fef3c7; color: #92400e;
          vertical-align: super;
        }
      `}</style>
      <div className="cap-cwt-wrap">
        <div className="cap-cwt-scroll">
          <table className="cap-cwt-table">
            <thead>
              <tr>
                {visibleCols.map(col => {
                  const active = sortKey === col.key;
                  const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                  return (
                    <th
                      key={col.key}
                      className={col.sticky ? 'sticky-col' : ''}
                      style={{ textAlign: col.align, minWidth: col.width }}
                      onClick={() => onHeaderClick(col)}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      {col.beta && <span className="cap-cwt-beta" title="Wire-up in Phase 1B">soon</span>}
                      <span style={{ color: '#7c3aed' }}>{arrow}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => (
                <tr key={`${row.country}-${idx}`}>
                  {visibleCols.map(col => {
                    const v = row[col.key];
                    let display = v;
                    if (col.key === 'country') display = renderCountryCell(row);
                    else if (col.key === 'ownerEmails') display = resolveOwnerNames(v);
                    else if (col.numeric) display = Number(v) || 0;
                    return (
                      <td
                        key={col.key}
                        className={[
                          col.sticky ? 'sticky-col' : '',
                          col.emphasis ? 'emphasis' : '',
                          col.numeric ? 'numeric' : '',
                          col.key === 'ownerEmails' && (!v || v.length === 0) ? 'muted' : '',
                          col.beta ? 'muted' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ textAlign: col.align }}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="cap-cwt-totals">
                {visibleCols.map(col => {
                  if (col.key === 'country') {
                    return (
                      <td key={col.key} className="sticky-col" style={{ textAlign: 'left' }}>
                        Total ({sorted.length} {sorted.length === 1 ? 'country' : 'countries'})
                      </td>
                    );
                  }
                  if (col.key === 'ownerEmails') {
                    return <td key={col.key} style={{ textAlign: 'left' }} className="muted">{totals.numOwners} unique people</td>;
                  }
                  return (
                    <td key={col.key} className="numeric" style={{ textAlign: col.align }}>
                      {Number(totals[col.key]) || 0}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {cachedAt && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
          Snapshot from {new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Cached for 15 minutes — use the refresh button above to force a fresh pull.
        </div>
      )}
    </div>
  );
}

const emptyCard = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '64px 24px', textAlign: 'center',
  background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14,
};
