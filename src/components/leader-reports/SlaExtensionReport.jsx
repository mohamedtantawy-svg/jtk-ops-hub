// ── SlaExtensionReport ────────────────────────────────────────────────
// Leaders Hub → Reports → SLA Extension. Answers Jose Ruales' 7 questions
// (Improvement / Managers only, 2026-05-30):
//
//   1. How often is 7 days requested?       → byRequestedDays + KPI callout
//   2. Most-requested days option?           → byRequestedDays (sorted)
//   3. Top / bottom requesters?              → byAgent leaderboard
//   4. How often is the note empty?          → noteStats
//   5. Most-extended category?               → bySource bar chart
//   6. How many denied?                      → totals.rejected + donut
//   7. Accepted-but-days-changed?            → totals.approvedModifiedDays + table
//
// Layout follows the Feedback / HR Hub pattern (skill §3.13): hero →
// filter bar → KPI strip → 2-up metric card grid → wide bar/table rows.
// All colours via CSS vars (var(--text/--surface/--border/--purple)) so
// dark mode lights up correctly; status semantics stay literal.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchSlaExtensionReport } from '../../services/slaExtensionReportApi';

// ── Date helpers ───────────────────────────────────────────────────────
function todayUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function daysAgoUtcDay(n) {
  const d = todayUtcDay();
  d.setUTCDate(d.getUTCDate() - (n - 1)); // inclusive
  return d;
}
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
function prettyRange(fromIso, toIso) {
  if (!fromIso || !toIso) return '—';
  const from = new Date(fromIso + 'T00:00:00Z');
  const to   = new Date(toIso   + 'T00:00:00Z');
  const fmt = (x) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (fromIso === toIso) return fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}

const PRESETS = [
  { id: '7',  label: 'Last 7 days',  days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
];

// ── Tiny chart primitives (no external dep) ───────────────────────────

function Donut({ segments, size = 124, thickness = 12, centreLabel, centreSub }) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} role="img" aria-label="Donut chart">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {total > 0 && segments.map(seg => {
          const v = Math.max(0, seg.value || 0);
          const len = (v / total) * circumference;
          const node = (
            <circle key={seg.label}
              cx={cx} cy={cy} r={r}
              fill="none" stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            >
              <title>{`${seg.label}: ${v}`}</title>
            </circle>
          );
          offset += len;
          return node;
        })}
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {centreLabel ?? total}
        </div>
        {centreSub && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>{centreSub}</div>
        )}
      </div>
    </div>
  );
}

function HBars({ rows, color = 'var(--purple)', emptyText = 'No data', formatRight }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value || 0), 0);
  if (!rows.length || max === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>{emptyText}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(r => {
        const v = Math.max(0, r.value || 0);
        const w = max > 0 ? (v / max) * 100 : 0;
        return (
          <div key={r.key ?? r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 116px) minmax(0, 1fr) minmax(0, 88px)', gap: 12, alignItems: 'center', minHeight: 24 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.label}>
              {r.label}
            </div>
            <div style={{ background: 'var(--surface-3)', borderRadius: 6, height: 10, position: 'relative' }}>
              <div
                style={{
                  background: r.color || color,
                  width: `${w}%`,
                  height: 10,
                  borderRadius: 6,
                  transition: 'width 0.25s ease-out',
                }}
              />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {formatRight ? formatRight(r) : v.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Card scaffold ──────────────────────────────────────────────────────

function Card({ title, hint, action, children, padded = true }) {
  return (
    <section style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: padded ? '16px 18px 18px' : 0,
      display: 'flex', flexDirection: 'column', gap: 12,
      minWidth: 0,
    }}>
      {(title || action) && (
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: padded ? 0 : '16px 18px 0' }}>
          {title && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.1 }}>{title}</div>
              {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{hint}</div>}
            </div>
          )}
          {action}
        </header>
      )}
      <div style={{ padding: padded ? 0 : '0 18px 18px' }}>{children}</div>
    </section>
  );
}

function Kpi({ label, value, tone = 'neutral', sub }) {
  const tones = {
    neutral: { bg: 'var(--surface)', accent: 'var(--text)' },
    purple:  { bg: 'var(--surface)', accent: '#7c3aed' },
    green:   { bg: 'var(--surface)', accent: '#15803d' },
    orange:  { bg: 'var(--surface)', accent: '#d97706' },
    red:     { bg: 'var(--surface)', accent: '#dc2626' },
    blue:    { bg: 'var(--surface)', accent: '#1d4ed8' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: t.bg,
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: t.accent, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export default function SlaExtensionReport({ onBack }) {
  // Date-range state. Server defaults to last 30d when params omitted; we
  // keep the FE in lockstep so the chips reflect what's rendered.
  const [presetId, setPresetId] = useState('30');
  const [customMode, setCustomMode] = useState(false);
  const [customFrom, setCustomFrom] = useState(isoDay(daysAgoUtcDay(30)));
  const [customTo,   setCustomTo]   = useState(isoDay(todayUtcDay()));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const range = useMemo(() => {
    if (customMode) return { from: customFrom, to: customTo };
    const preset = PRESETS.find(p => p.id === presetId) || PRESETS[1];
    return { from: isoDay(daysAgoUtcDay(preset.days)), to: isoDay(todayUtcDay()) };
  }, [presetId, customMode, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSlaExtensionReport(range)
      .then(res => {
        if (cancelled) return;
        setData(res);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load report');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to, refreshTick]);  // eslint-disable-line react-hooks/exhaustive-deps

  const onPreset = useCallback((p) => {
    setPresetId(p.id);
    setCustomMode(false);
    setCustomFrom(isoDay(daysAgoUtcDay(p.days)));
    setCustomTo(isoDay(todayUtcDay()));
  }, []);

  // ── Derived UI inputs ─────────────────────────────────────────────
  const totals = data?.totals || { submitted: 0, approved: 0, approvedSameDays: 0, approvedModifiedDays: 0, rejected: 0, pending: 0 };
  const decided = totals.approved + totals.rejected;
  const approvalRate = decided > 0 ? Math.round((totals.approved / decided) * 100) : null;
  const modifiedRate = totals.approved > 0 ? Math.round((totals.approvedModifiedDays / totals.approved) * 100) : null;

  // Days requested bars — highlight 7 explicitly per Jose's question 1.
  const daysRows = useMemo(() => {
    const arr = data?.byRequestedDays || [];
    return arr.map(d => ({
      key: `req-${d.days}`,
      label: `${d.days} day${d.days === 1 ? '' : 's'}`,
      value: d.n,
      color: d.days === 7 ? '#7c3aed' : 'var(--text-muted)',
      pct: d.pct,
    }));
  }, [data?.byRequestedDays]);

  const sevenDayCount = daysRows.find(r => r.label === '7 days')?.value || 0;
  const sevenDayPct = totals.submitted > 0 ? Math.round((sevenDayCount / totals.submitted) * 100) : 0;

  // Most-requested days option label (winning value).
  const topDaysLabel = useMemo(() => {
    if (!daysRows.length || !totals.submitted) return '—';
    const top = [...daysRows].sort((a, b) => b.value - a.value)[0];
    return top.value > 0 ? top.label : '—';
  }, [daysRows, totals.submitted]);

  const reasonRows = useMemo(() => (data?.byReason || []).map(r => ({
    key: r.code, label: r.label, value: r.n,
    color: REASON_COLORS[r.code] || 'var(--purple)',
  })), [data?.byReason]);

  const sourceRows = useMemo(() => (data?.bySource || []).map(s => ({
    key: s.source, label: s.label, value: s.n,
    color: SOURCE_COLORS[s.source] || 'var(--purple)',
  })), [data?.bySource]);

  // Decisions donut segments.
  const decisionSegments = useMemo(() => ([
    { label: 'Approved · same days',     value: totals.approvedSameDays,     color: '#15803d' },
    { label: 'Approved · days modified', value: totals.approvedModifiedDays, color: '#0ea5e9' },
    { label: 'Rejected',                 value: totals.rejected,             color: '#dc2626' },
    { label: 'Pending',                  value: totals.pending,              color: '#d97706' },
  ]), [totals]);

  const reasonDonut = useMemo(() => reasonRows.map(r => ({ label: r.label, value: r.value, color: r.color })), [reasonRows]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden', background: 'var(--surface-2)' }}>
      <style>{`
        .slx-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .slx-grid-3 { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
        .slx-kpi-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        @media (max-width: 1100px) {
          .slx-grid-2 { grid-template-columns: 1fr; }
          .slx-grid-3 { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          .slx-kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        .slx-chip {
          padding: 6px 12px; border-radius: 128;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-secondary);
          font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all .12s;
          display: inline-flex; align-items: center; gap: 6px;
          white-space: nowrap;
        }
        .slx-chip:hover { background: var(--surface-2); color: var(--text); }
        .slx-chip[data-active="true"] {
          background: #7c3aed; border-color: #7c3aed; color: white;
        }
        .slx-table-row:hover { background: var(--surface-2); }
      `}</style>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '20px 28px 12px 28px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            title="Back to Reports"
            style={{
              width: 36, height: 36, borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <i className="bi-arrow-left" style={{ fontSize: 16 }} />
          </button>
        )}
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: '#f5f3ff', color: '#7c3aed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className="bi-graph-up-arrow" style={{ fontSize: 20 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>SLA Extension Report</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Days requested, manager decisions, top requesters, and note compliance across the SLA extension workflow.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick(t => t + 1)}
          title="Refresh"
          disabled={loading}
          style={{
            height: 36, padding: '0 14px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            opacity: loading ? 0.6 : 1,
          }}
        >
          <i className={loading ? 'bi-arrow-clockwise' : 'bi-arrow-clockwise'} style={{ fontSize: 13, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px 32px' }}>
        {/* Date range chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className="slx-chip"
              data-active={!customMode && presetId === p.id}
              onClick={() => onPreset(p)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="slx-chip"
            data-active={customMode}
            onClick={() => setCustomMode(true)}
          >
            <i className="bi-calendar3" style={{ fontSize: 11 }} />
            Custom
          </button>
          {customMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{
                  height: 30, padding: '0 8px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 12,
                }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={isoDay(todayUtcDay())}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{
                  height: 30, padding: '0 8px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 12,
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
            <i className="bi-calendar-event" style={{ fontSize: 11, marginRight: 5 }} />
            {prettyRange(data?.rangeStart || range.from, data?.rangeEnd || range.to)}
          </div>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
            borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16,
          }}>
            <i className="bi-exclamation-circle-fill" style={{ marginRight: 6 }} />
            {error}
          </div>
        )}

        {/* KPI row */}
        <div className="slx-kpi-row" style={{ marginBottom: 16 }}>
          <Kpi label="Submitted" value={loading && !data ? '—' : totals.submitted} tone="purple" sub={`${prettyRange(range.from, range.to)}`} />
          <Kpi label="Approved" value={loading && !data ? '—' : totals.approved} tone="green"
            sub={approvalRate != null ? `${approvalRate}% approval rate` : 'No decisions yet'} />
          <Kpi label="Rejected" value={loading && !data ? '—' : totals.rejected} tone="red"
            sub={decided > 0 ? `${decided - totals.approved} of ${decided} decided denied` : 'No decisions yet'} />
          <Kpi label="Pending" value={loading && !data ? '—' : totals.pending} tone="orange"
            sub={totals.submitted > 0 ? `${Math.round((totals.pending / totals.submitted) * 100)}% awaiting review` : 'Nothing awaiting'} />
        </div>

        {/* Row 1: days requested + decision donut */}
        <div className="slx-grid-3" style={{ marginBottom: 16 }}>
          <Card
            title="Days requested"
            hint={`Most-requested option: ${topDaysLabel} · 7-day requests: ${sevenDayCount} (${sevenDayPct}%)`}
          >
            <HBars
              rows={daysRows}
              emptyText="No requests in this range."
              formatRight={(r) => `${r.value.toLocaleString()} · ${r.pct ?? 0}%`}
            />
          </Card>
          <Card title="Manager decisions" hint="Approved-same vs days-modified vs rejected vs pending.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Donut
                segments={decisionSegments}
                centreLabel={totals.submitted}
                centreSub="submitted"
              />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {decisionSegments.map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
            {modifiedRate != null && (
              <div style={{
                marginTop: 8, padding: '8px 12px',
                background: '#e0f2fe', color: '#075985',
                fontSize: 12, fontWeight: 600, borderRadius: 8,
              }}>
                <i className="bi-info-circle" style={{ marginRight: 6 }} />
                {modifiedRate}% of approvals had the days modified by the manager.
              </div>
            )}
          </Card>
        </div>

        {/* Row 2: sources + reasons */}
        <div className="slx-grid-2" style={{ marginBottom: 16 }}>
          <Card title="Most-extended categories" hint="Which task source receives the most extension requests.">
            <HBars rows={sourceRows} emptyText="No requests in this range." />
          </Card>
          <Card title="Reason breakdown" hint="Why the extensions are requested.">
            {reasonRows.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>No requests in this range.</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Donut
                  segments={reasonDonut}
                  centreLabel={totals.submitted}
                  centreSub="requests"
                />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {reasonRows.map(r => (
                    <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Row 3: agents leaderboard + note compliance */}
        <div className="slx-grid-3" style={{ marginBottom: 16 }}>
          <Card title="Requesters" hint="Submitted / approved / rejected per agent — sorted by volume.">
            <AgentTable rows={data?.byAgent || []} loading={loading && !data} />
          </Card>
          <Card title="Note compliance" hint="Requests submitted with vs without an explanatory note.">
            <NoteGauge noteStats={data?.noteStats} loading={loading && !data} total={totals.submitted} />
          </Card>
        </div>

        {/* Row 4: modified decisions detail (when any) */}
        {totals.approvedModifiedDays > 0 && (
          <Card
            title="Days changed by manager"
            hint={`${totals.approvedModifiedDays} approval${totals.approvedModifiedDays === 1 ? '' : 's'} where the manager picked a different number of days than the agent requested.`}
          >
            <ModifiedDecisionsTable rows={data?.modifiedDecisions || []} />
          </Card>
        )}

        {!loading && data && totals.submitted === 0 && (
          <div style={{
            background: 'var(--surface)', border: '1px dashed var(--border)',
            borderRadius: 14, padding: '32px 24px', textAlign: 'center',
            color: 'var(--text-secondary)',
          }}>
            <i className="bi-clipboard-x" style={{ fontSize: 28, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No SLA extension requests in this range</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Pick a wider window or check back after the team submits requests.</div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Inline sub-components ─────────────────────────────────────────────

const REASON_COLORS = {
  immigration:           '#7c3aed',
  client_unresponsive:   '#0ea5e9',
  employee_unresponsive: '#15803d',
  long_process:          '#d97706',
};
const SOURCE_COLORS = {
  zendesk:         '#15803d',
  jira:            '#1d4ed8',
  workbench:       '#7c3aed',
  onboarding:      '#0ea5e9',
  offboarding:     '#dc2626',
  amendments:      '#ea580c',
  redlines:        '#b91c1c',
  incentive_plans: '#a16207',
};

function AgentTable({ rows, loading }) {
  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>Loading…</div>;
  }
  if (!rows.length) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>No requesters in this range.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 52px 52px 52px 52px 50px 58px',
        gap: 8, alignItems: 'center',
        padding: '6px 8px',
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
        color: 'var(--text-muted)',
      }}>
        <div>Agent</div>
        <div style={{ textAlign: 'right' }}>Subm.</div>
        <div style={{ textAlign: 'right' }}>Appr.</div>
        <div style={{ textAlign: 'right' }}>Rej.</div>
        <div style={{ textAlign: 'right' }}>Pend.</div>
        <div style={{ textAlign: 'right' }} title="Average days requested">Avg</div>
        <div style={{ textAlign: 'right' }} title="Times the 7-day maximum was requested (% of this agent's requests)">7d max</div>
      </div>
      {rows.slice(0, 25).map(a => (
        <div
          key={a.email}
          className="slx-table-row"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 52px 52px 52px 52px 50px 58px',
            gap: 8, alignItems: 'center',
            padding: '8px',
            fontSize: 12,
            borderTop: '1px solid var(--border-light, var(--border))',
            transition: 'background .1s',
          }}
        >
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.email}>{a.email}</div>
          </div>
          <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{a.submitted}</div>
          <div style={{ textAlign: 'right', color: '#15803d', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{a.approved}</div>
          <div style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{a.rejected}</div>
          <div style={{ textAlign: 'right', color: '#d97706', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{a.pending}</div>
          <div
            style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: a.avgRequestedDays != null && a.avgRequestedDays >= 5 ? '#d97706' : 'var(--text)' }}
            title={a.avgRequestedDays != null ? `Averages ${a.avgRequestedDays} day(s) requested` : 'No requested-days data'}
          >
            {a.avgRequestedDays != null ? `${a.avgRequestedDays}d` : '—'}
          </div>
          <div
            style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: (a.maxDaysPct >= 50 && a.submitted >= 3) ? '#dc2626' : 'var(--text-secondary)' }}
            title={`Requested the 7-day max ${a.maxDaysCount} time(s) — ${a.maxDaysPct}% of their requests`}
          >
            {a.maxDaysCount}
          </div>
        </div>
      ))}
      {rows.length > 25 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 8 }}>
          + {rows.length - 25} more agent{rows.length - 25 === 1 ? '' : 's'}
        </div>
      )}
      <div style={{
        marginTop: 8, padding: '8px 10px',
        background: 'var(--surface-2)', color: 'var(--text-secondary)',
        fontSize: 11, borderRadius: 8, lineHeight: 1.4,
      }}>
        <i className="bi-info-circle" style={{ marginRight: 5 }} />
        <strong style={{ color: 'var(--text)' }}>Avg</strong> = average days requested ·{' '}
        <strong style={{ color: 'var(--text)' }}>7d max</strong> = times the 7-day maximum was requested.
        A <span style={{ color: '#dc2626', fontWeight: 600 }}>red</span> 7d max (≥50% of an agent&rsquo;s 3+ requests) or an{' '}
        <span style={{ color: '#d97706', fontWeight: 600 }}>amber</span> avg (≥5d) flags leaning on long extensions — a coaching signal.
      </div>
    </div>
  );
}

function NoteGauge({ noteStats, loading, total }) {
  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>;
  }
  if (!noteStats || total === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No requests in this range.</div>;
  }
  const withPct = total > 0 ? Math.round((noteStats.withNote / total) * 100) : 0;
  const emptyPct = total > 0 ? Math.round((noteStats.emptyNote / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {emptyPct}%
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
          empty notes ({noteStats.emptyNote} of {total})
        </div>
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-3)' }}>
        <div
          style={{ width: `${withPct}%`, background: '#15803d', transition: 'width 0.3s' }}
          title={`With note: ${noteStats.withNote} (${withPct}%)`}
        />
        <div
          style={{ width: `${emptyPct}%`, background: '#dc2626', transition: 'width 0.3s' }}
          title={`Empty note: ${noteStats.emptyNote} (${emptyPct}%)`}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#15803d', marginRight: 5 }} />With note · {noteStats.withNote}</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#dc2626', marginRight: 5 }} />Empty · {noteStats.emptyNote}</span>
      </div>
      <div style={{
        marginTop: 4, padding: '8px 10px',
        background: 'var(--surface-2)', color: 'var(--text-secondary)',
        fontSize: 11, borderRadius: 8, lineHeight: 1.4,
      }}>
        <i className="bi-info-circle" style={{ marginRight: 5 }} />
        New submissions enforce a ≥20-char note (since 2026-05-28); empty notes here are historical or pre-enforcement.
      </div>
    </div>
  );
}

function ModifiedDecisionsTable({ rows }) {
  if (!rows.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,140px) 80px 80px 100px',
        gap: 8, alignItems: 'center',
        padding: '6px 8px',
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
        color: 'var(--text-muted)',
      }}>
        <div>Task</div>
        <div>Agent</div>
        <div style={{ textAlign: 'right' }}>Requested</div>
        <div style={{ textAlign: 'right' }}>Approved</div>
        <div style={{ textAlign: 'right' }}>Submitted</div>
      </div>
      {rows.map(r => (
        <div
          key={r.id}
          className="slx-table-row"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,140px) 80px 80px 100px',
            gap: 8, alignItems: 'center',
            padding: '8px',
            fontSize: 12,
            borderTop: '1px solid var(--border-light, var(--border))',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {r.taskUrl ? (
              <a
                href={r.taskUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
                title={r.subject || 'View task'}
              >
                {r.subject || '(no subject)'}
              </a>
            ) : (
              <span style={{ color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                {r.subject || '(no subject)'}
              </span>
            )}
            {r.sourceLabel && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{r.sourceLabel}</span>
            )}
          </div>
          <div style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }} title={r.agentEmail || ''}>
            {r.agentName || r.agentEmail}
          </div>
          <div style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{r.requestedDays ?? '—'}d</div>
          <div style={{ textAlign: 'right', fontWeight: 600, color: '#0ea5e9', fontVariantNumeric: 'tabular-nums' }}>{r.approvedDays}d</div>
          <div style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>
            {r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}
