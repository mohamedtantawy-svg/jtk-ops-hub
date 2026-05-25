'use client';

import { useMemo, useState } from 'react';

import { useWorkspace } from '../WorkspaceContext';
import useWorkspaceQueue from './useWorkspaceQueue';
import {
  ToolBadge, FnBadge, StatusBadge, SlaBadge,
  Avatar, computeSlaInfo,
} from './Badges';
import { TOOLS, getFlag } from './queueConstants';

// Workspace queue — visually identical to HR Hub's queue.
//
// Layout copied from src/components/queue/Queue.jsx:
//   • Filter row: SLA tier chips (On Track / At Risk / Breached) + source
//     chips (Zendesk / Jira / Workbench) + Unassigned toggle + funnel icon
//   • Table with columns Source / Subject / Function / Country / Assignee /
//     Received / SLA / Status / Link / Note / Actions
//   • Sticky thead, 44px rows, priority-coloured left border, hover state
//
// Data shape comes from /api/v1/workspaces/[id]/queue which mirrors HR's
// /api/v1/queue normalisation (status normalised to new/in_progress/
// waiting; raw Zendesk status preserved on zdStatus).

const PRIORITY_BORDER = {
  critical: '#d42d35',
  high:     '#ed5e2a',
  medium:   '',
  low:      '',
};

const SLA_TIER_CHIPS = [
  { id: 'ok',       label: 'On Track', icon: 'bi-check-circle-fill',     color: '#15803d', bg: '#f0fdf4', activeBg: '#dcfce7', border: '#bbf7d0', activeBorder: '#15803d' },
  { id: 'at_risk',  label: 'At Risk',  icon: 'bi-exclamation-circle-fill', color: '#ed8d00', bg: '#fff8e6', activeBg: '#fef3c7', border: '#ffe27c', activeBorder: '#ed8d00' },
  { id: 'breached', label: 'Breached', icon: 'bi-x-circle-fill',         color: '#d42d35', bg: '#ffe2de', activeBg: '#fecaca', border: '#fca5a5', activeBorder: '#d42d35' },
];

const SOURCES = ['zendesk', 'jira', 'workbench'];

// Compressed paddings (2026-05-25) — matches HR's Queue/SourceTable so
// all queue surfaces fit their columns within standard viewport widths.
const tdStyle = { padding: '8px 6px', textAlign: 'center', verticalAlign: 'middle' };
const thStyle = {
  padding: '8px 6px',
  fontSize: 11,
  fontWeight: 700,
  color: '#6b6560',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textAlign: 'center',
  background: '#f5f4f2',
  borderBottom: '1px solid #e8e8e8',
};

function relTime(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) {
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(h / 24)}d`;
}

// Filter chip — used for SLA tiers, source filters, Unassigned.
function FilterChip({ active, onClick, color, bg, activeBg, border, activeBorder, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="button"
      tabIndex={0}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: active ? activeBg : bg,
        border: `${active ? '2' : '1'}px solid ${active ? activeBorder : border}`,
        borderRadius: 128,
        padding: active ? '4px 13px' : '5px 14px',
        cursor: 'pointer',
        transition: 'all .15s',
        flexShrink: 0,
        boxShadow: active ? `0 0 0 2px ${activeBorder}30` : 'none',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        color,
      }}
    >
      {icon && <i className={icon} style={{ fontSize: 13 }} />}
      {label}
    </button>
  );
}

// Plain neutral chip — used for source filters and Unassigned.
function NeutralChip({ active, onClick, icon, label, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: active ? 'var(--surface-3, #efeae3)' : 'var(--surface, #fff)',
        border: `1px solid ${active ? 'var(--text-muted, #9b928a)' : 'var(--border, #e8e4df)'}`,
        borderRadius: 128,
        padding: '5px 12px',
        cursor: 'pointer',
        transition: 'all .15s',
        flexShrink: 0,
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 500,
        color: color || 'var(--text-secondary, #6b6560)',
      }}
    >
      {icon && <i className={icon} style={{ fontSize: 11 }} />}
      {label}
    </button>
  );
}

export default function QueueShell() {
  const { workspace } = useWorkspace();
  const { items, meta, loading, error, refresh } = useWorkspaceQueue(workspace.id);

  const [fSla, setFSla] = useState(null);     // 'ok' | 'at_risk' | 'breached' | null
  const [fSources, setFSources] = useState(new Set(SOURCES)); // toggleable set
  const [fUnassigned, setFUnassigned] = useState(false);
  const [search, setSearch] = useState('');

  // Pre-compute sla info per ticket once
  const enriched = useMemo(() => items.map(t => ({ ...t, _sla: computeSlaInfo(t) })), [items]);

  const filtered = useMemo(() => {
    return enriched.filter(t => {
      // Source filter
      if (!fSources.has(t.source)) return false;
      // SLA tier
      if (fSla === 'ok' && !(t._sla?.ok)) return false;
      if (fSla === 'at_risk' && !(t._sla && !t._sla.ok && !t._sla.breach)) return false;
      if (fSla === 'breached' && !(t._sla?.breach)) return false;
      // Unassigned
      if (fUnassigned && t.assigneeEmail) return false;
      // Search
      if (search) {
        const q = search.toLowerCase();
        const hay = `${t.subject} ${t.assigneeName || ''} ${t.requesterName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, fSla, fSources, fUnassigned, search]);

  // Counts (across full items list, not filtered — chips show "available" counts)
  const counts = useMemo(() => {
    const c = { ok: 0, at_risk: 0, breached: 0, total: items.length, unassigned: 0 };
    for (const t of enriched) {
      if (t._sla?.breach) c.breached++;
      else if (t._sla && !t._sla.ok && !t._sla.breach) c.at_risk++;
      else if (t._sla?.ok) c.ok++;
      if (!t.assigneeEmail) c.unassigned++;
    }
    return c;
  }, [enriched, items]);

  const toggleSource = (id) => {
    setFSources(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isNotConfigured = meta?.status === 'not_configured';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)', marginTop: -24 }}>
      {/* ── Filter / toolbar row (mirrors HR's queue header) ───────────── */}
      <div data-role="queue-header" style={{
        padding: '12px 8px 12px',
        background: 'var(--surface, #ffffff)',
        borderBottom: '1px solid #e8e8e8',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          {SLA_TIER_CHIPS.map(c => (
            <FilterChip
              key={c.id}
              active={fSla === c.id}
              onClick={() => setFSla(fSla === c.id ? null : c.id)}
              color={c.color}
              bg={c.bg}
              activeBg={c.activeBg}
              border={c.border}
              activeBorder={c.activeBorder}
              icon={c.icon}
              label={`${c.label} (${counts[c.id]})`}
            />
          ))}

          <div style={{ width: 1, height: 20, background: '#e8e8e8', flexShrink: 0, margin: '0 4px' }} />

          {SOURCES.map(src => {
            const tool = TOOLS[src];
            return (
              <NeutralChip
                key={src}
                active={fSources.has(src)}
                onClick={() => toggleSource(src)}
                icon={tool?.icon}
                label={tool?.label}
                color={tool?.color}
              />
            );
          })}

          <div style={{ width: 1, height: 20, background: '#e8e8e8', flexShrink: 0, margin: '0 4px' }} />

          <NeutralChip
            active={fUnassigned}
            onClick={() => setFUnassigned(!fUnassigned)}
            icon="bi-person-dash"
            label={`Unassigned (${counts.unassigned})`}
          />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                height: 30,
                padding: '0 10px',
                fontSize: 12,
                border: '1px solid #e0ddd8',
                borderRadius: 8,
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 180,
                background: 'var(--surface, #fff)',
                color: 'var(--text, #1b1b1b)',
              }}
            />
            <button
              type="button"
              className="deel-btn deel-btn-ghost deel-btn-sm"
              onClick={() => refresh()}
              disabled={loading}
              title="Refresh"
            >
              <i className="bi-arrow-clockwise" style={{ marginRight: 4, animation: loading ? 'spin 1s linear infinite' : undefined }} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--text-muted, #9b928a)' }}>
          <span>
            Showing <strong style={{ color: 'var(--text, #1b1b1b)' }}>{filtered.length}</strong> of {counts.total} tickets · {workspace.label}
            {meta?.role && <> · viewing as <strong style={{ color: 'var(--text, #1b1b1b)' }}>{meta.role}</strong></>}
          </span>
          <span>{meta?.cachedAt && `last sync ${new Date(meta.cachedAt).toLocaleTimeString()}`}</span>
        </div>
      </div>

      {/* ── Banners ───────────────────────────────────────────────────────── */}
      {isNotConfigured && (
        <div style={{ padding: '12px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#854d0e', fontSize: 13 }}>
          <strong>Zendesk not configured for {workspace.label}.</strong> {meta.message}
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
          <strong>Couldn't load tickets.</strong> {error.message}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: '#fafaf9' }}>
        {loading && !items.length ? (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: '#9b928a' }}>
            <i className="bi-arrow-repeat" style={{ fontSize: 32, display: 'block', marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Loading tickets…</div>
          </div>
        ) : !filtered.length ? (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: '#9b928a' }}>
            <i className="bi-inbox" style={{ fontSize: 48, display: 'block', marginBottom: 16, opacity: 0.3, color: '#c0c0c0' }} />
            <div style={{ fontSize: 17, fontWeight: 600, color: '#1b1b1b', marginBottom: 6 }}>
              {items.length === 0 ? 'Queue is clear' : 'No matches'}
            </div>
            <div style={{ fontSize: 14, color: '#9e9e9e' }}>
              {items.length === 0
                ? (meta?.role === 'agent' ? 'No tickets assigned to you.' : 'All caught up')
                : 'Try adjusting your filters'}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} role="grid" aria-label="Workspace queue">
            <thead>
              <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
                <th scope="col" style={{ ...thStyle, width: 70 }}>Source</th>
                <th scope="col" style={{ ...thStyle, textAlign: 'left', minWidth: 180 }}>Subject</th>
                <th scope="col" style={{ ...thStyle, width: 78 }}>Function</th>
                <th scope="col" style={{ ...thStyle, width: 54 }}>Country</th>
                <th scope="col" style={{ ...thStyle, width: 78 }}>Assignee</th>
                <th scope="col" style={{ ...thStyle, width: 58 }}>Received</th>
                <th scope="col" style={{ ...thStyle, width: 68 }}>SLA</th>
                <th scope="col" style={{ ...thStyle, width: 86 }}>Status</th>
                <th scope="col" style={{ ...thStyle, width: 56 }}>Link</th>
                <th scope="col" style={{ ...thStyle, width: 44 }} title="Personal notes — coming soon">Note</th>
                <th scope="col" style={{ ...thStyle, width: 136 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(task => <QueueRow key={task.id} task={task} />)}
            </tbody>
          </table>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────
// Single source of truth for ticket row visuals. Mirrors QueueRow inside
// HR's Queue.jsx (lines ~1380-1500).

function QueueRow({ task }) {
  const [hov, setHov] = useState(false);
  const priColor = PRIORITY_BORDER[task.priority] || '';
  const sla = task._sla;

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 44,
        borderBottom: '1px solid #f0efed',
        background: hov ? '#fafaf9' : 'white',
        transition: 'background 0.1s',
        borderLeft: priColor ? `3px solid ${priColor}` : '3px solid transparent',
      }}
    >
      {/* Source */}
      <td style={tdStyle}><ToolBadge source={task.source} /></td>

      {/* Subject */}
      <td title={task.subject || ''} style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.subject}</span>
        </div>
      </td>

      {/* Function */}
      <td style={tdStyle}>
        {task.type ? <FnBadge type={task.type} /> : <span style={{ color: '#d5d5d5' }}>--</span>}
      </td>

      {/* Country */}
      <td title={task.country || ''} style={{ ...tdStyle, fontSize: 12 }}>
        {task.country
          ? <span>{getFlag(task.country)} <span style={{ color: '#616161', fontWeight: 500 }}>{task.country}</span></span>
          : <span style={{ color: '#d5d5d5' }}>--</span>}
      </td>

      {/* Assignee */}
      <td title={task.assigneeName || 'Unassigned'} style={tdStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
          {task.assigneeName ? (
            <>
              <Avatar name={task.assigneeName} size="xs" />
              <span style={{ fontSize: 12, color: '#1b1b1b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {task.assigneeName.split(' ')[0]}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: '#9e9e9e', fontStyle: 'italic' }}>Unassigned</span>
          )}
        </div>
      </td>

      {/* Received */}
      <td style={{ ...tdStyle, fontSize: 12, color: '#616161', whiteSpace: 'nowrap' }}>
        {relTime(task.minutesAgo)}
      </td>

      {/* SLA */}
      <td style={tdStyle}><SlaBadge sla={sla} status={task.status} /></td>

      {/* Status */}
      <td style={tdStyle}>
        <StatusBadge status={task.status} subStatus={task.zdStatus && task.zdStatus !== task.status ? task.zdStatus : null} />
      </td>

      {/* External link */}
      <td style={tdStyle}>
        <a
          href={task.externalUrl || '#'}
          target="_blank"
          rel="noreferrer"
          onClick={e => { if (!task.externalUrl) e.preventDefault(); }}
          title={`Open in ${TOOLS[task.source]?.label || task.source}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 6,
            background: hov ? '#e8f0fe' : '#f5f4f2',
            color: hov ? '#1f74b3' : '#9e9e9e',
            fontSize: 10, fontWeight: 600, textDecoration: 'none',
            transition: 'all .15s', whiteSpace: 'nowrap',
            border: hov ? '1px solid #c8d9f0' : '1px solid transparent',
          }}
        >
          <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />
          <span style={{ fontSize: 10 }}>{task.externalId}</span>
        </a>
      </td>

      {/* Note — stub, surfaces hover state to match HR */}
      <td style={tdStyle}>
        <button
          type="button"
          disabled
          aria-label="Add personal note (coming soon)"
          title="Personal notes — coming soon"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 24, padding: 0, borderRadius: 6,
            background: hov ? '#fff8e6' : '#f5f4f2',
            color: hov ? '#b7791f' : '#9e9e9e',
            border: hov ? '1px solid #f4d96b' : '1px solid transparent',
            cursor: 'not-allowed', fontFamily: 'inherit', transition: 'all .15s',
            opacity: 0.6,
          }}
        >
          <i className="bi-sticky" style={{ fontSize: 12 }} />
        </button>
      </td>

      {/* Actions — stubs for now (Escalate / Hide need backend wiring) */}
      <td style={tdStyle}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            disabled
            title="Escalate — coming soon"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 6,
              background: hov ? '#f5f3ff' : '#f5f4f2',
              color: hov ? '#7c3aed' : '#9e9e9e',
              border: hov ? '1px solid #d4c4f0' : '1px solid transparent',
              fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
              cursor: 'not-allowed', fontFamily: 'inherit', opacity: 0.6,
            }}
          >
            <i className="bi-arrow-up-right-circle" style={{ fontSize: 9 }} />
            Escalate
          </button>
          <button
            type="button"
            disabled
            title="Hide — coming soon"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 6,
              background: hov ? '#fef2f2' : '#f5f4f2',
              color: hov ? '#d42d35' : '#9e9e9e',
              border: hov ? '1px solid #fca5a5' : '1px solid transparent',
              fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
              cursor: 'not-allowed', fontFamily: 'inherit', opacity: 0.6,
            }}
          >
            <i className="bi-eye-slash" style={{ fontSize: 9 }} />
            Hide
          </button>
        </div>
      </td>
    </tr>
  );
}
