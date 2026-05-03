// ── HrHubView ───────────────────────────────────────────────────────────────
// 2026-05-02 redesign: matches the Feedback board's information density.
// Hero header (icon + title + subtitle + primary New-request button), a
// segmented scope toggle with inline count badges, four large status
// filter cards in a responsive grid, and a compact filter bar that pairs
// flow-type pill chips with search / refresh / settings.
//
// The previous flat header + tab strip burned ~250 px before the first
// row even rendered. The new layout puts the four status cards right
// under the hero, makes the filter row a single line, and tightens row
// padding — net effect is roughly twice the rows visible above the fold
// at 1440 px while the surface still looks polished.
//
// Detail drawer + Settings panel integrations are unchanged. The HR Hub
// composer continues to open via the global `+` button picker (see
// CreateHrHubRequestModal). Comments + Slack-style mention/emoji land in
// HrHubDetailPanel (Stage 4).

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  listHrHubRequests,
  getHrHubRequest,
} from '../../services/hrHubApi';
import { approveHideTask } from '../../services/hideTaskApi';
import HrHubDetailPanel from '../hr-hub/HrHubDetailPanel';
import HrHubSettingsPanel from '../hr-hub/HrHubSettingsPanel';
import DenyHideTaskModal from '../modals/DenyHideTaskModal';
import { PermissionsContext, IntegrationsContext } from '../../App';

// Single source of truth for status visuals — same shape as Feedback's
// STATUS_FILTERS so the four buttons feel identical across the two tabs.
const STATUS_FILTERS = [
  { value: 'new',         label: 'New',         icon: 'bi-circle-fill',          color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { value: 'in_progress', label: 'In Progress', icon: 'bi-arrow-repeat',         color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  { value: 'on_hold',     label: 'On Hold',     icon: 'bi-pause-circle-fill',    color: '#737373', bg: '#f5f5f4', tint: '#e7e5e4' },
  { value: 'resolved',    label: 'Resolved',    icon: 'bi-check-circle-fill',    color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
];
const STATUS_BY_VALUE = Object.fromEntries(STATUS_FILTERS.map(s => [s.value, s]));

// Per-flow visuals mirror the create-modal cards so the surface feels
// consistent — same icon + accent across the picker, the row chip, and
// the flow filter pill.
const FLOW_VISUALS = {
  hr_request:        { label: 'HR Request',       short: 'Request',     icon: 'bi-send-fill',         color: '#1f74b3', bg: '#e0f2fe' },
  hr_reporting:      { label: 'HR Reporting',     short: 'Reporting',   icon: 'bi-megaphone-fill',    color: '#dc2626', bg: '#fef2f2' },
  escalation_zero:   { label: 'Escalation Zero',  short: 'Escalation',  icon: 'bi-stars',             color: '#7c3aed', bg: '#f3eff8' },
  feedback:          { label: 'Ops Hub Feedback', short: 'Feedback',    icon: 'bi-lightbulb-fill',    color: '#d97706', bg: '#fff8e6' },
  hide_task_request: { label: 'Hide Task',        short: 'Hide Task',   icon: 'bi-eye-slash-fill',    color: '#d42d35', bg: '#fef2f2' },
};
const FLOW_FILTERS = [
  { value: 'all',                label: 'All flows',  icon: 'bi-grid-fill',         color: 'var(--text)' },
  { value: 'hr_request',         label: 'Requests',   icon: 'bi-send-fill',          color: '#1f74b3' },
  { value: 'hr_reporting',       label: 'Reporting',  icon: 'bi-megaphone-fill',     color: '#dc2626' },
  { value: 'escalation_zero',    label: 'Escalations', icon: 'bi-stars',             color: '#7c3aed' },
  { value: 'feedback',           label: 'Feedback',   icon: 'bi-lightbulb-fill',     color: '#d97706' },
  { value: 'hide_task_request',  label: 'Hide Task',  icon: 'bi-eye-slash-fill',     color: '#d42d35' },
];

const PRIORITY_DOT = {
  low:      '#9b928a',
  medium:   '#0ea5e9',
  high:     '#f59e0b',
  critical: '#dc2626',
};

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'new',     label: 'Newest' },
  { value: 'oldest',  label: 'Oldest' },
];

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isManagerRole(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = user.access || user.accessTypeName || '';
  if (typeof access === 'string') {
    const lc = access.toLowerCase();
    if (lc.includes('admin') || lc.includes('lead') || lc.includes('manager')) return true;
  }
  return false;
}

export default function HrHubView({ user, onCreateHrHub }) {
  const perms = useContext(PermissionsContext);
  const integrations = useContext(IntegrationsContext);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [denyModalReq, setDenyModalReq] = useState(null);
  const [decisionError, setDecisionError] = useState(null);
  const initialReqId = (() => {
    try {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      return url?.searchParams.get('req') || null;
    } catch { return null; }
  })();

  // ── Filters & toggles ─────────────────────────────────────────────────────
  const isManager = isManagerRole(user);
  const [scope, setScope] = useState('mine');
  const [flowFilter, setFlowFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState(null);          // null = all statuses
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('updated');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ── Data ─────────────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const reqSeqRef = useRef(0);
  const flowQuery = flowFilter === 'all' ? null : flowFilter;

  const loadFirstPage = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);
    // Retry-once-on-5xx — the 2026-05-03 live audit (F12) caught HR Hub
    // wedging on "Loading…" with a transient 503 from the deploy pod-warm
    // tail-end (skill §6.6). One immediate retry gives the upstream pod
    // ~600ms to recover before we surface the error and clear cached items.
    const tryFetch = async () => listHrHubRequests({
      flow: flowQuery,
      scope,
      status: statusFilter || undefined,
      search: debouncedSearch || undefined,
      limit: 25,
    });
    try {
      let res;
      try {
        res = await tryFetch();
      } catch (err) {
        const msg = String(err?.message || '');
        const transient = /\b(5\d\d|timeout|abort|network)\b/i.test(msg);
        if (!transient) throw err;
        await new Promise(r => setTimeout(r, 600));
        if (seq !== reqSeqRef.current) return;
        res = await tryFetch();
      }
      if (seq !== reqSeqRef.current) return;
      setItems(res?.items || []);
      setCursor(res?.nextCursor || null);
      setLastSyncAt(Date.now());
    } catch (err) {
      if (seq !== reqSeqRef.current) return;
      setError(err?.message || 'Could not load requests');
      setItems([]);
      setCursor(null);
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }, [flowQuery, scope, statusFilter, debouncedSearch]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listHrHubRequests({
        flow: flowQuery,
        scope,
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        cursor,
        limit: 25,
      });
      setItems(prev => [...prev, ...(res?.items || [])]);
      setCursor(res?.nextCursor || null);
    } catch (err) {
      setError(err?.message || 'Could not load more');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, flowQuery, scope, statusFilter, debouncedSearch, loadingMore]);

  // ── Counts for status cards + scope toggle ─────────────────────────────
  // Both reflect the *current* scope + flow filter so badges stay in sync
  // with whatever the user's looking at. We don't filter for this — we
  // ask the server for the unfiltered (by status) set under the same
  // scope/flow, then count locally. Cheap because the page size is 25 +
  // the four status totals fit a single round-trip.
  const [statusCounts, setStatusCounts] = useState({ new: 0, in_progress: 0, on_hold: 0, resolved: 0, total: 0 });
  const [scopeCounts, setScopeCounts] = useState({ mine: null, team: null, all: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listHrHubRequests({
          flow: flowQuery,
          scope,
          search: debouncedSearch || undefined,
          limit: 100,
        });
        if (cancelled) return;
        const counts = { new: 0, in_progress: 0, on_hold: 0, resolved: 0, total: (r?.items || []).length };
        for (const it of r?.items || []) {
          if (counts[it.status] != null) counts[it.status]++;
        }
        setStatusCounts(counts);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [flowQuery, scope, debouncedSearch]);

  // Scope counts run once per flow change — three small queries.
  useEffect(() => {
    let cancelled = false;
    const scopes = isManager ? ['mine', 'team', 'all'] : ['mine', 'all'];
    (async () => {
      const out = { mine: null, team: null, all: null };
      for (const sc of scopes) {
        try {
          const r = await listHrHubRequests({ flow: flowQuery, scope: sc, limit: 100 });
          if (cancelled) return;
          out[sc] = (r?.items || []).length;
        } catch { /* swallow */ }
      }
      if (!cancelled) setScopeCounts(out);
    })();
    return () => { cancelled = true; };
  }, [flowQuery, isManager]);

  // Local sort — server returns newest-first by default; we re-sort client-side
  // for the small page (25 rows) so toggling sort doesn't refetch.
  const sortedItems = useMemo(() => {
    const list = [...items];
    if (sort === 'updated') list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    else if (sort === 'new') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return list;
  }, [items, sort]);

  // ── Detail drawer state ──────────────────────────────────────────────────
  const [detailId, setDetailId] = useState(initialReqId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await getHrHubRequest(id);
      setDetail(res);
    } catch (err) {
      setDetailError(err?.message || 'Could not load request');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDetail(detailId);
    try {
      const url = new URL(window.location.href);
      if (detailId) url.searchParams.set('req', detailId);
      else url.searchParams.delete('req');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, [detailId, loadDetail]);

  const refreshDetail = useCallback(() => {
    if (detailId) loadDetail(detailId);
  }, [detailId, loadDetail]);

  const onItemUpdated = useCallback((updated) => {
    if (!updated) return;
    setItems(prev => prev.map(it => it.id === updated.id ? { ...it, ...updated } : it));
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={page}>
      <style>{`
        .hrhub-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 900px) { .hrhub-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .hrhub-row:hover { border-color: var(--border-light); background: var(--surface-2); }
      `}</style>

      {/* Hero header */}
      <div style={pageHead}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: '#f3eff8', color: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="bi-broadcast-pin" style={{ fontSize: 20 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>HR Hub</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              HR Requests, Reporting, Escalation Zero, and Ops Hub Feedback in one place.
              {lastSyncAt && <> · synced {relTime(new Date(lastSyncAt).toISOString())}</>}
            </div>
          </div>
        </div>
        <button
          onClick={() => onCreateHrHub?.()}
          style={primaryBtn}
        >
          <i className="bi-plus-circle-fill" style={{ fontSize: 13 }} /> New request
        </button>
      </div>

      {/* Scope toggle (My / Team / All) with count badges */}
      <div style={scopeRow}>
        <div role="tablist" aria-label="Request scope" style={segmentedControl}>
          {(isManager
            ? [{ value: 'mine', label: 'My Requests' }, { value: 'team', label: 'Team Requests' }, { value: 'all', label: 'All Requests' }]
            : [{ value: 'mine', label: 'My Requests' }, { value: 'all', label: 'All Requests' }]
          ).map(seg => {
            const active = scope === seg.value;
            const cnt = scopeCounts[seg.value];
            return (
              <button
                key={seg.value}
                role="tab"
                aria-selected={active}
                onClick={() => setScope(seg.value)}
                style={{ ...segmentBtn, ...(active ? segmentBtnActive : null) }}
              >
                {seg.label}
                {cnt != null && (
                  <span style={{ ...segmentCount, ...(active ? segmentCountActive : null) }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4 large status cards */}
      <div className="hrhub-status-grid" style={{ marginBottom: 12 }}>
        {STATUS_FILTERS.map(f => {
          const active = statusFilter === f.value;
          const cnt = statusCounts[f.value] || 0;
          return (
            <button
              key={f.value}
              onClick={() => setStatusFilter(active ? null : f.value)}
              aria-pressed={active}
              style={{
                ...statusFilterBtn,
                background: active ? f.bg : 'var(--surface)',
                borderColor: active ? f.tint : 'var(--border)',
                boxShadow: active ? `0 0 0 1px ${f.tint} inset, 0 1px 0 rgba(15,23,42,0.02)` : '0 1px 0 rgba(15,23,42,0.02)',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = f.bg; e.currentTarget.style.borderColor = f.tint; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 8,
                background: active ? f.color : f.bg,
                color: active ? 'white' : f.color,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background .12s, color .12s',
              }}>
                <i className={f.icon} style={{ fontSize: 13 }} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : 'var(--text)', whiteSpace: 'nowrap' }}>{f.label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)' }}>
                  {cnt} {cnt === 1 ? 'request' : 'requests'}
                </span>
              </span>
              <span style={{
                fontSize: 16, fontWeight: 800,
                color: active ? f.color : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 'auto',
              }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar — flow chips on the left, search/sort/refresh/settings on the right */}
      <div style={filterBar}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {FLOW_FILTERS.map(f => {
            const active = flowFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFlowFilter(f.value)}
                style={{
                  ...filterPill,
                  ...(active ? { ...filterPillActive, background: f.value === 'all' ? 'var(--surface-3)' : (FLOW_VISUALS[f.value]?.bg || 'var(--surface-3)'), color: f.color, borderColor: f.color } : null),
                }}
                aria-pressed={active}
                title={f.label}
              >
                <i className={f.icon} style={{ fontSize: 11, color: f.color }} /> {f.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ width: 220, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
          >
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={() => loadFirstPage()} title="Refresh" style={iconBtn}>
            <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 13, color: 'var(--text-muted)' }} />
          </button>
          {perms?.canManageHrHub && (
            <button onClick={() => setSettingsOpen(true)} title="HR Hub Settings" style={iconBtn}>
              <i className="bi-gear" style={{ fontSize: 13, color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 4 }}>
        {loading && items.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>
            {error}
          </div>
        )}
        {!loading && !error && sortedItems.length === 0 && (
          <EmptyState scope={scope} flowFilter={flowFilter} statusFilter={statusFilter} />
        )}
        {decisionError && (
          <div role="alert" style={{ padding: '8px 12px', marginBottom: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
            <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />{decisionError}
          </div>
        )}
        {sortedItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortedItems.map(item => (
              <RequestRow
                key={item.id}
                item={item}
                active={detailId === item.id}
                onClick={() => setDetailId(item.id)}
                viewerEmail={user?.email}
                isManager={isManager}
                isAdmin={isManager && (user?.role === 'admin' || (user?.access || '').toLowerCase().includes('admin'))}
                onApprove={async (it) => {
                  setDecisionError(null);
                  try {
                    await approveHideTask(it.id);
                    // Refresh the global hide list so the queue render path
                    // picks up the new entry on the next render. Then reload
                    // this view so the row flips to "resolved" status.
                    try { integrations?.hiddenTasks?.refresh?.(); } catch {}
                    loadFirstPage();
                  } catch (err) {
                    setDecisionError(err?.message || 'Approval failed');
                  }
                }}
                onDeny={(it) => setDenyModalReq(it)}
              />
            ))}
            {cursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  alignSelf: 'center', marginTop: 6,
                  padding: '8px 16px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 13, fontWeight: 500,
                  cursor: loadingMore ? 'wait' : 'pointer',
                }}
              >{loadingMore ? 'Loading more…' : 'Load more'}</button>
            )}
          </div>
        )}
      </div>

      {settingsOpen && <HrHubSettingsPanel onClose={() => setSettingsOpen(false)} />}
      {detailId && (
        <HrHubDetailPanel
          requestId={detailId}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          user={user}
          onClose={() => setDetailId(null)}
          onRefresh={refreshDetail}
          onItemUpdated={onItemUpdated}
        />
      )}
      {denyModalReq && (
        <DenyHideTaskModal
          request={denyModalReq}
          onClose={() => setDenyModalReq(null)}
          onDenied={() => {
            setDenyModalReq(null);
            loadFirstPage();
          }}
        />
      )}
    </div>
  );
}

// Reason-code → short label, used by the hide-task row meta line.
const HIDE_REASON_LABELS = {
  internal_deel_employee: 'Internal Deel Employee',
  test_task: 'Test Task',
  other: 'Other',
};

// ── Row ────────────────────────────────────────────────────────────────────
// Single-line layout matching Feedback's row density: priority dot on
// the far left, flow chip + status pill + meta line in the middle, a
// metadata cluster on the right (attachments / time / chevron).
//
// Hide-task flow rows ALSO render inline Approve/Deny buttons next to the
// status pill — visible only while the request is unresolved. The buttons
// stop propagation so the row click (→ open detail) still works for the
// rest of the row surface.
function RequestRow({ item, active, onClick, viewerEmail, isManager, isAdmin, onApprove, onDeny }) {
  const flow = FLOW_VISUALS[item.flow] || FLOW_VISUALS.hr_request;
  const status = STATUS_BY_VALUE[item.status] || STATUS_BY_VALUE.new;
  const priColor = PRIORITY_DOT[item.priority] || PRIORITY_DOT.medium;
  const isHide = item.flow === 'hide_task_request';
  const hideMeta = isHide
    ? [HIDE_REASON_LABELS[item.requestType] || item.requestType, item.taskSubject].filter(Boolean).join(' · ')
    : '';
  const meta = isHide
    ? hideMeta
    : [item.functionArea, item.requestType || item.reportType].filter(Boolean).join(' · ');
  // Manager-side decision affordance: visible on every pending hide
  // request to ANY manager (TL / RM / admin). The denormalised
  // `team_lead_email` is the routing target, but live audit 2026-05-04
  // showed the row stuck pending whenever the requester's TL was unset
  // or the routing was wrong, with no fallback path. Broadening the gate
  // to any manager guarantees a human can always action the request.
  // Self-decision is the one hard block — true 4-eyes principle, applied
  // uniformly across roles (no admin override). Backend mirrors this rule
  // (see /api/v1/hide-task/[id]/{approve,deny}).
  const viewerLc = (viewerEmail || '').toLowerCase();
  const canDecide = isHide
    && item.status !== 'resolved'
    && !!isManager
    && (item.createdByEmail || '').toLowerCase() !== viewerLc;

  return (
    <button
      className="hrhub-row"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: active ? 'var(--surface-2)' : 'var(--surface)',
        border: '1px solid ' + (active ? 'var(--border)' : 'var(--border-light)'),
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s',
        textAlign: 'left',
        minWidth: 0,
      }}
      title={item.title || item.summary || ''}
    >
      {/* Priority dot (semantic, not a button) */}
      <span style={{
        width: 8, height: 8, borderRadius: 999,
        background: priColor,
        flexShrink: 0,
      }} aria-label={`Priority ${item.priority || 'medium'}`} />

      {/* Flow chip — small icon-only square */}
      <span style={{
        width: 24, height: 24, borderRadius: 6,
        background: flow.bg, color: flow.color,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }} title={flow.label}>
        <i className={flow.icon} style={{ fontSize: 11 }} />
      </span>

      {/* Center: title + meta */}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
        <span style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title || (item.summary || '').slice(0, 140) || '(untitled)'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600, color: flow.color }}>{flow.short}</span>
          {meta ? ` · ${meta}` : ''}
          {item.assigneeName ? ` · ${item.assigneeName}` : ''}
          {item.createdByName && !item.assigneeName ? ` · ${item.createdByName}` : ''}
        </span>
      </span>

      {/* Right: status pill + meta cluster */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {canDecide && (
          <span
            // Render the two buttons as a plain span (NOT nested button) —
            // wrapping <button> inside a <button>.hrhub-row is invalid HTML
            // and React 19 logs a warning. We split out Approve/Deny as
            // standalone clickables and stop propagation so the row click
            // (→ open detail) still fires for the surrounding surface.
            role="group"
            aria-label="Approve or deny hide request"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onApprove?.(item); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onApprove?.(item); } }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: '#15803d', color: 'white',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Approve and hide this task globally"
            >
              <i className="bi-check2" style={{ fontSize: 11 }} />Approve
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDeny?.(item); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onDeny?.(item); } }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: 'white', color: '#d42d35',
                border: '1px solid #fca5a5',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Deny — task stays in the queue"
            >
              <i className="bi-x" style={{ fontSize: 11 }} />Deny
            </span>
          </span>
        )}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 700,
          padding: '3px 9px', borderRadius: 999,
          background: status.bg, color: status.color,
        }}>
          <i className={status.icon} style={{ fontSize: 9 }} />
          {status.label}
        </span>
        {item.attachmentCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <i className="bi-paperclip" style={{ fontSize: 11 }} /> {item.attachmentCount}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 56, textAlign: 'right' }}>
          {relTime(item.updatedAt || item.createdAt)}
        </span>
      </span>
    </button>
  );
}

function EmptyState({ scope, flowFilter, statusFilter }) {
  let title = 'No requests yet';
  let body = 'Hit the New request button in the header to submit one.';
  if (statusFilter) {
    const s = STATUS_BY_VALUE[statusFilter];
    title = `No ${s?.label?.toLowerCase() || statusFilter} requests`;
    body = 'Try clearing the status filter or widening the scope.';
  } else if (scope === 'mine') {
    title = 'Nothing on your plate yet';
    body = 'Hit New request in the header to submit one.';
  } else if (flowFilter !== 'all') {
    title = `No ${FLOW_VISUALS[flowFilter]?.label || flowFilter} yet`;
    body = 'Switch the flow filter or hit New request to add one.';
  }
  return (
    <div style={{
      padding: '40px 20px', textAlign: 'center',
      border: '1px dashed var(--border)', borderRadius: 12,
      color: 'var(--text-muted)', fontSize: 13,
      background: 'var(--surface)',
    }}>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>{title}</div>
      <div style={{ marginTop: 4 }}>{body}</div>
    </div>
  );
}

// ── Style tokens (copy of Feedback's so the two surfaces stay in sync) ────
const page = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 24px 24px', background: 'var(--bg)' };
const pageHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '20px 0 12px' };
const scopeRow = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 };
const segmentedControl = { display: 'inline-flex', padding: 3, borderRadius: 128, background: 'var(--surface-2)', border: '1px solid var(--border-light)', gap: 2 };
const segmentBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 128, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const segmentBtnActive = { background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', fontWeight: 700 };
const segmentCount = { padding: '0 7px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: 'rgba(15,23,42,0.06)', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center', lineHeight: '16px' };
const segmentCountActive = { background: '#7c3aed', color: 'white' };
const statusFilterBtn = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', transition: 'all .15s', textAlign: 'left', minWidth: 0 };
const filterBar = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border-light)', marginBottom: 10, flexWrap: 'wrap' };
const filterPill = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 128, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const filterPillActive = { background: 'var(--surface-3)', color: 'var(--text)', borderColor: 'var(--text)' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)' };
const iconBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
