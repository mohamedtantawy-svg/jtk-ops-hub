// ── TeamReviews ─────────────────────────────────────────────────────────────
// The manager review queue (Phase C). A period selector (month + year, default
// the current month/year) drives usePerfReviews({ scope:'team', month, year }).
// The roster renders as a table: Member · Role · Status · Overall (band pill) ·
// an Open/Review button that opens the ReviewEditor (canScore=true) with the
// member's template resolved by role from usePerfTemplates (fallback: first).
import { useMemo, useState } from 'react';
import { usePerfReviews } from '../../../hooks/usePerfReviews';
import { usePerfTemplates } from '../../../hooks/usePerfTemplates';
import {
  bandForScore, MONTH_LABELS, reviewStatusMeta, quarterOfMonth, SCORE_BANDS,
} from '../../../lib/performance-constants';
import { TrendLine, BandRing, DistributionBars } from './PerformanceCharts';
import ReviewEditor from './ReviewEditor';

const PURPLE = '#7c3aed';

export default function TeamReviews({ user, canManage = false }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [view, setView] = useState('queue'); // 'queue' | 'dashboard'

  const { reviews, roster, loading, error, refresh } = usePerfReviews({ scope: 'team', month, year });
  // All-period team reviews power the dashboard trend + heatmap. Only fetch
  // once the dashboard is opened to avoid an extra request on the queue view.
  const all = usePerfReviews({ scope: 'team', enabled: view === 'dashboard' });
  const { templates } = usePerfTemplates();
  const [active, setActive] = useState(null); // { member, review, template }

  // Index reviews by member email for quick lookup against the roster.
  const reviewByEmail = useMemo(() => {
    const m = {};
    for (const r of reviews) if (r.memberEmail) m[r.memberEmail.toLowerCase()] = r;
    return m;
  }, [reviews]);

  const resolveTemplate = (roleKey) => {
    if (!templates || templates.length === 0) return null;
    return templates.find(t => t.roleKey === roleKey) || templates[0];
  };

  // Completion: roster entries that have a scored review for this period.
  const reviewedCount = useMemo(
    () => roster.filter(m => {
      const r = reviewByEmail[(m.email || '').toLowerCase()];
      return r && Number(r.overallScore) > 0;
    }).length,
    [roster, reviewByEmail]);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReview = (m) => {
    const review = reviewByEmail[(m.email || '').toLowerCase()] || null;
    const roleKey = (review?.roleKey) || m.roleKey || m.role;
    setActive({
      member: { email: m.email, name: m.name, role: m.role, title: m.title, managerName: user?.name },
      review,
      template: resolveTemplate(roleKey),
    });
  };

  const cycleLabel = `${MONTH_LABELS[Number(month)]} ${year} · Q${quarterOfMonth(month)}`;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Period selector + completion */}
      <div style={toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={sel}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{MONTH_LABELS[m]}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={sel}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{cycleLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Queue / Dashboard toggle */}
          <div style={toggleWrap}>
            <button onClick={() => setView('queue')} style={view === 'queue' ? toggleOn : toggleOff}>
              <i className="bi bi-list-check" style={{ marginRight: 5 }} />Review queue
            </button>
            <button onClick={() => setView('dashboard')} style={view === 'dashboard' ? toggleOn : toggleOff}>
              <i className="bi bi-bar-chart-line" style={{ marginRight: 5 }} />Dashboard
            </button>
          </div>
          {view === 'queue' && (
            <>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                {reviewedCount} of {roster.length} reviewed
              </span>
              <div style={{ width: 120, height: 6, borderRadius: 128, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ width: `${roster.length ? (reviewedCount / roster.length) * 100 : 0}%`, height: '100%', background: PURPLE, borderRadius: 128 }} />
              </div>
            </>
          )}
          <button onClick={() => { refresh(); if (view === 'dashboard') all.refresh(); }} style={iconBtn} title="Refresh"><i className="bi bi-arrow-clockwise" /></button>
        </div>
      </div>

      {view === 'queue' && error && <Err msg={error} />}
      {view === 'queue' && loading && roster.length === 0 && <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}

      {view === 'queue' && !loading && roster.length === 0 && !error && (
        <div style={emptyCard}>
          <i className="bi bi-people" style={{ fontSize: 28, display: 'block', marginBottom: 10, opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No team members in scope</div>
          <div style={{ fontSize: 12 }}>{canManage ? 'No reports found for this department.' : 'You do not have a managerial scope.'}</div>
        </div>
      )}

      {view === 'dashboard' && (
        <TeamDashboard
          all={all}
          periodRoster={roster}
          periodReviewByEmail={reviewByEmail}
          reviewedCount={reviewedCount}
          month={month}
          year={year}
        />
      )}

      {view === 'queue' && roster.length > 0 && (
        <div style={tableCard}>
          <div style={{ ...rowBase, ...headRow }}>
            <div style={{ flex: 2, minWidth: 0 }}>Member</div>
            <div style={{ flex: 1 }}>Role</div>
            <div style={{ flex: 1 }}>Status</div>
            <div style={{ width: 70, textAlign: 'right' }}>Overall</div>
            <div style={{ flex: 1, textAlign: 'right' }} />
          </div>
          {roster.map(m => {
            const review = reviewByEmail[(m.email || '').toLowerCase()] || null;
            const scored = Number(review?.overallScore) > 0;
            const band = scored ? bandForScore(review.weightedScore ?? review.overallScore) : null;
            const sMeta = reviewStatusMeta(review?.status || 'draft');
            return (
              <div key={m.email || m.name} style={rowBase}>
                <div style={{ flex: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.email}</div>
                  {m.title && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.title}</div>}
                </div>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>{m.role || '—'}</div>
                <div style={{ flex: 1 }}>
                  <span style={{ ...statusPill, color: sMeta.color, background: sMeta.bg, borderColor: `${sMeta.color}33` }}>{sMeta.label}</span>
                </div>
                <div style={{ width: 70, textAlign: 'right' }}>
                  {scored ? (
                    <span style={{ ...overallRing, color: band.color, background: band.bg, border: `1px solid ${band.color}55` }}>{review.overallScore}</span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                  )}
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <button onClick={() => openReview(m)} style={review ? reviewBtn : openBtn}>
                    {review ? 'Review' : 'Open'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <ReviewEditor
          review={active.review}
          member={active.member}
          month={month}
          year={year}
          template={active.template}
          canScore
          isSelf={false}
          onSaved={() => { refresh(); setActive(null); }}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

// ── TeamDashboard ───────────────────────────────────────────────────────────
// Aggregated, read-only team view for the SELECTED period plus month-over-month
// trends. `all` is the all-period usePerfReviews result; the period-scoped
// roster + reviewByEmail come from the parent so completion/distribution/
// top-bottom reflect exactly what the queue shows for the chosen month/year.
function TeamDashboard({ all, periodRoster, periodReviewByEmail, reviewedCount, month, year }) {
  const { reviews: allReviews, loading: allLoading } = all;

  // Scored reviews for the SELECTED period (for distribution + top/bottom).
  const periodScored = useMemo(
    () => periodRoster
      .map(m => periodReviewByEmail[(m.email || '').toLowerCase()])
      .filter(r => r && Number(r.overallScore) > 0),
    [periodRoster, periodReviewByEmail]);

  // Band distribution for the selected period.
  const distribution = useMemo(() => {
    const counts = {};
    for (const b of SCORE_BANDS) counts[b.label] = 0;
    for (const r of periodScored) {
      const b = bandForScore(r.weightedScore ?? r.overallScore);
      counts[b.label] = (counts[b.label] || 0) + 1;
    }
    return counts;
  }, [periodScored]);

  // Top 5 / Bottom 5 by overall for the selected period.
  const ranked = useMemo(() => {
    const rows = periodScored.map(r => ({
      name: r.memberName || r.memberEmail,
      overall: Number(r.overallScore) || 0,
      score: Number(r.weightedScore ?? r.overallScore) || 0,
    })).sort((a, b) => b.score - a.score);
    return { top: rows.slice(0, 5), bottom: rows.length > 5 ? rows.slice(-5).reverse() : [] };
  }, [periodScored]);

  // Team trend — avg Final score per month across all periods (oldest→newest).
  const trendSeries = useMemo(() => {
    const buckets = new Map(); // key `${y}-${m}` → { sum, n, month, year }
    for (const r of allReviews) {
      if (!(Number(r.overallScore) > 0)) continue;
      const m = Number(r.periodMonth), y = Number(r.periodYear);
      if (!m || !y) continue;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const b = buckets.get(key) || { sum: 0, n: 0, month: m, year: y };
      b.sum += Number(r.weightedScore ?? r.overallScore) || 0; b.n += 1;
      buckets.set(key, b);
    }
    return [...buckets.values()]
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .map(b => ({ month: b.month, year: b.year, score: Math.round((b.sum / b.n) * 10) / 10 }));
  }, [allReviews]);

  // Heatmap — members × last ~6 months. Columns = trailing 6 months ending at
  // the selected period; cells tinted by that month's band (blank if no review).
  const heatmap = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      let m = month - i, y = year;
      while (m <= 0) { m += 12; y -= 1; }
      months.push({ month: m, year: y });
    }
    // Index all reviews by email → `${y}-${m}` → review.
    const byMember = new Map();
    for (const r of allReviews) {
      const email = (r.memberEmail || '').toLowerCase();
      if (!email) continue;
      if (!byMember.has(email)) byMember.set(email, { name: r.memberName || r.memberEmail, cells: new Map() });
      byMember.get(email).cells.set(`${Number(r.periodYear)}-${Number(r.periodMonth)}`, r);
    }
    const members = [...byMember.values()]
      .map(mem => ({
        name: mem.name,
        cells: months.map(col => {
          const r = mem.cells.get(`${col.year}-${col.month}`);
          if (!r || !(Number(r.overallScore) > 0)) return null;
          return { score: Number(r.weightedScore ?? r.overallScore) || 0, band: bandForScore(r.weightedScore ?? r.overallScore) };
        }),
      }))
      .filter(mem => mem.cells.some(Boolean))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { months, members };
  }, [allReviews, month, year]);

  const completionScore = periodRoster.length ? (reviewedCount / periodRoster.length) * 5 : 0;

  return (
    <div>
      <style>{`@media (max-width: 900px) { .perf-dash-top { grid-template-columns: 1fr !important; } }`}</style>

      {/* Top row: completion ring + distribution */}
      <div className="perf-dash-top" style={dashTopGrid}>
        <div style={{ ...dashCard, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <BandRing score={completionScore} label={`${MONTH_LABELS[Number(month)]} ${year} completion`} />
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
            {reviewedCount} of {periodRoster.length} reviewed
          </div>
        </div>
        <div style={dashCard}>
          <DistributionBars title={`Band distribution · ${MONTH_LABELS[Number(month)]} ${year}`} counts={distribution} />
        </div>
      </div>

      {/* Top / Bottom performers */}
      <div className="perf-dash-top" style={dashTopGrid}>
        <div style={dashCard}>
          <div style={dashTitle}>Top performers · {MONTH_LABELS[Number(month)]} {year}</div>
          <RankList rows={ranked.top} empty="No scored reviews this period" />
        </div>
        <div style={dashCard}>
          <div style={dashTitle}>Bottom performers · {MONTH_LABELS[Number(month)]} {year}</div>
          <RankList rows={ranked.bottom} empty="Not enough scored reviews" />
        </div>
      </div>

      {/* Team trend */}
      <div style={{ ...dashCard, marginBottom: 12 }}>
        <TrendLine series={trendSeries} title="Team avg final score · month over month" width={720} height={140} />
      </div>

      {/* Heatmap */}
      <div style={dashCard}>
        <div style={dashTitle}>Score heatmap · last 6 months</div>
        {allLoading && allReviews.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading history…</div>
        ) : heatmap.members.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>No history to display yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 460 }}>
              <thead>
                <tr>
                  <th style={hmCorner}>Member</th>
                  {heatmap.months.map(c => (
                    <th key={`${c.year}-${c.month}`} style={hmHead}>{MONTH_LABELS[c.month]}<div style={{ fontSize: 8, fontWeight: 500, color: 'var(--text-muted)' }}>{String(c.year).slice(2)}</div></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.members.map(mem => (
                  <tr key={mem.name}>
                    <td style={hmName}>{mem.name}</td>
                    {mem.cells.map((cell, i) => (
                      <td key={i} style={hmCellWrap}>
                        {cell ? (
                          <div style={{ ...hmCell, background: cell.band.bg, color: cell.band.color, border: `1px solid ${cell.band.color}44` }} title={`${cell.band.label} · ${cell.score.toFixed(1)}`}>
                            {cell.score.toFixed(1)}
                          </div>
                        ) : (
                          <div style={{ ...hmCell, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>–</div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RankList({ rows, empty }) {
  if (!rows || rows.length === 0) {
    return <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--text-muted)' }}>{empty}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r, i) => {
        const band = bandForScore(r.score);
        return (
          <div key={`${r.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 16, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.overall}</span>
            <span style={{ padding: '2px 9px', borderRadius: 128, fontSize: 10, fontWeight: 800, color: band.color, background: band.bg, border: `1px solid ${band.color}33`, whiteSpace: 'nowrap' }}>
              {band.emoji} {band.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const Err = ({ msg }) => <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>{msg}</div>;

const toolbar = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' };
const sel = { fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' };
const tableCard = { border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', overflow: 'hidden' };
const rowBase = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-light)' };
const headRow = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', background: 'var(--surface-2)' };
const statusPill = { display: 'inline-block', padding: '2px 9px', borderRadius: 128, fontSize: 10, fontWeight: 700, border: '1px solid' };
const overallRing = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 30, borderRadius: '50%', fontSize: 14, fontWeight: 800, padding: '0 4px' };
const openBtn = { fontSize: 12, fontWeight: 700, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' };
const reviewBtn = { fontSize: 12, fontWeight: 600, color: PURPLE, background: 'transparent', border: `1px solid ${PURPLE}`, borderRadius: 8, padding: '5px 13px', cursor: 'pointer' };
const iconBtn = { border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 4 };
const emptyCard = { padding: '40px 24px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 14, color: 'var(--text-muted)', background: 'var(--surface)' };
const toggleWrap = { display: 'inline-flex', padding: 3, gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 };
const toggleBase = { fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' };
const toggleOn = { ...toggleBase, background: PURPLE, color: '#fff' };
const toggleOff = { ...toggleBase, background: 'transparent', color: 'var(--text-secondary)' };
const dashTopGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 };
const dashCard = { padding: '16px 18px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)' };
const dashTitle = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 12 };
const hmCorner = { textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '4px 8px 8px 4px', position: 'sticky', left: 0, background: 'var(--surface)' };
const hmHead = { fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', padding: '4px 6px 8px', textAlign: 'center', minWidth: 48 };
const hmName = { fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: '4px 8px 4px 4px', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--surface)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' };
const hmCellWrap = { padding: 3, textAlign: 'center' };
const hmCell = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, minWidth: 40, borderRadius: 7, fontSize: 11, fontWeight: 800 };
