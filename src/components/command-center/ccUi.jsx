'use client';

// ── Command Center shared UI primitives ─────────────────────────────────────
// One source of truth for the executive look + the loading/error/empty states
// every report tab reuses. All theme-dependent colours are CSS vars (dark-mode
// safe, skill rule #30); only semantic status colours stay literal.

import React from 'react';

export const CC_ACCENT = 'var(--purple, #7c3aed)';

// Health bands — semantic, literal on purpose (must not shift with theme).
export function healthTone(score) {
  if (score >= 80) return { color: '#15803d', label: 'Healthy' };
  if (score >= 60) return { color: '#d97706', label: 'Attention' };
  return { color: '#dc2626', label: 'Critical' };
}

export function Card({ children, style }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, ...style }}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, hint, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
      {hint ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span> : null}
      {right || null}
    </div>
  );
}

export function StatRow({ children, style }) {
  return <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', ...style }}>{children}</div>;
}

export function StatTile({ label, value, icon, tone }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 150, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: 'var(--surface-2)', color: CC_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
        <i className={`bi ${icon}`} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: tone || 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

export function MiniStat({ label, value, tone }) {
  const color = tone === 'urgent' && value > 0 ? '#dc2626'
    : tone === 'warn' && value > 0 ? '#d97706'
    : tone === 'good' ? '#15803d'
    : 'var(--text)';
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

// Donut-style score ring (SVG) — used for Health + SLA % gauges.
export function ScoreRing({ value, max = 100, color, size = 96, label, suffix = '' }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, (Number(value) || 0) / max));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3, var(--border))" strokeWidth={9} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} style={{ transition: 'stroke-dashoffset .5s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}{suffix}</div>
        {label ? <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color }}>{label}</div> : null}
      </div>
    </div>
  );
}

export function LoadingState({ rows = 3 }) {
  return (
    <div style={{ animation: 'cc-pulse 1.2s ease-in-out infinite' }}>
      <style>{`@keyframes cc-pulse {0%,100%{opacity:1}50%{opacity:.55}}`}</style>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ height: 64, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 12 }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const forbidden = error?.status === 403;
  return (
    <Card style={{ textAlign: 'center', padding: 28 }}>
      <div style={{ fontSize: 26, color: forbidden ? CC_ACCENT : '#d97706', marginBottom: 8 }}>
        <i className={`bi ${forbidden ? 'bi-shield-lock' : 'bi-exclamation-triangle'}`} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{forbidden ? 'Command Center access required' : 'Couldn’t load this report'}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
        {forbidden ? 'This executive view is limited to leadership.' : 'The data didn’t load. Try again.'}
      </div>
      {!forbidden && onRetry ? (
        <button type="button" onClick={onRetry} style={{ marginTop: 14, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: CC_ACCENT, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600 }}>Retry</button>
      ) : null}
    </Card>
  );
}

export function EmptyState({ text }) {
  return <Card style={{ borderStyle: 'dashed', textAlign: 'center', padding: 28, color: 'var(--text-muted)', fontSize: 13 }}>{text}</Card>;
}

// Standard data-resource hook: load on mount + expose { data, loading, error, reload }.
// fetcher must be stable (define with useCallback in the page) or pass-through here.
export function useCcResource(fetcher) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const inFlight = React.useRef(false);
  const fnRef = React.useRef(fetcher);
  fnRef.current = fetcher;

  const reload = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}
