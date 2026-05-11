// ── NotificationsView ──────────────────────────────────────────────────────
// Full-page sibling of the bell dropdown (NotificationPanel). Reached via
// the bell's "View all notifications" footer or `?view=notifications`. Same
// underlying data + click routing as the bell — the parent passes the merged
// notifs list, mark-read helpers, and the same handleNotifClick handler so
// deep-link routing stays consistent. Available to every role: notifications
// are scoped to the JWT email server-side (see app/api/v1/notifications), so
// no perms gate is required at the view level.
//
// Layout follows the in-app board reference (skill §3.13):
//   1. Hero header     — bell icon + title + sub-line + Mark-all-read action
//   2. Segmented scope — All / Unread / @Mentions
//   3. Surface filter  — pill chips: HR Hub, Feedback, Leaders, Announcements
//   4. Search row      — text filter on title + body
//   5. Row list        — wider rendering of NotificationGroupCard

import { useMemo, useState } from 'react';
import {
  groupNotifications,
  NotificationGroupCard,
  pluralize,
} from '../nav/NotificationPanel';

const SURFACE_FILTERS = [
  { id: 'hr_hub',         label: 'HR Hub',         color: '#1f74b3' },
  { id: 'feedback',       label: 'Feedback',       color: '#7c3aed' },
  { id: 'leader-alerts',  label: 'Leaders Hub',    color: '#0369a1' },
  { id: 'announcements',  label: 'Announcements',  color: '#15803d' },
];

export default function NotificationsView({
  notifs = [],
  unreadCount = 0,
  markAllRead,
  markRead,
  markUnread,
  onNotifClick,
}) {
  const [scope, setScope] = useState('all');           // 'all' | 'unread' | 'mentions'
  const [surface, setSurface] = useState(null);        // linkView id or null
  const [search, setSearch] = useState('');

  const normalized = useMemo(() => notifs.map(n => ({
    ...n,
    timestamp: typeof n.timestamp === 'number'
      ? n.timestamp
      : n.createdAt ? Date.parse(n.createdAt) : Date.now(),
  })), [notifs]);

  const filtered = useMemo(() => {
    let list = normalized;
    if (scope === 'unread') list = list.filter(n => !n.read);
    else if (scope === 'mentions') list = list.filter(n => (n.type || '') === 'mention');
    if (surface) {
      // Match both 'leader-alerts' and 'leader_alerts' to the same Leaders surface
      list = list.filter(n => {
        const lv = n.linkView || '';
        if (surface === 'leader-alerts') return lv === 'leader-alerts' || lv === 'leader_alerts';
        return lv === surface;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(n =>
        (n.title || '').toLowerCase().includes(q)
        || (n.body || '').toLowerCase().includes(q)
        || (n.actorName || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [normalized, scope, surface, search]);

  const groups = useMemo(() => groupNotifications(filtered), [filtered]);

  const counts = useMemo(() => ({
    all:      normalized.length,
    unread:   normalized.filter(n => !n.read).length,
    mentions: normalized.filter(n => (n.type || '') === 'mention').length,
  }), [normalized]);

  const surfaceCounts = useMemo(() => {
    const out = { hr_hub: 0, feedback: 0, 'leader-alerts': 0, announcements: 0 };
    for (const n of normalized) {
      const lv = n.linkView || '';
      if (lv === 'hr_hub') out.hr_hub++;
      else if (lv === 'feedback') out.feedback++;
      else if (lv === 'leader-alerts' || lv === 'leader_alerts') out['leader-alerts']++;
      else if (lv === 'announcements') out.announcements++;
    }
    return out;
  }, [normalized]);

  const handleClick = (g) => {
    if (typeof onNotifClick !== 'function') return;
    const head = g?.items?.[0];
    if (head) onNotifClick(head);
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

  const subline = unreadCount > 0
    ? `${pluralize(unreadCount, 'new update')} across ${pluralize(groups.length, 'task')}`
    : 'You’re all caught up';

  return (
    <div style={page}>
      <style>{`
        .notif-surface-row { display: flex; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 760px) {
          .notif-page-head { flex-direction: column; align-items: flex-start; gap: 10px; }
          .notif-page-head .notif-mark-all { align-self: stretch; justify-content: center; }
        }
      `}</style>

      {/* Hero header */}
      <div className="notif-page-head" style={pageHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={iconTile}>
            <i className="bi-bell-fill" style={{ fontSize: 18, color: '#1f74b3' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
              Notifications
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {subline}
            </div>
          </div>
        </div>
        {unreadCount > 0 && markAllRead && (
          <button
            type="button"
            className="notif-mark-all"
            onClick={markAllRead}
            style={primaryBtn}
          >
            <i className="bi-check2-all" style={{ fontSize: 13 }} /> Mark all read
          </button>
        )}
      </div>

      {/* Segmented scope toggle */}
      <div style={scopeRow}>
        <div style={segmentedControl}>
          {[
            { id: 'all',      label: 'All',         count: counts.all },
            { id: 'unread',   label: 'Unread',      count: counts.unread },
            { id: 'mentions', label: '@ Mentions',  count: counts.mentions },
          ].map(t => {
            const active = scope === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setScope(t.id)}
                style={{ ...segmentBtn, ...(active ? segmentBtnActive : null) }}
              >
                {t.label}
                {t.count > 0 && (
                  <span style={{ ...segmentCount, ...(active ? segmentCountActive : null) }}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter bar — surface chips + search */}
      <div style={filterBar}>
        <div className="notif-surface-row" style={{ flex: '1 1 auto', minWidth: 0 }}>
          {SURFACE_FILTERS.map(s => {
            const active = surface === s.id;
            const cnt = surfaceCounts[s.id] || 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSurface(active ? null : s.id)}
                style={{
                  ...filterPill,
                  ...(active ? { background: `${s.color}1a`, color: s.color, borderColor: s.color } : null),
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: s.color, display: 'inline-block',
                }} />
                {s.label}
                {cnt > 0 && (
                  <span style={{
                    fontSize: 10.5, fontWeight: 700,
                    color: active ? s.color : 'var(--text-muted)',
                    padding: '0 5px', minWidth: 16, textAlign: 'center',
                  }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto',
          minWidth: 220,
        }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <i className="bi-search" style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none',
            }} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notifications"
              style={{
                width: '100%', height: 32, padding: '0 10px 0 30px',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 12.5, fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{
        flex: 1, minHeight: 0,
        background: 'var(--surface)',
        border: '1px solid var(--border-light)',
        borderRadius: 12, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {groups.length === 0 ? (
          <div style={{ padding: '64px 20px 72px', textAlign: 'center' }}>
            <i className={scope === 'unread' ? 'bi-check2-all' : scope === 'mentions' ? 'bi-at' : 'bi-bell'}
              style={{ fontSize: 44, color: 'var(--text-disabled, #d5d5d5)', display: 'block', marginBottom: 14 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              {scope === 'unread' ? 'No unread notifications'
                : scope === 'mentions' ? 'You haven’t been tagged'
                : surface ? 'No notifications for this surface'
                : search.trim() ? 'No matches'
                : 'No notifications yet'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
              {scope === 'unread' ? 'You’re all caught up — nice.'
                : scope === 'mentions' ? 'Nobody @-tagged you yet.'
                : 'Updates on tasks you raise or follow will appear here.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {groups.map(g => (
              <NotificationGroupCard
                key={g.key}
                group={g}
                onClick={() => handleClick(g)}
                onMarkRead={(e) => handleMarkGroupRead(e, g)}
                onMarkUnread={(e) => handleMarkGroupUnread(e, g)}
                canMarkRead={!!markRead && g.unreadCount > 0}
                canMarkUnread={!!markUnread && g.unreadCount === 0 && g.items.length > 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Tokens — mirror Feedback / HR Hub board (skill §3.13)
const page = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 24px 24px', background: 'var(--bg)' };
const pageHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '20px 0 14px' };
const iconTile = { width: 40, height: 40, borderRadius: 10, background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const scopeRow = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 };
const segmentedControl = { display: 'inline-flex', padding: 3, borderRadius: 128, background: 'var(--surface-2)', border: '1px solid var(--border-light)', gap: 2 };
const segmentBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 128, border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit' };
const segmentBtnActive = { background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', fontWeight: 700 };
const segmentCount = { padding: '0 7px', borderRadius: 128, fontSize: 10, fontWeight: 700, background: 'rgba(15,23,42,0.06)', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center', lineHeight: '16px' };
const segmentCountActive = { background: '#7c3aed', color: 'white' };
const filterBar = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border-light)', marginBottom: 14, flexWrap: 'wrap' };
const filterPill = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 128, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.25)', fontFamily: 'inherit' };
