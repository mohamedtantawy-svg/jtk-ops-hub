// ── HrHubView ───────────────────────────────────────────────────────────────
// Stage 3: list + detail. Toggles (My / Team / All), filter by flow +
// status + function, search, cursor pagination. Detail opens as a slide-in
// drawer so the list keeps its scroll position; clicking the URL bar still
// works for direct linking via ?req=<uuid>.
//
// Comments + Slack-style composer + emoji + mentions land in HrHubDetailPanel
// (Stage 4).
//
// Stage 5 will merge Ops Hub Feedback into this view by surfacing the
// `feedback` flow in the same chassis. Until then the existing /feedback
// tab continues to read from feedback_requests untouched.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  listHrHubRequests,
  getHrHubRequest,
} from '../../services/hrHubApi';
import HrHubDetailPanel from '../hr-hub/HrHubDetailPanel';
import HrHubSettingsPanel from '../hr-hub/HrHubSettingsPanel';
import { PermissionsContext } from '../../App';

const FLOW_TABS = [
  { id: 'all',              label: 'All flows',        flow: null },
  { id: 'hr_request',       label: 'HR Requests',      flow: 'hr_request' },
  { id: 'hr_reporting',     label: 'HR Reporting',     flow: 'hr_reporting' },
  { id: 'escalation_zero',  label: 'Escalation Zero',  flow: 'escalation_zero' },
  { id: 'feedback',         label: 'Ops Hub Feedback', flow: 'feedback' },
];

const STATUS_PILLS = {
  new:         { label: 'New',         color: '#0369a1', bg: '#e0f2fe' },
  in_progress: { label: 'In Progress', color: '#92400e', bg: '#fff8e6' },
  on_hold:     { label: 'On Hold',     color: 'var(--text-secondary)', bg: '#f3f3f3' },
  resolved:    { label: 'Resolved',    color: '#166534', bg: '#e8f5e9' },
};

const FLOW_LABELS = {
  hr_request: 'HR Request',
  hr_reporting: 'HR Reporting',
  escalation_zero: 'Escalation Zero',
  feedback: 'Ops Hub Feedback',
};

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Determine if the user is a manager — drives the 3-toggle (My/Team/All)
// vs 2-toggle (My/All) split. Mirrors queue-scoping's role tiers.
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

export default function HrHubView({ user }) {
  const perms = useContext(PermissionsContext);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ── URL deep-link support ─────────────────────────────────────────────────
  const initialReqId = (() => {
    try {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      return url?.searchParams.get('req') || null;
    } catch { return null; }
  })();

  // ── Filters & toggles ─────────────────────────────────────────────────────
  const isManager = isManagerRole(user);
  const [scope, setScope] = useState('mine');           // 'mine' | 'team' | 'all'
  const [flowTab, setFlowTab] = useState('all');
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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

  // Cancel in-flight requests when filters change so we don't paint stale data.
  const reqSeqRef = useRef(0);
  const flowQuery = FLOW_TABS.find(t => t.id === flowTab)?.flow || null;

  const loadFirstPage = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await listHrHubRequests({
        flow: flowQuery,
        scope,
        status: status || undefined,
        search: debouncedSearch || undefined,
        limit: 25,
      });
      if (seq !== reqSeqRef.current) return;
      setItems(res?.items || []);
      setCursor(res?.nextCursor || null);
    } catch (err) {
      if (seq !== reqSeqRef.current) return;
      setError(err?.message || 'Could not load requests');
      setItems([]);
      setCursor(null);
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }, [flowQuery, scope, status, debouncedSearch]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listHrHubRequests({
        flow: flowQuery,
        scope,
        status: status || undefined,
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
  }, [cursor, flowQuery, scope, status, debouncedSearch, loadingMore]);

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
    // Keep the URL in sync so deep links work without overriding history.
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
  const headerStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, padding: '20px 24px 8px', flexWrap: 'wrap',
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 80px' }}>
      <div style={headerStyle}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>HR Hub</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            HR Requests, Reports, Escalation Zero, and Ops Hub Feedback in one place.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Scope toggle: 2 buttons (mine/all) for everyone, 3 for managers */}
          <ScopeToggle scope={scope} setScope={setScope} isManager={isManager} />
          {perms?.canManageHrHub && (
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="HR Hub settings"
              title="HR Hub Settings"
              style={{
                padding: '8px 10px', borderRadius: 999,
                border: '1px solid var(--border)', background: 'var(--surface)',
                cursor: 'pointer', color: 'var(--text)', fontSize: 13,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            ><i className="bi bi-gear" /> Settings</button>
          )}
        </div>
      </div>
      {settingsOpen && <HrHubSettingsPanel onClose={() => setSettingsOpen(false)} />}

      {/* Flow tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 24px 0',
        overflowX: 'auto', borderBottom: '1px solid var(--border)',
      }}>
        {FLOW_TABS.map(t => (
          <FlowTabButton
            key={t.id}
            label={t.label}
            active={flowTab === t.id}
            onClick={() => setFlowTab(t.id)}
          />
        ))}
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px',
        borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap',
      }}>
        <input
          type="text"
          placeholder="Search title or summary…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200,
            padding: '8px 12px', fontSize: 13,
            border: '1px solid var(--border)', borderRadius: 8,
            outline: 'none', background: 'var(--surface)',
          }}
        />
        <StatusFilter status={status} setStatus={setStatus} />
      </div>

      {/* List */}
      <div style={{ padding: '12px 24px' }}>
        {loading && items.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>
            {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState scope={scope} flowTab={flowTab} />
        )}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(item => (
              <RequestRow
                key={item.id}
                item={item}
                active={detailId === item.id}
                onClick={() => setDetailId(item.id)}
              />
            ))}
            {cursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  alignSelf: 'center', marginTop: 8,
                  padding: '8px 16px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  fontSize: 13, fontWeight: 500, cursor: loadingMore ? 'wait' : 'pointer',
                }}
              >{loadingMore ? 'Loading more…' : 'Load more'}</button>
            )}
          </div>
        )}
      </div>

      {/* Detail drawer */}
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
    </div>
  );
}

// ── ScopeToggle ─────────────────────────────────────────────────────────────
function ScopeToggle({ scope, setScope, isManager }) {
  const options = isManager
    ? [{ id: 'mine', label: 'My Requests' }, { id: 'team', label: 'Team Requests' }, { id: 'all', label: 'All Requests' }]
    : [{ id: 'mine', label: 'My Requests' }, { id: 'all', label: 'All Requests' }];
  return (
    <div style={{
      display: 'inline-flex', padding: 3, background: 'var(--surface-3)', borderRadius: 999,
      gap: 2,
    }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => setScope(o.id)}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: scope === o.id ? 'white' : 'transparent',
            color: scope === o.id ? 'var(--text)' : 'var(--text-secondary)',
            boxShadow: scope === o.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background .12s',
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

function FlowTabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        borderRadius: '8px 8px 0 0',
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--text)' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: active ? 600 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
        position: 'relative',
        marginBottom: -1,
        borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
      }}
    >{label}</button>
  );
}

function StatusFilter({ status, setStatus }) {
  const options = [
    { id: null,         label: 'All' },
    { id: 'new',        label: 'New' },
    { id: 'in_progress',label: 'In Progress' },
    { id: 'on_hold',    label: 'On Hold' },
    { id: 'resolved',   label: 'Resolved' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(o => {
        const active = status === o.id;
        return (
          <button
            key={String(o.id)}
            onClick={() => setStatus(o.id)}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid ' + (active ? '#1b1b1b' : '#e8e8e8'),
              background: active ? '#1b1b1b' : 'white',
              color: active ? 'white' : '#616161',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

function RequestRow({ item, active, onClick }) {
  const pill = STATUS_PILLS[item.status] || STATUS_PILLS.new;
  const flowLabel = FLOW_LABELS[item.flow] || item.flow;
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px',
        background: active ? '#f7f5f2' : 'white',
        border: '1px solid ' + (active ? '#d8d8d8' : '#e8e8e8'),
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s',
      }}
    >
      <div style={{
        flexShrink: 0,
        width: 80, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '.04em',
      }}>{flowLabel}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title || (item.summary || '').slice(0, 120) || '(untitled)'}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {(() => {
            // Only join non-empty parts with `·` so flows that don't have a
            // request_type / report_type (e.g. Escalation Zero) don't render
            // a trailing separator.
            const parts = [
              item.functionArea,
              item.requestType || item.reportType,
              item.assigneeName,
            ].filter(Boolean);
            return parts.join(' · ');
          })()}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{
          fontSize: 11, fontWeight: 600,
          padding: '2px 10px', borderRadius: 999,
          background: pill.bg, color: pill.color,
        }}>{pill.label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {item.attachmentCount > 0 && (
            <span style={{ marginRight: 8 }}>
              <i className="bi bi-paperclip" /> {item.attachmentCount}
            </span>
          )}
          {formatRelative(item.updatedAt || item.createdAt)}
        </span>
      </div>
    </button>
  );
}

function EmptyState({ scope, flowTab }) {
  const lines = scope === 'mine'
    ? ['Nothing on your plate yet.', 'Hit the + button in the header to submit a request.']
    : flowTab === 'all'
      ? ['No requests match these filters.', 'Try widening the scope or clearing the search.']
      : ['No requests in this flow yet.', 'Switch the flow tab or hit the + button to add one.'];
  return (
    <div style={{
      padding: '40px 20px', textAlign: 'center',
      border: '1px dashed #e8e8e8', borderRadius: 12,
      color: 'var(--text-muted)', fontSize: 13,
    }}>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>{lines[0]}</div>
      <div style={{ marginTop: 4 }}>{lines[1]}</div>
    </div>
  );
}
