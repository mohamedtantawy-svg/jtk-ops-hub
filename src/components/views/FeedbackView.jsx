// ── FeedbackView ────────────────────────────────────────────────────────
// The team's bug + improvement board. Reddit-style row layout:
//   [▲ score ▼] | [type pill] [priority dot] Title | [status pill] [thumb]
// Click a row to expand inline showing the full issue, proposed
// resolution, screenshot at full size, comments thread, and (for
// admin / regional_manager) status / priority / assignee changers.
//
// "Copy as markdown" on every row dumps everything needed for the user
// to paste a single chat message into Claude — title, status, votes,
// type, priority, the issue text, the proposed resolution, and the
// screenshot reference.
// ────────────────────────────────────────────────────────────────────────

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsContext } from '../../App';
import { MEMBERS, MEMBERS_BY_EMAIL } from '../../data/members';
import { useFeedback } from '../../hooks/useFeedback';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import CreateFeedbackModal from '../modals/CreateFeedbackModal';

// ── Visual config ──────────────────────────────────────────────────────
const STATUS_CONFIG = {
  new:         { label: 'New',           color: '#0369a1', bg: '#e0f2fe', icon: 'bi-circle-fill',          dot: '#0ea5e9' },
  triaged:     { label: 'Triaged',       color: '#7c3aed', bg: '#f3eff8', icon: 'bi-pin-angle-fill',       dot: '#7c3aed' },
  in_progress: { label: 'In Progress',   color: '#d97706', bg: '#fff8e6', icon: 'bi-arrow-repeat',         dot: '#f59e0b' },
  done:        { label: 'Done',          color: '#15803d', bg: '#e8f5e9', icon: 'bi-check-circle-fill',    dot: '#22c55e' },
  wont_do:     { label: "Won't do",      color: '#737373', bg: '#f5f5f4', icon: 'bi-slash-circle',          dot: '#9ca3af' },
  duplicate:   { label: 'Duplicate',     color: '#737373', bg: '#f5f5f4', icon: 'bi-files',                 dot: '#9ca3af' },
};
const STATUS_ORDER = ['new', 'triaged', 'in_progress', 'done', 'wont_do', 'duplicate'];

const PRIORITY_CONFIG = {
  low:      { label: 'Low',      color: '#9b928a', bg: '#f7f5f2' },
  medium:   { label: 'Medium',   color: '#0369a1', bg: '#e0f2fe' },
  high:     { label: 'High',     color: '#d97706', bg: '#fff8e6' },
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
};

const TYPE_CONFIG = {
  bug:         { label: 'Bug',         icon: 'bi-bug',           color: '#dc2626', bg: '#fef2f2' },
  improvement: { label: 'Improvement', icon: 'bi-stars',         color: '#7c3aed', bg: '#f3eff8' },
  question:    { label: 'Question',    icon: 'bi-question-circle', color: '#0369a1', bg: '#e0f2fe' },
};

const SORTS = [
  { value: 'top', label: 'Most upvoted' },
  { value: 'new', label: 'Newest' },
  { value: 'recently_updated', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest' },
];

// Four large status filter buttons — replaces the old flat row of seven
// pills. New + Triaged are folded into "Open" (anything that hasn't moved
// to one of the other three buckets), per Pilar's revamp brief.
const STATUS_FILTERS = [
  { value: 'open',         label: 'Open',         icon: 'bi-circle-fill',           color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { value: 'in_progress',  label: 'In progress',  icon: 'bi-arrow-repeat',          color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  { value: 'done',         label: 'Done',         icon: 'bi-check-circle-fill',     color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
  { value: 'wont_do',      label: "Won't do",     icon: 'bi-slash-circle',          color: '#737373', bg: '#f5f5f4', tint: '#e7e5e4' },
];

// Statuses that are NOT considered "Open" — used by the Open filter and the
// open-count badge. Anything not in this set (new / triaged / duplicate) is
// shown when the Open button is active.
const NOT_OPEN = new Set(['in_progress', 'done', 'wont_do']);
const TERMINAL = new Set(['done', 'wont_do', 'duplicate']);

// Activity indicator threshold: how recently the row was last touched, and
// the minimum gap between created_at and updated_at to avoid false
// positives on freshly-submitted items.
const RECENT_ACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;     // 7d
const ACTIVITY_GAP_MS    = 30 * 60 * 1000;               // 30min

// Relative-time helper
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Build a single markdown blob describing the request — the user pastes
// this directly into a Claude chat to ship the bug to me with full context.
function toMarkdown(item) {
  const lines = [];
  lines.push(`## ${item.title}`);
  lines.push('');
  lines.push(`**Type:** ${item.type} · **Priority:** ${item.priority} · **Status:** ${item.status} · **Score:** ${item.score} (${item.upvotes}↑ ${item.downvotes}↓)`);
  if (item.category) lines.push(`**Area:** ${item.category}`);
  if (item.submitterName || item.submitterEmail) lines.push(`**Submitted by:** ${item.submitterName || item.submitterEmail}`);
  lines.push('');
  lines.push('### Issue');
  lines.push(item.issue || '_(none)_');
  if (item.proposedResolution) {
    lines.push('');
    lines.push('### Proposed resolution');
    lines.push(item.proposedResolution);
  }
  const attCount = Array.isArray(item.attachments) ? item.attachments.length : (item.screenshot ? 1 : 0);
  if (attCount > 0) {
    lines.push('');
    lines.push(`_(${attCount} attachment${attCount === 1 ? '' : 's'} — open the request to view.)_`);
  }
  if (item.resolutionNote) {
    lines.push('');
    lines.push('### Resolution note');
    lines.push(item.resolutionNote);
  }
  return lines.join('\n');
}

export default function FeedbackView({ user, addToast, openCompose, onComposeOpened }) {
  const perms = useContext(PermissionsContext);
  const isPriv = perms?.isAdmin || perms?.dataScope === 'regional_tasks' || false;

  // Default filter set per the revamp brief: scope=All, status=Open. The
  // Open bucket is the most important first impression (everything that
  // still needs attention) — single-selecting Open by default keeps the
  // board scannable.
  const [scopeFilter, setScopeFilter] = useState('all'); // 'all' | 'mine'
  const [statusFilter, setStatusFilter] = useState('open'); // always one of the four
  const [typeFilter, setTypeFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('top');
  const [composeOpen, setComposeOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Allow App.jsx (via the "+ New Feedback" Create-menu shortcut) to pop the
  // composer the moment the user lands on this tab.
  useEffect(() => {
    if (openCompose) {
      setComposeOpen(true);
      onComposeOpened?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCompose]);

  const { items, loading, error, lastSyncAt, refresh, create, patch, remove, vote } = useFeedback({
    enabled: !!user,
    userEmail: user?.email || null,
    sort,
  });

  // Identity match for the "My requests" toggle. Email is preferred (the
  // canonical submitter id since the JOIN added in /api/v1/feedback);
  // numeric submitterId is the fallback for legacy rows.
  const userEmailLc = (user?.email || '').toLowerCase();
  const isMineFn = useMemo(() => (item) => {
    if (!user) return false;
    if (userEmailLc && (item.submitterEmail || '').toLowerCase() === userEmailLc) return true;
    if (user.id && item.submitterId === user.id) return true;
    return false;
  }, [user, userEmailLc]);

  // ── Derived: filtered + searched list ──────────────────────────────────
  // Scope (mine vs all) → status bucket → type → text search. Status counts
  // below are computed after scope so the four big buttons reflect the
  // numbers you'd actually see when you click them.
  const scopedItems = useMemo(() => (
    scopeFilter === 'mine' ? items.filter(isMineFn) : items
  ), [items, scopeFilter, isMineFn]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedItems.filter(item => {
      if (statusFilter === 'open') {
        if (NOT_OPEN.has(item.status)) return false;
      } else if (item.status !== statusFilter) return false;
      if (typeFilter && item.type !== typeFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.issue} ${item.proposedResolution || ''} ${item.category || ''} ${item.submitterName || ''} ${item.submitterEmail || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopedItems, statusFilter, typeFilter, search]);

  // ── Status counts (drive the four large filter buttons) ───────────────
  // Counts respect the scope toggle so "My requests · Open (3)" reads
  // accurately. Type / search are NOT applied here so the user can see how
  // many would land in each bucket regardless of the secondary filter.
  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, done: 0, wont_do: 0 };
    for (const i of scopedItems) {
      if (i.status === 'in_progress') c.in_progress += 1;
      else if (i.status === 'done') c.done += 1;
      else if (i.status === 'wont_do') c.wont_do += 1;
      else c.open += 1; // new / triaged / duplicate / anything else
    }
    return c;
  }, [scopedItems]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleSubmit = async (payload) => {
    try {
      const created = await create(payload);
      addToast?.('success', 'Submitted', `"${created?.title || payload.title}" is now on the board.`);
    } catch (err) {
      addToast?.('error', 'Submit failed', err?.message || 'Please try again.');
      throw err;
    }
  };

  const handleVote = (item, dir) => {
    if (!user?.id) {
      addToast?.('error', 'Sign in required', 'You need to be signed in to vote.');
      return;
    }
    const next = item.myVote === dir ? 0 : dir;
    vote(item.id, next).catch(err => addToast?.('error', 'Vote failed', err?.message || 'Please try again.'));
  };

  const handleStatusChange = (item, status) => {
    patch(item.id, { status }).then(updated => {
      if (updated) addToast?.('success', 'Status updated', `"${updated.title}" → ${STATUS_CONFIG[status]?.label || status}`);
    }).catch(err => addToast?.('error', 'Update failed', err?.message || 'Please try again.'));
  };

  const handlePriorityChange = (item, priority) => {
    patch(item.id, { priority }).then(updated => {
      if (updated) addToast?.('success', 'Priority updated', `"${updated.title}" · ${PRIORITY_CONFIG[priority]?.label || priority}`);
    }).catch(err => addToast?.('error', 'Update failed', err?.message || 'Please try again.'));
  };

  const handleAssigneeChange = (item, assigneeId) => {
    patch(item.id, { assigneeId: assigneeId || null }).then(() => {
      addToast?.('success', 'Assignee updated', '');
    }).catch(err => addToast?.('error', 'Update failed', err?.message || 'Please try again.'));
  };

  const handleDelete = async (item) => {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await remove(item.id);
      addToast?.('success', 'Deleted', '');
      if (expandedId === item.id) setExpandedId(null);
    } catch (err) {
      addToast?.('error', 'Delete failed', err?.message || '');
    }
  };

  const handleCopy = async (item) => {
    const md = toMarkdown(item);
    try {
      await navigator.clipboard.writeText(md);
      addToast?.('success', 'Copied', 'Markdown is on your clipboard — paste it to Claude.');
    } catch {
      addToast?.('error', 'Copy failed', 'Your browser blocked clipboard access.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={page}>
      {/* Inline responsive style — the four big status buttons collapse to
          a 2x2 grid on narrow viewports so the labels never truncate. */}
      <style>{`
        .feedback-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 900px) { .feedback-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
      {/* Header */}
      <div style={pageHead}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#f3eff8', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi-megaphone-fill" style={{ fontSize: 19 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>Feedback board</h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Bugs, ideas, and improvements for ops-hub. Vote on what matters most.
                {lastSyncAt && <> · <span title={new Date(lastSyncAt).toISOString()}>synced {relTime(new Date(lastSyncAt).toISOString())}</span></>}
              </div>
            </div>
          </div>
        </div>
        <button onClick={() => setComposeOpen(true)} style={primaryBtn}>
          <i className="bi-plus-circle-fill" style={{ fontSize: 13 }} /> New request
        </button>
      </div>

      {/* Scope toggle (My requests | All requests) — primary nav. Count
          ticked beside each segment so the user can pre-empt how busy
          either view is before clicking. */}
      <div style={scopeRow}>
        <div role="tablist" aria-label="Request scope" style={segmentedControl}>
          {[
            { value: 'all',  label: 'All requests', count: items.length },
            { value: 'mine', label: 'My requests',  count: items.filter(isMineFn).length },
          ].map(seg => {
            const active = scopeFilter === seg.value;
            return (
              <button
                key={seg.value}
                role="tab"
                aria-selected={active}
                onClick={() => setScopeFilter(seg.value)}
                style={{ ...segmentBtn, ...(active ? segmentBtnActive : null) }}
              >
                {seg.label}
                <span style={{ ...segmentCount, ...(active ? segmentCountActive : null) }}>{seg.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Big status filter buttons — single-select, default Open */}
      <div className="feedback-status-grid" style={{ marginBottom: 14 }}>
        {STATUS_FILTERS.map(f => {
          const active = statusFilter === f.value;
          const cnt = counts[f.value] || 0;
          return (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              aria-pressed={active}
              style={{
                ...statusFilterBtn,
                background: active ? f.bg : 'var(--surface)',
                borderColor: active ? f.tint : 'var(--border)',
                boxShadow: active ? `0 0 0 1px ${f.tint} inset, 0 1px 0 rgba(15,23,42,0.02)` : '0 1px 0 rgba(15,23,42,0.02)',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = f.bg; e.currentTarget.style.borderColor = f.tint; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 8,
                background: active ? f.color : f.bg,
                color: active ? 'white' : f.color,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'background .12s, color .12s',
              }}>
                <i className={f.icon} style={{ fontSize: 13 }} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : 'var(--text)', whiteSpace: 'nowrap' }}>{f.label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)' }}>
                  {cnt} {cnt === 1 ? 'request' : 'requests'}
                </span>
              </span>
              <span style={{
                fontSize: 16, fontWeight: 800,
                color: active ? f.color : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 'auto',
              }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Secondary filter row — type pills + search + sort + refresh */}
      <div style={filterBar}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(TYPE_CONFIG).map(([k, t]) => {
            const active = typeFilter === k;
            return (
              <button key={k} onClick={() => setTypeFilter(active ? null : k)}
                style={{
                  ...filterPill,
                  ...(active ? { ...filterPillActive, background: t.bg, color: t.color, borderColor: t.color } : null),
                }}
                aria-pressed={active}
                title={t.label}
              >
                <i className={t.icon} style={{ fontSize: 11 }} /> {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <i className="bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              style={{ width: 220, height: 32, paddingLeft: 30, paddingRight: 10, borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', outline: 'none' }} />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={() => refresh()} title="Refresh" style={iconBtn}>
            <i className={loading ? 'bi-arrow-clockwise spin' : 'bi-arrow-clockwise'} style={{ fontSize: 13, color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={listWrap}>
        {error && (
          <div style={errorBanner}>
            <i className="bi-exclamation-triangle-fill" style={{ fontSize: 13 }} /> {error}
            <button onClick={() => refresh()} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--surface)', color: '#991b1b', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Retry</button>
          </div>
        )}
        {loading && items.length === 0 ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="bi-lightbulb"
            title={items.length === 0 ? 'No feedback yet' : 'No matches'}
            subtitle={items.length === 0
              ? 'Be the first — paste a screenshot from a confusing screen and tell us what would make it better.'
              : 'Try a different filter or clear the search.'}
            action={
              <button
                onClick={items.length === 0
                  ? () => setComposeOpen(true)
                  : () => { setStatusFilter('open'); setScopeFilter('all'); setTypeFilter(null); setSearch(''); }}
                style={primaryBtn}
              >
                <i className={items.length === 0 ? 'bi-plus-circle-fill' : 'bi-x-circle'} style={{ fontSize: 13 }} />
                {items.length === 0 ? 'Submit the first request' : 'Reset filters'}
              </button>
            }
          />
        ) : (
          <ul style={list}>
            {filtered.map(item => (
              <FeedbackRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                onVote={handleVote}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
                onAssigneeChange={handleAssigneeChange}
                onDelete={handleDelete}
                onCopy={handleCopy}
                isPriv={isPriv}
                isAdmin={!!perms?.isAdmin}
                user={user}
              />
            ))}
          </ul>
        )}
      </div>

      {composeOpen && (
        <CreateFeedbackModal
          onClose={() => setComposeOpen(false)}
          onSubmit={handleSubmit}
          currentUser={user}
        />
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────
function FeedbackRow({ item, expanded, onToggle, onVote, onStatusChange, onPriorityChange, onAssigneeChange, onDelete, onCopy, isPriv, isAdmin, user }) {
  const status = STATUS_CONFIG[item.status] || STATUS_CONFIG.new;
  const priority = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
  const type = TYPE_CONFIG[item.type] || TYPE_CONFIG.bug;
  const submitter = item.submitterEmail ? MEMBERS_BY_EMAIL[item.submitterEmail.toLowerCase()] : null;
  // Email-first lookup so the assignee survives MEMBERS-array drift
  // (array-position ids vs DB members.id). The server returns
  // assigneeEmail+assigneeName via JOIN; we fall back to the numeric id
  // only if email is somehow missing.
  const assigneeFromCtx = item.assigneeEmail
    ? MEMBERS_BY_EMAIL[item.assigneeEmail.toLowerCase()]
    : null;
  const assignee = assigneeFromCtx
    ? assigneeFromCtx
    : (item.assigneeName
        ? { name: item.assigneeName, initials: item.assigneeName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() }
        : item.assigneeId
          ? MEMBERS.find(m => m.id === item.assigneeId)
          : null);
  const isMine = user?.id && item.submitterId === user.id;
  const isResolved = TERMINAL.has(item.status);

  // Activity indicator: row was meaningfully updated (status change, edit,
  // resolution note) within the last week. We require a 30-min gap between
  // createdAt and updatedAt so freshly-submitted rows don't get flagged as
  // "recently moved" out of the gate.
  const activity = (() => {
    if (!item.updatedAt || !item.createdAt) return null;
    const updated = new Date(item.updatedAt).getTime();
    const created = new Date(item.createdAt).getTime();
    if (!Number.isFinite(updated) || !Number.isFinite(created)) return null;
    if (updated - created < ACTIVITY_GAP_MS) return null;
    if (Date.now() - updated > RECENT_ACTIVITY_MS) return null;
    return { label: `${status.label} · ${relTime(item.updatedAt)}`, color: status.color, bg: status.bg, icon: status.icon };
  })();

  const [hov, setHov] = useState(false);

  return (
    <li
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...rowCard,
        // Recent-activity rows get a soft tint matching the new status so
        // the board signals what's been pushed at a glance. Hover / expanded
        // still wins so the user always sees feedback on interaction.
        borderColor: hov || expanded
          ? '#7c3aed40'
          : (activity ? `${status.color}33` : 'var(--border)'),
        boxShadow: hov || expanded
          ? '0 4px 14px rgba(124,58,237,0.08)'
          : (activity ? `0 1px 0 ${status.color}10, 0 2px 8px ${status.color}10` : '0 1px 0 rgba(15,23,42,0.02)'),
        opacity: isResolved ? 0.86 : 1,
      }}
    >
      {/* Top: vote stack | content | screenshot thumb */}
      <div style={{ display: 'flex', gap: 14 }}>
        {/* Vote stack */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, minWidth: 36, gap: 2 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onVote(item, 1); }}
            aria-label="Upvote"
            aria-pressed={item.myVote === 1}
            style={{
              ...voteBtn,
              color: item.myVote === 1 ? '#15803d' : 'var(--text-muted)',
              background: item.myVote === 1 ? '#e8f5e9' : 'transparent',
            }}
            title="Upvote"
          >
            <i className="bi-caret-up-fill" style={{ fontSize: 17 }} />
          </button>
          <span style={{
            fontSize: 13, fontWeight: 800, color: item.score > 0 ? '#15803d' : item.score < 0 ? '#dc2626' : 'var(--text)',
            minWidth: 20, textAlign: 'center',
          }}>{item.score}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onVote(item, -1); }}
            aria-label="Downvote"
            aria-pressed={item.myVote === -1}
            style={{
              ...voteBtn,
              color: item.myVote === -1 ? '#dc2626' : 'var(--text-muted)',
              background: item.myVote === -1 ? '#fef2f2' : 'transparent',
            }}
            title="Downvote"
          >
            <i className="bi-caret-down-fill" style={{ fontSize: 17 }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Pill row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...pill, background: type.bg, color: type.color, borderColor: type.color + '40' }}>
              <i className={type.icon} style={{ fontSize: 10 }} /> {type.label}
            </span>
            <span style={{ ...pill, background: status.bg, color: status.color, borderColor: status.color + '40' }}>
              <i className={status.icon} style={{ fontSize: 10 }} /> {status.label}
            </span>
            <span style={{ ...priorityChip, background: priority.bg, color: priority.color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: priority.color, display: 'inline-block' }} />
              {priority.label}
            </span>
            {item.category && (
              <span style={mutedPill}>{item.category}</span>
            )}
            {assignee && (
              <span style={{ ...mutedPill, gap: 4 }}>
                <Avatar name={assignee.name} initials={assignee.initials} size="xs" />
                {assignee.name?.split(' ')[0]}
              </span>
            )}
          </div>

          {/* Title (click to expand) */}
          <button
            onClick={onToggle}
            style={titleBtn}
            aria-expanded={expanded}
          >
            {item.title}
          </button>

          {/* Preview line */}
          {!expanded && (
            <div style={preview}>
              {item.issue.length > 200 ? `${item.issue.slice(0, 200)}…` : item.issue}
            </div>
          )}

          {/* Footer row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Avatar name={submitter?.name || item.submitterName || item.submitterEmail} initials={submitter?.initials} size="xs" />
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                {submitter?.name || item.submitterName || item.submitterEmail || 'Unknown'}
              </span>
              <span>·</span>
              <span title={new Date(item.createdAt).toLocaleString('en-GB')}>{relTime(item.createdAt)}</span>
              {isMine && <span style={{ ...mutedPill, padding: '0 6px', fontSize: 9, height: 16, marginLeft: 4 }}>YOU</span>}
            </span>
            {item.commentCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <i className="bi-chat-text" style={{ fontSize: 11 }} />
                {item.commentCount}
              </span>
            )}
            {activity && (
              <span
                title={`Last updated ${new Date(item.updatedAt).toLocaleString('en-GB')}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 128,
                  background: activity.bg, color: activity.color,
                  border: `1px solid ${activity.color}30`,
                  fontSize: 10, fontWeight: 700, letterSpacing: '.01em',
                }}
              >
                <i className={activity.icon} style={{ fontSize: 9 }} />
                {activity.label}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={() => onCopy(item)} style={ghostLink} title="Copy as markdown for sharing with Claude">
              <i className="bi-clipboard" style={{ fontSize: 11 }} /> Copy
            </button>
            {(isPriv || isMine) && (
              <button onClick={onToggle} style={ghostLink} title={expanded ? 'Collapse' : 'Expand'}>
                <i className={expanded ? 'bi-chevron-up' : 'bi-chevron-down'} style={{ fontSize: 11 }} />
                {expanded ? 'Hide' : 'Details'}
              </button>
            )}
            {isAdmin && (
              <button onClick={() => onDelete(item)} style={{ ...ghostLink, color: '#dc2626' }} title="Delete">
                <i className="bi-trash" style={{ fontSize: 11 }} />
              </button>
            )}
          </div>
        </div>

        {/* Attachment thumb (right rail) — first image if any, else first
            video frame placeholder. "+N" badge appears when more than one
            attachment is present so the row signals there's more inside. */}
        {(() => {
          if (expanded) return null;
          const atts = Array.isArray(item.attachments) && item.attachments.length > 0
            ? item.attachments
            : (item.screenshot ? [{ kind: 'image', dataUri: item.screenshot, name: 'screenshot' }] : []);
          if (atts.length === 0) return null;
          const first = atts.find(a => a.kind === 'image') || atts[0];
          const moreCount = atts.length - 1;
          return (
            <div style={{ flexShrink: 0, alignSelf: 'flex-start', position: 'relative' }}>
              <button onClick={onToggle} style={thumbBtn} aria-label={`View ${atts.length} attachment${atts.length === 1 ? '' : 's'}`}>
                {first.kind === 'image' ? (
                  <img src={first.dataUri} alt={first.name || 'Attachment'} style={{ width: 92, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ) : (
                  <div style={{ width: 92, height: 64, borderRadius: 8, border: '1px solid var(--border)', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                    <i className="bi-camera-video-fill" style={{ fontSize: 18 }} />
                  </div>
                )}
              </button>
              {moreCount > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  background: 'rgba(0,0,0,0.7)', color: 'white',
                  borderRadius: 128, padding: '1px 7px',
                  fontSize: 10, fontWeight: 700,
                  pointerEvents: 'none',
                }}>+{moreCount}</span>
              )}
            </div>
          );
        })()}
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={detailPanel}>
          <ExpandedDetail
            item={item}
            isPriv={isPriv}
            onStatusChange={onStatusChange}
            onPriorityChange={onPriorityChange}
            onAssigneeChange={onAssigneeChange}
          />
        </div>
      )}
    </li>
  );
}

// ── Expanded detail (description, screenshot full-size, status changer) ──
function ExpandedDetail({ item, isPriv, onStatusChange, onPriorityChange, onAssigneeChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 16 }}>
      {/* Left: long-form text + screenshot */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Issue</div>
        <div style={prose}>{item.issue}</div>

        {item.proposedResolution && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 14, marginBottom: 6 }}>Proposed resolution</div>
            <div style={prose}>{item.proposedResolution}</div>
          </>
        )}

        {item.resolutionNote && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 14, marginBottom: 6 }}>Resolution note</div>
            <div style={prose}>{item.resolutionNote}</div>
          </>
        )}

        {(() => {
          // Prefer the multi-attachment array; fall back to the legacy
          // single-screenshot column for rows submitted before this feature.
          const atts = Array.isArray(item.attachments) && item.attachments.length > 0
            ? item.attachments
            : (item.screenshot ? [{ kind: 'image', dataUri: item.screenshot, name: 'screenshot' }] : []);
          if (atts.length === 0) return null;
          const label = atts.length === 1
            ? (atts[0].kind === 'video' ? 'Clip' : 'Screenshot')
            : `Attachments (${atts.length})`;
          return (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {atts.map((a, idx) => (
                  <div key={idx} style={{ minWidth: 0 }}>
                    {a.kind === 'video' ? (
                      <video src={a.dataUri} controls preload="metadata"
                        style={{ display: 'block', width: '100%', maxHeight: 320, borderRadius: 10, border: '1px solid var(--border)', background: '#000' }} />
                    ) : (
                      <a href={a.dataUri} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                        <img src={a.dataUri} alt={a.name || `Attachment ${idx + 1}`}
                          style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }} />
                      </a>
                    )}
                    {a.name && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Right: action panel */}
      <aside style={{ borderLeft: '1px solid var(--border-light)', paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ActionRow label="Status">
          {isPriv ? (
            <select value={item.status} onChange={e => onStatusChange(item, e.target.value)} style={miniSelect}>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
            </select>
          ) : (
            <span style={{ ...pill, background: STATUS_CONFIG[item.status]?.bg, color: STATUS_CONFIG[item.status]?.color, borderColor: STATUS_CONFIG[item.status]?.color + '40' }}>
              <i className={STATUS_CONFIG[item.status]?.icon} style={{ fontSize: 10 }} /> {STATUS_CONFIG[item.status]?.label || item.status}
            </span>
          )}
        </ActionRow>

        <ActionRow label="Priority">
          {isPriv ? (
            <select value={item.priority} onChange={e => onPriorityChange(item, e.target.value)} style={miniSelect}>
              {Object.entries(PRIORITY_CONFIG).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          ) : (
            <span style={{ ...priorityChip, background: PRIORITY_CONFIG[item.priority]?.bg, color: PRIORITY_CONFIG[item.priority]?.color }}>
              {PRIORITY_CONFIG[item.priority]?.label}
            </span>
          )}
        </ActionRow>

        <ActionRow label="Assignee">
          {isPriv ? (
            <select value={item.assigneeId || ''} onChange={e => onAssigneeChange(item, e.target.value ? Number(e.target.value) : null)} style={miniSelect}>
              <option value="">Unassigned</option>
              {MEMBERS.filter(m => m.role === 'admin' || m.role === 'regional_manager' || m.role === 'team_lead').map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text)' }}>
              {item.assigneeName || item.assigneeEmail
                ? (item.assigneeName || item.assigneeEmail)
                : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
            </span>
          )}
        </ActionRow>

        <ActionRow label="Submitted">
          <span style={{ fontSize: 12, color: 'var(--text)' }}>{relTime(item.createdAt)}</span>
        </ActionRow>
        {item.resolvedAt && (
          <ActionRow label="Resolved">
            <span style={{ fontSize: 12, color: 'var(--text)' }}>{relTime(item.resolvedAt)}</span>
          </ActionRow>
        )}
        <ActionRow label="Votes">
          <span style={{ fontSize: 12, color: 'var(--text)' }}>{item.upvotes}↑  {item.downvotes}↓</span>
        </ActionRow>
      </aside>
    </div>
  );
}

function ActionRow({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul style={list}>
      {[1, 2, 3, 4].map(i => (
        <li key={i} style={{ ...rowCard, opacity: 0.6 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 36, height: 60, background: 'var(--surface-2)', borderRadius: 6 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ height: 12, background: 'var(--surface-2)', borderRadius: 4, width: '40%' }} />
              <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 4, width: '70%' }} />
              <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 4, width: '60%' }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────
const page = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 24px 24px', background: 'var(--bg)' };
const pageHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '20px 0 14px' };
const scopeRow = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 };
const segmentedControl = { display: 'inline-flex', padding: 3, borderRadius: 128, background: 'var(--surface-2)', border: '1px solid var(--border-light)', gap: 2 };
const segmentBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 128, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const segmentBtnActive = { background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', fontWeight: 700 };
const segmentCount = { padding: '0 7px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: 'rgba(15,23,42,0.06)', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center', lineHeight: '16px' };
const segmentCountActive = { background: '#7c3aed', color: 'white' };
const statusFilterBtn = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', transition: 'all .15s', textAlign: 'left', minWidth: 0 };
const filterBar = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border-light)', marginBottom: 14, flexWrap: 'wrap' };
const filterPill = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 128, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const filterPillActive = { background: '#1b1b1b', color: 'white', borderColor: '#1b1b1b' };
const countBadge = { padding: '0 6px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: '#f2f2f2', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' };
const countBadgeActive = { background: 'rgba(255,255,255,0.2)', color: 'white' };
const listWrap = { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 };
// Slightly more breathing room between cards (10 → 12) per the revamp brief.
const list = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 };
const rowCard = { padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', transition: 'all .12s' };
const voteBtn = { width: 30, height: 26, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .12s' };
const pill = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 128, fontSize: 10, fontWeight: 700, border: '1px solid', whiteSpace: 'nowrap' };
const priorityChip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 128, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' };
const mutedPill = { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 128, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border-light)' };
const titleBtn = { textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 };
const preview = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' };
const ghostLink = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all .12s' };
const thumbBtn = { padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' };
const detailPanel = { marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' };
const prose = { fontSize: 13, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const miniSelect = { width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)' };
const iconBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const errorBanner = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 500, border: '1px solid #fca5a5', marginBottom: 12 };
