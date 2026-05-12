'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { deriveName, deriveInitials, avatarColors } from './teamHelpers';
import {
  listWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from './membersApi';

// Admin view for managing a workspace's roster. Backed by the DB-driven
// /api/v1/workspaces/[id]/members API.
//
// Memory-safe: paginated (default 50 per page), no full-roster caching, and
// the list refreshes on every mutation rather than mutating in place. Search
// is server-side (LIKE on lower(email)) so the client never holds more than
// one page at a time.

const PAGE_SIZE = 50;

const card = {
  background: '#fff',
  borderRadius: 16,
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

const inputStyle = {
  flex: 1,
  minWidth: 220,
  border: '1px solid #e0ddd8',
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

const primaryBtn = {
  padding: '8px 14px',
  background: '#1b1b1b',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const ghostBtn = {
  padding: '6px 10px',
  background: '#fff',
  color: '#1b1b1b',
  border: '1px solid #e0ddd8',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const dangerBtn = {
  ...ghostBtn,
  color: '#dc2626',
  borderColor: '#fecaca',
};

const tableWrap = { maxHeight: 600, overflowY: 'auto' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
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
const pill = (bg, fg, border) => ({
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  padding: '2px 8px',
  borderRadius: 999,
  background: bg,
  color: fg,
  border: `1px solid ${border}`,
  marginLeft: 8,
});
const banner = (color, bg, border) => ({
  padding: '10px 14px',
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 12,
  fontSize: 13,
  color,
  margin: '0 0 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

function AddMemberForm({ onAdd, busy }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    onAdd(trimmed, role);
    setEmail('');
    setRole('member');
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
      <input
        type="email"
        required
        placeholder="user@deel.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        style={{ ...inputStyle, minWidth: 240 }}
        disabled={busy}
      />
      <select
        value={role}
        onChange={e => setRole(e.target.value)}
        style={{ ...inputStyle, flex: 'none', minWidth: 110 }}
        disabled={busy}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button type="submit" style={primaryBtn} disabled={busy || !email.trim()}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
    </form>
  );
}

export default function AdminView({ workspace, currentEmail }) {
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async ({ search: s = search, offset: o = offset } = {}) => {
    setLoading(true);
    setError('');
    try {
      const data = await listWorkspaceMembers(workspace.id, { search: s, limit: PAGE_SIZE, offset: o });
      setMembers(data.members || []);
      setTotal(data.total || 0);
      setOffset(data.offset || 0);
    } catch (err) {
      setError(err.message || 'Failed to load members.');
    } finally {
      setLoading(false);
    }
  }, [workspace.id, search, offset]);

  useEffect(() => {
    load({ search: '', offset: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  // Debounced search — refetch 250ms after the user stops typing so we
  // don't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { load({ search, offset: 0 }); }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleAdd = useCallback(async (email, role) => {
    setMutating(true);
    setError('');
    setNotice('');
    try {
      const res = await addWorkspaceMember(workspace.id, email, role);
      const verb = res?.member?.revived ? 're-added' : res?.member?.existed ? 'already a member' : 'added';
      setNotice(`${email} ${verb}.`);
      await load({ search, offset: 0 });
      setOffset(0);
    } catch (err) {
      setError(err.message || 'Failed to add member.');
    } finally {
      setMutating(false);
    }
  }, [workspace.id, load, search]);

  const handleRemove = useCallback(async (email) => {
    if (!confirm(`Remove ${email} from ${workspace.label}?`)) return;
    setMutating(true);
    setError('');
    setNotice('');
    try {
      await removeWorkspaceMember(workspace.id, email);
      setNotice(`${email} removed.`);
      await load({ search, offset });
    } catch (err) {
      setError(err.message || 'Failed to remove member.');
    } finally {
      setMutating(false);
    }
  }, [workspace.id, workspace.label, load, search, offset]);

  const handleRoleChange = useCallback(async (email, newRole) => {
    setMutating(true);
    setError('');
    setNotice('');
    try {
      await updateWorkspaceMemberRole(workspace.id, email, newRole);
      setNotice(`${email} is now ${newRole}.`);
      await load({ search, offset });
    } catch (err) {
      setError(err.message || 'Failed to update role.');
    } finally {
      setMutating(false);
    }
  }, [workspace.id, load, search, offset]);

  const pages = useMemo(() => {
    if (!total) return { current: 1, total: 1 };
    return { current: Math.floor(offset / PAGE_SIZE) + 1, total: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }, [offset, total]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Admin</h1>
          <p style={{ fontSize: 14, color: '#6b6b6b', margin: '6px 0 0' }}>
            Manage members of {workspace.label}. Changes take effect immediately on the server; users may need to reload to see new access.
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#9e9e9e' }}>
          {total} total · admin-only
        </div>
      </div>

      {error && <div style={banner('#dc2626', '#fef2f2', '#fecaca')}>{error}</div>}
      {notice && <div style={banner('#15803d', '#dcfce7', '#bbf7d0')}>{notice}</div>}

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ ...toolbar, borderBottom: 'none', paddingBottom: 16 }}>
          <AddMemberForm onAdd={handleAdd} busy={mutating} />
        </div>
      </div>

      <div style={card}>
        <div style={toolbar}>
          <input
            type="search"
            placeholder="Search by email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={inputStyle}
          />
          {pages.total > 1 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#6b6b6b' }}>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); load({ search, offset: Math.max(0, offset - PAGE_SIZE) }); }}
                disabled={offset === 0 || loading}
              >
                ←
              </button>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pages.current} of {pages.total}</span>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => { const next = offset + PAGE_SIZE; if (next < total) { setOffset(next); load({ search, offset: next }); } }}
                disabled={offset + PAGE_SIZE >= total || loading}
              >
                →
              </button>
            </div>
          )}
        </div>

        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Member</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Added</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !members.length && (
                <tr><td colSpan={4} style={{ ...tdStyle, color: '#9e9e9e', textAlign: 'center' }}>Loading…</td></tr>
              )}
              {!loading && !members.length && (
                <tr><td colSpan={4} style={{ ...tdStyle, color: '#9e9e9e', textAlign: 'center' }}>No members{search ? ` matching "${search}".` : '.'}</td></tr>
              )}
              {members.map(m => {
                const colors = avatarColors(m.email);
                const name = deriveName(m.email);
                const isYou = !!currentEmail && m.email.toLowerCase() === currentEmail.toLowerCase();
                return (
                  <tr key={m.email}>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={avatarStyle(colors)}>{deriveInitials(name)}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: '#1b1b1b' }}>
                            {name}
                            {isYou && <span style={pill('#e0f2fe', '#0369a1', '#bae6fd')}>You</span>}
                          </div>
                          <div style={{ fontSize: 12, color: '#9e9e9e' }}>{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={m.role === 'admin'
                        ? pill('#fff3e0', '#9c5b00', '#ffdfb3')
                        : pill('#f4f1ec', '#6b6b6b', '#e0ddd8')}>
                        {m.role}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: 12, color: '#6b6b6b' }}>
                        {m.addedAt ? new Date(m.addedAt).toLocaleDateString() : '—'}
                      </div>
                      {m.addedBy && (
                        <div style={{ fontSize: 11, color: '#9e9e9e' }}>by {m.addedBy}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {m.role === 'admin' ? (
                          <button type="button" style={ghostBtn} onClick={() => handleRoleChange(m.email, 'member')} disabled={mutating || isYou}>
                            Demote
                          </button>
                        ) : (
                          <button type="button" style={ghostBtn} onClick={() => handleRoleChange(m.email, 'admin')} disabled={mutating}>
                            Make admin
                          </button>
                        )}
                        <button type="button" style={dangerBtn} onClick={() => handleRemove(m.email)} disabled={mutating || isYou}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
