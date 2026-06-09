// ── PerformanceCharts ───────────────────────────────────────────────────────
// A small library of reusable, PURELY PRESENTATIONAL chart components for the
// Performance tab (Phase D). No data fetching, no API, no hooks-with-effects —
// each component takes already-shaped props and renders clean inline SVG (no
// chart library). They match the Ops Hub board look (var(--surface)/--border/
// --text, #7c3aed accent, band colours from SCORE_BANDS) and degrade to a muted
// "No data" state when handed empty/missing input. Scores live on the 1–5 scale
// (0 = not scored); bands come from SCORE_BANDS via bandForScore.
import { SCORE_BANDS, bandForScore, MONTH_LABELS } from '../../../lib/performance-constants';

const PURPLE = '#7c3aed';

// Shared muted empty state so every chart fails the same gentle way.
function NoData({ label = 'No data', height = 80 }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600,
      border: '1px dashed var(--border)', borderRadius: 12, background: 'var(--surface)',
    }}>
      {label}
    </div>
  );
}

// ── TrendLine ───────────────────────────────────────────────────────────────
// An SVG line+area sparkline of monthly Final score (1–5) over time. `series`
// is an ordered (oldest→newest) array of { month, year, score } where score is
// the weighted/overall final on the 0–5 scale. Renders month labels along the
// bottom + the last-point value, and colours the line/fill by the latest band.
export function TrendLine({ series, width = 340, height = 120, title = null }) {
  const pts = Array.isArray(series)
    ? series.filter(d => d && Number(d.score) > 0)
    : [];
  if (pts.length < 2) return <NoData label="Not enough history yet" height={height} />;

  const padL = 26, padR = 12, padT = 12, padB = 22;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);
  const maxV = 5, minV = 0, range = maxV - minV;
  const stepX = pts.length > 1 ? innerW / (pts.length - 1) : 0;

  const xy = pts.map((d, i) => {
    const v = Math.max(minV, Math.min(maxV, Number(d.score) || 0));
    const x = padL + i * stepX;
    const y = padT + innerH - ((v - minV) / range) * innerH;
    return { x, y, v, d };
  });

  const linePath = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xy[xy.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${xy[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const last = xy[xy.length - 1];
  const band = bandForScore(last.v);
  const gid = `tl-grad-${Math.round(last.x)}-${Math.round(last.v * 10)}`;

  // Gridlines at integer scores 1..5.
  const grid = [1, 2, 3, 4, 5].map(g => padT + innerH - ((g - minV) / range) * innerH);

  return (
    <div>
      {title && <div style={chartTitle}>{title}</div>}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }} role="img" aria-label="Final score trend">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={band.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={band.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((gy, i) => (
          <g key={i}>
            <line x1={padL} y1={gy} x2={width - padR} y2={gy} stroke="var(--border-light)" strokeWidth="1" />
            <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">{i + 1}</text>
          </g>
        ))}
        <path d={areaPath} fill={`url(#${gid})`} stroke="none" />
        <path d={linePath} fill="none" stroke={band.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {xy.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === xy.length - 1 ? 4 : 2.5} fill={i === xy.length - 1 ? band.color : 'var(--surface)'} stroke={band.color} strokeWidth="1.5" />
        ))}
        {/* Last-point value chip */}
        <text x={last.x} y={Math.max(padT + 8, last.y - 9)} textAnchor="middle" fontSize="11" fontWeight="800" fill={band.color}>{last.v.toFixed(1)}</text>
        {/* Month labels (thin out if crowded) */}
        {xy.map((p, i) => {
          const everyN = Math.ceil(xy.length / 7);
          if (i % everyN !== 0 && i !== xy.length - 1) return null;
          return (
            <text key={`m${i}`} x={p.x} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
              {MONTH_LABELS[Number(p.d.month)] || ''}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── MetricRadar ─────────────────────────────────────────────────────────────
// A 4-axis radar (1–5) of the latest review's sub-scores: Operations, KPI,
// Growth, Sentiment. Defensive — if everything is 0/missing, shows "No data".
export function MetricRadar({ operations, kpi, growth, sentiment, size = 180, title = null }) {
  const axes = [
    { key: 'operations', label: 'Ops', value: Number(operations) || 0 },
    { key: 'kpi', label: 'KPI', value: Number(kpi) || 0 },
    { key: 'growth', label: 'Growth', value: Number(growth) || 0 },
    { key: 'sentiment', label: 'Sentiment', value: Number(sentiment) || 0 },
  ];
  const hasData = axes.some(a => a.value > 0);
  if (!hasData) return <NoData label="No scored review yet" height={size} />;

  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 30;
  const maxV = 5;
  const n = axes.length;
  // Start at top (-90°), go clockwise.
  const angleAt = (i) => (-Math.PI / 2) + (i * 2 * Math.PI) / n;
  const pointAt = (i, frac) => ({
    x: cx + Math.cos(angleAt(i)) * r * frac,
    y: cy + Math.sin(angleAt(i)) * r * frac,
  });

  const rings = [1, 2, 3, 4, 5];
  const dataPts = axes.map((a, i) => pointAt(i, Math.max(0, Math.min(maxV, a.value)) / maxV));
  const dataPath = dataPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  const avg = axes.reduce((s, a) => s + a.value, 0) / n;
  const band = bandForScore(avg);

  return (
    <div>
      {title && <div style={chartTitle}>{title}</div>}
      <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', maxWidth: size, margin: '0 auto' }} role="img" aria-label="Metric radar">
        {/* Concentric rings */}
        {rings.map((ring) => {
          const pts = axes.map((_, i) => pointAt(i, ring / maxV));
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
          return <path key={ring} d={d} fill="none" stroke="var(--border-light)" strokeWidth="1" />;
        })}
        {/* Spokes */}
        {axes.map((_, i) => {
          const edge = pointAt(i, 1);
          return <line key={i} x1={cx} y1={cy} x2={edge.x} y2={edge.y} stroke="var(--border-light)" strokeWidth="1" />;
        })}
        {/* Data polygon */}
        <path d={dataPath} fill={band.color} fillOpacity="0.18" stroke={band.color} strokeWidth="2" strokeLinejoin="round" />
        {dataPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={band.color} />)}
        {/* Axis labels + value */}
        {axes.map((a, i) => {
          const lp = pointAt(i, 1.18);
          return (
            <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fontWeight="700" fill="var(--text-secondary)">
              {a.label} {a.value > 0 ? a.value : '–'}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── BandRing ────────────────────────────────────────────────────────────────
// A circular progress ring showing the overall score (0–5) tinted by its band,
// with the band emoji + label + numeric score in the center.
export function BandRing({ score, size = 132, stroke = 11, label = null }) {
  const s = Number(score) || 0;
  const has = s > 0;
  const band = bandForScore(s);
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(5, s)) / 5;
  const dash = circ * frac;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Overall score ring">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-light)" strokeWidth={stroke} />
          {has && (
            <circle
              cx={cx} cy={cy} r={r} fill="none"
              stroke={band.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )}
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        }}>
          {has ? (
            <>
              <div style={{ fontSize: size * 0.18, lineHeight: 1 }}>{band.emoji}</div>
              <div style={{ fontSize: size * 0.26, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>{s.toFixed(s % 1 === 0 ? 0 : 1)}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: band.color }}>{band.label}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>No score</div>
          )}
        </div>
      </div>
      {label && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>}
    </div>
  );
}

// ── DistributionBars ────────────────────────────────────────────────────────
// Horizontal bars of count per band (Insufficient → Exceptional), using each
// band's SCORE_BANDS colour. `counts` is either a { [label]: n } map or an
// array aligned to SCORE_BANDS order.
export function DistributionBars({ counts, title = null }) {
  const byLabel = {};
  if (Array.isArray(counts)) {
    SCORE_BANDS.forEach((b, i) => { byLabel[b.label] = Number(counts[i]) || 0; });
  } else if (counts && typeof counts === 'object') {
    SCORE_BANDS.forEach(b => { byLabel[b.label] = Number(counts[b.label]) || 0; });
  }
  const total = SCORE_BANDS.reduce((s, b) => s + (byLabel[b.label] || 0), 0);
  if (total === 0) return <NoData label="No scored reviews this period" height={110} />;
  const max = Math.max(1, ...SCORE_BANDS.map(b => byLabel[b.label] || 0));

  return (
    <div>
      {title && <div style={chartTitle}>{title}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {SCORE_BANDS.map(b => {
          const n = byLabel[b.label] || 0;
          const pct = (n / max) * 100;
          return (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 92, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ marginRight: 4 }}>{b.emoji}</span>{b.label}
              </div>
              <div style={{ flex: 1, height: 16, background: 'var(--surface-2)', borderRadius: 128, overflow: 'hidden', position: 'relative' }}>
                <div style={{ width: `${Math.max(n > 0 ? 6 : 0, pct)}%`, height: '100%', background: b.color, borderRadius: 128, transition: 'width .2s' }} />
              </div>
              <div style={{ width: 22, textAlign: 'right', fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{n}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const chartTitle = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 10 };

export { PURPLE as CHART_PURPLE };
