// ── OrgView (Phase 0, 2026-05-20) ───────────────────────────────────────────
// Central command for the HR org structure: Department → Team → Sub-team →
// Member hierarchy with org-chart + table views. Phase 0 ships the shell —
// nav placement, view routing, permission wiring, and the loading scaffold.
// Subsequent phases bolt on CRUD (Phase 1), the visual chart (Phase 2),
// people-management modals lifted from Team.jsx (Phase 3), drag-and-drop
// (Phase 4), per-team config (Phase 5), downstream wiring (Phase 6), and
// bulk import/export + polish (Phase 7).
//
// All chrome (hero, toolbar, skeleton, empty state) is built against the
// design tokens in src/index.css so light/dark/responsive parity is free.
// No hardcoded hex outside the per-node accent slot.

import { useContext, useMemo, useState } from 'react';
import { PermissionsContext } from '../../App';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';

const VIEW_MODES = [
  { id: 'chart', label: 'Org chart', icon: 'bi-diagram-3' },
  { id: 'table', label: 'Table',     icon: 'bi-table' },
];

export default function OrgView({ user }) {
  const perms = useContext(PermissionsContext);
  const { members, loading } = useTeamMembers();
  const [viewMode, setViewMode] = useState('chart');
  const [search, setSearch] = useState('');

  const canEdit = perms?.canDo?.('can_manage_org') === true;

  // ── Phase 0 placeholder summary — counts read from the existing member
  // hook so the empty-shell still surfaces real data for the user. Phase 1
  // replaces this with the live org_nodes tree.
  const summary = useMemo(() => {
    const total = members?.length || 0;
    const withNode = members?.filter(m => m.orgNodeId).length || 0;
    return {
      total,
      assigned: withNode,
      unassigned: total - withNode,
    };
  }, [members]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '24px 32px 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-light)',
        flexShrink: 0,
      }}>
        {/* Custom hero — uses --text + --text-secondary tokens so dark mode
            stays legible. Doesn't reach for PageHeader because that component
            hardcodes a near-black title colour (pre-existing bug elsewhere). */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'var(--purple-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi bi-diagram-3-fill" style={{ color: 'var(--purple)', fontSize: 18 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              fontSize: 'var(--font-3xl)', fontWeight: 700,
              color: 'var(--text)', margin: 0, lineHeight: 1.3,
              letterSpacing: '-0.01em',
            }}>Org</h2>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-md)',
              margin: '4px 0 0', lineHeight: 1.4,
            }}>Departments, teams, sub-teams, and the people that power them.</p>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled
              title="Edit mode lands in Phase 1"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 36, padding: '0 14px',
                background: 'var(--purple)', color: 'white',
                border: 'none', borderRadius: 'var(--radius-lg)',
                fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'not-allowed', opacity: 0.55,
                flexShrink: 0,
              }}
            >
              <i className="bi bi-plus-lg" />
              New department
            </button>
          )}
        </div>

        {/* ── Toolbar: view-mode pills + search ──────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginTop: 18,
        }}>
          <div role="tablist" aria-label="Org view mode" style={{
            display: 'inline-flex',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-lg)',
            padding: 3, gap: 2,
          }}>
            {VIEW_MODES.map(m => {
              const active = viewMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setViewMode(m.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 30, padding: '0 12px',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    boxShadow: active ? 'var(--shadow-xs, 0 1px 2px rgba(0,0,0,.06))' : 'none',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    transition: 'all .12s',
                  }}
                >
                  <i className={`bi ${m.icon}`} style={{ fontSize: 12 }} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div style={{
            position: 'relative',
            flex: 1, maxWidth: 320,
          }}>
            <i className="bi bi-search" style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12, color: 'var(--text-muted)',
              pointerEvents: 'none',
            }} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search people, teams, departments…"
              aria-label="Search org"
              style={{
                width: '100%', height: 32,
                paddingLeft: 32, paddingRight: 12,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                fontSize: 13, color: 'var(--text)',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color .12s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>

          {/* Headcount summary */}
          <div style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center', gap: 16,
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <SummaryPill icon="bi-people" label="Total" value={summary.total} />
            <SummaryPill icon="bi-check-circle" label="Assigned" value={summary.assigned} tone="success" />
            {summary.unassigned > 0 && (
              <SummaryPill icon="bi-question-circle" label="Unassigned" value={summary.unassigned} tone="warn" />
            )}
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px 48px' }}>
        {loading ? (
          <ChartSkeleton />
        ) : (
          <ComingSoonScaffold viewMode={viewMode} canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}

// ── Small inline pill used in the toolbar summary ─────────────────────────
function SummaryPill({ icon, label, value, tone = 'default' }) {
  const palette = {
    default: { bg: 'transparent',         color: 'var(--text-secondary)' },
    success: { bg: 'var(--surface-2)',    color: 'var(--text-secondary)' },
    warn:    { bg: 'var(--orange-light)', color: 'var(--orange)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 'var(--radius-pill)',
      background: palette.bg, color: palette.color,
      fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      <i className={`bi ${icon}`} style={{ fontSize: 12 }} />
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <strong style={{ fontWeight: 700, color: tone === 'warn' ? 'var(--orange)' : 'var(--text)' }}>{value}</strong>
    </span>
  );
}

// ── Skeleton tree placeholder ─────────────────────────────────────────────
function ChartSkeleton() {
  const card = { borderRadius: 12 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <Skeleton width={220} height={48} style={card} />
      <div style={{ display: 'flex', gap: 16 }}>
        <Skeleton width={180} height={40} style={{ borderRadius: 10 }} />
        <Skeleton width={180} height={40} style={{ borderRadius: 10 }} />
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width={120} height={64} style={card} />
        ))}
      </div>
    </div>
  );
}

// ── Phase 0 scaffold: explains what's coming, shows the seeded structure
// will be live in Phase 1, and offers a clear empty state until the chart
// renderer is wired in Phase 2.
function ComingSoonScaffold({ viewMode, canEdit }) {
  const isChart = viewMode === 'chart';
  return (
    <div style={{
      maxWidth: 720, margin: '8vh auto 0',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', gap: 'var(--space-4)',
    }}>
      <div style={{
        width: 64, height: 64,
        borderRadius: 16,
        background: 'var(--purple-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <i className={`bi ${isChart ? 'bi-diagram-3-fill' : 'bi-table'}`}
          style={{ fontSize: 28, color: 'var(--purple)' }} />
      </div>
      <h3 style={{ fontSize: 'var(--font-xl)', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
        The Org tab is being assembled
      </h3>
      <p style={{
        fontSize: 'var(--font-md)', color: 'var(--text-secondary)',
        maxWidth: 480, margin: 0, lineHeight: 1.5,
      }}>
        Phase 0 wires the foundation — schema, permissions, and this navigation
        slot. The interactive {isChart ? 'org chart' : 'table view'}, drag-to-move
        people, per-team configuration, and bulk operations land in the next
        phases.
      </p>
      <div style={{
        marginTop: 'var(--space-4)',
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))',
        gap: 'var(--space-3)', textAlign: 'left',
        width: '100%',
      }}>
        <RoadmapCard phase="Phase 1" title="Departments & teams" body="Create, rename, move, and archive nodes." status="next" />
        <RoadmapCard phase="Phase 2" title="Visual org chart" body="Tree with collapsible groups + table toggle." />
        <RoadmapCard phase="Phase 3" title="People management" body="Add, edit, allocate — lifted from Leaders Hub." />
        <RoadmapCard phase="Phase 4" title="Drag-and-drop moves" body="Reassign people and restructure with impact preview." />
        <RoadmapCard phase="Phase 5" title="Per-team config" body="SLA cascade, MOC rotation, delegated admins." />
        <RoadmapCard phase="Phase 6" title="Downstream wiring" body="Briefing, Queue, HR Hub all read the new structure." />
      </div>
      {!canEdit && (
        <EmptyState
          icon="bi-shield-check"
          title="Read-only access"
          subtitle="You can browse the org chart in every phase. Edit actions are gated behind admin or regional-manager permissions."
        />
      )}
    </div>
  );
}

function RoadmapCard({ phase, title, body, status }) {
  const isNext = status === 'next';
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface)',
      border: `1px solid ${isNext ? 'var(--purple)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      boxShadow: isNext ? '0 0 0 3px var(--purple-light)' : 'none',
      transition: 'box-shadow .15s, border-color .15s',
    }}>
      <div style={{
        fontSize: 'var(--font-xs)', fontWeight: 700,
        color: isNext ? 'var(--purple)' : 'var(--text-muted)',
        letterSpacing: 'var(--ls-caps, 0.06em)',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>{phase}{isNext ? ' · up next' : ''}</div>
      <div style={{
        fontSize: 'var(--font-md)', fontWeight: 600,
        color: 'var(--text)', marginBottom: 4,
      }}>{title}</div>
      <div style={{
        fontSize: 'var(--font-sm)', color: 'var(--text-secondary)',
        lineHeight: 1.4,
      }}>{body}</div>
    </div>
  );
}
