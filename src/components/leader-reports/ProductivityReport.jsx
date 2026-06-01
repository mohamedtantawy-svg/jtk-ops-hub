// ── ProductivityReport (2026-06-01) ───────────────────────────────────────
// Leaders Hub → Reports → Productivity. Sarah Suge's feedback:
// "no centralized way to track team productivity — view tasks solved per
// team per category over a selected time period (weekly, monthly, or
// custom)."
//
// Layout (top → bottom):
//   1. Hero header — title + period selector + refresh + CSV export.
//   2. KPI strip   — 4 cards: Total Resolved (with vs-prev-period delta),
//                    Active Contributors, Top Category, Top Performer.
//   3. 2-up grid   — Tasks-by-Team stacked horizontal bars (left, 2/3
//                    width) + Tasks-by-Category list with deltas (right).
//   4. Trend chart — Daily resolutions over the period; SVG line + area
//                    fill, dot per day, tooltip on hover.
//   5. Top performers leaderboard — Avatar / name / team / breakdown
//                    chips / total count. Top 25 by total resolved.
//
// Tokens follow the Feedback / HR Hub / SlaExtensionReport vocabulary
// (skill §3.13). All structural surfaces use CSS vars so dark mode lights
// up cleanly; category accent colours stay literal because they convey
// semantic meaning (HR Hub = purple, Urgent Assist = orange, etc.).
//
// No external chart dep — everything is hand-rolled SVG or CSS bars so
// the bundle stays tight and the look matches the rest of the app.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import Avatar from '../ui/Avatar';

// ── Date helpers ───────────────────────────────────────────────────────────

function todayUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function daysAgoUtcDay(n) {
  const d = todayUtcDay();
  d.setUTCDate(d.getUTCDate() - (n - 1));
  return d;
}
function isoDay(d) { return d.toISOString().slice(0, 10); }
function prettyRange(fromIso, toIso) {
  if (!fromIso || !toIso) return '—';
  const from = new Date(fromIso + 'T00:00:00Z');
  // `toIso` is exclusive; subtract a day to display the last included day.
  const to = new Date(toIso + 'T00:00:00Z');
  to.setUTCDate(to.getUTCDate() - 1);
  const fmt = (x) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (from.getTime() === to.getTime()) return fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}

const PRESETS = [
  { id: '7d',  label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'custom', label: 'Custom' },
];

// ── CSV export ─────────────────────────────────────────────────────────────
// Per skill §3.15: UTF-8 BOM + CRLF + always-quote. Multi-section CSV so
// the user can drop it into any spreadsheet tool without re-shaping.

function csvEscape(v) {
  if (v == null) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}
function rowToCsv(cells) { return cells.map(csvEscape).join(',') + '\r\n'; }
function buildCsv(data) {
  let out = '﻿'; // UTF-8 BOM (Excel-on-Windows compatibility)
  const range = data.range || {};
  out += rowToCsv(['Productivity report']);
  out += rowToCsv(['Period', prettyRange(range.start, range.end)]);
  out += rowToCsv(['Generated', new Date().toISOString()]);
  out += rowToCsv([]);
  out += rowToCsv(['BY CATEGORY']);
  out += rowToCsv(['Category', 'Total', 'Prev period', 'Δ %']);
  for (const c of data.byCategory || []) {
    out += rowToCsv([c.label, c.total, c.prevTotal, `${c.deltaPercent}%`]);
  }
  out += rowToCsv([]);
  out += rowToCsv(['BY TEAM']);
  out += rowToCsv(['Team Lead', '# Members', 'Total', ...(data.categories || []).map(c => c.label)]);
  for (const t of data.byTeam || []) {
    const row = [t.teamLeadName, t.memberCount, t.total];
    for (const c of data.categories || []) row.push(t.byCategory?.[c.key] || 0);
    out += rowToCsv(row);
  }
  out += rowToCsv([]);
  out += rowToCsv(['LEADERBOARD']);
  out += rowToCsv(['Name', 'Email', 'Team Lead', 'Total', ...(data.categories || []).map(c => c.label)]);
  for (const m of data.byMember || []) {
    const row = [m.name, m.email, m.teamLeadName, m.total];
    for (const c of data.categories || []) row.push(m.byCategory?.[c.key] || 0);
    out += rowToCsv(row);
  }
  out += rowToCsv([]);
  out += rowToCsv(['DAILY TREND']);
  out += rowToCsv(['Date', 'Total', ...(data.categories || []).map(c => c.label)]);
  for (const d of data.trend || []) {
    const row = [d.date, d.total];
    for (const c of data.categories || []) row.push(d.byCategory?.[c.key] || 0);
    out += rowToCsv(row);
  }
  return out;
}
function downloadCsv(filename, content) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

// ── Tiny visual primitives ────────────────────────────────────────────────

function DeltaPill({ value }) {
  // value = signed percentage delta
  const v = Number(value) || 0;
  const positive = v > 0;
  const negative = v < 0;
  const flat = !positive && !negative;
  const color = positive ? '#15803d' : negative ? '#b91c1c' : 'var(--text-muted)';
  const bg    = positive ? '#dcfce7' : negative ? '#fee2e2' : 'var(--surface-2)';
  const icon  = positive ? 'bi-arrow-up-short' : negative ? 'bi-arrow-down-short' : 'bi-dash';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      padding: '2px 7px', borderRadius: 128,
      background: bg, color, fontSize: 11, fontWeight: 700,
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    }}>
      <i className={icon} style={{ fontSize: 12 }} />
      {flat ? '0%' : `${Math.abs(v).toFixed(1)}%`}
    </span>
  );
}

function StackedBar({ segments, total, max, color }) {
  // Total bar width = (total / max) × 100%; each segment width within
  // that bar = (segment / total) × bar-width.
  const widthPct = max > 0 ? (total / max) * 100 : 0;
  return (
    <div
      style={{
        position: 'relative', height: 14, borderRadius: 7,
        background: 'var(--surface-3)', overflow: 'hidden', width: '100%',
      }}
    >
      <div
        style={{
          height: '100%', width: `${widthPct}%`,
          display: 'flex', borderRadius: 7, overflow: 'hidden',
          transition: 'width 0.35s ease-out',
        }}
      >
        {segments.map(seg => {
          const segPct = total > 0 ? (seg.value / total) * 100 : 0;
          if (segPct <= 0) return null;
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${seg.value}`}
              style={{
                width: `${segPct}%`, height: '100%',
                background: seg.color, transition: 'background 0.2s',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function TrendChart({ trend, categories, height = 180 }) {
  // Width is fluid — we render to a fixed viewBox and let CSS scale.
  // Points are spaced evenly; a dot per day, line through totals, soft
  // area fill. Hover the chart and a vertical guide-line shows the day.
  const W = 800;
  const H = height;
  const padLeft = 36;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const [hoverIdx, setHoverIdx] = useState(null);

  const data = trend || [];
  const max = Math.max(1, ...data.map(d => d.total));
  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => Math.ceil((max * i) / yTicks));

  if (data.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No data in this range yet.
      </div>
    );
  }

  // Path generators.
  const xFor = (i) => {
    if (data.length === 1) return padLeft + innerW / 2;
    return padLeft + (i * innerW) / (data.length - 1);
  };
  const yFor = (v) => padTop + innerH - (v / max) * innerH;

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d.total)}`)
    .join(' ');
  const areaPath = data.length > 1
    ? `${linePath} L ${xFor(data.length - 1)} ${padTop + innerH} L ${xFor(0)} ${padTop + innerH} Z`
    : `M ${xFor(0)} ${yFor(data[0].total)}`;

  // X-axis label sampling — at most 6 labels.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  // Mouse handler converts client x to nearest data index.
  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const t = (x - padLeft) / innerW;
    const idx = Math.round(Math.max(0, Math.min(1, t)) * (data.length - 1));
    setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hover = hoverIdx != null ? data[hoverIdx] : null;
  const categoriesArr = Array.isArray(categories) ? categories : [];

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily resolutions trend"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ display: 'block', cursor: 'crosshair' }}
      >
        <defs>
          <linearGradient id="prod-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-axis gridlines */}
        {tickValues.map(v => (
          <g key={v}>
            <line
              x1={padLeft} x2={W - padRight}
              y1={yFor(v)} y2={yFor(v)}
              stroke="var(--border-light)" strokeWidth="1" strokeDasharray="2 4"
            />
            <text
              x={padLeft - 6} y={yFor(v) + 3}
              textAnchor="end" fontSize="10" fill="var(--text-muted)"
            >{v}</text>
          </g>
        ))}

        {/* Area + line */}
        {data.length > 1 && (
          <path d={areaPath} fill="url(#prod-area)" />
        )}
        <path d={linePath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots */}
        {data.map((d, i) => (
          <circle key={d.date}
            cx={xFor(i)} cy={yFor(d.total)}
            r={hoverIdx === i ? 5 : 3}
            fill={hoverIdx === i ? '#7c3aed' : 'var(--surface)'}
            stroke="#7c3aed" strokeWidth="2"
            style={{ transition: 'r 0.12s' }}
          >
            <title>{`${d.date}: ${d.total}`}</title>
          </circle>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (i % labelEvery !== 0 && i !== data.length - 1) return null;
          const label = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
          return (
            <text key={d.date}
              x={xFor(i)} y={H - 8}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)"
            >{label}</text>
          );
        })}

        {/* Hover guide-line */}
        {hover && (
          <line
            x1={xFor(hoverIdx)} x2={xFor(hoverIdx)}
            y1={padTop} y2={padTop + innerH}
            stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
          />
        )}
      </svg>

      {/* Hover tooltip */}
      {hover && (
        <div style={{
          position: 'absolute', top: 0, right: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 10px',
          boxShadow: 'var(--shadow-sm)', pointerEvents: 'none',
          fontSize: 11, minWidth: 160,
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            {new Date(hover.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6, fontVariantNumeric: 'tabular-nums' }}>
            {hover.total} resolved
          </div>
          {categoriesArr.map(c => {
            const v = hover.byCategory?.[c.key] || 0;
            if (!v) return null;
            return (
              <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, display: 'inline-block' }} />
                  {c.label}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────

function KpiCard({ accent, accentBg, icon, label, value, sub, delta }) {
  return (
    <div style={{
      flex: '1 1 200px', minWidth: 180,
      padding: 16, borderRadius: 14,
      background: 'var(--surface)',
      border: '1px solid var(--border-light)',
      display: 'flex', flexDirection: 'column', gap: 6,
      transition: 'transform 0.15s, box-shadow 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className={icon} style={{ fontSize: 14, color: accent }} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
          {value}
        </div>
        {delta != null && <DeltaPill value={delta} />}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ProductivityReport({ onBack }) {
  const { dept: currentDept } = useCurrentDept();
  const [period, setPeriod] = useState('7d');
  const [customStart, setCustomStart] = useState(isoDay(daysAgoUtcDay(7)));
  const [customEnd, setCustomEnd]     = useState(isoDay(todayUtcDay()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const buildUrl = useCallback((opts = {}) => {
    const params = new URLSearchParams();
    params.set('period', period);
    if (period === 'custom') {
      // FE always sends `end + 1 day` so the picker's last day is inclusive.
      const e = new Date(customEnd + 'T00:00:00Z');
      e.setUTCDate(e.getUTCDate() + 1);
      params.set('start', customStart);
      params.set('end', isoDay(e));
    }
    if (opts.bustCache) params.set('bustCache', '1');
    return `/leader-reports/productivity?${params.toString()}`;
  }, [period, customStart, customEnd]);

  const load = useCallback(async (opts = {}) => {
    const { bustCache = false } = opts;
    if (bustCache) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(buildUrl({ bustCache }));
      setData(res);
    } catch (err) {
      setError(err?.message || 'Could not load productivity data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildUrl]);

  useEffect(() => { load(); }, [load]);

  const onExport = useCallback(() => {
    if (!data) return;
    const range = data.range || {};
    const filename = `productivity-${range.start || 'unknown'}_to_${range.end || 'unknown'}.csv`;
    downloadCsv(filename, buildCsv(data));
  }, [data]);

  // ── Derived display data ────────────────────────────────────────────────
  const maxTeamTotal = useMemo(() => {
    if (!data?.byTeam?.length) return 0;
    return data.byTeam.reduce((m, t) => Math.max(m, t.total), 0);
  }, [data]);

  const maxCategoryTotal = useMemo(() => {
    if (!data?.byCategory?.length) return 0;
    return data.byCategory.reduce((m, c) => Math.max(m, c.total), 0);
  }, [data]);

  const leaderboard = useMemo(() => {
    if (!data?.byMember?.length) return [];
    return data.byMember.slice(0, 25);
  }, [data]);

  const maxLeaderboardTotal = useMemo(() => {
    if (!leaderboard.length) return 0;
    return leaderboard[0]?.total || 0;
  }, [leaderboard]);

  return (
    <div style={page}>
      <style>{`
        .prod-kpi-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        @media (max-width: 1180px) { .prod-kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 640px)  { .prod-kpi-row { grid-template-columns: 1fr; } }

        .prod-grid-2up {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 14px;
        }
        @media (max-width: 1180px) { .prod-grid-2up { grid-template-columns: 1fr; } }

        .prod-period-chip {
          padding: 7px 14px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-secondary);
          font-size: 12.5px; font-weight: 600;
          cursor: pointer; user-select: none;
          transition: all .12s;
          font-family: inherit;
        }
        .prod-period-chip:hover { color: var(--text); border-color: var(--text-muted); }
        .prod-period-chip.active {
          background: #7c3aed; color: white; border-color: #7c3aed;
          box-shadow: 0 2px 8px rgba(124,58,237,0.25);
        }
        .prod-period-chip.active:hover { color: white; }

        .prod-card {
          padding: 18px;
          border-radius: 14px;
          background: var(--surface);
          border: 1px solid var(--border-light);
        }
        .prod-card-title {
          font-size: 11px; font-weight: 700; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 4px;
        }
        .prod-card-subtitle { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }

        .prod-team-row {
          display: grid;
          grid-template-columns: 200px 1fr 80px;
          gap: 16px; align-items: center;
          padding: 10px 0;
        }
        .prod-team-row + .prod-team-row { border-top: 1px solid var(--border-light); }
        .prod-team-name { font-weight: 700; color: var(--text); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .prod-team-role { font-size: 10px; color: var(--text-muted); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
        .prod-team-count { font-size: 17px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; text-align: right; }

        .prod-category-row {
          display: grid;
          grid-template-columns: 1fr 80px;
          gap: 12px; align-items: center;
          padding: 12px 0;
        }
        .prod-category-row + .prod-category-row { border-top: 1px solid var(--border-light); }

        .prod-leaderboard-row {
          display: grid;
          grid-template-columns: 28px minmax(180px, 1fr) 1fr 80px;
          gap: 12px; align-items: center;
          padding: 12px 0;
          font-size: 12.5px;
        }
        .prod-leaderboard-row + .prod-leaderboard-row { border-top: 1px solid var(--border-light); }
        .prod-leaderboard-rank {
          width: 24px; height: 24px; border-radius: 50%;
          background: var(--surface-2); color: var(--text-secondary);
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
        }
        .prod-leaderboard-rank.top-1 { background: #fef3c7; color: #92400e; }
        .prod-leaderboard-rank.top-2 { background: #e5e7eb; color: #374151; }
        .prod-leaderboard-rank.top-3 { background: #fed7aa; color: #9a3412; }

        .prod-icon-btn {
          width: 34px; height: 34px; border-radius: 8px;
          border: 1px solid var(--border); background: var(--surface);
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--text-secondary);
          font-family: inherit; transition: all .12s;
        }
        .prod-icon-btn:hover { color: var(--text); border-color: var(--text-muted); }
        .prod-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .prod-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 64px 24px; text-align: center;
          background: var(--surface); border: 1px solid var(--border-light); border-radius: 14px;
          color: var(--text-muted);
        }
      `}</style>

      {/* Hero header */}
      <div style={pageHead}>
        {onBack && (
          <button type="button" onClick={onBack} className="prod-icon-btn" aria-label="Back to Reports">
            <i className="bi-arrow-left" style={{ fontSize: 14 }} />
          </button>
        )}
        <div style={{
          width: 40, height: 40, borderRadius: 12, background: '#ecfdf5',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <i className="bi-trophy-fill" style={{ fontSize: 18, color: '#0d9488' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
            Productivity
            {currentDept?.name && (
              <span style={{
                marginLeft: 10, fontSize: 11, fontWeight: 600,
                color: 'var(--text-muted)', padding: '3px 8px', borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border-light)',
                verticalAlign: 'middle',
              }}>
                {currentDept.name}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Tasks resolved per team per category. Sarah Suge's ask — pick a range and see who shipped what.
          </div>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="prod-icon-btn"
          aria-label="Export CSV"
          title="Export to CSV (Excel-compatible)"
          disabled={!data || loading}
        >
          <i className="bi-download" style={{ fontSize: 14 }} />
        </button>
        <button
          type="button"
          onClick={() => load({ bustCache: true })}
          className="prod-icon-btn"
          aria-label="Refresh"
          title="Refresh — bypasses the 5-min cache"
          disabled={refreshing || loading}
        >
          <i
            className="bi-arrow-clockwise"
            style={{ fontSize: 14, animation: refreshing ? 'spin 1s linear infinite' : 'none' }}
          />
        </button>
      </div>

      {/* Period selector */}
      <div style={{ padding: '4px 28px 16px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`prod-period-chip ${period === p.id ? 'active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
          {period === 'custom' && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 10px', borderRadius: 999,
              background: 'var(--surface-2)', border: '1px solid var(--border-light)',
            }}>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={e => setCustomStart(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit' }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={isoDay(todayUtcDay())}
                onChange={e => setCustomEnd(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit' }}
              />
            </div>
          )}
          {data?.range && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {prettyRange(data.range.start, data.range.end)}
              {data?.range?.prevStart && (
                <span style={{ marginLeft: 10, opacity: 0.7 }}>
                  vs {prettyRange(data.range.prevStart, data.range.prevEnd)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 40px' }}>
        {loading && (
          <div className="prod-empty">
            <i className="bi-arrow-clockwise" style={{ fontSize: 24, marginBottom: 12, animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 13 }}>Loading productivity…</div>
          </div>
        )}

        {!loading && error && (
          <div className="prod-empty" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
            <i className="bi-exclamation-triangle-fill" style={{ fontSize: 24, marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>Could not load productivity</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>{error}</div>
            <button type="button" onClick={() => load()} style={primaryBtn}>Try again</button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* KPI strip */}
            <div className="prod-kpi-row" style={{ marginBottom: 18 }}>
              <KpiCard
                accent="#7c3aed" accentBg="#f3eff8"
                icon="bi-check-circle-fill"
                label="Tasks Resolved"
                value={(data.summary?.totalResolved || 0).toLocaleString()}
                sub={data.summary?.prevPeriodTotal != null
                  ? `${(data.summary.prevPeriodTotal || 0).toLocaleString()} previous period`
                  : '—'}
                delta={data.summary?.deltaPercent}
              />
              <KpiCard
                accent="#0d9488" accentBg="#ecfdf5"
                icon="bi-people-fill"
                label="Active Contributors"
                value={data.summary?.activeContributors || 0}
                sub={data.summary?.totalMembers
                  ? `${data.summary.activeContributors} / ${data.summary.totalMembers} agents shipped work`
                  : '—'}
              />
              <KpiCard
                accent="#ea580c" accentBg="#fff7ed"
                icon="bi-tags-fill"
                label="Top Category"
                value={data.summary?.topCategory?.label || '—'}
                sub={data.summary?.topCategory
                  ? `${data.summary.topCategory.total.toLocaleString()} resolved`
                  : 'No resolutions yet'}
              />
              <KpiCard
                accent="#2563eb" accentBg="#eff6ff"
                icon="bi-trophy-fill"
                label="Top Performer"
                value={data.summary?.topMember?.name || '—'}
                sub={data.summary?.topMember
                  ? `${data.summary.topMember.total.toLocaleString()} resolved`
                  : 'No resolutions yet'}
              />
            </div>

            {/* 2-up: Team breakdown (stacked bars) + Category breakdown */}
            <div className="prod-grid-2up" style={{ marginBottom: 18 }}>
              <div className="prod-card">
                <div className="prod-card-title">Tasks by Team</div>
                <div className="prod-card-subtitle">Stacked by category — hover a segment for the count.</div>
                {data.byTeam?.length > 0 ? (
                  <div>
                    {data.byTeam.map(t => {
                      const segments = (data.categories || []).map(c => ({
                        key: c.key, label: c.label, color: c.color,
                        value: t.byCategory?.[c.key] || 0,
                      }));
                      return (
                        <div key={t.teamLeadEmail || 'unassigned'} className="prod-team-row">
                          <div style={{ minWidth: 0 }}>
                            <div className="prod-team-name">{t.teamLeadName}</div>
                            <div className="prod-team-role">
                              {t.teamLeadRole === 'team_lead' ? 'Team Lead'
                                : t.teamLeadRole === 'regional_manager' ? 'Regional Manager'
                                : t.teamLeadRole === 'admin' ? 'Director'
                                : t.teamLeadRole === 'manager' ? 'Manager'
                                : 'Unassigned'} · {t.memberCount} {t.memberCount === 1 ? 'member' : 'members'}
                            </div>
                          </div>
                          <StackedBar segments={segments} total={t.total} max={maxTeamTotal} />
                          <div className="prod-team-count">{t.total.toLocaleString()}</div>
                        </div>
                      );
                    })}

                    {/* Legend */}
                    <div style={{
                      marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-light)',
                      display: 'flex', flexWrap: 'wrap', gap: 12,
                    }}>
                      {(data.categories || []).map(c => (
                        <span key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color, display: 'inline-block' }} />
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No resolutions in this range yet.
                  </div>
                )}
              </div>

              <div className="prod-card">
                <div className="prod-card-title">By Category</div>
                <div className="prod-card-subtitle">Volume + change vs previous period.</div>
                {data.byCategory?.length > 0 ? (
                  <div>
                    {data.byCategory
                      .slice()
                      .sort((a, b) => b.total - a.total)
                      .map(c => {
                        const pct = maxCategoryTotal > 0 ? (c.total / maxCategoryTotal) * 100 : 0;
                        return (
                          <div key={c.key} className="prod-category-row">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.label}</span>
                                <DeltaPill value={c.deltaPercent} />
                              </div>
                              <div style={{
                                height: 6, borderRadius: 3,
                                background: 'var(--surface-3)', overflow: 'hidden',
                              }}>
                                <div style={{
                                  width: `${pct}%`, height: '100%',
                                  background: c.color, borderRadius: 3,
                                  transition: 'width 0.35s ease-out',
                                }} />
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                                Previous: {(c.prevTotal || 0).toLocaleString()}
                              </div>
                            </div>
                            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {(c.total || 0).toLocaleString()}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No category data.
                  </div>
                )}
              </div>
            </div>

            {/* Trend chart */}
            <div className="prod-card" style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div className="prod-card-title">Daily Trend</div>
                  <div className="prod-card-subtitle" style={{ marginBottom: 0 }}>Resolutions per day across all categories.</div>
                </div>
              </div>
              <TrendChart trend={data.trend} categories={data.categories} />
            </div>

            {/* Leaderboard */}
            <div className="prod-card">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div className="prod-card-title">Top Performers</div>
                  <div className="prod-card-subtitle" style={{ marginBottom: 0 }}>
                    Showing top {Math.min(25, leaderboard.length)} of {data.byMember?.length || 0} contributors.
                  </div>
                </div>
              </div>
              {leaderboard.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Nobody resolved anything in this range yet.
                </div>
              ) : (
                <div>
                  <div className="prod-leaderboard-row" style={{ paddingTop: 0, paddingBottom: 8, borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Member</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Breakdown</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Total</div>
                  </div>
                  {leaderboard.map((m, idx) => {
                    const rankClass = idx === 0 ? 'top-1' : idx === 1 ? 'top-2' : idx === 2 ? 'top-3' : '';
                    const segments = (data.categories || []).map(c => ({
                      key: c.key, label: c.label, color: c.color,
                      value: m.byCategory?.[c.key] || 0,
                    }));
                    return (
                      <div key={m.email} className="prod-leaderboard-row">
                        <span className={`prod-leaderboard-rank ${rankClass}`}>{idx + 1}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <Avatar name={m.name} src={m.avatarUrl} size="md" />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                              {m.name}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                              {m.teamLeadName ? `Reports to ${m.teamLeadName}` : 'Unassigned'}
                            </div>
                          </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <StackedBar segments={segments} total={m.total} max={maxLeaderboardTotal} />
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                            {segments.filter(s => s.value > 0).map(s => (
                              <span key={s.key} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '1px 7px', borderRadius: 4,
                                background: 'var(--surface-2)', border: '1px solid var(--border-light)',
                                fontSize: 10.5, fontWeight: 600, color: 'var(--text-secondary)',
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: 2, background: s.color }} />
                                {s.label} {s.value}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                          {m.total.toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {data?.cachedAt && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14, textAlign: 'right' }}>
                Snapshot from {new Date(data.cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Cached for 5 minutes — refresh to force a fresh pull.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tokens — match HrHubView / FeedbackView surface tokens ────────────────
const page = {
  flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
  background: 'var(--bg)', overflowY: 'hidden',
};
const pageHead = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '20px 28px 12px',
  flexShrink: 0,
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
  fontFamily: 'inherit', marginTop: 14,
};
