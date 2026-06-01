// ── LeaderReportsView ─────────────────────────────────────────────────
// Leaders Hub → Reports sub-tab. Lists the available reports as cards on
// the landing page; clicking a card drills into the specific report
// component. Built to grow — new reports just add a new entry to the
// REPORTS catalogue + a new component import.
//
// Deep-link: ?report=<id> in the URL (read in the useState initialiser
// so a hard refresh on a deep link lands on the right report; skill
// mistake #31).
//
// First report: SLA Extension (Jose Ruales feedback 2026-05-30).
// Second report: Productivity (Sarah Suge feedback 2026-05) — tasks
// resolved per team per category over a selected time period.

import { useCallback, useEffect, useState } from 'react';
import SlaExtensionReport from './SlaExtensionReport';
import ProductivityReport from './ProductivityReport';

// Each entry is a self-describing card. To add a report:
//   1. Drop the component file next to this one.
//   2. Add a row here with id / title / description / icon / accent / Component.
// The landing grid + the deep-link router both pick it up automatically.
const REPORTS = [
  {
    id: 'productivity',
    title: 'Productivity Report',
    description: 'Tasks resolved per team per category over a chosen time period. KPIs, stacked-bar team breakdown, daily trend, and a top-performers leaderboard — dept-scoped + CSV exportable.',
    icon: 'bi-trophy-fill',
    accent: '#0d9488',
    accentBg: '#ecfdf5',
    Component: ProductivityReport,
  },
  {
    id: 'sla-extension',
    title: 'SLA Extension Report',
    description: 'Days requested, manager decisions, top requesters, note compliance, and category breakdown for the SLA extension workflow.',
    icon: 'bi-graph-up-arrow',
    accent: '#7c3aed',
    accentBg: '#f5f3ff',
    Component: SlaExtensionReport,
  },
];

function readReportFromUrl() {
  if (typeof window === 'undefined') return null;
  try {
    const id = new URL(window.location.href).searchParams.get('report');
    if (!id) return null;
    return REPORTS.find(r => r.id === id) ? id : null;
  } catch { return null; }
}

function writeReportToUrl(id) {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('report', id);
    else u.searchParams.delete('report');
    window.history.replaceState({}, '', u.toString());
  } catch {}
}

export default function LeaderReportsView() {
  // Read the deep-link in the initialiser so the first paint is correct.
  const [activeId, setActiveId] = useState(() => readReportFromUrl());

  useEffect(() => { writeReportToUrl(activeId); }, [activeId]);

  // Respond to back/forward navigation so the browser's history works.
  useEffect(() => {
    const onPop = () => setActiveId(readReportFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleBack = useCallback(() => setActiveId(null), []);

  const active = activeId ? REPORTS.find(r => r.id === activeId) : null;
  if (active) {
    const C = active.Component;
    return <C onBack={handleBack} />;
  }

  // ── Landing — grid of report cards ──────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden', background: 'var(--surface-2)' }}>
      <style>{`
        .lrv-reports-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        @media (max-width: 980px) { .lrv-reports-grid { grid-template-columns: 1fr; } }
        .lrv-card { transition: all .15s; }
        .lrv-card:hover { transform: translateY(-1px); border-color: var(--purple, #7c3aed); box-shadow: 0 6px 16px -8px rgba(0,0,0,0.12); }
      `}</style>

      {/* Hero */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '20px 28px 12px 28px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: '#f5f3ff', color: '#7c3aed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className="bi-bar-chart-line-fill" style={{ fontSize: 20 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>Reports</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Analytics across HR Hub workflows — scoped to your department.
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 32px' }}>
        <div className="lrv-reports-grid">
          {REPORTS.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveId(r.id)}
              className="lrv-card"
              style={{
                textAlign: 'left',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: '18px 18px 20px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: r.accentBg, color: r.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <i className={r.icon} style={{ fontSize: 20 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{r.title}</div>
                </div>
                <i className="bi-arrow-right" style={{ fontSize: 16, color: 'var(--text-muted)' }} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {r.description}
              </div>
            </button>
          ))}

          {/* Hint card for future additions */}
          <div style={{
            border: '1px dashed var(--border)',
            borderRadius: 14,
            padding: '20px 18px',
            color: 'var(--text-muted)',
            fontSize: 12,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            minHeight: 120,
          }}>
            <div>
              <i className="bi-plus-circle" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
              More reports coming soon
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
