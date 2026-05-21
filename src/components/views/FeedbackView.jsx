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

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsContext } from '../../App';
import { MEMBERS, MEMBERS_BY_EMAIL } from '../../data/members';
import { useFeedback } from '../../hooks/useFeedback';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import ImageLightbox from '../ui/ImageLightbox';
import MentionTextarea from '../ui/MentionTextarea';
import CreateFeedbackModal from '../modals/CreateFeedbackModal';
import CreateEscalationZeroModal from '../modals/CreateEscalationZeroModal';
import SubmitFeedbackPicker from '../modals/SubmitFeedbackPicker';
import CommentReactions from '../ui/CommentReactions';
import {
  ESCALATION_FUNCTIONS,
  ESCALATION_STATUSES,
  escalationFunctionLabel,
  escalationStatusMeta,
  dbPriorityToEscalation,
} from '../../lib/escalation-zero-constants';

// ── Visual config ──────────────────────────────────────────────────────
// Status labels were renamed 2026-05-11 to match the team's actual lifecycle:
//   New → In Progress → Paused → Deployed → Rejected.
// DB enum values stayed stable (done = Deployed, wont_do = Rejected) so
// existing rows keep their meaning; only the displayed labels changed.
// `triaged` and `duplicate` are legacy values kept here for backwards
// compatibility on older rows — they're not shown in the user-facing status
// dropdown (STATUS_ORDER) but DO render correctly on a row whose status is
// still set to one of those values.
const STATUS_CONFIG = {
  new:         { label: 'New',         color: '#0369a1', bg: '#e0f2fe', icon: 'bi-circle-fill',          dot: '#0ea5e9' },
  triaged:     { label: 'Triaged',     color: '#7c3aed', bg: '#f3eff8', icon: 'bi-pin-angle-fill',       dot: '#7c3aed' },
  in_progress: { label: 'In Progress', color: '#d97706', bg: '#fff8e6', icon: 'bi-arrow-repeat',         dot: '#f59e0b' },
  paused:      { label: 'Paused',      color: '#a16207', bg: '#fef9c3', icon: 'bi-pause-circle-fill',    dot: '#eab308' },
  done:        { label: 'Deployed',    color: '#15803d', bg: '#e8f5e9', icon: 'bi-rocket-takeoff-fill',  dot: '#22c55e' },
  wont_do:     { label: 'Rejected',    color: '#dc2626', bg: '#fef2f2', icon: 'bi-x-circle-fill',        dot: '#ef4444' },
  duplicate:   { label: 'Duplicate',   color: '#737373', bg: '#f5f5f4', icon: 'bi-files',                dot: '#9ca3af' },
};
// User-facing dropdown order — five statuses matching the lifecycle. The
// legacy `triaged` / `duplicate` values aren't surfaced for new edits but
// existing rows carrying them still render via STATUS_CONFIG.
const STATUS_ORDER = ['new', 'in_progress', 'paused', 'done', 'wont_do'];

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

// Short label for the audience-scope badge on rows. The full descriptions
// live in CreateFeedbackModal's AUDIENCE_OPTIONS — this just needs a glance-
// friendly tag so the row tells you "this is private to EMEA" without
// crowding the pill row.
const AUDIENCE_BADGE_LABEL = {
  managers: 'Managers only',
  emea:     'EMEA only',
  apac:     'APAC only',
  americas: 'Americas only',
  nam:      'NAM only',
  latam:    'LATAM only',
};

const SORTS = [
  { value: 'top', label: 'Most upvoted' },
  { value: 'new', label: 'Newest' },
  { value: 'recently_updated', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest' },
];

// Five large status filter buttons matching the lifecycle (2026-05-11):
//   New → In Progress → Paused → Deployed → Rejected.
// Legacy `triaged` rows fold into the "New" bucket, legacy `duplicate` rows
// fold into "Rejected" — see counts and filter logic below.
const STATUS_FILTERS = [
  { value: 'new',          label: 'New',          icon: 'bi-circle-fill',          color: '#0369a1', bg: '#e0f2fe', tint: '#bae6fd' },
  { value: 'in_progress',  label: 'In Progress',  icon: 'bi-arrow-repeat',         color: '#d97706', bg: '#fff8e6', tint: '#fde68a' },
  { value: 'paused',       label: 'Paused',       icon: 'bi-pause-circle-fill',    color: '#a16207', bg: '#fef9c3', tint: '#fde68a' },
  { value: 'done',         label: 'Deployed',     icon: 'bi-rocket-takeoff-fill',  color: '#15803d', bg: '#e8f5e9', tint: '#bbf7d0' },
  { value: 'wont_do',      label: 'Rejected',     icon: 'bi-x-circle-fill',        color: '#dc2626', bg: '#fef2f2', tint: '#fecaca' },
];

// Terminal states keep the same enum membership: done + wont_do + duplicate.
// "Open"-style meta-bucket is gone now that the 5 buttons map 1:1 to the
// lifecycle statuses.
const TERMINAL = new Set(['done', 'wont_do', 'duplicate']);

// Map a row's stored status onto the filter bucket it belongs to. Legacy
// `triaged` rows surface as "New" so they stay visible after the rename;
// legacy `duplicate` rows surface as "Rejected" since duplicate is, in
// effect, a rejection-because-already-tracked.
function bucketForStatus(status) {
  if (status === 'triaged') return 'new';
  if (status === 'duplicate') return 'wont_do';
  return status;
}

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

export default function FeedbackView({ user, addToast, openCompose, onComposeOpened, openPicker, onPickerOpened }) {
  const perms = useContext(PermissionsContext);
  const isPriv = perms?.isAdmin || perms?.dataScope === 'regional_tasks' || false;

  // Default filter set 2026-05-11: scope=All, status=New. The New bucket
  // is the first stop in the lifecycle (New → In Progress → Paused →
  // Deployed → Rejected) so landing on it surfaces the freshest items
  // that haven't been triaged yet.
  const [scopeFilter, setScopeFilter] = useState('all'); // 'all' | 'mine'
  const [statusFilter, setStatusFilter] = useState('new'); // one of the five lifecycle statuses
  const [typeFilter, setTypeFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('top');
  const [composeOpen, setComposeOpen] = useState(false);
  // Escalation Zero composer + the picker that gates entry into either
  // composer. 2026-05-21 split: New Request → picker (2 cards) → kind
  // composer. Direct ?compose=escalation_zero deep-link is honoured below.
  const [escalationComposeOpen, setEscalationComposeOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Top-level kind tab. Drives every list/board/counter filter below so the
  // two workflows never bleed into each other visually. URL-mirrored so
  // F5 + share-the-URL preserves the chosen surface. Default lands on
  // Ops Hub Feedback (the historical Feedback board content).
  const [kindFilter, setKindFilter] = useState('ops_hub_feedback'); // 'ops_hub_feedback' | 'escalation_zero'
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('kind');
      if (v === 'escalation_zero' || v === 'ops_hub_feedback') {
        setKindFilter(v);
      }
    } catch {}
  }, []);
  // Persist kind selection to the URL so a hard refresh restores the same
  // tab. Mirrors how the deep-link `fb` param flows through.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (kindFilter === 'escalation_zero') url.searchParams.set('kind', 'escalation_zero');
      else url.searchParams.delete('kind');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, [kindFilter]);
  // Deep-link target (Carolina-style notification flow: click a feedback
  // notification → land on Feedback with the right row expanded). Read in
  // a useEffect-after-mount rather than the useState initialiser so SSR
  // and the client first render return the same null — otherwise React
  // throws #418 ("Hydration failed because the server rendered HTML
  // didn't match the client") whenever `?fb=<id>` is present in the URL.
  // The race with App.jsx's openDetail event that the previous comment
  // worried about is mitigated by the second useEffect below (the
  // dedicated openDetail listener), which fires on every fresh dispatch
  // — so reading the URL one tick later doesn't drop the deep-link.
  const [expandedId, setExpandedId] = useState(null);
  // Snapshot of the initial ?fb= value (if any), used by the cleanup-on-
  // collapse effect below. Filled in by the same mount effect that seeds
  // `expandedId`, so we can't pre-compute it in a useRef initialiser
  // without re-introducing the SSR/CSR divergence we're avoiding.
  const initialDeepLinkRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('fb');
      if (v) {
        initialDeepLinkRef.current = String(v);
        setExpandedId(String(v));
      }
    } catch {}
  }, []);

  // Allow App.jsx (via the "+ New Feedback" Create-menu shortcut) to pop the
  // composer the moment the user lands on this tab.
  useEffect(() => {
    if (openCompose) {
      setComposeOpen(true);
      onComposeOpened?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCompose]);

  // 2026-05-21 — Submit Feedback picker entry point. App.jsx flips
  // `openPicker` true when the TopNav Quick Create "Submit Feedback"
  // option is chosen; we surface the 2-card picker on this tab.
  useEffect(() => {
    if (openPicker) {
      setPickerOpen(true);
      onPickerOpened?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPicker]);

  // Bell deep-link handler. App.jsx fires `feedback:openDetail` with the
  // feedback id (and optionally a comment id) when the user clicks a
  // notification linked to this board. We expand the row + scroll it
  // into view. The (optional) comment id is forwarded as an attribute on
  // the row container so a future "scroll-to-comment" affordance can read
  // it without another listener round-trip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e) => {
      const id = e?.detail?.id;
      if (!id) return;
      setExpandedId(String(id));
      // Mirror to the URL so a later F5 / share-the-URL restores the same
      // expanded row. Stays in sync with the App.jsx writer.
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('fb', String(id));
        window.history.replaceState({}, '', url.toString());
      } catch {}
      requestAnimationFrame(() => {
        const node = document.querySelector(`[data-feedback-row="${String(id)}"]`);
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };
    window.addEventListener('feedback:openDetail', handler);
    return () => window.removeEventListener('feedback:openDetail', handler);
  }, []);

  // When the user manually collapses the deep-linked row, drop the ?fb=
  // URL param so a subsequent reload doesn't keep auto-expanding it.
  // Mounted-only effect — fires when `expandedId` clears AFTER the deep
  // link has been seeded via initialDeepLinkRef (set in the mount effect
  // above).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (expandedId) return;
    if (!initialDeepLinkRef.current) return;
    initialDeepLinkRef.current = null;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('fb')) {
        url.searchParams.delete('fb');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
  }, [expandedId]);

  // After the items list lands, scroll the deep-linked row into view (the
  // openDetail event handler already does this on its own dispatch path,
  // but on the URL-param path the items aren't loaded yet at mount).
  useEffect(() => {
    if (!expandedId) return;
    const id = String(expandedId);
    const t = setTimeout(() => {
      try {
        const node = document.querySelector(`[data-feedback-row="${id}"]`);
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
    }, 60);
    return () => clearTimeout(t);
  }, [expandedId]);

  const { items, loading, error, lastSyncAt, refresh, create, patch, remove, vote, loadDetail, fetchComments, submitComment } = useFeedback({
    enabled: !!user,
    userEmail: user?.email || null,
    sort,
  });

  // Lazy-load full attachments the moment a row opens. The list response
  // ships lite rows (no attachment dataUris) so the cold load is fast;
  // when the user clicks to expand, fetch the detail.
  //
  // Dedupe rule: track ids currently being fetched (NOT ids that have
  // been fetched in the past). The 30 s background poll replaces the
  // `items` array with a fresh lite shape — so an id we previously
  // hydrated drops its `attachments` array back to `[]`. A "loaded once"
  // ref would say "already done" and the next expand of the same row
  // would render the loading placeholder forever (caught 2026-05-13
  // post-ship sweep). Keying the dedupe on `attachments.length ===
  // attachmentCount` instead means the effect naturally refetches after
  // the poll wipes the data, and `inFlightFetchRef` only blocks
  // duplicate fetches WHILE one is mid-flight.
  const inFlightFetchRef = useRef(new Set());
  useEffect(() => {
    if (!expandedId) return;
    const id = expandedId;
    const item = items.find(i => String(i.id) === String(id));
    if (!item) return;
    // No attachments to hydrate → noop.
    if (!item.attachmentCount) return;
    // Already fully loaded — every attachment present.
    if (Array.isArray(item.attachments) && item.attachments.length >= item.attachmentCount) return;
    // Already fetching for this id — wait.
    if (inFlightFetchRef.current.has(id)) return;
    inFlightFetchRef.current.add(id);
    Promise.resolve(loadDetail(id)).finally(() => {
      inFlightFetchRef.current.delete(id);
    });
  }, [expandedId, items, loadDetail]);

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
  // Deep-link bypass: when a notification expanded a specific row, always
  // include it in the visible list regardless of the active filters — the
  // user explicitly asked to see THAT item. Without this, a notification
  // pointing to a Done request while the user is on the Open filter would
  // flip the view, set expandedId, and STILL show the row collapsed and
  // out-of-view (Carolina Ferreira 2026-05-11 "Accessing requests through
  // notifications").
  const matchesDeepLink = useCallback(
    (item) => !!(expandedId && String(item.id) === String(expandedId)),
    [expandedId],
  );

  // 2026-05-21 — partition by kind FIRST so the Ops Hub Feedback tab
  // never shows escalation_zero rows and vice versa. Items missing a
  // `kind` field (legacy server payloads pre-#754) default to
  // ops_hub_feedback to preserve the historical board content. Deep-link
  // bypass: a `?fb=<id>` deep-link still surfaces the row even when its
  // kind doesn't match the active tab — user explicitly asked for that id.
  const kindedItems = useMemo(() => (
    items.filter(item => {
      if (matchesDeepLink(item)) return true;
      const k = item.kind || 'ops_hub_feedback';
      return k === kindFilter;
    })
  ), [items, kindFilter, matchesDeepLink]);

  const scopedItems = useMemo(() => (
    scopeFilter === 'mine'
      ? kindedItems.filter(item => isMineFn(item) || matchesDeepLink(item))
      : kindedItems
  ), [kindedItems, scopeFilter, isMineFn, matchesDeepLink]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedItems.filter(item => {
      if (matchesDeepLink(item)) return true;
      if (bucketForStatus(item.status) !== statusFilter) return false;
      if (typeFilter && item.type !== typeFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.issue} ${item.proposedResolution || ''} ${item.category || ''} ${item.submitterName || ''} ${item.submitterEmail || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopedItems, statusFilter, typeFilter, search, matchesDeepLink]);

  // ── Status counts (drive the five large filter buttons) ───────────────
  // Counts respect the scope toggle so "My requests · New (3)" reads
  // accurately. Type / search are NOT applied here so the user can see how
  // many would land in each bucket regardless of the secondary filter.
  // Legacy `triaged` rows fold into `new`; legacy `duplicate` into `wont_do`.
  const counts = useMemo(() => {
    const c = { new: 0, in_progress: 0, paused: 0, done: 0, wont_do: 0 };
    for (const i of scopedItems) {
      const bucket = bucketForStatus(i.status);
      if (bucket in c) c[bucket] += 1;
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
      {/* Inline responsive style — the five big status buttons collapse to
          a 3+2 grid at medium widths and 2x3 / 1-per-row at the narrow end
          so labels never truncate. */}
      <style>{`
        .feedback-status-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 1200px) { .feedback-status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 760px)  { .feedback-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 520px)  { .feedback-status-grid { grid-template-columns: 1fr; } }
      `}</style>
      {/* Header — title + subtitle adapt to the active kind so the user
          always knows which surface they're on. */}
      <div style={pageHead}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: kindFilter === 'escalation_zero' ? '#f3eff8' : '#fff8e6',
              color: kindFilter === 'escalation_zero' ? '#7c3aed' : '#d97706',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className={kindFilter === 'escalation_zero' ? 'bi-stars' : 'bi-lightbulb-fill'} style={{ fontSize: 19 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
                {kindFilter === 'escalation_zero' ? 'Escalation Zero' : 'Ops Hub Feedback'}
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {kindFilter === 'escalation_zero'
                  ? 'Strategic improvements, process gaps, product feedback. Reviewed by leadership.'
                  : 'Bugs, ideas, and improvements for ops-hub. Vote on what matters most.'}
                {lastSyncAt && <> · <span title={new Date(lastSyncAt).toISOString()}>synced {relTime(new Date(lastSyncAt).toISOString())}</span></>}
              </div>
            </div>
          </div>
        </div>
        <button onClick={() => setPickerOpen(true)} style={primaryBtn}>
          <i className="bi-plus-circle-fill" style={{ fontSize: 13 }} /> New request
        </button>
      </div>

      {/* Kind tabs — Ops Hub Feedback vs Escalation Zero. Counts reflect
          ALL items in each kind across every scope so the user can see how
          full the other surface is before switching. 2026-05-21 split. */}
      <div style={{ ...scopeRow, marginBottom: 12 }}>
        <div role="tablist" aria-label="Feedback surface" style={segmentedControl}>
          {[
            { value: 'ops_hub_feedback', label: 'Ops Hub Feedback', icon: 'bi-lightbulb-fill', count: items.filter(it => (it.kind || 'ops_hub_feedback') === 'ops_hub_feedback').length },
            { value: 'escalation_zero',  label: 'Escalation Zero',  icon: 'bi-stars',          count: items.filter(it => it.kind === 'escalation_zero').length },
          ].map(seg => {
            const active = kindFilter === seg.value;
            return (
              <button
                key={seg.value}
                role="tab"
                aria-selected={active}
                onClick={() => setKindFilter(seg.value)}
                style={{ ...segmentBtn, ...(active ? segmentBtnActive : null) }}
              >
                <i className={seg.icon} style={{ fontSize: 13, marginRight: 6 }} />
                {seg.label}
                <span style={{ ...segmentCount, ...(active ? segmentCountActive : null) }}>{seg.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scope toggle (My requests | All requests) — secondary nav within
          the active kind. Count ticked beside each segment so the user can
          pre-empt how busy either view is before clicking. */}
      <div style={scopeRow}>
        <div role="tablist" aria-label="Request scope" style={segmentedControl}>
          {[
            { value: 'all',  label: 'All requests', count: kindedItems.length },
            { value: 'mine', label: 'My requests',  count: kindedItems.filter(isMineFn).length },
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
                  ? () => setPickerOpen(true)
                  : () => { setStatusFilter('new'); setScopeFilter('all'); setTypeFilter(null); setSearch(''); }}
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
                fetchComments={fetchComments}
                submitComment={submitComment}
                addToast={addToast}
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

      {/* 2026-05-21 — Submit Feedback picker (Ops Hub vs Escalation Zero).
          Opens before the per-kind composer so the user explicitly picks
          a flow each time. Direct deep-link from the TopNav also lands
          here. */}
      {pickerOpen && (
        <SubmitFeedbackPicker
          onClose={() => setPickerOpen(false)}
          onPick={(kind) => {
            setPickerOpen(false);
            if (kind === 'escalation_zero') setEscalationComposeOpen(true);
            else setComposeOpen(true);
          }}
        />
      )}

      {/* Escalation Zero composer — separate from CreateFeedbackModal
          because the form shape is meaningfully different (function
          dropdown, ideal solution at 10k chars, multi-country, linked
          ZD / Jira URLs). Shares the same submit pipeline so the row
          appears on the board the moment the POST resolves. */}
      {escalationComposeOpen && (
        <CreateEscalationZeroModal
          onClose={() => setEscalationComposeOpen(false)}
          onSubmit={handleSubmit}
          currentUser={user}
        />
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────
function FeedbackRow({ item, expanded, onToggle, onVote, onStatusChange, onPriorityChange, onAssigneeChange, onDelete, onCopy, isPriv, isAdmin, user, fetchComments, submitComment, addToast }) {
  // For escalation_zero rows, the canonical workflow has 6 statuses
  // (New, In Review, HRX Execute, On Hold, Resolved, Closed) stored on
  // extras.escalationStatus. The DB column carries the mirrored
  // 5-bucket value (new/in_progress/paused/done/wont_do) so the
  // existing index + filter chips still work — we just relabel the pill
  // to the canonical escalation status when present. Falls back to the
  // standard STATUS_CONFIG entry when no extras hint exists (legacy
  // rows, or ops_hub_feedback kind).
  const isEscalation = item.kind === 'escalation_zero';
  const escStatus = isEscalation ? escalationStatusMeta(item.extras?.escalationStatus || 'new') : null;
  const status = (isEscalation && escStatus)
    ? { label: escStatus.label, color: escStatus.color, bg: escStatus.bg, icon: escStatus.isPaused ? 'bi-pause-circle-fill' : 'bi-circle-fill', dot: escStatus.color }
    : (STATUS_CONFIG[item.status] || STATUS_CONFIG.new);
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
      data-feedback-row={item.id}
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
            {/* Escalation Zero badges (2026-05-21) — function pill + a
                country chip set so the row is scannable at a glance. The
                priority pill above already reflects the Standard/Urgent
                choice via the mirrored priority column. */}
            {item.kind === 'escalation_zero' && item.extras?.functionKey && (
              <span
                style={{ ...mutedPill, gap: 4, background: '#f3eff8', color: '#7c3aed', borderColor: '#c4b1f9' }}
                title={`HRX Function: ${escalationFunctionLabel(item.extras.functionKey)}`}
              >
                <i className="bi-tag-fill" style={{ fontSize: 10 }} />
                {escalationFunctionLabel(item.extras.functionKey)}
              </span>
            )}
            {item.kind === 'escalation_zero' && Array.isArray(item.extras?.countries) && item.extras.countries.length > 0 && (
              <span
                style={{ ...mutedPill, gap: 4 }}
                title={`Countries: ${item.extras.countries.join(', ')}`}
              >
                <i className="bi-globe2" style={{ fontSize: 10 }} />
                {item.extras.countries.slice(0, 3).join(' · ')}
                {item.extras.countries.length > 3 && ` +${item.extras.countries.length - 3}`}
              </span>
            )}
            {item.audience && item.audience !== 'global' && (
              <span
                style={{ ...mutedPill, gap: 4, background: '#f3eff8', color: '#7c3aed', borderColor: '#c4b1f9' }}
                title={`Visible to ${AUDIENCE_BADGE_LABEL[item.audience] || item.audience} only`}
              >
                <i className="bi-eye" style={{ fontSize: 10 }} />
                {AUDIENCE_BADGE_LABEL[item.audience] || item.audience}
              </span>
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

        {/* Attachment thumb (right rail). Two shapes:
            • Hydrated (server returned the dataUri — happens on detail
              fetch after expand, OR for rows the user just submitted):
              render the first image / video frame as a thumbnail.
            • Lite (list response — server omits dataUris for perf):
              render a generic "📎 N" placeholder. Clicking it expands
              the row, which triggers the lazy detail-fetch and swaps
              this in for the real thumbnail next pass. */}
        {(() => {
          if (expanded) return null;
          const atts = Array.isArray(item.attachments) && item.attachments.length > 0
            ? item.attachments
            : (item.screenshot ? [{ kind: 'image', dataUri: item.screenshot, name: 'screenshot' }] : []);
          const liteCount = Number(item.attachmentCount || 0);
          if (atts.length === 0 && liteCount === 0) return null;

          // Lite placeholder — no dataUri yet.
          if (atts.length === 0) {
            return (
              <div style={{ flexShrink: 0, alignSelf: 'flex-start', position: 'relative' }}>
                <button onClick={onToggle} style={thumbBtn} aria-label={`View ${liteCount} attachment${liteCount === 1 ? '' : 's'}`}>
                  <div style={{
                    width: 92, height: 64,
                    borderRadius: 8, border: '1px dashed var(--border)',
                    background: 'var(--surface-2)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    gap: 2,
                  }}>
                    <i className="bi-paperclip" style={{ fontSize: 16 }} />
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{liteCount} attachment{liteCount === 1 ? '' : 's'}</span>
                  </div>
                </button>
              </div>
            );
          }

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
            user={user}
            fetchComments={fetchComments}
            submitComment={submitComment}
            addToast={addToast}
          />
        </div>
      )}
    </li>
  );
}

// Inline-render a comment body: split on newlines, wrap @first.last tokens
// in styled chips that resolve to roster members. Unknown handles fall
// through as plain text so a typo doesn't blow up the comment.
function renderCommentLine(line, mentionByPrefix) {
  if (!line) return null;
  const parts = [];
  const re = /(^|\s)@([a-z0-9._-]+)/gi;
  let lastIndex = 0;
  let m;
  let key = 0;
  while ((m = re.exec(line)) !== null) {
    const before = line.slice(lastIndex, m.index + m[1].length);
    if (before) parts.push(<span key={`t-${key++}`}>{before}</span>);
    const handle = String(m[2] || '').toLowerCase();
    const member = mentionByPrefix.get(handle);
    if (member) {
      parts.push(
        <span key={`m-${key++}`} title={member.email}
          style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'var(--purple-mid, #ede9fe)',
            color: 'var(--purple, #6b3fa0)',
            borderRadius: 6, padding: '0 5px', fontWeight: 600,
          }}>@{handle}</span>
      );
    } else {
      parts.push(<span key={`u-${key++}`}>@{handle}</span>);
    }
    lastIndex = m.index + m[1].length + 1 + m[2].length;
  }
  const tail = line.slice(lastIndex);
  if (tail) parts.push(<span key={`t-${key++}`}>{tail}</span>);
  return parts;
}

// ── Comments thread (load on expand, post with @-mentions) ──────────────
// The /api/v1/feedback/[id]/comments route already fans notifications out
// to the submitter, previous commenters, and any @-mentioned users — we
// just have to surface the thread in the UI and let users post.
function CommentsSection({ item, fetchComments, submitComment, user, addToast }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [, setMentions] = useState([]); // resolved emails — server re-parses, kept for parity with other composers
  const [posting, setPosting] = useState(false);

  // mentionByPrefix lets the renderer chip-ify @handles without re-walking
  // the full members list on every line.
  const mentionByPrefix = useMemo(() => {
    const map = new Map();
    for (const m of MEMBERS) {
      const e = String(m?.email || '');
      const at = e.indexOf('@');
      const prefix = (at > 0 ? e.slice(0, at) : e).toLowerCase();
      if (prefix) map.set(prefix, m);
    }
    return map;
  }, []);

  // Load comments on mount (i.e. when the row is expanded). The thread is
  // small enough to fetch in one shot — no pagination needed.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.resolve(fetchComments(item.id))
      .then(res => { if (!cancelled) setComments(Array.isArray(res?.items) ? res.items : []); })
      .catch(err => { if (!cancelled) addToast?.('error', 'Comments', err?.message || 'Could not load comments'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id, fetchComments, addToast]);

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const created = await submitComment(item.id, body);
      if (created) setComments(prev => [...prev, created]);
      setDraft('');
      setMentions([]);
    } catch (err) {
      addToast?.('error', 'Comment failed', err?.message || 'Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const authorEmailLc = String(user?.email || '').toLowerCase();

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <i className="bi-chat-text-fill" style={{ fontSize: 13, color: '#7c3aed' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Discussion</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({comments.length})</span>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>Loading comments…</div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
          No comments yet. Be the first to weigh in — type <code style={{ background: 'var(--surface-2)', padding: '0 4px', borderRadius: 4 }}>@</code> to tag someone.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.map(c => {
            const cAuthorEmail = String(c.authorEmail || '').toLowerCase();
            const member = cAuthorEmail ? MEMBERS_BY_EMAIL[cAuthorEmail] : null;
            const isOwn = cAuthorEmail && cAuthorEmail === authorEmailLc;
            return (
              <li key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Avatar name={member?.name || c.authorName || c.authorEmail} initials={member?.initials} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                      {member?.name || c.authorName || c.authorEmail || 'Unknown'}
                    </span>
                    {isOwn && (
                      <span style={{ ...mutedPill, padding: '0 6px', fontSize: 9, height: 16 }}>YOU</span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }} title={new Date(c.createdAt).toLocaleString('en-GB')}>
                      {relTime(c.createdAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {String(c.body || '').split('\n').map((line, i) => (
                      <div key={i}>{line.trim() === '' ? <>&nbsp;</> : renderCommentLine(line, mentionByPrefix)}</div>
                    ))}
                  </div>
                  <CommentReactions
                    commentType="feedback"
                    commentId={c.id}
                    reactions={c.reactions || []}
                    currentUserEmail={user?.email}
                    currentUserName={user?.name}
                    onChange={(next) => setComments(prev => prev.map(x => x.id === c.id ? { ...x, reactions: next } : x))}
                    compact
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Composer — Cmd/Ctrl+Enter submits, plain Enter inserts a newline.
          Server re-parses @-mentions so we don't need to thread the
          resolved list back, but we still track them locally for parity
          with other composers in the app. */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Avatar name={user?.name || user?.email} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <MentionTextarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onMentionsChange={setMentions}
            members={MEMBERS}
            placeholder="Add a comment… type @ to mention someone. Cmd/Ctrl+Enter to send."
            rows={2}
            minHeight={64}
            maxHeight={200}
            style={{ fontSize: 13, padding: '8px 10px', lineHeight: 1.45, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: '100%', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!draft.trim() || posting}
          aria-label="Post comment"
          style={{
            height: 36, padding: '0 14px', borderRadius: 8, border: 'none',
            background: draft.trim() && !posting ? '#7c3aed' : 'var(--surface-2)',
            color: draft.trim() && !posting ? 'white' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 700,
            cursor: draft.trim() && !posting ? 'pointer' : 'default',
            display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            boxShadow: draft.trim() && !posting ? '0 2px 8px rgba(124,58,237,0.22)' : 'none',
          }}>
          <i className={posting ? 'bi-arrow-clockwise spin' : 'bi-send-fill'} style={{ fontSize: 12 }} />
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

// ── Expanded detail (description, screenshot full-size, status changer) ──
function ExpandedDetail({ item, isPriv, onStatusChange, onPriorityChange, onAssigneeChange, user, fetchComments, submitComment, addToast }) {
  const [lightbox, setLightbox] = useState(null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 16 }}>
      {/* Left: long-form text + screenshot */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Issue</div>
        <div style={prose}>{item.issue}</div>

        {item.proposedResolution && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 14, marginBottom: 6 }}>
              {item.kind === 'escalation_zero' ? 'Ideal solution' : 'Proposed resolution'}
            </div>
            <div style={prose}>{item.proposedResolution}</div>
          </>
        )}

        {/* Escalation Zero linked items — clickable Zendesk + Jira links
            beneath the long-form fields so the reviewer can hop straight
            to the source ticket. Each URL was server-validated to be
            http(s)-only so rendering as <a target="_blank"> is safe. */}
        {item.kind === 'escalation_zero' && (item.extras?.linkedZdUrl || item.extras?.linkedJiraUrl) && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 14, marginBottom: 6 }}>
              Linked items
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {item.extras?.linkedZdUrl && (
                <a
                  href={item.extras.linkedZdUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, textDecoration: 'none', border: '1px solid var(--border-light)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  <i className="bi-life-preserver" style={{ fontSize: 13, color: '#0369a1', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>Zendesk:</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.extras.linkedZdUrl}</span>
                </a>
              )}
              {item.extras?.linkedJiraUrl && (
                <a
                  href={item.extras.linkedJiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, textDecoration: 'none', border: '1px solid var(--border-light)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  <i className="bi-kanban" style={{ fontSize: 13, color: '#7c3aed', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>Jira / Workbench:</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.extras.linkedJiraUrl}</span>
                </a>
              )}
            </div>
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
          const liteCount = Number(item.attachmentCount || 0);
          // List endpoint omits data URIs for perf — show a placeholder
          // while the detail-fetch (kicked off by the row's expand
          // useEffect) lands. Typically <500 ms; the placeholder keeps
          // the layout stable so the inline preview slots in seamlessly.
          if (atts.length === 0 && liteCount > 0) {
            return (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                  {liteCount === 1 ? 'Attachment' : `Attachments (${liteCount})`}
                </div>
                <div style={{
                  padding: '24px 16px',
                  border: '1px dashed var(--border)',
                  borderRadius: 10,
                  background: 'var(--surface-2)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                }}>
                  <i className="bi-arrow-clockwise spin" style={{ fontSize: 16, marginRight: 6 }} />
                  Loading {liteCount === 1 ? 'attachment' : 'attachments'}…
                </div>
              </div>
            );
          }
          if (atts.length === 0) return null;
          const label = atts.length === 1
            ? (atts[0].kind === 'video' ? 'Clip' : 'Screenshot')
            : `Attachments (${atts.length})`;
          return (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {atts.map((a, idx) => {
                  const fallbackName = a.name || `Attachment ${idx + 1}`;
                  const lightboxKind = a.kind === 'video' ? 'video' : 'image';
                  const titleAttr = a.kind === 'video' ? 'Play video' : 'Open image';
                  return (
                    <div key={idx} style={{ minWidth: 0, position: 'relative' }}>
                      {a.kind === 'video' ? (
                        <button
                          type="button"
                          onClick={() => setLightbox({ src: a.dataUri, name: fallbackName, kind: 'video' })}
                          title={titleAttr}
                          aria-label={titleAttr}
                          style={{ position: 'relative', display: 'block', width: '100%', padding: 0, border: 'none', background: '#000', cursor: 'zoom-in', borderRadius: 10, overflow: 'hidden' }}
                        >
                          <video
                            src={a.dataUri}
                            preload="metadata"
                            muted
                            playsInline
                            style={{ display: 'block', width: '100%', maxHeight: 320, borderRadius: 10, border: '1px solid var(--border)', background: '#000', pointerEvents: 'none' }}
                          />
                          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                            <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              <i className="bi-play-fill" style={{ fontSize: 22 }} />
                            </span>
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLightbox({ src: a.dataUri, name: fallbackName, kind: 'image' })}
                          title={titleAttr}
                          style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'zoom-in' }}
                        >
                          <img src={a.dataUri} alt={fallbackName}
                            style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }} />
                        </button>
                      )}
                      {/* Download fallback — works for both kinds via the
                          `download` attribute on a data: URI. Always
                          present so the user has a path to save even if
                          the inline preview can't decode the file. */}
                      <a
                        href={a.dataUri}
                        download={fallbackName}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Download ${fallbackName}`}
                        title="Download"
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          width: 28, height: 28, borderRadius: '50%',
                          background: 'rgba(0,0,0,0.65)', color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          textDecoration: 'none',
                        }}
                      >
                        <i className="bi-download" style={{ fontSize: 12 }} />
                      </a>
                      {a.name && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Discussion thread + composer. Available to everyone with view
            access to the row — the server's audience gate on
            /api/v1/feedback/[id]/comments mirrors the row's audience scope. */}
        {fetchComments && submitComment && user && (
          <CommentsSection
            item={item}
            fetchComments={fetchComments}
            submitComment={submitComment}
            user={user}
            addToast={addToast}
          />
        )}
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
      <ImageLightbox
        src={lightbox?.src}
        name={lightbox?.name}
        kind={lightbox?.kind || 'image'}
        onClose={() => setLightbox(null)}
      />
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
