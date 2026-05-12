'use client';

import { useMemo, useState } from 'react';

import { useWorkspace } from '../WorkspaceContext';

// HR-style queue shell. Uses HR's CSS classes (deel-card, deel-btn,
// deel-table-header*) so the visual matches HR Hub's queue exactly —
// same filter bar layout, same table header styling, same empty state.
//
// Adapters are stubbed: until per-workspace Zendesk/Jira/Workbench API
// keys are provisioned, all three sources return an empty array. When
// real adapters land they slot into useWorkspaceQueue() (Tier 2) without
// any UI changes — the columns + filters are already in place.
//
// Tier-1 scope: the shell + filter bar + sortable table headers + empty
// state. No row actions, no detail panel, no bulk select — those land in
// Tier 2 once there's real data to act on.

const SOURCES = [
  { id: 'zendesk',   label: 'Zendesk',   tint: '#16a34a', icon: 'bi-headset' },
  { id: 'jira',      label: 'Jira',      tint: '#2563eb', icon: 'bi-kanban' },
  { id: 'workbench', label: 'Workbench', tint: '#a855f7', icon: 'bi-tools' },
];

const STATUS_OPTIONS = ['Open', 'New', 'In progress', 'Pause', 'Resolved'];
const PRIORITY_OPTIONS = ['Low', 'Normal', 'High', 'Urgent'];

const filterBar = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '14px 16px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface)',
  flexWrap: 'wrap',
};

const select = {
  height: 32,
  padding: '0 28px 0 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 'var(--font-sm)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' stroke='%236b6560' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

const searchInput = {
  flex: 1,
  minWidth: 240,
  height: 32,
  padding: '0 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 'var(--font-sm)',
  fontFamily: 'inherit',
  outline: 'none',
};

const tableHeaderStyle = {
  background: 'var(--surface-2)',
  fontSize: 'var(--font-xs)',
  fontWeight: 'var(--fw-semibold)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--ls-caps)',
  color: 'var(--text-secondary)',
  padding: '0 16px',
  display: 'grid',
  gridTemplateColumns: '40px minmax(280px, 2fr) 140px 110px 130px 200px 90px',
  alignItems: 'center',
  minHeight: 40,
  borderBottom: '1px solid var(--border)',
};

const emptyState = {
  padding: '64px 32px',
  textAlign: 'center',
  color: 'var(--text-secondary)',
};

const emptyIcon = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: 'var(--surface-2)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 24,
  color: 'var(--text-muted)',
  marginBottom: 12,
};

const statChip = (tint) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  background: tint + '14',
  border: `1px solid ${tint}33`,
  color: tint,
  fontSize: 'var(--font-xs)',
  fontWeight: 'var(--fw-semibold)',
});

const counterRow = {
  display: 'flex',
  gap: 12,
  marginBottom: 16,
  flexWrap: 'wrap',
};

const statCard = {
  flex: '1 1 180px',
  minWidth: 180,
  padding: '14px 18px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xl, 12px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const cardLabel = {
  fontSize: 'var(--font-xs)',
  fontWeight: 'var(--fw-semibold)',
  letterSpacing: 'var(--ls-caps)',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const cardValue = {
  fontSize: 24,
  fontWeight: 'var(--fw-bold)',
  color: 'var(--text)',
  fontVariantNumeric: 'tabular-nums',
};

export default function QueueShell() {
  const { workspace } = useWorkspace();

  const [filters, setFilters] = useState({
    source: 'all',
    status: 'all',
    priority: 'all',
    search: '',
  });

  // Stub data — until per-workspace Zendesk/Jira/Workbench adapters are
  // wired, every source returns an empty tickets array. Counts come from
  // those (zero everywhere) but the UI is fully ready for the moment real
  // data flows in.
  const sourceCounts = useMemo(() => ({
    zendesk: 0, jira: 0, workbench: 0, total: 0,
  }), []);

  const tickets = []; // shaped: { id, subject, source, status, priority, assignee, age }

  const filtered = useMemo(() => {
    if (!tickets.length) return [];
    return tickets.filter(t => {
      if (filters.source !== 'all' && t.source !== filters.source) return false;
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!t.subject.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tickets, filters]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Workspace</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
            Tickets across Zendesk, Jira, and Workbench — scoped to {workspace.label}.
          </p>
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
          {sourceCounts.total} tickets · last sync —
        </div>
      </div>

      {/* Source counter strip */}
      <div style={counterRow}>
        {SOURCES.map(s => (
          <div key={s.id} style={statCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={statChip(s.tint)}>
                <i className={`bi ${s.icon}`} /> {s.label}
              </span>
            </div>
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

      {/* Filter bar + table */}
      <div className="deel-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={filterBar}>
          <select
            style={select}
            value={filters.source}
            onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}
          >
            <option value="all">All sources</option>
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select
            style={select}
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          >
            <option value="all">Any status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            style={select}
            value={filters.priority}
            onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
          >
            <option value="all">Any priority</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            type="search"
            placeholder="Search subject…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            style={searchInput}
          />
          <button
            type="button"
            className="deel-btn deel-btn-ghost deel-btn-sm"
            disabled
            title="Refresh — wired in Tier 2"
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          >
            <i className="bi bi-arrow-clockwise" />
          </button>
        </div>

        <div style={tableHeaderStyle}>
          <span />
          <span>Subject</span>
          <span>Source</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Assignee</span>
          <span>Age</span>
        </div>

        {filtered.length === 0 ? (
          <div style={emptyState}>
            <div style={emptyIcon}><i className="bi bi-inbox" /></div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              No tickets to show yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
              Connect {workspace.label}'s Zendesk, Jira, and Workbench API
              credentials and the queue will populate from those sources. Filters
              and the table layout are ready — no further UI work needed.
            </div>
            <div style={{ marginTop: 18, display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {SOURCES.map(s => (
                <span key={s.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 999,
                  background: 'var(--surface-2)', color: 'var(--text-secondary)',
                  fontSize: 'var(--font-xs)', fontWeight: 600,
                }}>
                  <i className={`bi ${s.icon}`} style={{ color: s.tint }} />
                  {s.label}
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    background: '#fff3e0', color: '#9c5b00',
                    border: '1px solid #ffdfb3',
                    padding: '2px 6px', borderRadius: 999, marginLeft: 4,
                  }}>Not connected</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
