'use client';

import { useMemo, useState } from 'react';

import { useWorkspace } from '../WorkspaceContext';
import useWorkspaceQueue from './useWorkspaceQueue';

// HR-style queue for non-HR workspaces. Same visual language as HR Hub's
// queue (deel-card, deel-table-header, SLA pill colors, status chips) but
// scoped to one workspace's Zendesk group.
//
// Data flow:
//   useWorkspaceQueue → /api/v1/workspaces/[id]/queue → workspace Zendesk
//   client (per-workspace token + group filter) → role-scoped server-side
//   (admin/manager/agent) → returns normalised tickets with SLA computed.
//
// Tier-1 actions: row click opens the Zendesk ticket in a new tab. Detail
// drawer + reply / escalate / snooze / reassign land in Tier 2 alongside
// the Jira + Workbench adapters.

const SOURCES = [
  { id: 'zendesk',   label: 'Zendesk',   tint: '#16a34a', icon: 'bi-headset' },
  { id: 'jira',      label: 'Jira',      tint: '#2563eb', icon: 'bi-kanban' },
  { id: 'workbench', label: 'Workbench', tint: '#a855f7', icon: 'bi-tools' },
];

const STATUS_OPTIONS = ['new', 'open', 'pending', 'hold', 'solved'];
const PRIORITY_OPTIONS = ['urgent', 'high', 'normal', 'low'];

const STATUS_COLOR = {
  new:     { bg: '#dbeafe', fg: '#1d4ed8', border: '#bfdbfe' },
  open:    { bg: '#ffedd5', fg: '#c2410c', border: '#fed7aa' },
  pending: { bg: '#fef9c3', fg: '#854d0e', border: '#fde68a' },
  hold:    { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' },
  solved:  { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
};

const PRIORITY_COLOR = {
  urgent: { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' },
  high:   { bg: '#ffedd5', fg: '#c2410c', border: '#fed7aa' },
  normal: { bg: '#f4f1ec', fg: '#6b6560', border: '#e8e4df' },
  low:    { bg: '#f4f1ec', fg: '#9b928a', border: '#e8e4df' },
};

const SLA_COLOR = {
  within:   { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0', label: 'Within SLA' },
  at_risk:  { bg: '#fef9c3', fg: '#854d0e', border: '#fde68a', label: 'At risk' },
  breached: { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca', label: 'Breached' },
  unknown:  { bg: '#f4f1ec', fg: '#6b6560', border: '#e8e4df', label: '—' },
};

const filterBar = {
  display: 'flex', gap: 10, alignItems: 'center',
  padding: '14px 16px', borderBottom: '1px solid var(--border)',
  background: 'var(--surface)', flexWrap: 'wrap',
};
const select = {
  height: 32, padding: '0 28px 0 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  background: 'var(--surface)', color: 'var(--text)',
  fontSize: 'var(--font-sm)', fontFamily: 'inherit', cursor: 'pointer',
  appearance: 'none',
  backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' stroke='%236b6560' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
};
const searchInput = {
  flex: 1, minWidth: 240, height: 32, padding: '0 12px',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  background: 'var(--surface)', color: 'var(--text)',
  fontSize: 'var(--font-sm)', fontFamily: 'inherit', outline: 'none',
};
const counterRow = { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' };
const statCard = {
  flex: '1 1 180px', minWidth: 180, padding: '14px 18px',
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 12,
  display: 'flex', flexDirection: 'column', gap: 4,
};
const cardLabel = {
  fontSize: 'var(--font-xs)', fontWeight: 'var(--fw-semibold)',
  letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
  color: 'var(--text-muted)',
};
const cardValue = {
  fontSize: 24, fontWeight: 'var(--fw-bold)', color: 'var(--text)',
  fontVariantNumeric: 'tabular-nums',
};
const statChip = (tint) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '4px 10px', borderRadius: 999,
  background: tint + '14', border: `1px solid ${tint}33`, color: tint,
  fontSize: 'var(--font-xs)', fontWeight: 'var(--fw-semibold)',
});

const cols = '32px minmax(280px, 2fr) 110px 110px 110px 200px 130px';
const tableHeaderStyle = {
  background: 'var(--surface-2)',
  fontSize: 'var(--font-xs)', fontWeight: 'var(--fw-semibold)',
  textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)',
  color: 'var(--text-secondary)',
  padding: '0 16px',
  display: 'grid', gridTemplateColumns: cols, alignItems: 'center',
  minHeight: 40, borderBottom: '1px solid var(--border)',
};
const tableRowStyle = {
  display: 'grid', gridTemplateColumns: cols, alignItems: 'center',
  padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
  fontSize: 'var(--font-sm)', cursor: 'pointer',
  transition: 'background .12s',
};
const sourcePill = (tint) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 8px', borderRadius: 999,
  background: tint + '14', color: tint, border: `1px solid ${tint}33`,
  fontSize: 11, fontWeight: 600,
});
const chip = (c) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
  fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
});

const emptyState = { padding: '64px 32px', textAlign: 'center', color: 'var(--text-secondary)' };
const emptyIcon = {
  width: 56, height: 56, borderRadius: '50%',
  background: 'var(--surface-2)', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', fontSize: 24,
  color: 'var(--text-muted)', marginBottom: 12,
};

function formatAge(hours) {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export default function QueueShell() {
  const { workspace } = useWorkspace();
  const { items, meta, loading, error, refresh } = useWorkspaceQueue(workspace.id);

  const [filters, setFilters] = useState({
    source: 'all',
    status: 'all',
    priority: 'all',
    search: '',
  });

  const sourceCounts = useMemo(() => {
    const counts = { zendesk: 0, jira: 0, workbench: 0, total: 0 };
    for (const t of items) {
      if (counts[t.source] != null) counts[t.source]++;
      counts.total++;
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(t => {
      if (filters.source !== 'all' && t.source !== filters.source) return false;
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${t.subject || ''} ${t.assignee?.name || ''} ${t.assignee?.email || ''} ${t.requester?.name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters]);

  const isNotConfigured = meta?.status === 'not_configured';
  const lastSync = meta?.cachedAt ? new Date(meta.cachedAt) : null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Workspace</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
            Tickets across Zendesk, Jira, and Workbench — scoped to {workspace.label}.
            {meta?.role && <> · Viewing as <strong style={{ color: 'var(--text)' }}>{meta.role}</strong></>}
          </p>
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
          {sourceCounts.total} tickets · last sync {lastSync ? lastSync.toLocaleTimeString() : '—'}
        </div>
      </div>

      {/* Stat strip */}
      <div style={counterRow}>
        {SOURCES.map(s => (
          <div key={s.id} style={statCard}>
            <span style={statChip(s.tint)}>
              <i className={`bi ${s.icon}`} /> {s.label}
            </span>
            <div style={cardValue}>{sourceCounts[s.id]}</div>
            <div style={cardLabel}>open tickets</div>
          </div>
        ))}
        <div style={statCard}>
          <div style={cardLabel}>Total</div>
          <div style={cardValue}>{sourceCounts.total}</div>
          <div style={cardLabel}>across all sources</div>
        </div>
      </div>

      {/* Errors / banners */}
      {isNotConfigured && (
        <div className="deel-card" style={{ padding: '14px 18px', marginBottom: 16, borderColor: '#fde68a', background: '#fffbeb', color: '#854d0e' }}>
          <strong>Zendesk not configured.</strong> {meta.message}
        </div>
      )}
      {error && (
        <div className="deel-card" style={{ padding: '14px 18px', marginBottom: 16, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}>
          <strong>Couldn't load tickets.</strong> {error.message}
        </div>
      )}

      {/* Filter bar + table */}
      <div className="deel-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={filterBar}>
          <select style={select} value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}>
            <option value="all">All sources</option>
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select style={select} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="all">Any status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={select} value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
            <option value="all">Any priority</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            type="search"
            placeholder="Search subject, assignee, requester…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            style={searchInput}
          />
          <button
            type="button"
            className="deel-btn deel-btn-ghost deel-btn-sm"
            onClick={() => refresh()}
            disabled={loading}
            title="Refresh"
          >
            <i className={`bi bi-arrow-clockwise${loading ? '' : ''}`} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
            <span style={{ marginLeft: 6 }}>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>

        <div style={tableHeaderStyle}>
          <span />
          <span>Subject</span>
          <span>Source</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Assignee</span>
          <span>Age · SLA</span>
        </div>

        {loading && !items.length ? (
          <div style={emptyState}>
            <div style={emptyIcon}><i className="bi bi-arrow-repeat" /></div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Loading tickets…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={emptyState}>
            <div style={emptyIcon}><i className="bi bi-inbox" /></div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              {items.length === 0 ? 'No tickets in this view' : 'No matches'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
              {items.length === 0
                ? <>{meta?.role === 'agent'
                    ? 'You have no tickets assigned to you right now.'
                    : meta?.role === 'manager'
                    ? 'No tickets currently assigned to anyone on your team.'
                    : `No tickets in the "${meta?.group || workspace.label}" Zendesk group.`}</>
                : <>Adjust filters above to see other tickets.</>}
            </div>
          </div>
        ) : (
          filtered.map(t => {
            const source = SOURCES.find(s => s.id === t.source) || SOURCES[0];
            const stColor = STATUS_COLOR[t.status] || STATUS_COLOR.open;
            const prColor = t.priority ? (PRIORITY_COLOR[t.priority] || PRIORITY_COLOR.normal) : null;
            const slaColor = SLA_COLOR[t.sla_state] || SLA_COLOR.unknown;
            return (
              <div
                key={t.id}
                style={tableRowStyle}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => {
                  if (t.external_url) window.open(t.external_url, '_blank', 'noopener,noreferrer');
                }}
                title={t.external_url ? 'Open in Zendesk' : ''}
              >
                <i className={`bi ${source.icon}`} style={{ color: source.tint, fontSize: 14 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontWeight: 'var(--fw-semibold)', color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.subject}</div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                    #{t.external_id}
                    {t.requester?.name && <> · from {t.requester.name}</>}
                    {t.tags?.length > 0 && <> · {t.tags.slice(0, 3).join(', ')}{t.tags.length > 3 ? ` +${t.tags.length - 3}` : ''}</>}
                  </div>
                </div>
                <span style={sourcePill(source.tint)}>{source.label}</span>
                <span style={chip(stColor)}>{t.status}</span>
                {prColor ? <span style={chip(prColor)}>{t.priority}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                <div style={{ minWidth: 0 }}>
                  {t.assignee ? (
                    <>
                      <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.assignee.name}
                      </div>
                      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{t.assignee.email}</div>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unassigned</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text)' }}>{formatAge(t.ageHours)}</span>
                  <span style={chip(slaColor)}>{slaColor.label}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
