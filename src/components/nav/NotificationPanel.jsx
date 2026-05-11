// ── NotificationPanel ───────────────────────────────────────────────────
// Wider, denser bell dropdown that groups notifications by source task so
// "3 comments · 1 mention on Issue 3: FY27 SIP Delays" collapses to a
// single card instead of stacking five separate rows. The user wants to
// see 8-10 cards at once (Slack-style) with a per-row mark-as-read affordance,
// quick filters, and direct routing to the originating surface.
//
// Render shape per group:
//   [avatar]  {Actor} commented · HR Hub             {time}  [✕]
//             "Latest comment body, trimmed to ~120 chars."
//             • 3 comments  • 1 mention  • status updated
//
// Cross-cutting concerns the parent wires:
//   • notifs       — merged list (server + in-memory) with shape
//                    { id, type, title, body, time, read, linkView, linkId,
//                      sourceType, sourceId, actorEmail, actorName, _source }
//   • markRead(id) — mark a single notification read (per-row ✕ button)
//   • markAllRead  — mark every unread read (header CTA)
//   • onNotifClick(group) — open the source task; parent routes per linkView
//                           and is responsible for marking read / scrolling
//                           the associated comment into view.

import { useMemo, useState } from 'react';
import Avatar from '../ui/Avatar';

export const VIEW_LABELS = {
  hr_hub: 'HR Hub',
  'leader-alerts': 'Leaders Hub',
  leader_alerts: 'Leaders Hub',
  announcements: 'Announcement',
  feedback: 'Feedback',
  'my-queue': 'Workspace',
  briefing: 'Home',
};

export const TYPE_META = {
  comment:        { icon: 'bi-chat-square-text-fill', color: '#1d4ed8', label: 'comment' },
  mention:        { icon: 'bi-at',                    color: '#7c3aed', label: 'mention' },
  status_change:  { icon: 'bi-flag-fill',             color: '#ed8d00', label: 'status' },
  assignment:     { icon: 'bi-person-fill',           color: '#0369a1', label: 'assignment' },
  decision:       { icon: 'bi-check2-circle',         color: '#15803d', label: 'decision' },
  approved:       { icon: 'bi-check-circle-fill',     color: '#15803d', label: 'approved' },
  denied:         { icon: 'bi-x-circle-fill',         color: '#d42d35', label: 'denied' },
  escalation:     { icon: 'bi-arrow-up-circle-fill',  color: '#d42d35', label: 'escalation' },
  alert:          { icon: 'bi-exclamation-triangle-fill', color: '#ed8d00', label: 'alert' },
  new_task:       { icon: 'bi-inbox-fill',            color: '#0a5a99', label: 'new task' },
  task:           { icon: 'bi-inbox-fill',            color: '#0a5a99', label: 'task' },
  sla:            { icon: 'bi-clock-history',         color: '#d42d35', label: 'SLA' },
  success:        { icon: 'bi-check-circle-fill',     color: '#15803d', label: 'success' },
  info:           { icon: 'bi-bell-fill',             color: '#1f74b3', label: 'update' },
};

export function metaFor(type) {
  return TYPE_META[type] || TYPE_META.info;
}

// Group notifications by (linkView, linkId) so the same task collapses to
// one card. Notifications without link metadata get their own group keyed
// on id (legacy in-memory items + ungrouped one-offs).
export function groupNotifications(notifs) {
  const groups = new Map();
  for (const n of notifs) {
    const hasLink = n.linkView && n.linkId;
    const key = hasLink ? `${n.linkView}:${n.linkId}` : `__solo:${n.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        linkView: n.linkView || null,
        linkId: n.linkId || null,
        title: n.title || '',
        items: [],
        unreadCount: 0,
        typeCounts: {},
        latestBody: '',
        latestActor: null,
        latestTime: 0,
        latestType: null,
      };
      groups.set(key, g);
    }
    g.items.push(n);
    if (!n.read) g.unreadCount++;
    const t = n.type || 'info';
    g.typeCounts[t] = (g.typeCounts[t] || 0) + 1;
    const ts = n.timestamp || (n.createdAt ? Date.parse(n.createdAt) : 0) || 0;
    if (ts >= g.latestTime) {
      g.latestTime = ts;
      g.latestBody = n.body || '';
      g.latestActor = { email: n.actorEmail, name: n.actorName };
      g.latestType = t;
      // Keep the newest title as the canonical group title — handy for
      // status changes ("Resolved by …") that override the original.
      if (n.title) g.title = n.title;
    }
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => {
      const ta = a.timestamp || (a.createdAt ? Date.parse(a.createdAt) : 0);
      const tb = b.timestamp || (b.createdAt ? Date.parse(b.createdAt) : 0);
      return tb - ta;
    });
  }
  return [...groups.values()].sort((a, b) => b.latestTime - a.latestTime);
}

export function timeAgo(ts) {
  if (!ts) return '';
  const ms = Date.now() - ts;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(ts).toLocaleDateString();
}

export function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : (plural || singular + 's')}`;
}

export default function NotificationPanel({
  notifs = [],
  unreadCount = 0,
  onNotifClick,
  markAllRead,
  markRead,
  markUnread,
  onClose,
  onViewAll,
}) {
  const [filter, setFilter] = useState('all'); // 'all' | 'unread' | 'mentions'

  // Normalize each notif so grouping has consistent timestamps / shape.
  const normalized = useMemo(() => notifs.map(n => ({
    ...n,
    timestamp: typeof n.timestamp === 'number'
      ? n.timestamp
      : n.createdAt ? Date.parse(n.createdAt) : Date.now(),
  })), [notifs]);

  const filtered = useMemo(() => {
    if (filter === 'unread') return normalized.filter(n => !n.read);
    if (filter === 'mentions') return normalized.filter(n => (n.type || '') === 'mention');
    return normalized;
  }, [normalized, filter]);

  const groups = useMemo(() => groupNotifications(filtered), [filtered]);

  const counts = useMemo(() => ({
    all: normalized.length,
    unread: normalized.filter(n => !n.read).length,
    mentions: normalized.filter(n => (n.type || '') === 'mention').length,
  }), [normalized]);

  const handleGroupClick = (g) => {
    onClose?.();
    onNotifClick?.(g);
  };

  const handleMarkGroupRead = (e, g) => {
    e.stopPropagation();
    if (!markRead) return;
    for (const item of g.items) {
      if (!item.read && item.serverId) markRead(item.serverId);
    }
  };

  const handleMarkGroupUnread = (e, g) => {
    e.stopPropagation();
    if (!markUnread) return;
    for (const item of g.items) {
      if (item.read && item.serverId) markUnread(item.serverId);
    }
  };

  return (
    <div role="dialog" aria-label="Notifications"
      style={{
        position: 'absolute', right: 0, top: 'calc(100% + 8px)',
        width: 460, maxWidth: 'calc(100vw - 32px)',
        background: 'var(--surface)', borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.06)',
        border: '1px solid var(--border)', overflow: 'hidden',
        zIndex: 1100, display: 'flex', flexDirection: 'column',
        maxHeight: 'min(640px, calc(100vh - 80px))',
      }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px 10px', borderBottom: '1px solid var(--border-light, #f0efed)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Notifications</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {unreadCount > 0
              ? `${pluralize(unreadCount, 'new update')} across ${pluralize(groups.length, 'task')}`
              : "You're all caught up"}
          </div>
        </div>
        {unreadCount > 0 && markAllRead && (
          <button
            type="button"
            onClick={markAllRead}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 12px',
              fontSize: 11.5, fontWeight: 600, color: 'var(--text)',
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
            <i className="bi-check2-all" style={{ fontSize: 12 }} />
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border-light, #f0efed)',
        background: 'var(--surface-2, #fafaf9)', flexShrink: 0,
      }}>
        {[
          { id: 'all',      label: 'All',      count: counts.all },
          { id: 'unread',   label: 'Unread',   count: counts.unread },
          { id: 'mentions', label: '@ Mentions', count: counts.mentions },
        ].map(t => {
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              style={{
                background: active ? 'var(--surface)' : 'transparent',
                border: '1px solid', borderColor: active ? 'var(--border)' : 'transparent',
                borderRadius: 8, padding: '5px 10px',
                fontSize: 11.5, fontWeight: active ? 700 : 500,
                color: active ? 'var(--text)' : 'var(--text-secondary)',
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
              {t.label}
              {t.count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: active ? 'white' : 'var(--text-muted)',
                  background: active ? '#1d4ed8' : 'var(--surface-3, #e8e8e8)',
                  padding: '1px 6px', borderRadius: 10, minWidth: 16, textAlign: 'center',
                }}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {groups.length === 0 ? (
          <div style={{ padding: '48px 20px 56px', textAlign: 'center' }}>
            <i className={filter === 'unread' ? 'bi-check2-all' : filter === 'mentions' ? 'bi-at' : 'bi-bell'}
              style={{ fontSize: 36, color: 'var(--text-disabled, #d5d5d5)', display: 'block', marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {filter === 'unread' ? 'No unread notifications'
                : filter === 'mentions' ? "You haven't been tagged"
                : 'No notifications yet'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {filter === 'unread' ? "You're all caught up — nice."
                : filter === 'mentions' ? 'Nobody @-tagged you yet.'
                : 'Updates on tasks you raise or follow will appear here.'}
            </div>
          </div>
        ) : groups.map(g => <NotificationGroupCard key={g.key} group={g}
          onClick={() => handleGroupClick(g)}
          onMarkRead={(e) => handleMarkGroupRead(e, g)}
          onMarkUnread={(e) => handleMarkGroupUnread(e, g)}
          canMarkRead={!!markRead && g.unreadCount > 0}
          canMarkUnread={!!markUnread && g.unreadCount === 0 && g.items.length > 0}
        />)}
      </div>

      {/* Footer — opens the dedicated full-page notifications view */}
      {onViewAll && (
        <button
          type="button"
          onClick={() => { onClose?.(); onViewAll(); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '11px 18px',
            borderTop: '1px solid var(--border-light, #f0efed)',
            background: 'var(--surface-2, #fafaf9)',
            border: 'none', borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
            color: 'var(--text)', fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            transition: 'background .12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3, #efeeec)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2, #fafaf9)'; }}
        >
          View all notifications
          <i className="bi-arrow-right" style={{ fontSize: 12 }} />
        </button>
      )}
    </div>
  );
}

export function NotificationGroupCard({ group, onClick, onMarkRead, onMarkUnread, canMarkRead, canMarkUnread }) {
  const [hov, setHov] = useState(false);
  const m = metaFor(group.latestType || 'info');
  const surfaceLabel = VIEW_LABELS[group.linkView] || '';
  const summaryChips = useMemo(() => {
    const out = [];
    const counts = group.typeCounts || {};
    for (const [type, n] of Object.entries(counts)) {
      if (n <= 0) continue;
      const meta = metaFor(type);
      out.push({ type, n, meta });
    }
    // Sort: bigger counts first, then mentions before comments
    out.sort((a, b) => b.n - a.n);
    return out;
  }, [group.typeCounts]);

  const isUnread = group.unreadCount > 0;
  const actorName = group.latestActor?.name || group.latestActor?.email || '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      style={{
        position: 'relative',
        display: 'flex', gap: 12, padding: '12px 18px 12px 22px',
        borderBottom: '1px solid var(--border-light, #f0efed)',
        background: hov ? 'var(--surface-2, #fafaf9)' : (isUnread ? '#eff6ff' : 'var(--surface)'),
        cursor: 'pointer', transition: 'background .12s',
        alignItems: 'flex-start',
        // Left bar to telegraph unread without competing with the avatar
        boxShadow: isUnread ? 'inset 3px 0 0 #1d4ed8' : 'none',
      }}>
      {/* Avatar with type badge overlay */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar name={actorName || 'System'} size={36} />
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 18, height: 18, borderRadius: '50%',
          background: m.color, color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid var(--surface)',
          fontSize: 9,
        }}>
          <i className={m.icon} style={{ fontSize: 9 }} />
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: 13,
            fontWeight: isUnread ? 700 : 500,
            color: 'var(--text)', lineHeight: 1.35,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {group.title}
          </div>
          <span style={{
            fontSize: 11, color: 'var(--text-muted)', fontWeight: 500,
            flexShrink: 0,
          }}>{timeAgo(group.latestTime)}</span>
        </div>

        {(surfaceLabel || actorName) && (
          <div style={{
            fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {actorName && <span style={{ fontWeight: 600, color: 'var(--text)' }}>{actorName}</span>}
            {actorName && surfaceLabel ? ' · ' : ''}
            {surfaceLabel}
          </div>
        )}

        {group.latestBody && (
          <div style={{
            fontSize: 12, color: 'var(--text-secondary)',
            marginTop: 4, lineHeight: 1.4,
            // Cap to 2 lines so the card stays scannable
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            “{group.latestBody.length > 160 ? group.latestBody.slice(0, 160).trim() + '…' : group.latestBody}”
          </div>
        )}

        {summaryChips.length > 1 && (
          <div style={{
            display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6,
          }}>
            {summaryChips.slice(0, 4).map(c => (
              <span key={c.type} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 10.5, fontWeight: 600,
                color: c.meta.color, background: `${c.meta.color}15`,
                padding: '2px 8px', borderRadius: 999,
              }}>
                <i className={c.meta.icon} style={{ fontSize: 9 }} />
                {c.n} {c.meta.label}{c.n > 1 ? 's' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Per-row read/unread toggle — JIRA-style. Shows "Mark as read" on
          unread groups, "Mark as unread" on fully-read groups. Both appear
          on hover and are Tab-focusable. */}
      {canMarkRead && (
        <button
          type="button"
          aria-label="Mark as read"
          title="Mark as read"
          onClick={onMarkRead}
          style={{
            opacity: hov ? 1 : 0,
            transition: 'opacity .15s',
            border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer',
            padding: 4, borderRadius: 6, alignSelf: 'flex-start',
            flexShrink: 0, fontFamily: 'inherit',
          }}
          onFocus={e => { e.currentTarget.style.opacity = 1; }}
          onBlur={e => { e.currentTarget.style.opacity = hov ? 1 : 0; }}
        >
          <i className="bi-check2" style={{ fontSize: 14 }} />
        </button>
      )}
      {!canMarkRead && canMarkUnread && (
        <button
          type="button"
          aria-label="Mark as unread"
          title="Mark as unread"
          onClick={onMarkUnread}
          style={{
            opacity: hov ? 1 : 0,
            transition: 'opacity .15s',
            border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer',
            padding: 4, borderRadius: 6, alignSelf: 'flex-start',
            flexShrink: 0, fontFamily: 'inherit',
          }}
          onFocus={e => { e.currentTarget.style.opacity = 1; }}
          onBlur={e => { e.currentTarget.style.opacity = hov ? 1 : 0; }}
        >
          <i className="bi-envelope" style={{ fontSize: 13 }} />
        </button>
      )}
    </div>
  );
}
