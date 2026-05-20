// ── OrgView (Phase 1, 2026-05-20) ───────────────────────────────────────────
// Central command for the HR org structure: Department → Team → Sub-team →
// Member hierarchy with org-chart + table views. Phase 0 wired schema,
// permissions, and the navigation slot; Phase 1 ships the live tree with
// admin CRUD (create, rename, archive, move, reorder, color/icon/lead/
// countries/slack). Phase 2 wraps a Slack-style visual chart around the
// same data; Phase 3 lifts member management out of Team.jsx.
//
// All chrome is built against the design tokens in src/index.css so
// light/dark/responsive parity is automatic. No hardcoded hex outside the
// per-node accent slot.

import { useCallback, useContext, useMemo, useState } from 'react';
import { PermissionsContext } from '../../App';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useOrgNodes } from '../../hooks/useOrgNodes';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';
import OrgTreeView from '../org/OrgTreeView';
import OrgChartCanvas from '../org/OrgChartCanvas';
import OrgNodeFormDrawer from '../org/OrgNodeFormDrawer';
import OrgArchiveConfirm from '../org/OrgArchiveConfirm';
import MemberDetailDrawer from '../org/MemberDetailDrawer';
import AddMemberModal from '../org/AddMemberModal';
import OrgMovePreviewModal from '../org/OrgMovePreviewModal';
import BulkMoveBar from '../org/BulkMoveBar';
import OrgAuditDrawer from '../org/OrgAuditDrawer';
import { buildStructureCsv, buildMembersCsv, downloadCsv } from '../../utils/orgCsvExport';

const VIEW_MODES = [
  { id: 'chart', label: 'Chart', icon: 'bi-diagram-3-fill' },
  { id: 'list',  label: 'List',  icon: 'bi-list-ul' },
  { id: 'table', label: 'Table', icon: 'bi-table' },
];

// Phase 10a (2026-05-20): the only "global super-admin" allowed to use the
// per-row "Login as dept admin" affordance. Every other access=admin user is
// expected to live inside one department's tenancy. Phase 11 swaps this for
// a real `is_global_super_admin` flag — the constant lives in one place so
// the migration is a single grep.
const GLOBAL_SUPER_ADMIN_EMAIL = 'mohamed.tantawy@deel.com';

export default function OrgView({ user, realUser, onImpersonate }) {
  const perms = useContext(PermissionsContext);
  const tm = useTeamMembers();
  const { members } = tm;
  const org = useOrgNodes();
  // Resolved on the REAL user — impersonation doesn't grant the button.
  const isGlobalSuperAdmin =
    (realUser?.email || user?.email || '').toLowerCase() === GLOBAL_SUPER_ADMIN_EMAIL;
  const handleLoginAsDeptAdmin = useCallback((leadEmail) => {
    if (!isGlobalSuperAdmin || !leadEmail || !onImpersonate) return;
    onImpersonate(String(leadEmail).toLowerCase());
  }, [isGlobalSuperAdmin, onImpersonate]);
  const [viewMode, setViewMode] = useState('chart');
  const [search, setSearch] = useState('');

  // ── Member-side modals (Phase 3) ────────────────────────────────────────
  const [selectedMember, setSelectedMember] = useState(null);
  const [addMemberTo, setAddMemberTo] = useState(null);

  // ── Phase 4: multi-select + drag-to-move ────────────────────────────────
  const [selectedEmails, setSelectedEmails] = useState(() => new Set());
  const [movePayload, setMovePayload] = useState(null);
  // ── Phase 7: audit drawer + CSV export menu ─────────────────────────────
  const [auditOpen, setAuditOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportStructure = () => {
    downloadCsv(`org-structure-${new Date().toISOString().slice(0, 10)}.csv`,
      buildStructureCsv(org.nodes, org.tree));
    setExportMenuOpen(false);
  };
  const exportMembers = () => {
    downloadCsv(`org-members-${new Date().toISOString().slice(0, 10)}.csv`,
      buildMembersCsv(members || [], org.tree));
    setExportMenuOpen(false);
  };
  const toggleSelected = (email) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };
  const clearSelection = () => setSelectedEmails(new Set());
  const emailsToMembers = (emails) => {
    const lookup = new Map((members || []).map(m => [m.email, m]));
    return emails.map(e => lookup.get(e)).filter(Boolean);
  };
  const openMovePreview = (emails, targetNode) => {
    const resolved = emailsToMembers(emails);
    if (resolved.length === 0 || !targetNode) return;
    setMovePayload({ members: resolved, target: targetNode });
  };
  const applyMove = async ({ members: ms, target }) => {
    // Sequentially patch each member — keeps the API single-row contract
    // intact. With 100+ members per bulk move this is still fast enough
    // (DB round-trips are sub-100ms each); Phase 7 swaps in a bulk
    // endpoint if needed.
    for (const m of ms) {
      const res = await tm.updateMember(m.email, { orgNodeId: target.id });
      if (res && res.ok === false) {
        throw new Error(res.error || `Failed to move ${m.name}`);
      }
    }
    clearSelection();
    org.reload();
  };

  // Permission to edit comes from the API response (server-side
  // authoritative) but we fall back to the local perms snapshot so the
  // edit affordances render immediately while the first fetch is in
  // flight or while the API is unreachable (degraded mode). The
  // canonical property name is `canManageOrg` — `canDo()` only covers
  // ALL_ACTIONS, not ALL_ADMIN_POWERS.
  const canEdit = org.canEdit || perms?.canManageOrg === true;

  // Phase 10b (2026-05-20): for the lead-email warning in OrgNodeFormDrawer.
  // Resolves an email to its current top-level department so the drawer can
  // say "moving them out of <dept>" when an admin types a lead email that
  // already belongs somewhere else. Walks up parent_id chains because a
  // member may sit under a sub-team but the isolation boundary is the
  // top-level dept (per the locked multi-tenant decisions, 2026-05-20).
  const getCurrentDeptForEmail = useCallback((email) => {
    if (!email || !Array.isArray(members)) return null;
    const lc = String(email).toLowerCase().trim();
    if (!lc) return null;
    const m = members.find(x => x.email && x.email.toLowerCase() === lc);
    if (!m?.orgNodeId) return null;
    const node = org.tree.byId?.get(m.orgNodeId);
    if (!node) return null;
    let topLevel = node;
    let guard = 0;
    while (topLevel.parentId && guard < 16) {
      const parent = org.tree.byId.get(topLevel.parentId);
      if (!parent) break;
      topLevel = parent;
      guard += 1;
    }
    return { node, topLevel, memberName: m.name || m.email };
  }, [members, org.tree]);

  // ── Modals ─────────────────────────────────────────────────────────────
  const [formState, setFormState] = useState(null); // { mode, parent?, defaultKind?, node? }
  const [archiveTarget, setArchiveTarget] = useState(null);

  const openCreateRoot = () => setFormState({ mode: 'create', defaultKind: 'department', parent: null });
  const openCreateChild = (parent, kind) => setFormState({ mode: 'create', parent, defaultKind: kind });
  const openEdit = (node) => setFormState({ mode: 'edit', node, parent: node.parentId ? org.tree.byId.get(node.parentId) : null });
  const closeForm = () => setFormState(null);

  // Phase 8: clicking Archive on an already-archived node restores it.
  const handleArchiveOrRestore = async (node) => {
    if (node.isArchived) {
      try { await org.restoreNode(node.id); }
      catch (err) { alert(err?.message || 'Could not restore'); }
      return;
    }
    setArchiveTarget(node);
  };

  const onSaveForm = async (payload) => {
    if (formState.mode === 'create') {
      await org.createNode(payload);
    } else {
      await org.updateNode(formState.node.id, payload);
    }
  };

  const onArchiveConfirm = async (node) => {
    await org.archiveNode(node.id);
  };

  // ── Summary chips read live node counts so the hero stays in sync ──────
  const summary = useMemo(() => {
    const total = members?.length || 0;
    const withNode = members?.filter(m => m.orgNodeId).length || 0;
    return {
      total,
      assigned: withNode,
      unassigned: total - withNode,
      departments: org.nodes.filter(n => n.kind === 'department' && !n.isArchived).length,
      teams: org.nodes.filter(n => n.kind === 'team' && !n.isArchived).length,
    };
  }, [members, org.nodes]);

  const showWelcome = !org.loading && org.rootNodes.length === 0 && !search;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '24px 32px 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-light)',
        flexShrink: 0,
      }}>
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* Phase 7: export menu */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setExportMenuOpen(p => !p)}
                aria-label="Export"
                title="Export CSV"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 36, padding: '0 12px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 13, fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer', transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <i className="bi bi-download" /> Export
              </button>
              {exportMenuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.14)',
                  minWidth: 220, padding: 6, zIndex: 200,
                }} onMouseLeave={() => setExportMenuOpen(false)}>
                  <ExportItem icon="bi-diagram-3" label="Org structure (CSV)" onClick={exportStructure} />
                  <ExportItem icon="bi-people" label="Members roster (CSV)" onClick={exportMembers} />
                </div>
              )}
            </div>
            {/* Phase 7: audit drawer toggle, admin-only */}
            {canEdit && (
              <button
                type="button"
                onClick={() => setAuditOpen(true)}
                aria-label="Audit log"
                title="Audit log"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 36, padding: '0 12px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 13, fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer', transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <i className="bi bi-journal-text" /> Audit
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={openCreateRoot}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 36, padding: '0 14px',
                  background: 'var(--purple)', color: 'white',
                  border: 'none', borderRadius: 'var(--radius-lg)',
                  fontSize: 13, fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--purple-hover, #6d28d9)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--purple)'}
              >
                <i className="bi bi-plus-lg" />
                New department
              </button>
            )}
          </div>
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginTop: 18, flexWrap: 'wrap',
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
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
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

          <div style={{ position: 'relative', flex: 1, maxWidth: 360, minWidth: 200 }}>
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
                boxSizing: 'border-box',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>

          <div style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 12, color: 'var(--text-secondary)',
            flexWrap: 'wrap',
          }}>
            {/* Phase 8: include-archived toggle, admin-only */}
            {canEdit && (
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 'var(--font-xs)', fontWeight: 600,
                color: org.includeArchived ? 'var(--orange)' : 'var(--text-muted)',
                cursor: 'pointer', userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={org.includeArchived}
                  onChange={e => org.setIncludeArchived(e.target.checked)}
                  style={{ accentColor: 'var(--orange)' }}
                />
                <i className="bi bi-archive" /> Show archived
              </label>
            )}
            <SummaryPill icon="bi-building"        label="Depts"      value={summary.departments} />
            <SummaryPill icon="bi-people"          label="Teams"      value={summary.teams} />
            <SummaryPill icon="bi-person-fill"     label="Total"      value={summary.total} />
            <SummaryPill icon="bi-check-circle"    label="Assigned"   value={summary.assigned} tone="success" />
            {summary.unassigned > 0 && (
              <SummaryPill icon="bi-question-circle" label="Unassigned" value={summary.unassigned} tone="warn" />
            )}
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px 48px' }}>
        {org.loading ? (
          <TreeSkeleton />
        ) : org.error && org.rootNodes.length === 0 ? (
          <EmptyState
            icon="bi-exclamation-triangle"
            title="Couldn't load the org tree"
            subtitle="The org API didn't respond. Reload to try again — your structure is safe."
            action={
              <button
                type="button"
                onClick={() => org.reload()}
                style={primaryBtn()}
              >
                <i className="bi bi-arrow-clockwise" /> Reload
              </button>
            }
          />
        ) : showWelcome ? (
          <WelcomeScaffold canEdit={canEdit} onCreate={openCreateRoot} />
        ) : viewMode === 'chart' ? (
          <OrgChartCanvas
            tree={org.tree}
            rootNodes={org.rootNodes}
            members={members}
            search={search}
            canEdit={canEdit}
            sumDescendants={org.sumDescendants}
            onSelectNode={openEdit}
            onEdit={openEdit}
            onAddChild={openCreateChild}
            onArchive={handleArchiveOrRestore}
            onAddMember={(node) => setAddMemberTo(node)}
            onSelectMember={(m) => setSelectedMember(m)}
            selectedEmails={selectedEmails}
            onToggleSelect={toggleSelected}
            onDropMembers={openMovePreview}
            isGlobalSuperAdmin={isGlobalSuperAdmin}
            onLoginAsDeptAdmin={handleLoginAsDeptAdmin}
          />
        ) : viewMode === 'list' ? (
          <OrgTreeView
            tree={org.tree}
            rootNodes={org.rootNodes}
            search={search}
            canEdit={canEdit}
            sumDescendants={org.sumDescendants}
            onEdit={openEdit}
            onAddChild={openCreateChild}
            onArchive={handleArchiveOrRestore}
            onAddMember={(node) => setAddMemberTo(node)}
            onSelect={openEdit}
            isGlobalSuperAdmin={isGlobalSuperAdmin}
            onLoginAsDeptAdmin={handleLoginAsDeptAdmin}
          />
        ) : (
          <TablePreview nodes={org.nodes} members={members} tree={org.tree} search={search} onSelectMember={(m) => setSelectedMember(m)} />
        )}
      </div>

      {/* ── Drawers / modals ──────────────────────────────────────────────── */}
      {formState && (
        <OrgNodeFormDrawer
          open
          mode={formState.mode}
          parentNode={formState.parent}
          defaultKind={formState.defaultKind}
          node={formState.node}
          onClose={closeForm}
          onSave={onSaveForm}
          getCurrentDeptForEmail={getCurrentDeptForEmail}
        />
      )}
      <OrgArchiveConfirm
        open={!!archiveTarget}
        node={archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={onArchiveConfirm}
      />
      <MemberDetailDrawer
        open={!!selectedMember}
        member={selectedMember}
        tree={org.tree}
        rootNodes={org.rootNodes}
        canEdit={canEdit}
        onClose={() => setSelectedMember(null)}
        onUpdate={tm.updateMember}
        onRemove={tm.removeMember}
        onToggleLeave={tm.toggleOnLeave}
        onSetCountries={tm.setCountries}
      />
      <AddMemberModal
        open={!!addMemberTo}
        node={addMemberTo}
        leadEmail={addMemberTo?.leadEmail || null}
        onClose={() => setAddMemberTo(null)}
        onSubmit={async (payload) => {
          const res = await tm.addMember(payload);
          if (res?.ok !== false) org.reload();
          return res;
        }}
      />
      <OrgMovePreviewModal
        open={!!movePayload}
        payload={movePayload}
        onClose={() => setMovePayload(null)}
        onConfirm={applyMove}
      />
      {canEdit && (
        <BulkMoveBar
          selectedCount={selectedEmails.size}
          rootNodes={org.rootNodes}
          tree={org.tree}
          onCancel={clearSelection}
          onChooseTarget={(node) => openMovePreview(Array.from(selectedEmails), node)}
        />
      )}
      <OrgAuditDrawer open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}

function ExportItem({ icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 10px',
        background: 'transparent', border: 'none',
        textAlign: 'left',
        fontSize: 'var(--font-sm)', fontWeight: 500,
        color: 'var(--text)',
        cursor: 'pointer', borderRadius: 6,
        fontFamily: 'inherit',
      }}>
      <i className={`bi ${icon}`} style={{ fontSize: 13, color: 'var(--text-secondary)' }} />
      {label}
    </button>
  );
}

// ── Small inline pill used in the toolbar summary ─────────────────────────
function SummaryPill({ icon, label, value, tone = 'default' }) {
  const palette = {
    default: { bg: 'transparent',         color: 'var(--text-secondary)', strong: 'var(--text)' },
    success: { bg: 'var(--surface-2)',    color: 'var(--text-secondary)', strong: 'var(--text)' },
    warn:    { bg: 'var(--orange-light)', color: 'var(--orange)',         strong: 'var(--orange)' },
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
      <strong style={{ fontWeight: 700, color: palette.strong }}>{value}</strong>
    </span>
  );
}

// ── Tree skeleton placeholder ─────────────────────────────────────────────
function TreeSkeleton() {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          padding: '12px 16px',
          paddingLeft: 16 + (i % 3) * 24,
          borderBottom: i < 5 ? '1px solid var(--border-light)' : 'none',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Skeleton width={22} height={22} style={{ borderRadius: 6 }} />
          <Skeleton width={28} height={28} style={{ borderRadius: 8 }} />
          <Skeleton width={Math.round(180 - i * 12)} height={14} />
          <Skeleton width={64} height={20} style={{ borderRadius: 20, marginLeft: 'auto' }} />
          <Skeleton width={42} height={20} style={{ borderRadius: 20 }} />
        </div>
      ))}
    </div>
  );
}

// ── First-run welcome scaffold (no nodes yet) ─────────────────────────────
function WelcomeScaffold({ canEdit, onCreate }) {
  return (
    <div style={{
      maxWidth: 720, margin: '6vh auto 0',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', gap: 'var(--space-4)',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: 'var(--purple-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <i className="bi bi-diagram-3-fill" style={{ fontSize: 28, color: 'var(--purple)' }} />
      </div>
      <h3 style={{ fontSize: 'var(--font-xl)', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
        Build your org from scratch
      </h3>
      <p style={{
        fontSize: 'var(--font-md)', color: 'var(--text-secondary)',
        maxWidth: 480, margin: 0, lineHeight: 1.5,
      }}>
        Start with a department, then nest teams (and sub-teams) under it.
        Assign leads, countries, and Slack channels as you go. Members get
        moved in once the structure is in place.
      </p>
      {canEdit && (
        <button type="button" onClick={onCreate} style={primaryBtn({ height: 40, padding: '0 18px' })}>
          <i className="bi bi-plus-lg" />
          Create your first department
        </button>
      )}
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────
// Phase 9 (2026-05-20): table now interleaves members under each node so
// admins can scan who's where without bouncing to the chart. Sort: kind
// (Department first, then Team), then name. Members appear indented below
// their parent node with their org-path resolved from the tree map.
function TablePreview({ nodes, members = [], tree, search, onSelectMember }) {
  const lc = (search || '').toLowerCase().trim();
  const matchesNode = (n) => !lc || n.name.toLowerCase().includes(lc) || (n.leadEmail || '').toLowerCase().includes(lc);
  const matchesMember = (m) => !lc
    || (m.name || '').toLowerCase().includes(lc)
    || (m.email || '').toLowerCase().includes(lc)
    || (m.title || '').toLowerCase().includes(lc);
  const visibleNodes = nodes
    .filter(n => !n.isArchived)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  // Group members by node id for quick lookup.
  const byNode = new Map();
  for (const m of members) {
    const key = m.orgNodeId || '__unassigned__';
    if (!byNode.has(key)) byNode.set(key, []);
    byNode.get(key).push(m);
  }
  for (const list of byNode.values()) list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Build the flat row list: per-node rows + per-member rows directly under.
  const rows = [];
  for (const n of visibleNodes) {
    const nodeMatches = matchesNode(n);
    const nodeMembers = (byNode.get(n.id) || []).filter(matchesMember);
    if (!nodeMatches && nodeMembers.length === 0) continue;
    rows.push({ kind: 'node', node: n });
    for (const m of nodeMembers) rows.push({ kind: 'member', node: n, member: m });
  }
  // Truly unassigned members appear in their own bucket.
  const unassigned = (byNode.get('__unassigned__') || []).filter(matchesMember);
  if (unassigned.length) {
    rows.push({ kind: 'group-header', label: 'Unassigned' });
    for (const m of unassigned) rows.push({ kind: 'member', node: null, member: m });
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon="bi-table"
        title="Nothing to show"
        subtitle="Try a different search, or switch back to the chart view."
      />
    );
  }
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr 1fr 100px 100px',
        padding: '10px 16px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border-light)',
        fontSize: 'var(--font-xs)',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>
        <div>Kind</div>
        <div>Name</div>
        <div>Lead / Role</div>
        <div style={{ textAlign: 'right' }}>Direct</div>
        <div style={{ textAlign: 'right' }}>Vacant</div>
      </div>
      {rows.map((r, i) => {
        const isLast = i === rows.length - 1;
        if (r.kind === 'group-header') {
          return (
            <div key={`gh-${i}`} style={{
              padding: '10px 16px',
              background: 'var(--orange-light)',
              color: 'var(--orange)',
              fontSize: 'var(--font-xs)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: !isLast ? '1px solid var(--border-light)' : 'none',
            }}>{r.label}</div>
          );
        }
        if (r.kind === 'node') {
          const n = r.node;
          return (
            <div key={n.id} style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr 100px 100px',
              padding: '10px 16px',
              borderBottom: !isLast ? '1px solid var(--border-light)' : 'none',
              alignItems: 'center',
              fontSize: 'var(--font-md)', color: 'var(--text)',
              background: n.kind === 'department' ? 'var(--purple-light)' : 'var(--surface-2)',
            }}>
              <div>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-pill)',
                  background: n.kind === 'department' ? 'var(--purple)' : 'var(--surface-3)',
                  color: n.kind === 'department' ? 'white' : 'var(--text-secondary)',
                  fontSize: 'var(--font-xs)', fontWeight: 600,
                  textTransform: 'capitalize',
                }}>{n.kind}</span>
              </div>
              <div style={{ fontWeight: 700 }}>{n.name}</div>
              <div style={{ color: 'var(--text-secondary)' }}>{n.leadEmail || '—'}</div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{(byNode.get(n.id) || []).length}</div>
              <div style={{ textAlign: 'right', color: n.vacantCount ? 'var(--orange)' : 'var(--text-muted)', fontWeight: n.vacantCount ? 700 : 500 }}>{n.vacantCount || 0}</div>
            </div>
          );
        }
        // member row
        const m = r.member;
        return (
          <div
            key={`mr-${m.email}`}
            onClick={() => onSelectMember?.(m)}
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr 100px 100px',
              padding: '8px 16px 8px 32px',
              borderBottom: !isLast ? '1px solid var(--border-light)' : 'none',
              alignItems: 'center',
              fontSize: 'var(--font-sm)', color: 'var(--text)',
              cursor: onSelectMember ? 'pointer' : 'default',
              transition: 'background .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div>
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--surface-3)',
                color: 'var(--text-muted)',
                fontSize: 'var(--font-xs)', fontWeight: 600,
              }}>member</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'var(--purple-light)', color: 'var(--purple)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                overflow: 'hidden',
              }}>{m.initials || (m.name || m.email).slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
              </div>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>{m.title || '—'}</div>
            <div style={{ textAlign: 'right', fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{m.access || ''}</div>
            <div style={{ textAlign: 'right', fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{m.country || ''}</div>
          </div>
        );
      })}
    </div>
  );
}

function primaryBtn(extra = {}) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 36, padding: '0 14px',
    background: 'var(--purple)', color: 'white',
    border: 'none', borderRadius: 'var(--radius-lg)',
    fontSize: 13, fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'background .12s',
    ...extra,
  };
}
