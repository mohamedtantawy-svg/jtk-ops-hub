// ── MyPerformance ───────────────────────────────────────────────────────────
// The member's OWN performance view (Phase C). Read-only scores: a header with
// the latest band, a compact monthly history with a tiny trend sparkline, and a
// button to open the current open period in the ReviewEditor (isSelf=true,
// canScore=false) so the member can fill their self-reflection / acknowledge.
import { useMemo, useState } from 'react';
import { usePerfReviews } from '../../../hooks/usePerfReviews';
import { usePerfTemplates } from '../../../hooks/usePerfTemplates';
import {
  bandForScore, MONTH_LABELS, reviewStatusMeta,
} from '../../../lib/performance-constants';
import ReviewEditor from './ReviewEditor';

const PURPLE = '#7c3aed';

export default function MyPerformance({ user }) {
  const { reviews, loading, error, refresh } = usePerfReviews({ scope: 'mine' });
  const { templates } = usePerfTemplates();
  const [editorOpen, setEditorOpen] = useState(false);

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  // Sort newest-first for the history list; the most recent finalized/scored
  // review drives the header band.
  const sorted = useMemo(() => {
    return [...reviews].sort((a, b) =>
      (b.periodYear - a.periodYear) || (b.periodMonth - a.periodMonth));
  }, [reviews]);

  // Latest review with a real score for the header.
  const latestScored = useMemo(
    () => sorted.find(r => Number(r.overallScore) > 0) || sorted[0] || null,
    [sorted]);

  const headerBand = latestScored ? bandForScore(latestScored.weightedScore ?? latestScored.overallScore) : null;

  // Current open period (this month) — open it in the editor for self-reflection.
  const currentReview = useMemo(
    () => reviews.find(r => Number(r.periodMonth) === curMonth && Number(r.periodYear) === curYear) || null,
    [reviews, curMonth, curYear]);

  // Resolve the member's template by their role (fall back to the first one).
  const myRoleKey = currentReview?.roleKey || latestScored?.roleKey || user?.roleKey;
  const template = useMemo(() => {
    if (!templates || templates.length === 0) return null;
    return templates.find(t => t.roleKey === myRoleKey) || templates[0];
  }, [templates, myRoleKey]);

  // Sparkline series — oldest → newest weighted scores.
  const series = useMemo(
    () => [...sorted].reverse().map(r => Number(r.weightedScore ?? r.overallScore) || 0),
    [sorted]);

  return (
    <div style={{ marginTop: 16 }}>
      {/* Header band card */}
      <div style={headerCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={avatar}><i className="bi bi-person-badge" /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{user?.name || user?.email || 'You'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {headerBand ? `Latest: ${MONTH_LABELS[Number(latestScored.periodMonth)]} ${latestScored.periodYear}` : 'No reviews yet'}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            {series.length > 1 && <Sparkline values={series} />}
            {headerBand && <BandPill band={headerBand} big />}
          </div>
        </div>
      </div>

      {error && <Err msg={error} />}
      {loading && reviews.length === 0 && <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}

      {/* Current period CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '16px 0 10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          Monthly history
        </div>
        <button onClick={() => setEditorOpen(true)} style={primaryBtn}>
          <i className="bi bi-chat-square-heart" style={{ marginRight: 6 }} />
          {currentReview ? `Open ${MONTH_LABELS[curMonth]} ${curYear} check-in` : `Start ${MONTH_LABELS[curMonth]} ${curYear} reflection`}
        </button>
      </div>

      {/* History list */}
      {!loading && sorted.length === 0 && (
        <div style={emptyCard}>
          <i className="bi bi-graph-up-arrow" style={{ fontSize: 28, display: 'block', marginBottom: 10, opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No reviews yet</div>
          <div style={{ fontSize: 12 }}>Your monthly performance history will appear here.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(r => {
          const band = bandForScore(r.weightedScore ?? r.overallScore);
          const sMeta = reviewStatusMeta(r.status);
          const scored = Number(r.overallScore) > 0;
          return (
            <div key={r.id} style={historyRow}>
              <div style={{ minWidth: 92 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{MONTH_LABELS[Number(r.periodMonth)]} {r.periodYear}</div>
                <span style={{ ...statusPill, color: sMeta.color, background: sMeta.bg, borderColor: `${sMeta.color}33` }}>{sMeta.label}</span>
              </div>
              <div style={{ flex: 1 }} />
              {scored ? (
                <>
                  <div style={{ textAlign: 'right', minWidth: 64 }}>
                    <div style={miniLabel}>Overall</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{r.overallScore}</div>
                  </div>
                  <BandPill band={band} />
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Not scored yet</span>
              )}
            </div>
          );
        })}
      </div>

      {editorOpen && (
        <ReviewEditor
          review={currentReview}
          member={{ email: user?.email, name: user?.name, role: user?.role, title: user?.title, managerName: currentReview?.managerName }}
          month={curMonth}
          year={curYear}
          template={template}
          canScore={false}
          isSelf
          onSaved={() => { refresh(); setEditorOpen(false); }}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

// ── Sparkline (inline SVG) ──────────────────────────────────────────────────
function Sparkline({ values, width = 120, height = 32 }) {
  if (!values || values.length < 2) return null;
  const max = 5, min = 0; // weighted scores live in 0–5
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((Math.max(min, Math.min(max, v)) - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastY = Number(points[points.length - 1].split(',')[1]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }} aria-label="Score trend">
      <polyline points={points.join(' ')} fill="none" stroke={PURPLE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={lastY} r={3} fill={PURPLE} />
    </svg>
  );
}

function BandPill({ band, big = false }) {
  return (
    <span style={{
      padding: big ? '6px 14px' : '4px 11px', borderRadius: 128,
      fontSize: big ? 14 : 12, fontWeight: 800, color: band.color, background: band.bg,
      border: `1px solid ${band.color}33`, whiteSpace: 'nowrap',
    }}>
      <span style={{ marginRight: 5 }}>{band.emoji}</span>{band.label}
    </span>
  );
}

const Err = ({ msg }) => <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>{msg}</div>;

const headerCard = { padding: '16px 18px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)' };
const avatar = { width: 44, height: 44, borderRadius: 12, background: '#f3eff8', color: PURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 };
const historyRow = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)' };
const statusPill = { display: 'inline-block', marginTop: 3, padding: '2px 9px', borderRadius: 128, fontSize: 10, fontWeight: 700, border: '1px solid' };
const miniLabel = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' };
const emptyCard = { padding: '40px 24px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 14, color: 'var(--text-muted)', background: 'var(--surface)' };
const primaryBtn = { fontSize: 13, fontWeight: 700, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' };
