// ── Leaders Alerts (LEADER_ALERTS_PLAN.md) ───────────────────────────────
// Stage 3 list view. Layout follows the Feedback / HR Hub pattern (skill
// §3.13): hero header → segmented scope toggle (My / All) → 4-up status
// filter cards → filter bar (severity + category chips + search + sort +
// refresh) → compact row list. Click a row to open the detail drawer.
//
// Severity colors / icons are kept LITERAL — they convey meaning that
// must NOT shift with theme (skill §4.5).

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { listLeaderAlerts, getLeaderAlertsSettings } from '../../services/leaderAlertsApi';
import { FLAGS, getCountryName } from '../../data/constants';
import LeaderAlertDetailPanel from './LeaderAlertDetailPanel';
import LeaderAlertSettingsPanel from './LeaderAlertSettingsPanel';

// ── Constants ──────────────────────────────────────────────────────────────

const SEVERITY_META = {
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2', icon: 'bi-exclamation-octagon-fill' },
  high:     { label: 'High',     color: '#d97706', bg: '#fff8e6', icon: 'bi-exclamation-triangle-fill' },
  medium:   { label: 'Medium',   color: '#0369a1', bg: '#e0f2fe', icon: 'bi-info-circle-fill' },
  low:      { label: 'Low',      color: '#15803d', bg: '#f0fdf4', icon: 'bi-check-circle' },
};

const STATUS_META = {
  new:         { label: 'New',         color: '#1d4ed8', bg: '#dbeafe', icon: 'bi-circle-fill' },
  in_progress: { label: 'In Progress', color: '#ed8d00', bg: '#fff8e6', icon: 'bi-arrow-repeat' },
  on_hold:     { label: 'On Hold',     color: '#9e9e9e', bg: '#f3f4f6', icon: 'bi-pause-circle-fill' },
  resolved:    { label: 'Resolved',    color: '#29811e', bg: '#dcfce7', icon: 'bi-check-circle-fill' },
};

const SCOPES = [
  { id: 'all',  label: 'All Alerts' },
  { id: 'mine', label: 'My Alerts'  },
];

const STATUS_ORDER = ['new', 'in_progress', 'on_hold', 'resolved'];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 30) return `${Math.round(day / 7)} wk ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function getCategoryMeta(settings, catLabel) {
  const cats = Array.isArray(settings?.categories) ? settings.categories : [];
  return cats.find(c => c.label === catLabel || c.id === catLabel)
    || { label: catLabel, color: '#6b7280', icon: 'bi-tag-fill' };
}

// Read ?alert=<uuid> from the URL on mount + on popstate so deep-links open
// the right drawer.
function readAlertIdFromUrl() {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(window.location.href).searchParams.get('alert');
  } catch { return null; }
}

function setAlertIdInUrl(id) {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('alert', id);
    else u.searchParams.delete('alert');
    window.history.replaceState({}, '', u.toString());
  } catch {}
}

// ── Main view ──────────────────────────────────────────────────────────────

const LeaderAlertsView = ({ user, perms, refreshNonce = 0 }) => {
  // List state
  const [scope, setScope]           = useState('all');
  const [statusFilter, setStatusF]  = useState(null);     // null = all
  const [severityFilter, setSevF]   = useState(null);
  const [categoryFilter, setCatF]   = useState(null);
  const [search, setSearch]         = useState('');
  const [sort, setSort]             = useState('newest'); // newest | oldest | most_acks
  const [alerts, setAlerts]         = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError]           = useState(null);

  const [settings, setSettings]     = useState(null);
  const [openAlertId, setOpenAlertId] = useState(() => readAlertIdFromUrl());
  const [showSettings, setShowSettings] = useState(false);

  // Settings — categories + statuses reference list. Re-fetches on
  // refreshTick (manual button) and refreshNonce (post-create signal
  // from App.jsx).
  useEffect(() => {
    let cancelled = false;
    getLeaderAlertsSettings()
      .then(d => { if (!cancelled) setSettings(d?.settings || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshTick, refreshNonce]);

  // Alert list — reload on filter change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listLeaderAlerts({
      scope,
      status: statusFilter || undefined,
      severity: severityFilter || undefined,
      category: categoryFilter || undefined,
      search: search.trim() || undefined,
      limit: 50,
    })
      .then(d => {
        if (cancelled) return;
        setAlerts(Array.isArray(d?.alerts) ? d.alerts : []);
        setNextCursor(d?.nextCursor || null);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load alerts');
        setAlerts([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scope, statusFilter, severityFilter, categoryFilter, search, refreshTick, refreshNonce]);

  // URL ↔ openAlertId sync (browser back/forward + deep-links).
  useEffect(() => {
    const onPop = () => setOpenAlertId(readAlertIdFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { setAlertIdInUrl(openAlertId); }, [openAlertId]);

  // Counts for the 4-up status cards — reflect the CURRENT secondary
  // filters (scope + severity + category + search). Re-fetched as a small
  // single batch when those change.
  const [statusCounts, setStatusCounts] = useState({ new: 0, in_progress: 0, on_hold: 0, resolved: 0 });
  useEffect(() => {
    let cancelled = false;
    Promise.all(STATUS_ORDER.map(s =>
      listLeaderAlerts({
        scope,
        status: s,
        severity: severityFilter || undefined,
        category: categoryFilter || undefined,
        search: search.trim() || undefined,
        limit: 1,
      }).then(r => Array.isArray(r?.alerts) ? r.alerts : [])
        .catch(() => [])
    )).then(results => {
      if (cancelled) return;
      // Approximate count: API returns up to limit, doesn't include total.
      // For accuracy at scale we'd add a /count endpoint; for v1 the row
      // count is good enough as a presence signal.
      const counts = {};
      STATUS_ORDER.forEach((s, i) => { counts[s] = results[i].length; });
      setStatusCounts(counts);
    });
    return () => { cancelled = true; };
  }, [scope, severityFilter, categoryFilter, search, refreshTick, refreshNonce]);

  // Local sort — backend always returns newest-first; we resort client-side
  // for the secondary sort options.
  const sortedAlerts = useMemo(() => {
    const arr = [...alerts];
    if (sort === 'oldest') arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sort === 'most_acks') arr.sort((a, b) => (b.ack_count || 0) - (a.ack_count || 0));
    return arr;
  }, [alerts, sort]);

  // Categories list for the chip rail in the filter bar.
  const categories = Array.isArray(settings?.categories) ? settings.categories : [];

  const handleRefresh = () => setRefreshTick(t => t + 1);
  const handleRowClick = (id) => setOpenAlertId(id);
  const handleDrawerClose = () => setOpenAlertId(null);
  const handleAlertChanged = () => setRefreshTick(t => t + 1);

  const openAlert = openAlertId ? alerts.find(a => a.id === openAlertId) : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden', background: 'var(--surface-2)' }}>
      <style>{`
        .leader-alerts-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
        @media (max-width: 900px) { .leader-alerts-status-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
        .leader-alerts-row:hover { background: var(--surface-2); }
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
          background: '#fff1f2', color: '#dc2626',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className="bi-broadcast-pin" style={{ fontSize: 20 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>Leaders Alerts</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Post a quick alert to fellow leaders and track who's acknowledged it.
          </div>
        </div>
        {perms?.canManageLeaderAlerts && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="Edit categories, statuses, and notification policy"
            style={{
              height: 32, padding: '0 12px', borderRadius: 128,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface)'}
          >
            <i className="bi-gear" style={{ fontSize: 12 }} />
            Settings
          </button>
        )}
      </div>

      {/* Body — scrollable below the hero */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px 32px' }}>
        {/* Scope toggle */}
        <div style={{
          display: 'inline-flex', padding: 4, borderRadius: 128,
          background: 'var(--surface-3)', marginBottom: 16,
        }}>
          {SCOPES.map(s => {
            const active = scope === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                style={{
                  padding: '6px 14px', borderRadius: 128, border: 'none',
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  transition: 'all .12s',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* 4-up status cards */}
        <div className="leader-alerts-status-grid" style={{ marginBottom: 16 }}>
          {STATUS_ORDER.map(s => {
            const meta = STATUS_META[s];
            const active = statusFilter === s;
            const count = statusCounts[s] || 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusF(active ? null : s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px', borderRadius: 14,
                  border: `1.5px solid ${active ? meta.color : 'var(--border)'}`,
                  background: active ? meta.bg : 'var(--surface)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'all .12s',
                  minWidth: 0,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: meta.bg, color: meta.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <i className={meta.icon} style={{ fontSize: 16 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: active ? meta.color : 'var(--text)' }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {count >= 50 ? `${count}+ alerts` : `${count} alert${count === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div style={{
                  fontSize: 22, fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  color: active ? meta.color : 'var(--text-secondary)',
                }}>
                  {count >= 50 ? '50+' : count}
                </div>
              </button>
            );
          })}
        </div>

        {/* Filter bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          marginBottom: 12,
          padding: '8px 10px',
          background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12,
        }}>
          {/* Severity chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {Object.entries(SEVERITY_META).map(([id, meta]) => {
              const active = severityFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSevF(active ? null : id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 128,
                    border: `1px solid ${active ? meta.color : 'var(--border)'}`,
                    background: active ? meta.bg : 'var(--surface)',
                    color: active ? meta.color : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    cursor: 'pointer', height: 28,
                  }}
                >
                  <i className={meta.icon} style={{ fontSize: 11, color: meta.color }} />
                  {meta.label}
                </button>
              );
            })}
          </div>

          <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />

          {/* Category chips (horizontally scrollable on overflow) */}
          {categories.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {categories.map(c => {
                const active = categoryFilter === c.label;
                return (
                  <button
                    key={c.id || c.label}
                    type="button"
                    onClick={() => setCatF(active ? null : c.label)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 128,
                      border: `1px solid ${active ? (c.color || '#6b7280') : 'var(--border)'}`,
                      background: active ? `${c.color || '#6b7280'}15` : 'var(--surface)',
                      color: active ? (c.color || '#6b7280') : 'var(--text-secondary)',
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      cursor: 'pointer', height: 28,
                    }}
                  >
                    <i className={c.icon || 'bi-tag-fill'} style={{ fontSize: 11, color: c.color || '#6b7280' }} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 12, color: 'var(--text-muted)',
            }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or body…"
              style={{
                height: 30, padding: '0 12px 0 30px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 12, outline: 'none',
                width: 220,
              }}
            />
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              height: 30, padding: '0 8px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="most_acks">Most acks</option>
          </select>

          {/* Refresh */}
          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh"
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className="bi-arrow-clockwise" style={{ fontSize: 13 }} />
          </button>
        </div>

        {/* Active-filter strip with clear-all */}
        {(statusFilter || severityFilter || categoryFilter || search) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Filtered by</span>
            {statusFilter && <ChipPill label={STATUS_META[statusFilter].label} onClear={() => setStatusF(null)} accent={STATUS_META[statusFilter].color} />}
            {severityFilter && <ChipPill label={SEVERITY_META[severityFilter].label} onClear={() => setSevF(null)} accent={SEVERITY_META[severityFilter].color} />}
            {categoryFilter && <ChipPill label={categoryFilter} onClear={() => setCatF(null)} />}
            {search && <ChipPill label={`"${search}"`} onClear={() => setSearch('')} />}
            <button
              type="button"
              onClick={() => { setStatusF(null); setSevF(null); setCatF(null); setSearch(''); }}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 128,
                border: 'none', background: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Clear all
            </button>
          </div>
        )}

        {/* Row list */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14,
          overflow: 'hidden',
        }}>
          {loading && alerts.length === 0 && (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <i className="bi-arrow-repeat" style={{ fontSize: 18, animation: 'spin 1.4s linear infinite', display: 'inline-block', marginBottom: 8 }} />
              <div>Loading alerts…</div>
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: '#b91c1c', fontSize: 13 }}>
              <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
              Could not load alerts — {error}
            </div>
          )}
          {!loading && !error && sortedAlerts.length === 0 && (
            <EmptyState scope={scope} statusFilter={statusFilter} severityFilter={severityFilter} categoryFilter={categoryFilter} search={search} />
          )}
          {sortedAlerts.map((a, idx) => (
            <AlertRow
              key={a.id}
              alert={a}
              settings={settings}
              isLast={idx === sortedAlerts.length - 1}
              currentEmail={user?.email}
              onClick={() => handleRowClick(a.id)}
            />
          ))}
        </div>

        {nextCursor && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button
              type="button"
              disabled
              title="Pagination — Stage 6"
              style={{
                padding: '6px 14px', borderRadius: 128,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                cursor: 'not-allowed', opacity: 0.6,
              }}
            >
              Load more
            </button>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {openAlertId && (
        <LeaderAlertDetailPanel
          alertId={openAlertId}
          alertHint={openAlert}
          settings={settings}
          user={user}
          perms={perms}
          onClose={handleDrawerClose}
          onChanged={handleAlertChanged}
        />
      )}

      {/* Settings drawer (Alerts Admin only) */}
      {showSettings && perms?.canManageLeaderAlerts && (
        <LeaderAlertSettingsPanel
          onClose={() => setShowSettings(false)}
          onSaved={handleRefresh}
        />
      )}
      <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
};

// ── Subcomponents ──────────────────────────────────────────────────────────

const ChipPill = ({ label, onClear, accent }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 128,
    background: accent ? `${accent}15` : 'var(--surface-2)',
    color: accent || 'var(--text-secondary)',
    fontSize: 11, fontWeight: 600,
  }}>
    {label}
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear ${label}`}
      style={{
        border: 'none', background: 'transparent', padding: 0,
        color: 'inherit', cursor: 'pointer', display: 'flex',
      }}
    >
      <i className="bi-x" style={{ fontSize: 13 }} />
    </button>
  </span>
);

const EmptyState = ({ scope, statusFilter, severityFilter, categoryFilter, search }) => {
  const hasFilter = statusFilter || severityFilter || categoryFilter || search;
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, margin: '0 auto 12px',
        background: 'var(--surface-2)', color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <i className={hasFilter ? 'bi-funnel' : 'bi-broadcast'} style={{ fontSize: 24 }} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        {hasFilter
          ? 'No alerts match these filters'
          : scope === 'mine'
            ? "You haven't posted any alerts yet"
            : 'No alerts yet'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {hasFilter
          ? 'Try clearing one or more filters above.'
          : 'Use the + button at the top to post a new Leaders Alert.'}
      </div>
    </div>
  );
};

const AlertRow = ({ alert, settings, isLast, currentEmail, onClick }) => {
  const sev = SEVERITY_META[alert.severity] || SEVERITY_META.medium;
  const status = STATUS_META[alert.status] || STATUS_META.new;
  const cat = getCategoryMeta(settings, alert.category);

  const impactTags = Array.isArray(alert.impact_tags) ? alert.impact_tags : [];
  const visibleImpact = impactTags.slice(0, 3);
  const hiddenImpact  = impactTags.length - visibleImpact.length;

  const acked = !!alert.i_acked;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="leader-alerts-row"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 36px minmax(0, 1fr) auto auto',
        alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
        cursor: 'pointer',
        transition: 'background .1s',
      }}
    >
      {/* Severity dot */}
      <div title={sev.label} style={{ width: 8, height: 8, borderRadius: 4, background: sev.color, flexShrink: 0 }} />

      {/* Category icon tile */}
      <div title={cat.label} style={{
        width: 28, height: 28, borderRadius: 8,
        background: `${cat.color}18`, color: cat.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <i className={cat.icon || 'bi-tag-fill'} style={{ fontSize: 13 }} />
      </div>

      {/* Title + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {alert.title}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 3,
          fontSize: 11, color: 'var(--text-muted)',
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{alert.created_by_name || alert.created_by_email}</span>
          <span>·</span>
          <span>{formatRelative(alert.created_at)}</span>
          {visibleImpact.length > 0 && (
            <>
              <span>·</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                {visibleImpact.map(tag => {
                  if (tag === 'Global' || tag === 'Team') {
                    return (
                      <span key={tag} title={tag} style={{
                        padding: '0 6px', borderRadius: 4,
                        background: 'var(--surface-3)', color: 'var(--text-secondary)',
                        fontSize: 10, fontWeight: 600,
                      }}>{tag}</span>
                    );
                  }
                  return <span key={tag} title={getCountryName(tag) || tag}>{FLAGS[tag] || tag}</span>;
                })}
                {hiddenImpact > 0 && <span>+{hiddenImpact}</span>}
              </span>
            </>
          )}
          {alert.comment_count > 0 && (
            <>
              <span>·</span>
              <span><i className="bi-chat-left" style={{ fontSize: 10, marginRight: 3 }} />{alert.comment_count}</span>
            </>
          )}
        </div>
      </div>

      {/* Ack count + state */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 128,
        background: acked ? '#dcfce7' : 'var(--surface-2)',
        color: acked ? '#15803d' : 'var(--text-secondary)',
        fontSize: 12, fontWeight: 700,
        flexShrink: 0,
      }}>
        <i className={acked ? 'bi-check-circle-fill' : 'bi-hand-thumbs-up'} style={{ fontSize: 12 }} />
        {alert.ack_count || 0}
      </div>

      {/* Status pill */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 128,
        background: status.bg, color: status.color,
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        <i className={status.icon} style={{ fontSize: 10 }} />
        {status.label}
      </div>
    </div>
  );
};

export default LeaderAlertsView;
