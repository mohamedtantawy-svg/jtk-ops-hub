// ── DeptManagementPanel (Phase 12a, 2026-05-25) ───────────────────────────
// Per-department management surface, opened from the Org tab when a top-
// level dept is selected. Sub-tabs:
//   • Overview          — short rollup (name, lead, headcount, sub-tree)
//   • SWAT Functions    — table of named functions with assignees + backups
//   • Responsibilities  — table of named responsibilities with assignees + backups
//
// SWAT and Responsibilities share the same row shape (Name + Description +
// Assignees + Backups) and route through useNodeAssignments with different
// `kind` filters. The "Backup covering" badge surfaces when any primary
// assignee on a row is on approved leave (server-resolved oooEmails).
//
// Read access is open to anyone with Org-tab view permission; edit is
// gated by canEdit (server-side org_node_admin grant or global org-admin).
// The Overview pane has no edit affordances yet — it's a pure rollup so
// admins see the dept identity before drilling into the lists.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNodeAssignments } from '../../hooks/useNodeAssignments';
import { membersInSubtree, subtreeNodeIds } from '../../lib/org-scope';
import MemberMultiPicker from './MemberMultiPicker';
import Avatar from '../ui/Avatar';

const SUB_TABS = [
  { id: 'overview',         label: 'Overview',         icon: 'bi-info-circle' },
  { id: 'swat_function',    label: 'SWAT Functions',   icon: 'bi-shield-check' },
  { id: 'responsibility',   label: 'Responsibilities', icon: 'bi-clipboard-check' },
];

const KIND_COPY = {
  swat_function: {
    title: 'SWAT Functions',
    description: 'Critical functions owned by this department. Each row names a function, who owns it, and who covers when the primary is unavailable.',
    addLabel: 'Add SWAT function',
    namePlaceholder: 'Function name (e.g. EOR Compliance Review)',
    emptyTitle: 'No SWAT functions yet',
    emptySubtitle: 'Add the first function and assign a primary owner + backup so coverage stays clear.',
  },
  responsibility: {
    title: 'Responsibilities',
    description: 'Standing responsibilities for this department. Use this to record ongoing area ownership beyond formal SWAT functions.',
    addLabel: 'Add responsibility',
    namePlaceholder: 'Responsibility name (e.g. Manager-on-call rotation)',
    emptyTitle: 'No responsibilities yet',
    emptySubtitle: 'Add the first responsibility to set primary + backup ownership for the team.',
  },
};

export default function DeptManagementPanel({
  node,
  members = [],
  tree,
  rootNodes,
  perms,
  onBack,
  onLoginAsDeptAdmin,
  isGlobalSuperAdmin,
}) {
  const [activeTab, setActiveTab] = useState('swat_function');
  const {
    assignments,
    oooEmails,
    canEdit: assignmentCanEdit,
    loading,
    error,
    reload,
    create,
    update,
    archive,
  } = useNodeAssignments(node?.id || null);
  const canEdit = assignmentCanEdit === true || perms?.canManageOrg === true;

  // Resolve dept members (this dept + every descendant team) so the picker
  // has the right candidate list. The Org tab elsewhere already does this
  // via membersInSubtree — we mirror that here.
  const deptMembers = useMemo(() => {
    if (!node?.id || !tree?.byParent) return [];
    return membersInSubtree(members, node.id, tree.byParent, { includeUnassigned: false });
  }, [node?.id, tree, members]);

  const deptHeadcount = useMemo(() => {
    if (!node?.id || !tree?.byParent) return 0;
    return subtreeNodeIds(node.id, tree.byParent).size;
  }, [node?.id, tree]);

  // Split the flat assignments list into the two kinds for fast rendering.
  const byKind = useMemo(() => {
    const grouped = { swat_function: [], responsibility: [] };
    for (const a of assignments) {
      if (grouped[a.kind]) grouped[a.kind].push(a);
    }
    return grouped;
  }, [assignments]);

  if (!node) return null;

  const accent = node.color || 'var(--purple)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DeptHeader
        node={node}
        accent={accent}
        deptHeadcount={deptHeadcount}
        memberCount={deptMembers.length}
        onBack={onBack}
        onLoginAsDeptAdmin={onLoginAsDeptAdmin}
        isGlobalSuperAdmin={isGlobalSuperAdmin}
      />

      <SubTabRail
        tabs={SUB_TABS}
        active={activeTab}
        counts={{
          overview: null,
          swat_function: byKind.swat_function.length,
          responsibility: byKind.responsibility.length,
        }}
        onChange={setActiveTab}
      />

      {activeTab === 'overview' && (
        <OverviewPane node={node} members={deptMembers} memberCount={deptMembers.length} />
      )}

      {activeTab !== 'overview' && (
        <AssignmentsPane
          kind={activeTab}
          rows={byKind[activeTab] || []}
          loading={loading}
          error={error}
          canEdit={canEdit}
          candidates={deptMembers}
          oooEmails={oooEmails}
          onReload={reload}
          onCreate={create}
          onUpdate={update}
          onArchive={archive}
        />
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────
function DeptHeader({ node, accent, deptHeadcount, memberCount, onBack, onLoginAsDeptAdmin, isGlobalSuperAdmin }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: 16,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Org"
        title="Back to Org"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 10px',
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12, fontWeight: 600,
          fontFamily: 'inherit',
          cursor: 'pointer', transition: 'background .12s',
          flexShrink: 0,
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <i className="bi bi-arrow-left" /> Back to Org
      </button>

      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: 'var(--purple-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <i className={`bi ${node.icon || 'bi-building'}`} style={{ color: accent, fontSize: 20 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{
            fontSize: 'var(--font-xl)', fontWeight: 700,
            color: 'var(--text)', margin: 0, lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: '60ch',
          }}>{node.name}</h2>
          <span style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--purple-light)',
            color: 'var(--purple)',
            fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>Department</span>
        </div>
        <div style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--font-sm)',
          marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap',
        }}>
          {node.leadEmail && <span><i className="bi bi-person-badge" style={{ marginRight: 4 }} /> Lead: {node.leadEmail}</span>}
          <span><i className="bi bi-people" style={{ marginRight: 4 }} /> {memberCount} members</span>
          <span><i className="bi bi-diagram-2" style={{ marginRight: 4 }} /> {deptHeadcount} nodes in tree</span>
          {node.slug && <span style={{ color: 'var(--text-muted)' }}><code style={{ fontSize: 11 }}>slug: {node.slug}</code></span>}
        </div>
      </div>

      {isGlobalSuperAdmin && node.leadEmail && onLoginAsDeptAdmin && (
        <button
          type="button"
          onClick={() => onLoginAsDeptAdmin(node.leadEmail)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 32, padding: '0 12px',
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12, fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer', transition: 'background .12s',
            flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={`Login as ${node.leadEmail}`}
        >
          <i className="bi bi-box-arrow-in-right" /> Login as lead
        </button>
      )}
    </div>
  );
}

// ── Sub-tab rail (Feedback-pattern segmented control) ───────────────────
function SubTabRail({ tabs, active, counts, onChange }) {
  return (
    <div role="tablist" aria-label="Department management sections" style={{
      display: 'inline-flex',
      background: 'var(--surface-2)',
      borderRadius: 'var(--radius-lg)',
      padding: 3, gap: 2,
      width: 'fit-content',
    }}>
      {tabs.map(t => {
        const isActive = active === t.id;
        const count = counts ? counts[t.id] : null;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 32, padding: '0 14px',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              background: isActive ? 'var(--surface)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--text-secondary)',
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'all .12s',
            }}
          >
            <i className={`bi ${t.icon}`} style={{ fontSize: 12 }} />
            {t.label}
            {count != null && (
              <span style={{
                padding: '1px 6px', borderRadius: 'var(--radius-pill)',
                background: isActive ? 'var(--purple-light)' : 'var(--surface-3)',
                color: isActive ? 'var(--purple)' : 'var(--text-muted)',
                fontSize: 10, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Overview pane ────────────────────────────────────────────────────────
function OverviewPane({ node, members, memberCount }) {
  const leadMember = useMemo(() => {
    const lead = (node.leadEmail || '').toLowerCase();
    if (!lead) return null;
    return members.find(m => (m.email || '').toLowerCase() === lead) || null;
  }, [members, node.leadEmail]);

  return (
    <div style={{
      padding: 16,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: 16,
    }}>
      <OverviewCard label="Department lead" icon="bi-person-badge">
        {leadMember ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={leadMember.name} initials={leadMember.initials} src={leadMember.avatarUrl} size="md" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{leadMember.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{leadMember.email}</div>
            </div>
          </div>
        ) : node.leadEmail ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{node.leadEmail}</div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>— No lead assigned</div>
        )}
      </OverviewCard>

      <OverviewCard label="Members" icon="bi-people">
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {memberCount}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>across this department and its teams</div>
      </OverviewCard>

      <OverviewCard label="Description" icon="bi-text-paragraph">
        <div style={{
          color: node.description ? 'var(--text)' : 'var(--text-muted)',
          fontSize: 12, lineHeight: 1.5,
        }}>{node.description || '— No description set'}</div>
      </OverviewCard>
    </div>
  );
}

function OverviewCard({ label, icon, children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 14,
      background: 'var(--surface-2)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <i className={`bi ${icon}`} /> {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Assignments pane (SWAT / Responsibilities) ──────────────────────────
function AssignmentsPane({ kind, rows, loading, error, canEdit, candidates, oooEmails, onReload, onCreate, onUpdate, onArchive }) {
  const copy = KIND_COPY[kind] || KIND_COPY.swat_function;
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const handleCreate = useCallback(async (payload) => {
    setBusy(true);
    setActionError(null);
    try {
      await onCreate({ ...payload, kind });
      setComposerOpen(false);
    } catch (err) {
      setActionError(err?.message || 'Failed to add row');
    } finally {
      setBusy(false);
    }
  }, [kind, onCreate]);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        padding: '16px 18px',
        borderBottom: '1px solid var(--border-light)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            {copy.title}
          </h3>
          <p style={{
            fontSize: 'var(--font-sm)', color: 'var(--text-secondary)',
            margin: '4px 0 0', maxWidth: '70ch', lineHeight: 1.5,
          }}>
            {copy.description}
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onReload()}
            aria-label="Refresh"
            title="Refresh"
            style={iconBtnStyle}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <i className="bi bi-arrow-clockwise" />
          </button>
          {canEdit && !composerOpen && (
            <button
              type="button"
              onClick={() => { setActionError(null); setComposerOpen(true); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 14px',
                background: 'var(--purple)', color: 'white',
                border: 'none', borderRadius: 'var(--radius-md)',
                fontSize: 12, fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer', transition: 'background .12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--purple-hover, #6d28d9)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--purple)'}
            >
              <i className="bi bi-plus-lg" /> {copy.addLabel}
            </button>
          )}
        </div>
      </div>

      {composerOpen && canEdit && (
        <AssignmentComposer
          copy={copy}
          candidates={candidates}
          oooEmails={oooEmails}
          busy={busy}
          error={actionError}
          onCancel={() => setComposerOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {!canEdit && (
        <div style={{
          padding: '10px 18px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border-light)',
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          <i className="bi bi-eye" style={{ marginRight: 6 }} />
          View only — ask a department admin to edit.
        </div>
      )}

      {error && !loading && (
        <div style={{
          padding: 18,
          background: 'var(--orange-light)',
          color: 'var(--orange)',
          fontSize: 12,
        }}>
          Couldn't load — {error?.message || 'unknown error'}.{' '}
          <button
            type="button"
            onClick={() => onReload()}
            style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >Retry</button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <RowSkeleton />
      ) : rows.length === 0 ? (
        <EmptyPane title={copy.emptyTitle} subtitle={copy.emptySubtitle} />
      ) : (
        <AssignmentTable
          rows={rows}
          canEdit={canEdit}
          candidates={candidates}
          oooEmails={oooEmails}
          onUpdate={onUpdate}
          onArchive={onArchive}
        />
      )}
    </div>
  );
}

// ── Composer row (new row form) ─────────────────────────────────────────
function AssignmentComposer({ copy, candidates, oooEmails, busy, error, onCancel, onSubmit }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [backups, setBackups] = useState([]);

  const canSubmit = name.trim().length > 0 && assignees.length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      assignees,
      backups,
    });
  };

  return (
    <div style={{
      padding: '14px 18px',
      background: 'var(--surface-2)',
      borderBottom: '1px solid var(--border-light)',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={copy.namePlaceholder}
        autoFocus
        style={inputStyle}
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Optional details"
        rows={1}
        style={{ ...inputStyle, resize: 'vertical', minHeight: 32, paddingTop: 6, paddingBottom: 6 }}
      />
      <MemberMultiPicker
        selected={assignees}
        onChange={setAssignees}
        candidates={candidates}
        oooEmails={oooEmails}
        placeholder="Primary…"
      />
      <MemberMultiPicker
        selected={backups}
        onChange={setBackups}
        candidates={candidates}
        oooEmails={oooEmails}
        placeholder="Backup…"
      />
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          onClick={onCancel}
          style={secondaryBtnStyle}
          disabled={busy}
        >Cancel</button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          style={{
            ...primaryBtnStyle,
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {error && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--orange)', fontSize: 12 }}>{error}</div>
      )}
    </div>
  );
}

// ── Table view ───────────────────────────────────────────────────────────
function AssignmentTable({ rows, canEdit, candidates, oooEmails, onUpdate, onArchive }) {
  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 110px',
        padding: '10px 18px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border-light)',
        fontSize: 'var(--font-xs)',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>
        <div>Name</div>
        <div>Description</div>
        <div>Primary assignee(s)</div>
        <div>Backup(s)</div>
        <div style={{ textAlign: 'right' }}>Actions</div>
      </div>
      {rows.map((row, idx) => (
        <AssignmentRow
          key={row.id}
          row={row}
          isLast={idx === rows.length - 1}
          canEdit={canEdit}
          candidates={candidates}
          oooEmails={oooEmails}
          onUpdate={onUpdate}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}

function AssignmentRow({ row, isLast, canEdit, candidates, oooEmails, onUpdate, onArchive }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(row.name);
  const [draftDescription, setDraftDescription] = useState(row.description || '');
  const [draftAssignees, setDraftAssignees] = useState(row.assignees || []);
  const [draftBackups, setDraftBackups] = useState(row.backups || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraftName(row.name);
    setDraftDescription(row.description || '');
    setDraftAssignees(row.assignees || []);
    setDraftBackups(row.backups || []);
  }, [row.id, row.name, row.description, row.assignees, row.backups]);

  // Resolve which assignees are currently on leave → controls the backup
  // covering badge. Computed against the live oooEmails set so the badge
  // updates on each background refresh.
  const oooAssignees = useMemo(() => {
    const out = [];
    for (const e of (row.assignees || [])) {
      if (oooEmails && oooEmails.has(String(e).toLowerCase())) out.push(e);
    }
    return out;
  }, [row.assignees, oooEmails]);

  const memberByEmail = useMemo(() => {
    const m = new Map();
    for (const c of candidates) {
      if (c.email) m.set(String(c.email).toLowerCase(), c);
    }
    return m;
  }, [candidates]);

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraftName(row.name);
    setDraftDescription(row.description || '');
    setDraftAssignees(row.assignees || []);
    setDraftBackups(row.backups || []);
  };

  const save = async () => {
    const cleanName = draftName.trim();
    if (!cleanName) {
      setError('Name is required');
      return;
    }
    if (draftAssignees.length === 0) {
      setError('At least one primary assignee is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onUpdate(row.id, {
        name: cleanName,
        description: draftDescription.trim() || null,
        assignees: draftAssignees,
        backups: draftBackups,
      });
      setEditing(false);
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const requestArchive = async () => {
    if (!window.confirm(`Archive "${row.name}"? This removes it from the list. You can restore it later by an admin from the audit log.`)) return;
    setBusy(true);
    try {
      await onArchive(row.id);
    } catch (err) {
      setError(err?.message || 'Archive failed');
      setBusy(false);
    }
  };

  const baseStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 110px',
    padding: '12px 18px',
    borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
    alignItems: 'flex-start',
    gap: 10,
    background: editing ? 'var(--surface-2)' : 'var(--surface)',
    transition: 'background .12s',
  };

  if (editing) {
    return (
      <div style={baseStyle}>
        <div>
          <input
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            autoFocus
            style={inputStyle}
          />
          {error && <div style={{ marginTop: 4, color: 'var(--orange)', fontSize: 11 }}>{error}</div>}
        </div>
        <textarea
          value={draftDescription}
          onChange={e => setDraftDescription(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 32, paddingTop: 6, paddingBottom: 6 }}
        />
        <MemberMultiPicker
          selected={draftAssignees}
          onChange={setDraftAssignees}
          candidates={candidates}
          oooEmails={oooEmails}
          placeholder="Primary…"
        />
        <MemberMultiPicker
          selected={draftBackups}
          onChange={setDraftBackups}
          candidates={candidates}
          oooEmails={oooEmails}
          placeholder="Backup…"
        />
        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" onClick={cancel} style={secondaryBtnStyle} disabled={busy}>Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            style={{ ...primaryBtnStyle, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
          >{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={baseStyle}
      onMouseEnter={e => { if (!editing) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={e => { if (!editing) e.currentTarget.style.background = 'var(--surface)'; }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13, lineHeight: 1.4 }}>{row.name}</div>
        {oooAssignees.length > 0 && (
          <BackupCoveringBadge
            oooAssignees={oooAssignees}
            backups={row.backups}
            memberByEmail={memberByEmail}
          />
        )}
      </div>
      <div style={{
        fontSize: 12,
        color: row.description ? 'var(--text-secondary)' : 'var(--text-muted)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}>
        {row.description || '—'}
      </div>
      <PersonStack emails={row.assignees} memberByEmail={memberByEmail} oooEmails={oooEmails} />
      <PersonStack emails={row.backups} memberByEmail={memberByEmail} oooEmails={oooEmails} emptyLabel="No backup" />
      <div style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end', alignItems: 'flex-start' }}>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit row"
              title="Edit"
              style={iconBtnSmallStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <i className="bi bi-pencil" />
            </button>
            <button
              type="button"
              onClick={requestArchive}
              disabled={busy}
              aria-label="Archive row"
              title="Archive"
              style={{ ...iconBtnSmallStyle, color: 'var(--orange)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--orange-light)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <i className="bi bi-archive" />
            </button>
          </>
        )}
      </div>
      {!editing && error && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--orange)', fontSize: 11 }}>{error}</div>
      )}
    </div>
  );
}

function PersonStack({ emails, memberByEmail, oooEmails, emptyLabel = 'Unassigned' }) {
  if (!emails || emails.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{emptyLabel}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {emails.map(e => {
        const lc = String(e).toLowerCase();
        const member = memberByEmail.get(lc);
        const onLeave = oooEmails?.has(lc);
        return (
          <div key={lc} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            minWidth: 0,
          }}>
            <Avatar
              name={member?.name || e}
              initials={member?.initials || lc.slice(0, 2).toUpperCase()}
              src={member?.avatarUrl}
              size="xs"
            />
            <span style={{
              fontSize: 12, color: 'var(--text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              flex: 1, minWidth: 0,
            }}
              title={lc}
            >
              {member?.name || lc.split('@')[0]}
            </span>
            {onLeave && (
              <i
                className="bi bi-calendar-x"
                title="On leave"
                style={{ color: '#B91C1C', fontSize: 11, flexShrink: 0 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BackupCoveringBadge({ oooAssignees, backups, memberByEmail }) {
  const oooName = (e) => {
    const m = memberByEmail.get(String(e).toLowerCase());
    return m?.name || String(e).split('@')[0];
  };
  const backupNames = (backups || [])
    .map(e => memberByEmail.get(String(e).toLowerCase())?.name || String(e).split('@')[0])
    .slice(0, 2);
  const hasBackup = backupNames.length > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      background: hasBackup ? '#FEF3C7' : '#FEE2E2',
      color: hasBackup ? '#92400E' : '#B91C1C',
      fontSize: 10, fontWeight: 700,
      width: 'fit-content',
    }}
      title={`${oooAssignees.map(oooName).join(', ')} on leave`}
    >
      <i className={`bi ${hasBackup ? 'bi-shield-fill' : 'bi-exclamation-triangle-fill'}`} />
      {hasBackup
        ? `Backup covering: ${backupNames.join(', ')}${(backups || []).length > 2 ? ` +${backups.length - 2}` : ''}`
        : 'No backup — uncovered'}
    </span>
  );
}

function EmptyPane({ title, subtitle }) {
  return (
    <div style={{
      padding: '40px 24px',
      textAlign: 'center',
      color: 'var(--text-secondary)',
    }}>
      <i className="bi bi-clipboard" style={{ fontSize: 32, color: 'var(--text-muted)' }} />
      <div style={{
        marginTop: 12, fontSize: 14, fontWeight: 600, color: 'var(--text)',
      }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)', maxWidth: 480, marginInline: 'auto' }}>
        {subtitle}
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={{
          height: 48,
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-md)',
          opacity: 0.6,
        }} />
      ))}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%',
  height: 32,
  padding: '0 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 32, padding: '0 12px',
  background: 'var(--purple)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-md)',
  fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};

const secondaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 32, padding: '0 12px',
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};

const iconBtnSmallStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer', transition: 'background .12s',
};
