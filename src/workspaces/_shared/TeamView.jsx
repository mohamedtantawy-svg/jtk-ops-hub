'use client';

import { useMemo, useState, useCallback } from 'react';

import {
  deriveName,
  deriveInitials,
  avatarColors,
  buildOrgTree,
  countDescendants,
} from './teamHelpers';

// Shared Team view for non-HR workspaces. Renders a roster table + an
// expandable org tree from a workspace's allowlist data.
//
// Props:
//   workspace — workspace config from the registry (label, accent, admins)
//   roster — {email → managerEmail|null}
//   admins — string[] of emails with admin rights in this workspace
//   currentEmail — the signed-in user (highlighted in the views)

const card = {
  background: '#fff',
  borderRadius: 16,
  padding: 0,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  border: '1px solid #ece8e1',
  overflow: 'hidden',
};

const toolbar = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid #ece8e1',
  flexWrap: 'wrap',
};

const toggleGroup = {
  display: 'inline-flex',
  background: '#f5f3ef',
  borderRadius: 10,
  padding: 3,
};

const toggleBtnBase = {
  border: 'none',
  background: 'transparent',
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 500,
  color: '#6b6b6b',
  cursor: 'pointer',
  borderRadius: 8,
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const toggleBtnActive = {
  ...toggleBtnBase,
  background: '#fff',
  color: '#1b1b1b',
  fontWeight: 600,
  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
};

const searchBox = {
  flex: 1,
  minWidth: 220,
  border: '1px solid #e0ddd8',
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

const countBadge = {
  fontSize: 12,
  color: '#9e9e9e',
  marginLeft: 'auto',
  fontVariantNumeric: 'tabular-nums',
};

const tableWrap = {
  maxHeight: 600,
  overflowY: 'auto',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle = {
  textAlign: 'left',
  padding: '10px 16px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: '#9e9e9e',
  borderBottom: '1px solid #ece8e1',
  background: '#faf8f5',
  position: 'sticky',
  top: 0,
};

const tdStyle = {
  padding: '12px 16px',
  borderBottom: '1px solid #f4f1ec',
  verticalAlign: 'middle',
};

const avatarStyle = (colors) => ({
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: colors.bg,
  color: colors.fg,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
});

const adminPill = {
  display: 'inline-block',
  marginLeft: 8,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  background: '#fff3e0',
  color: '#9c5b00',
  border: '1px solid #ffdfb3',
  padding: '2px 6px',
  borderRadius: 999,
};

const youPill = {
  ...adminPill,
  background: '#e0f2fe',
  color: '#0369a1',
  borderColor: '#bae6fd',
};

const orgWrap = {
  padding: '12px 8px',
};

const orgNodeRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 13,
};

const orgCaret = {
  width: 14,
  height: 14,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#9e9e9e',
  fontSize: 10,
  transition: 'transform .15s ease',
};

const emptyState = {
  padding: '48px 24px',
  textAlign: 'center',
  color: '#9e9e9e',
  fontSize: 13,
};

// ── Subcomponents ──────────────────────────────────────────────────────────

function PersonCell({ email, name, isAdmin, isYou }) {
  const colors = avatarColors(email);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={avatarStyle(colors)}>{deriveInitials(name)}</span>
      <div>
        <div style={{ fontWeight: 600, color: '#1b1b1b' }}>
          {name}
          {isYou && <span style={youPill}>You</span>}
          {isAdmin && <span style={adminPill}>Admin</span>}
        </div>
        <div style={{ fontSize: 12, color: '#9e9e9e' }}>{email}</div>
      </div>
    </div>
  );
}

function TableView({ people, currentEmail, admins }) {
  if (!people.length) {
    return <div style={emptyState}>No matches.</div>;
  }
  const adminSet = new Set(admins.map(a => a.toLowerCase()));
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Person</th>
            <th style={thStyle}>Reports to</th>
          </tr>
        </thead>
        <tbody>
          {people.map(p => (
            <tr key={p.email}>
              <td style={tdStyle}>
                <PersonCell
                  email={p.email}
                  name={p.name}
                  isAdmin={adminSet.has(p.email.toLowerCase())}
                  isYou={!!currentEmail && p.email.toLowerCase() === currentEmail.toLowerCase()}
                />
              </td>
              <td style={tdStyle}>
                {p.managerName ? (
                  <div style={{ fontSize: 13, color: '#1b1b1b' }}>
                    {p.managerName}
                    <div style={{ fontSize: 11, color: '#9e9e9e' }}>{p.manager}</div>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: '#9e9e9e' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgNode({ email, depth, expanded, onToggle, reportsByManager, currentEmail, adminSet }) {
  const reports = reportsByManager[email] || [];
  const hasReports = reports.length > 0;
  const total = hasReports ? countDescendants(email, reportsByManager) : 0;
  const name = deriveName(email);
  const colors = avatarColors(email);
  const isYou = !!currentEmail && email.toLowerCase() === currentEmail.toLowerCase();
  const isAdmin = adminSet.has(email.toLowerCase());
  const isOpen = expanded.has(email);

  return (
    <>
      <div
        style={{
          ...orgNodeRow,
          paddingLeft: 10 + depth * 24,
          background: isYou ? '#e0f2fe' : 'transparent',
        }}
        onMouseEnter={e => { if (!isYou) e.currentTarget.style.background = '#f8f6f1'; }}
        onMouseLeave={e => { if (!isYou) e.currentTarget.style.background = 'transparent'; }}
        onClick={() => hasReports && onToggle(email)}
      >
        <span style={{ ...orgCaret, transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', visibility: hasReports ? 'visible' : 'hidden' }}>▶</span>
        <span style={avatarStyle(colors)}>{deriveInitials(name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: hasReports ? 600 : 500, color: '#1b1b1b' }}>
            {name}
            {isYou && <span style={youPill}>You</span>}
            {isAdmin && <span style={adminPill}>Admin</span>}
          </div>
          <div style={{ fontSize: 11, color: '#9e9e9e' }}>{email}</div>
        </div>
        {hasReports && (
          <span style={{ fontSize: 12, color: '#9e9e9e', fontVariantNumeric: 'tabular-nums' }}>
            {reports.length} direct {total !== reports.length ? `· ${total} total` : ''}
          </span>
        )}
      </div>
      {isOpen && reports.map(child => (
        <OrgNode
          key={child}
          email={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          reportsByManager={reportsByManager}
          currentEmail={currentEmail}
          adminSet={adminSet}
        />
      ))}
    </>
  );
}

function OrgView({ tree, currentEmail, admins }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const adminSet = useMemo(() => new Set(admins.map(a => a.toLowerCase())), [admins]);

  const onToggle = useCallback((email) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }, []);

  if (!tree.roots.length) {
    return <div style={emptyState}>No roots in this team's hierarchy.</div>;
  }

  return (
    <div style={orgWrap}>
      {tree.roots.map(root => (
        <OrgNode
          key={root}
          email={root}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          reportsByManager={tree.reportsByManager}
          currentEmail={currentEmail}
          adminSet={adminSet}
        />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function TeamView({ workspace, roster, admins = [], currentEmail }) {
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');

  const people = useMemo(() => {
    return Object.entries(roster).map(([email, manager]) => ({
      email,
      name: deriveName(email),
      manager: manager || null,
      managerName: manager ? deriveName(manager) : null,
    }));
  }, [roster]);

  const sortedPeople = useMemo(
    () => people.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const filteredPeople = useMemo(() => {
    if (!search.trim()) return sortedPeople;
    const q = search.trim().toLowerCase();
    return sortedPeople.filter(p =>
      p.email.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.managerName && p.managerName.toLowerCase().includes(q)) ||
      (p.manager && p.manager.toLowerCase().includes(q))
    );
  }, [sortedPeople, search]);

  const tree = useMemo(() => buildOrgTree(roster), [roster]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Team</h1>
          <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 0' }}>
            {people.length} {people.length === 1 ? 'person' : 'people'} in {workspace.label}.
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#9e9e9e' }}>
          Roster source: <code style={{ fontSize: 11, background: '#f5f3ef', padding: '2px 6px', borderRadius: 4 }}>src/workspaces/{workspace.id}/data/allowlist.js</code>
        </div>
      </div>

      <div style={card}>
        <div style={toolbar}>
          <div style={toggleGroup}>
            <button
              type="button"
              style={view === 'table' ? toggleBtnActive : toggleBtnBase}
              onClick={() => setView('table')}
            >
              <i className="bi-list-ul" /> Table
            </button>
            <button
              type="button"
              style={view === 'org' ? toggleBtnActive : toggleBtnBase}
              onClick={() => setView('org')}
            >
              <i className="bi-diagram-3" /> Org chart
            </button>
          </div>
          <input
            type="search"
            placeholder="Search by name, email, or manager…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={searchBox}
          />
          {view === 'table' && (
            <span style={countBadge}>
              {filteredPeople.length} of {people.length}
            </span>
          )}
        </div>

        {view === 'table'
          ? <TableView people={filteredPeople} currentEmail={currentEmail} admins={admins} />
          : <OrgView tree={tree} currentEmail={currentEmail} admins={admins} />}
      </div>
    </div>
  );
}
