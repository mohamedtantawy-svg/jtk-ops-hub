// ── CapacityPlanningView (Phase 0/1 — 2026-06-01) ────────────────────────
// Leaders Hub → Capacity sub-tab. Phase 0 shipped the shell + skeleton
// API. Phase 1 lights up the Country Workload view with live demand from
// the connected Deel sources, sortable on every column. Phases 2-3 wire
// the Capacity (Current) + Team Summary views; Phase 4 adds the settings
// drawer (gear icon); Phase 5 adds the proposed scenarios surface; Phase
// 6 the CSV export.
//
// Per CAPACITY_PLANNING_PLAN.md: every read is dept-scoped via the
// /leader-reports/capacity route, which uses getCurrentDeptSlugAndId so
// HRX/GIX/Payroll/Benefits each get their own capacity surface.
//
// Mirror layout tokens from FeedbackView / HrHubView (skill §3.13 — the
// in-app board layout reference) so the surface feels native.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import CapacityCountryWorkloadTable from './CapacityCountryWorkloadTable';
import CapacityMembersCurrentTable from './CapacityMembersCurrentTable';
import CapacityTeamSummaryTable from './CapacityTeamSummaryTable';

const VIEWS = [
  { id: 'workload', label: 'Country Workload',  icon: 'bi-globe-europe-africa' },
  { id: 'current',  label: 'Capacity (Current)', icon: 'bi-people-fill' },
  { id: 'proposed', label: 'Proposed Scenario',  icon: 'bi-lightning-charge-fill' },
  { id: 'summary',  label: 'Team Summary',       icon: 'bi-bar-chart-fill' },
];

export default function CapacityPlanningView({ onBack }) {
  const { dept: currentDept } = useCurrentDept();
  const currentDeptSlug = currentDept?.slug || null;
  const [view, setView] = useState('workload');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // bustCache=true forces the aggregator to refetch every source (skips
  // the 15-min in-process cache on the server). Used by the refresh
  // button; the initial mount goes through the cache.
  const load = useCallback(async (opts = {}) => {
    const { bustCache = false } = opts;
    if (bustCache) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const url = bustCache ? '/leader-reports/capacity?bustCache=1' : '/leader-reports/capacity';
      const res = await apiFetch(url);
      setData(res);
    } catch (err) {
      setError(err?.message || 'Could not load capacity data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // GIX-only: the aggregator returns the `immig` bucket for the GIX dept
  // only; for HRX/Payroll/Benefits the column is hidden so the table
  // doesn't grow a column of zeros.
  const showImmigColumn = currentDeptSlug === 'gix';

  return (
    <div style={page}>
      <style>{`
        .cap-view-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
        .cap-empty-card {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 64px 24px; text-align: center;
          background: var(--surface); border: 1px solid var(--border-light); border-radius: 14px;
          color: var(--text-muted);
        }
      `}</style>

      {/* Hero header — mirrors FeedbackView/HrHubView pattern */}
      <div style={pageHead}>
        {onBack && (
          <button type="button" onClick={onBack} style={iconBtn} aria-label="Back to Reports">
            <i className="bi-arrow-left" style={{ fontSize: 14 }} />
          </button>
        )}
        <div style={{
          width: 40, height: 40, borderRadius: 12, background: '#eef2ff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <i className="bi-speedometer2" style={{ fontSize: 18, color: '#4f46e5' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
            Capacity Planning
            {currentDept?.name && (
              <span style={{
                marginLeft: 10, fontSize: 11, fontWeight: 600,
                color: 'var(--text-muted)',
                padding: '3px 8px', borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border-light)',
                verticalAlign: 'middle',
              }}>
                {currentDept.name}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Live demand by country, per-member load, and what-if scenarios — modelled on Kristina Fomina's audit framework.
          </div>
        </div>
        <button
          type="button"
          onClick={() => load({ bustCache: true })}
          style={iconBtn}
          aria-label="Refresh"
          title="Refresh — bypasses the 15-min cache"
          disabled={refreshing || loading}
        >
          <i
            className="bi-arrow-clockwise"
            style={{ fontSize: 14, animation: refreshing ? 'spin 1s linear infinite' : 'none' }}
          />
        </button>
      </div>

      {/* View switch */}
      <div style={scopeRow}>
        <div className="cap-view-tabs" role="tablist" aria-label="Capacity views">
          {VIEWS.map(v => {
            const isActive = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setView(v.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10,
                  border: '1px solid ' + (isActive ? '#4f46e5' : 'var(--border)'),
                  background: isActive ? '#eef2ff' : 'var(--surface)',
                  color: isActive ? '#4f46e5' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: isActive ? 700 : 600,
                  fontFamily: 'inherit', cursor: 'pointer',
                  transition: 'all .12s',
                }}
              >
                <i className={v.icon} style={{ fontSize: 13 }} />
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 40px' }}>
        {loading && (
          <div className="cap-empty-card">
            <i className="bi-arrow-clockwise" style={{ fontSize: 24, marginBottom: 12, animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 13 }}>Loading capacity…</div>
          </div>
        )}

        {!loading && error && (
          <div className="cap-empty-card" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
            <i className="bi-exclamation-triangle-fill" style={{ fontSize: 24, marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>Could not load capacity</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>{error}</div>
            <button type="button" onClick={() => load()} style={{ ...primaryBtn, marginTop: 14 }}>Try again</button>
          </div>
        )}

        {!loading && !error && data && view === 'workload' && (
          <CapacityCountryWorkloadTable
            rows={data.countryWorkload || []}
            showImmigColumn={showImmigColumn}
            cachedAt={data.workloadCachedAt}
          />
        )}

        {!loading && !error && data && view === 'current' && (
          <CapacityMembersCurrentTable
            members={data.membersCurrent || []}
            leads={data.membersLeads || {}}
            settings={data.settings}
          />
        )}

        {!loading && !error && data && view === 'summary' && (
          <CapacityTeamSummaryTable teams={data.teamSummary || []} />
        )}

        {!loading && !error && data && view === 'proposed' && (
          <div className="cap-empty-card">
            <i className="bi-lightning-charge-fill" style={{ fontSize: 28, marginBottom: 12, color: 'var(--text-disabled)' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Proposed Scenario</div>
            <div style={{ fontSize: 12, marginTop: 6, maxWidth: 460 }}>
              Phase 5 ships the drag-and-drop what-if scenarios — rebalance countries between members and watch the signals update live.
            </div>
            {data?.settings && (
              <div style={{ fontSize: 11, marginTop: 16, color: 'var(--text-muted)' }}>
                Defaults loaded: {data.settings.workingDays} working days · {data.settings.minutesPerTask} min/task · {data.settings.minutesPerCall} min/call · {data.settings.baselineCallHrs}h baseline calls
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tokens — verbatim copy of HrHubView/FeedbackView tokens (skill §3.13) ──
const page = {
  flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
  background: 'var(--bg)', overflowY: 'hidden',
};
const pageHead = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '20px 28px 12px',
  flexShrink: 0,
};
const scopeRow = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '4px 28px 16px',
  borderBottom: '1px solid var(--border-light)',
  background: 'var(--bg)',
  flexShrink: 0,
};
const iconBtn = {
  width: 32, height: 32, borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-secondary)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', fontFamily: 'inherit',
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)', fontFamily: 'inherit',
};
