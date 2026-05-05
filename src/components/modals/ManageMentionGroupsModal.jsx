// ── ManageMentionGroupsModal ──────────────────────────────────────────────
// One-stop surface for Slack-style @-handles (mention groups). Reachable
// from the topnav + button as "New Tag Group". Lets any authenticated
// user list existing groups, create a new one, or edit/delete an
// existing one. When an HR Hub / Leaders Alerts / Feedback comment
// mentions a group's handle the server expands it to every member email
// (`src/lib/mention-groups.js::loadGroupsByHandle`) — they all get
// notified + auto-followed exactly as if the author had typed each one
// individually.
//
// Visual rhythm follows the existing modal stack: dark scrim, centred
// card, Inter typography, primary button = #7c3aed. The member picker
// reuses the same multi-select shape as Settings → Roster (search +
// checkbox list) so muscle memory is preserved.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MEMBERS } from '../../data/members';
import {
  listMentionGroups,
  createMentionGroup,
  updateMentionGroup,
  deleteMentionGroup,
} from '../../services/mentionGroupsApi';
import Avatar from '../ui/Avatar';

const HANDLE_RX = /^[a-z][a-z0-9._-]{0,79}$/;

export default function ManageMentionGroupsModal({ onClose }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // null | { id?, handle, name, description, members }
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMentionGroups();
      setGroups(Array.isArray(res?.groups) ? res.groups : []);
    } catch (err) {
      setError(err?.message || 'Could not load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      (g.handle || '').toLowerCase().includes(q)
      || (g.name || '').toLowerCase().includes(q)
    );
  }, [groups, search]);

  const startCreate = () => setEditing({ handle: '', name: '', description: '', members: [] });
  const startEdit = (g) => setEditing({
    id: g.id,
    handle: g.handle,
    name: g.name || '',
    description: g.description || '',
    members: Array.isArray(g.members) ? g.members.slice() : [],
  });
  const cancelEdit = () => setEditing(null);

  const save = async () => {
    if (!editing) return;
    if (!editing.id && !HANDLE_RX.test((editing.handle || '').toLowerCase())) {
      setError('Handle must start with a letter and use only a-z, 0-9, dot, hyphen, or underscore');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing.id) {
        await updateMentionGroup(editing.id, {
          name: editing.name,
          description: editing.description,
          members: editing.members,
        });
      } else {
        await createMentionGroup({
          handle: (editing.handle || '').toLowerCase(),
          name: editing.name,
          description: editing.description,
          members: editing.members,
        });
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete @${g.handle}? Members will no longer be notified by this handle in future comments.`)) {
      return;
    }
    setError(null);
    try {
      await deleteMentionGroup(g.id);
      await reload();
    } catch (err) {
      setError(err?.message || 'Could not delete');
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 64, zIndex: 1500,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)', maxHeight: 'calc(100vh - 100px)',
          background: 'var(--surface)', borderRadius: 14,
          boxShadow: '0 30px 80px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: '#f3eff8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="bi-tags-fill" style={{ fontSize: 16, color: '#7c3aed' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              Tag groups
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Create handles like <code>@hrxtools</code> that ping multiple people at once.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 14 }} />
          </button>
        </div>

        {error && (
          <div style={{
            padding: '10px 20px', background: '#fef2f2', color: '#991b1b',
            fontSize: 12, borderBottom: '1px solid #fecaca',
          }}>
            {error}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!editing && (
            <ListView
              groups={filtered}
              loading={loading}
              search={search}
              onSearchChange={setSearch}
              onCreate={startCreate}
              onEdit={startEdit}
              onDelete={remove}
            />
          )}
          {editing && (
            <EditView
              draft={editing}
              onChange={setEditing}
              onSave={save}
              onCancel={cancelEdit}
              saving={saving}
              isEdit={!!editing.id}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ListView({ groups, loading, search, onSearchChange, onCreate, onEdit, onDelete }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <i className="bi-search" style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="search"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search by handle or name"
            style={{
              width: '100%', height: 34, padding: '0 12px 0 30px',
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <button
          type="button"
          onClick={onCreate}
          style={primaryBtn}
        >
          <i className="bi-plus-circle-fill" style={{ fontSize: 13 }} /> New tag group
        </button>
      </div>

      {loading && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      )}
      {!loading && groups.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <i className="bi-tags" style={{ fontSize: 36, color: 'var(--text-disabled, #d5d5d5)', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {search ? 'No matches' : 'No tag groups yet'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {search ? 'Try a different search term.' : 'Create one to ping multiple people with a single handle.'}
          </div>
        </div>
      )}
      {!loading && groups.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map(g => (
            <div key={g.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              border: '1px solid var(--border-light)', borderRadius: 10,
              background: 'var(--surface)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: '#7c3aed',
                  }}>@{g.handle}</span>
                  {g.name && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.name}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {(g.members || []).length} {(g.members || []).length === 1 ? 'member' : 'members'}
                  {g.description ? ` · ${g.description.slice(0, 60)}${g.description.length > 60 ? '…' : ''}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(g)}
                style={iconBtn}
                title="Edit"
              ><i className="bi-pencil" style={{ fontSize: 12 }} /></button>
              <button
                type="button"
                onClick={() => onDelete(g)}
                style={{ ...iconBtn, color: '#d42d35' }}
                title="Delete"
              ><i className="bi-trash" style={{ fontSize: 12 }} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditView({ draft, onChange, onSave, onCancel, saving, isEdit }) {
  const [memberSearch, setMemberSearch] = useState('');
  const sortedMembers = useMemo(
    () => [...MEMBERS].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [],
  );
  const memberSet = useMemo(() => new Set((draft.members || []).map(e => e.toLowerCase())), [draft.members]);
  const q = memberSearch.trim().toLowerCase();
  const filteredMembers = q
    ? sortedMembers.filter(m =>
        (m.name || '').toLowerCase().includes(q)
        || (m.email || '').toLowerCase().includes(q)
      )
    : sortedMembers;

  const toggleMember = (email) => {
    const lc = String(email).toLowerCase();
    const next = memberSet.has(lc)
      ? (draft.members || []).filter(e => e.toLowerCase() !== lc)
      : [...(draft.members || []), lc];
    onChange({ ...draft, members: next });
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={fieldLabel}>Handle</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 700 }}>@</span>
          <input
            type="text"
            value={draft.handle}
            disabled={isEdit}
            onChange={e => onChange({ ...draft, handle: e.target.value.toLowerCase() })}
            placeholder="hrxtools"
            style={{
              ...inputStyle,
              fontFamily: 'inherit',
              opacity: isEdit ? 0.6 : 1,
              cursor: isEdit ? 'not-allowed' : 'text',
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {isEdit
            ? 'Handle is locked once created so existing comments still resolve correctly.'
            : 'Lowercase letters, digits, dot, hyphen, underscore. Starts with a letter.'}
        </div>
      </div>

      <div>
        <label style={fieldLabel}>Name (optional)</label>
        <input
          type="text"
          value={draft.name}
          onChange={e => onChange({ ...draft, name: e.target.value })}
          placeholder="HRX Tools team"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={fieldLabel}>Description (optional)</label>
        <textarea
          value={draft.description}
          onChange={e => onChange({ ...draft, description: e.target.value })}
          rows={2}
          placeholder="When to use this handle"
          style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }}
        />
      </div>

      <div>
        <label style={fieldLabel}>Members ({(draft.members || []).length})</label>
        <div style={{ position: 'relative', marginBottom: 6 }}>
          <i className="bi-search" style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="search"
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            placeholder="Search teammates"
            style={{ ...inputStyle, paddingLeft: 30 }}
          />
        </div>
        <div style={{
          maxHeight: 220, overflowY: 'auto',
          border: '1px solid var(--border)', borderRadius: 8,
        }}>
          {filteredMembers.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>
          )}
          {filteredMembers.map(m => {
            const isMember = memberSet.has((m.email || '').toLowerCase());
            return (
              <button
                key={m.email}
                type="button"
                onClick={() => toggleMember(m.email)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', textAlign: 'left',
                  border: 'none', background: isMember ? 'var(--surface-2)' : 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <span style={{
                  width: 16, height: 16, borderRadius: 4,
                  border: '1px solid ' + (isMember ? '#7c3aed' : 'var(--border)'),
                  background: isMember ? '#7c3aed' : 'transparent',
                  color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {isMember && <i className="bi-check" style={{ fontSize: 11 }} />}
                </span>
                <Avatar name={m.name} size={22} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.email}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={ghostBtn}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || (!isEdit && !HANDLE_RX.test((draft.handle || '').toLowerCase()))}
          style={{
            ...primaryBtn,
            opacity: (saving || (!isEdit && !HANDLE_RX.test((draft.handle || '').toLowerCase()))) ? 0.6 : 1,
            cursor: (saving || (!isEdit && !HANDLE_RX.test((draft.handle || '').toLowerCase()))) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create group')}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 12px', fontSize: 13,
  border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box',
};
const fieldLabel = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', display: 'block', marginBottom: 6,
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 16px', borderRadius: 10, border: 'none',
  background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)', fontFamily: 'inherit',
};
const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 14px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
const iconBtn = {
  width: 30, height: 30, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: 'var(--text)',
};
