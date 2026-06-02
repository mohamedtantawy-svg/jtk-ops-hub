'use client';

// ── Command Center (Phase 0 — 2026-06-03) ───────────────────────────────────
// Executive cross-department oversight for CEO / VP Ops / COO. Phase 0 is the
// gated shell: it proves the live connection to EVERY department (enumerated
// from org_nodes via /api/v1/command-center/overview, so it adapts when depts
// change) and lays the executive layout the metric panels (Health, SLA, Volume,
// Capacity, People, Risk) drop into across later phases.
//
// Read-only. All theme-dependent colours use CSS vars so dark mode is intact
// from day one (skill rule #30 / mistake #8). All hooks sit ABOVE every early
// return (skill §4.7 / mistake #43).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getCommandCenterOverview } from '../../services/commandCenterApi';

const ACCENT = 'var(--purple, #7c3aed)';

// Metric panels that land in later phases — shown as an honest roadmap on each
// department card + the section header so the Phase 0 shell never pretends to
// have numbers it doesn't yet compute.
const UPCOMING_PANELS = [
  { phase: 1, label: 'Health & scorecards' },
  { phase: 2, label: 'SLA & breaches' },
  { phase: 3, label: 'Volume & throughput' },
  { phase: 4, label: 'Capacity & load' },
  { phase: 5, label: 'People & coverage' },
  { phase: 6, label: 'Risk & escalations' },
];

function StatTile({ label, value, icon }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        background: 'var(--surface-2)', color: ACCENT,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
      }}>
        <i className={`bi ${icon}`} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

function DeptCard({ dept }) {
  const accent = dept.color || ACCENT;
  const initial = (dept.name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      padding: 18, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: `${accent}1f`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700,
        }}>{initial}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }} title={dept.name}>{dept.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {dept.headcount} {dept.headcount === 1 ? 'person' : 'people'}
            {dept.teamCount > 0 ? ` · ${dept.teamCount} ${dept.teamCount === 1 ? 'team' : 'teams'}` : ''}
          </div>
        </div>
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
        borderTop: '1px solid var(--border-light, var(--border))', paddingTop: 10,
      }}>
        <i className="bi bi-hourglass-split" style={{ marginRight: 6, opacity: 0.7 }} />
        Health · SLA · volume · capacity — wiring in upcoming phases
      </div>
    </div>
  );
}

export default function CommandCenterView({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await getCommandCenterOverview();
      setData(res || { departments: [], totals: {} });
    } catch (err) {
      setError(err);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const departments = data?.departments || [];
  const totals = data?.totals || {};

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 0 48px' }}>
      <style>{`
        .cc-dept-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        @media (max-width: 1100px) { .cc-dept-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 720px)  { .cc-dept-grid { grid-template-columns: 1fr; } }
        .cc-stat-row { display: flex; gap: 14px; flex-wrap: wrap; }
        .cc-skel { animation: cc-pulse 1.2s ease-in-out infinite; }
        @keyframes cc-pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
      `}</style>

      {/* Hero */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 0 16px' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, backgroundColor: ACCENT, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,.08))',
        }}>
          <i className="bi bi-speedometer2" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Command Center</h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Cross-department operational oversight
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
          fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
          color: ACCENT, background: 'var(--surface-2)', border: '1px solid var(--border)',
          padding: '5px 10px', borderRadius: 999,
        }}>
          <i className="bi bi-shield-lock" /> Executive view
        </span>
        <button
          type="button"
          onClick={() => load()}
          aria-label="Refresh"
          title="Refresh"
          disabled={loading}
          style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0, cursor: loading ? 'default' : 'pointer',
            background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.5 : 1,
          }}
        >
          <i className={`bi bi-arrow-clockwise${loading ? ' cc-skel' : ''}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24,
          textAlign: 'center', color: 'var(--text-secondary)',
        }}>
          <div style={{ fontSize: 28, color: '#d97706', marginBottom: 8 }}><i className="bi bi-exclamation-triangle" /></div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {error.status === 403 ? 'Command Center access required' : 'Couldn’t load the Command Center'}
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {error.status === 403
              ? 'This executive view is limited to leadership. Ask an admin for Command Center access.'
              : 'The overview didn’t load. This is the only place to retry.'}
          </div>
          {error.status !== 403 && (
            <button
              type="button"
              onClick={() => load()}
              style={{
                marginTop: 14, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                background: ACCENT, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600,
              }}
            >Retry</button>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !error && (
        <div className="cc-skel">
          <div className="cc-stat-row" style={{ marginBottom: 20 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: '1 1 0', height: 70, background: 'var(--surface-2)', borderRadius: 14, border: '1px solid var(--border)' }} />
            ))}
          </div>
          <div className="cc-dept-grid">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ height: 132, background: 'var(--surface-2)', borderRadius: 14, border: '1px solid var(--border)' }} />
            ))}
          </div>
        </div>
      )}

      {/* Loaded */}
      {!loading && !error && (
        <>
          <div className="cc-stat-row" style={{ marginBottom: 22 }}>
            <StatTile label="Departments" value={totals.departmentCount ?? departments.length} icon="bi-diagram-3" />
            <StatTile label="Teams" value={totals.teamCount ?? 0} icon="bi-people" />
            <StatTile label="People" value={totals.headcount ?? 0} icon="bi-person-badge" />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Departments</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <i className="bi bi-broadcast" style={{ marginRight: 5, color: '#15803d' }} />
              Live from the Org tab — adapts automatically as departments change
            </span>
          </div>

          {departments.length === 0 ? (
            <div style={{
              background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14,
              padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
            }}>
              No active departments found yet. Create one in the Org tab and it will appear here.
            </div>
          ) : (
            <div className="cc-dept-grid">
              {departments.map(d => <DeptCard key={d.id} dept={d} />)}
            </div>
          )}

          {/* Honest roadmap — what the executive panels will be */}
          <div style={{
            marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
              Executive reports — rolling out
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
              The Command Center is connected to every department above. Cross-department
              performance panels are being added phase by phase — each aggregates the same
              data each team already runs on, rolled up for leadership.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {UPCOMING_PANELS.map(p => (
                <span key={p.phase} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500,
                  color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)',
                  padding: '5px 10px', borderRadius: 999,
                }}>
                  <i className="bi bi-hourglass-split" style={{ opacity: 0.6 }} /> {p.label}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
