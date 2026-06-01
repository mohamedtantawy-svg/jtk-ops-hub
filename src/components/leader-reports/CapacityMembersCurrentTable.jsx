// ── CapacityMembersCurrentTable (Phase 2 — 2026-06-01) ────────────────────
// Per-member load grouped by Team Lead. Mirrors Kristina's sheet 2:
//   Member / Title / Countries / HC / Tasks/mo (shared) / Tasks/day /
//   Task hrs/day / Calls/mo / Call hrs/day / Total WL/mo / Total hrs/day /
//   # Countries / Signal
//
// Tasks/mo here is the share-of-country-total: a country with 3 co-owners
// contributes country.totalTasks / 3 to each owner. Matches the audit's
// "shared" column (Alexandra Apsychou's 450.2 ≈ Greece 185 + Cyprus 113
// + Portugal/3 152.3 = 450.3 ✓).
//
// Visual language:
//   • Section per Team Lead — Lead row in a coloured chip with member
//     count. Collapsible so a 30-member dept doesn't dominate the page.
//   • Signal column — coloured pill (🟢 OK / 🟡 Moderate / 🟠 Elevated
//     / 🔴 High) computed server-side, displayed here with both the
//     symbol and the label so colour-blind users have the literal text.
//   • Hovering a row tints the background; clicking a member name (Phase
//     5 wiring) will open the proposal what-if. Until then it's a
//     read-only surface.
//
// Empty states:
//   • No members in dept — empty card with copy.
//   • Member with no countries — appears in their lead's section with
//     italic "No countries assigned" in the Countries column and a
//     muted "⚪ Inactive" signal so the admin can spot the gap.
//
// Per-leave handling: members flagged `on_leave === true` get a muted
// row + "On leave" badge appended to their name; their counts still
// render (they ARE the workload that's currently uncovered) so the lead
// can spot the unbalance.

import { useMemo, useState } from 'react';
import { getCountryName, getFlag } from '../../data/constants';

const SIGNAL_META = {
  ok:       { label: 'OK',        color: '#15803d', bg: '#dcfce7', symbol: '🟢' },
  moderate: { label: 'Manageable',color: '#65a30d', bg: '#ecfccb', symbol: '🟢' },
  elevated: { label: 'Elevated',  color: '#c2410c', bg: '#ffedd5', symbol: '🟠' },
  high:     { label: 'High',      color: '#b91c1c', bg: '#fee2e2', symbol: '🔴' },
  inactive: { label: 'Inactive',  color: '#737373', bg: '#f5f5f4', symbol: '⚪' },
};

// Map a workload value to a 0..100% bar — 100% sits at the Elevated
// threshold so anything red maxes out the bar. Settings are passed
// down so the FE matches whatever the dept has configured (Phase 4).
function loadBarPercent(totalHrsPerDay, settings) {
  const cap = (settings?.thresholdElevated ?? 8.0);
  if (!Number.isFinite(totalHrsPerDay) || totalHrsPerDay <= 0) return 0;
  return Math.min(100, Math.round((totalHrsPerDay / cap) * 100));
}

function renderCountries(countries) {
  if (!countries || countries.length === 0) {
    return <em style={{ color: 'var(--text-muted)' }}>No countries assigned</em>;
  }
  // Up to 4 inline; the rest summarised as "+N more".
  const shown = countries.slice(0, 4);
  const overflow = countries.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {shown.map(cc => (
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
        <span
          title={countries.slice(4).join(', ')}
          style={{
            padding: '2px 6px', borderRadius: 4,
            background: 'var(--surface-2)', border: '1px solid var(--border-light)',
            fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          }}
        >+{overflow}</span>
      )}
    </span>
  );
}

function SignalPill({ signal, totalHrsPerDay }) {
  const meta = SIGNAL_META[signal] || SIGNAL_META.ok;
  return (
    <span
      title={`Total ${Number(totalHrsPerDay || 0).toFixed(2)} hrs/day`}
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

function MemberRow({ row, settings }) {
  const effSignal = row.numCountries === 0 ? 'inactive' : row.signal;
  const barPct = loadBarPercent(row.totalHrsPerDay, settings);
  const barColor =
    effSignal === 'high'     ? '#b91c1c' :
    effSignal === 'elevated' ? '#c2410c' :
    effSignal === 'moderate' ? '#65a30d' :
    effSignal === 'inactive' ? '#a3a3a3' : '#15803d';
  return (
    <tr>
      <td className="sticky-col">
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.name}</span>
            {row.onLeave && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                background: '#fef3c7', color: '#92400e', textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>On leave</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
            {row.title || ''}
          </span>
        </div>
      </td>
      <td>{renderCountries(row.countries)}</td>
      <td className="numeric">{Number(row.hc) || 0}</td>
      <td className="numeric">{Number(row.tasksPerMonth) || 0}</td>
      <td className="numeric">{Number(row.tasksPerDay) || 0}</td>
      <td className="numeric">{Number(row.taskHrsPerDay).toFixed(2)}</td>
      <td className="numeric">{Number(row.callsPerMonth) || 0}</td>
      <td className="numeric">{Number(row.callHrsPerDay).toFixed(2)}</td>
      <td className="numeric emphasis">{Number(row.totalWlPerMonth) || 0}</td>
      <td className="numeric emphasis">{Number(row.totalHrsPerDay).toFixed(2)}</td>
      <td className="numeric">{Number(row.numCountries) || 0}</td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <SignalPill signal={effSignal} totalHrsPerDay={row.totalHrsPerDay} />
          <div style={{
            width: 90, height: 4, borderRadius: 4,
            background: 'var(--surface-2)', overflow: 'hidden',
            border: '1px solid var(--border-light)',
          }}>
            <div style={{
              width: `${barPct}%`, height: '100%',
              background: barColor, transition: 'width .2s, background .2s',
            }} />
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function CapacityMembersCurrentTable({ members = [], leads = {}, settings = null }) {
  // Group members by their teamLeadEmail. Render leads in the order they
  // first appear in the (server-sorted) members array.
  const sections = useMemo(() => {
    const order = [];
    const seen = new Set();
    for (const m of members) {
      const k = m.teamLeadEmail || '';
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    }
    return order.map(k => ({
      key: k,
      lead: leads[k] || { email: k, name: k ? k : 'Unassigned', role: 'unassigned', memberCount: 0 },
      members: members.filter(m => (m.teamLeadEmail || '') === k),
    }));
  }, [members, leads]);

  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (key) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (members.length === 0) {
    return (
      <div style={emptyCard}>
        <i className="bi-people" style={{ fontSize: 32, color: 'var(--text-disabled)', marginBottom: 12 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No members yet</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, maxWidth: 480 }}>
          This department has no agents on the active roster. Add members via Org → this dept → Add member.
        </div>
      </div>
    );
  }

  // Section-level rollup so the lead chip can show their team's aggregate
  // load at a glance (matches the team-summary feel without waiting for
  // Phase 3's full Team Summary view).
  const sectionTotals = (rows) => {
    let totalWl = 0, totalHrs = 0, hc = 0;
    let highs = 0, elevated = 0;
    for (const r of rows) {
      totalWl += Number(r.totalWlPerMonth) || 0;
      totalHrs += Number(r.totalHrsPerDay) || 0;
      hc += Number(r.hc) || 0;
      if (r.signal === 'high')     highs++;
      if (r.signal === 'elevated') elevated++;
    }
    return {
      totalWl, totalHrs, hc, highs, elevated,
      avgHrs: rows.length > 0 ? totalHrs / rows.length : 0,
    };
  };

  return (
    <div>
      <style>{`
        .cap-mct-wrap { background: var(--surface); border: 1px solid var(--border-light); border-radius: 14px; overflow: hidden; }
        .cap-mct-section + .cap-mct-section { border-top: 1px solid var(--border); }
        .cap-mct-lead-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; padding: 12px 16px;
          background: linear-gradient(0deg, var(--surface-2), var(--surface));
          cursor: pointer; user-select: none;
        }
        .cap-mct-lead-row:hover { background: var(--surface-2); }
        .cap-mct-lead-name { font-size: 13px; font-weight: 700; color: var(--text); display: inline-flex; align-items: center; gap: 8px; }
        .cap-mct-lead-meta { font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 12px; }
        .cap-mct-scroll { overflow-x: auto; max-height: 60vh; overflow-y: auto; }
        .cap-mct-table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 1280px; font-size: 12.5px; }
        .cap-mct-table thead th {
          position: sticky; top: 0; z-index: 2;
          background: var(--surface-2);
          color: var(--text-secondary);
          font-weight: 700; font-size: 11px;
          letter-spacing: 0.04em; text-transform: uppercase;
          border-bottom: 1px solid var(--border);
          padding: 9px 12px;
          white-space: nowrap;
          text-align: right;
        }
        .cap-mct-table thead th:first-child { text-align: left; left: 0; z-index: 3; }
        .cap-mct-table thead th:nth-child(2) { text-align: left; }
        .cap-mct-table thead th:last-child { text-align: left; }
        .cap-mct-table tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-light);
          color: var(--text);
          vertical-align: middle;
          text-align: right;
        }
        .cap-mct-table tbody td:first-child { text-align: left; }
        .cap-mct-table tbody td:nth-child(2) { text-align: left; }
        .cap-mct-table tbody td:last-child { text-align: left; }
        .cap-mct-table tbody td.sticky-col {
          position: sticky; left: 0; background: var(--surface); z-index: 1;
        }
        .cap-mct-table tbody tr:hover td { background: var(--surface-2); }
        .cap-mct-table tbody tr:hover td.sticky-col { background: var(--surface-2); }
        .cap-mct-table tbody td.numeric { font-variant-numeric: tabular-nums; }
        .cap-mct-table tbody td.emphasis { font-weight: 700; }
      `}</style>
      <div className="cap-mct-wrap">
        {sections.map(section => {
          const isCollapsed = collapsed.has(section.key);
          const t = sectionTotals(section.members);
          return (
            <div key={section.key || 'unassigned'} className="cap-mct-section">
              <div
                className="cap-mct-lead-row"
                onClick={() => toggle(section.key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(section.key); } }}
                aria-expanded={!isCollapsed}
              >
                <div className="cap-mct-lead-name">
                  <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'}`} style={{ fontSize: 12, color: 'var(--text-muted)' }} />
                  <span>{section.lead.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 128,
                    background: '#eef2ff', color: '#4f46e5', textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    {section.lead.role === 'team_lead'        ? 'Team Lead' :
                     section.lead.role === 'regional_manager' ? 'Regional Manager' :
                     section.lead.role === 'admin'            ? 'Director' :
                     section.lead.role === 'manager'          ? 'Manager' :
                     'Unassigned'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                    {section.members.length} {section.members.length === 1 ? 'member' : 'members'}
                  </span>
                </div>
                <div className="cap-mct-lead-meta">
                  <span>HC <strong>{t.hc}</strong></span>
                  <span>WL <strong>{Math.round(t.totalWl)}/mo</strong></span>
                  <span>Avg <strong>{t.avgHrs.toFixed(1)}h/day</strong></span>
                  {t.highs > 0    && <span style={{ color: '#b91c1c', fontWeight: 700 }}>{t.highs} 🔴</span>}
                  {t.elevated > 0 && <span style={{ color: '#c2410c', fontWeight: 700 }}>{t.elevated} 🟠</span>}
                </div>
              </div>
              {!isCollapsed && (
                <div className="cap-mct-scroll">
                  <table className="cap-mct-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Countries</th>
                        <th>HC</th>
                        <th>Tasks / mo</th>
                        <th>Tasks / day</th>
                        <th>Task hrs / day</th>
                        <th>Calls / mo</th>
                        <th>Call hrs / day</th>
                        <th>Total WL / mo</th>
                        <th>Total hrs / day</th>
                        <th># Countries</th>
                        <th>Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.members.map(m => (
                        <MemberRow key={m.email} row={m} settings={settings} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const emptyCard = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '64px 24px', textAlign: 'center',
  background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 14,
};
