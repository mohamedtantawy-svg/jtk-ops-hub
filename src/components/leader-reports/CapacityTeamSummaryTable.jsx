// ── CapacityTeamSummaryTable (Phase 3 — 2026-06-01) ───────────────────────
// Per-Team-Lead aggregation. Mirrors Kristina's sheet 4 exactly:
//   Team Lead / # Members / Countries Covered / Total HC /
//   Total Tasks/mo / Total Calls/mo / Total WL/mo / Avg WL/person/mo /
//   Avg Task hrs/day / Avg Call hrs/day
//
// Adds an extra "Avg Total hrs/day" column + Signal pill that the audit
// doesn't surface — we already compute it from the per-member data, and
// it answers the most-asked manager question ("which team is closest to
// burnout?") without forcing them to drill into the Current view.
//
// One row per Team Lead. Plus a Totals row at the bottom for the dept-
// wide rollup. The summary is derived entirely from the membersCurrent
// payload (see `aggregateTeamSummary` in src/lib/capacity-aggregator.js),
// so the math is GUARANTEED to match the per-member view.

import { useMemo, useState } from 'react';
import { getCountryName, getFlag } from '../../data/constants';

const SIGNAL_META = {
  ok:       { label: 'OK',         color: '#15803d', bg: '#dcfce7', symbol: '🟢' },
  moderate: { label: 'Manageable', color: '#65a30d', bg: '#ecfccb', symbol: '🟢' },
  elevated: { label: 'Elevated',   color: '#c2410c', bg: '#ffedd5', symbol: '🟠' },
  high:     { label: 'High',       color: '#b91c1c', bg: '#fee2e2', symbol: '🔴' },
};

function SignalPill({ signal }) {
  const meta = SIGNAL_META[signal] || SIGNAL_META.ok;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 9px', borderRadius: 128,
        background: meta.bg, color: meta.color,
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 10 }}>{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

function CountriesCell({ countries }) {
  const [expanded, setExpanded] = useState(false);
  if (!countries || countries.length === 0) {
    return <em style={{ color: 'var(--text-muted)', fontSize: 11 }}>None assigned</em>;
  }
  // Up to 6 inline by default; the rest behind "+N more" toggle.
  const collapsedLimit = 6;
  const overflow = countries.length - collapsedLimit;
  const showAll = expanded || overflow <= 0;
  const visible = showAll ? countries : countries.slice(0, collapsedLimit);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {visible.map(cc => (
        <span
          key={cc}
          title={getCountryName(cc) || cc}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 6px', borderRadius: 4,
            background: 'var(--surface-2)', border: '1px solid var(--border-light)',
            fontSize: 11, fontWeight: 600, color: 'var(--text)',
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>{getFlag(cc)}</span>
          {cc}
        </span>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{
            padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-light)',
            background: 'transparent', color: 'var(--purple, #7c3aed)',
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {showAll ? 'Show less' : `+${overflow} more`}
        </button>
      )}
    </div>
  );
}

function roleLabel(role) {
  if (role === 'team_lead')        return 'Team Lead';
  if (role === 'regional_manager') return 'Regional Manager';
  if (role === 'admin')            return 'Director';
  if (role === 'manager')          return 'Manager';
  return 'Unassigned';
}

export default function CapacityTeamSummaryTable({ teams = [] }) {
  const totals = useMemo(() => {
    const countrySet = new Set();
    let memberCount = 0, totalHc = 0, totalTasks = 0, totalCalls = 0, totalWl = 0;
    let sumTaskHrs = 0, sumCallHrs = 0, sumTotalHrs = 0;
    for (const t of teams) {
      memberCount += Number(t.memberCount) || 0;
      totalHc     += Number(t.totalHc)     || 0;
      totalTasks  += Number(t.totalTasksPerMonth) || 0;
      totalCalls  += Number(t.totalCallsPerMonth) || 0;
      totalWl     += Number(t.totalWlPerMonth)    || 0;
      sumTaskHrs  += Number(t.avgTaskHrsPerDay)   || 0;
      sumCallHrs  += Number(t.avgCallHrsPerDay)   || 0;
      sumTotalHrs += Number(t.avgTotalHrsPerDay)  || 0;
      for (const cc of (t.countriesCovered || [])) countrySet.add(cc);
    }
    const n = teams.length;
    return {
      memberCount, totalHc, totalTasks, totalCalls, totalWl,
      avgWl:       memberCount > 0 ? totalWl / memberCount : 0,
      avgTaskHrs:  n > 0 ? sumTaskHrs / n   : 0,
      avgCallHrs:  n > 0 ? sumCallHrs / n   : 0,
      avgTotalHrs: n > 0 ? sumTotalHrs / n  : 0,
      countriesCovered: Array.from(countrySet).sort(),
    };
  }, [teams]);

  if (teams.length === 0) {
    return (
      <div style={emptyCard}>
        <i className="bi-bar-chart-fill" style={{ fontSize: 32, color: 'var(--text-disabled)', marginBottom: 12 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No team breakdown yet</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, maxWidth: 480 }}>
          The Team Summary derives from the per-member view — once your dept has agents on the roster, this rolls them up automatically per Team Lead.
        </div>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        .cap-tst-wrap { background: var(--surface); border: 1px solid var(--border-light); border-radius: 14px; overflow: hidden; }
        .cap-tst-scroll { overflow-x: auto; }
        .cap-tst-table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 1180px; font-size: 12.5px; }
        .cap-tst-table thead th {
          background: var(--surface-2);
          color: var(--text-secondary);
          font-weight: 700; font-size: 11px;
          letter-spacing: 0.04em; text-transform: uppercase;
          border-bottom: 1px solid var(--border);
          padding: 12px;
          white-space: nowrap;
          text-align: right;
        }
        .cap-tst-table thead th:first-child { text-align: left; }
        .cap-tst-table thead th:nth-child(3) { text-align: left; }
        .cap-tst-table thead th:last-child  { text-align: left; }
        .cap-tst-table tbody td {
          padding: 14px 12px;
          border-bottom: 1px solid var(--border-light);
          color: var(--text);
          vertical-align: middle;
          text-align: right;
        }
        .cap-tst-table tbody td:first-child { text-align: left; }
        .cap-tst-table tbody td:nth-child(3) { text-align: left; }
        .cap-tst-table tbody td:last-child  { text-align: left; }
        .cap-tst-table tbody tr:hover td { background: var(--surface-2); }
        .cap-tst-table tbody td.numeric { font-variant-numeric: tabular-nums; }
        .cap-tst-table tbody td.emphasis { font-weight: 700; }
        .cap-tst-table tfoot td {
          background: var(--surface-2);
          border-top: 2px solid var(--border);
          font-weight: 700;
          padding: 12px;
        }
      `}</style>
      <div className="cap-tst-wrap">
        <div className="cap-tst-scroll">
          <table className="cap-tst-table">
            <thead>
              <tr>
                <th>Team Lead</th>
                <th># Members</th>
                <th>Countries Covered</th>
                <th>Total HC</th>
                <th>Total Tasks / mo</th>
                <th>Total Calls / mo</th>
                <th>Total WL / mo</th>
                <th>Avg WL / person / mo</th>
                <th>Avg Task hrs / day</th>
                <th>Avg Call hrs / day</th>
                <th>Avg Total hrs / day</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {teams.map(t => (
                <tr key={t.teamLeadEmail || 'unassigned'}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text)' }}>{t.teamLeadName}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#4f46e5',
                        background: '#eef2ff', padding: '1px 6px', borderRadius: 4,
                        alignSelf: 'flex-start', marginTop: 2,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {roleLabel(t.teamLeadRole)}
                      </span>
                    </div>
                  </td>
                  <td className="numeric">{t.memberCount}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <CountriesCell countries={t.countriesCovered} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {t.numCountriesCovered} {t.numCountriesCovered === 1 ? 'country' : 'countries'}
                      </span>
                    </div>
                  </td>
                  <td className="numeric">{t.totalHc}</td>
                  <td className="numeric">{Number(t.totalTasksPerMonth).toFixed(1)}</td>
                  <td className="numeric">{Number(t.totalCallsPerMonth).toFixed(1)}</td>
                  <td className="numeric emphasis">{Number(t.totalWlPerMonth).toFixed(1)}</td>
                  <td className="numeric">{Number(t.avgWlPerPersonPerMonth).toFixed(1)}</td>
                  <td className="numeric">{Number(t.avgTaskHrsPerDay).toFixed(2)}</td>
                  <td className="numeric">{Number(t.avgCallHrsPerDay).toFixed(2)}</td>
                  <td className="numeric emphasis">{Number(t.avgTotalHrsPerDay).toFixed(2)}</td>
                  <td><SignalPill signal={t.signal} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Department total ({teams.length} {teams.length === 1 ? 'team' : 'teams'})</td>
                <td className="numeric">{totals.memberCount}</td>
                <td>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {totals.countriesCovered.length} unique countries
                  </span>
                </td>
                <td className="numeric">{totals.totalHc}</td>
                <td className="numeric">{Number(totals.totalTasks).toFixed(1)}</td>
                <td className="numeric">{Number(totals.totalCalls).toFixed(1)}</td>
                <td className="numeric">{Number(totals.totalWl).toFixed(1)}</td>
                <td className="numeric">{Number(totals.avgWl).toFixed(1)}</td>
                <td className="numeric">{Number(totals.avgTaskHrs).toFixed(2)}</td>
                <td className="numeric">{Number(totals.avgCallHrs).toFixed(2)}</td>
                <td className="numeric">{Number(totals.avgTotalHrs).toFixed(2)}</td>
                <td>&nbsp;</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

const emptyCard = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '64px 24px', textAlign: 'center',
  background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14,
};
