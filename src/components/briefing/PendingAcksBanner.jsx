// ── PendingAcksBanner ─────────────────────────────────────────────────────
// Single-banner carousel for unacknowledged announcements / alerts /
// updates / guidance / kudos. Originally inlined in BriefingView's "Pending
// Acknowledgements" block; extracted here so the new home pages
// (AgentHome, TeamLeadHome) and any future surface can render the same
// thing without duplicating the 90-line carousel.
//
// Behavior matches BriefingView byte-for-byte:
//   • Targets: comm is shown when it's `sent`, the viewer is in the
//     audience (audience match or user is the author/target), and the
//     viewer hasn't acked it yet. The author themselves is NEVER
//     prompted to ack their own message.
//   • Theme: per-type colors + icon (alert / announce / update / guidance
//     / kudos).
//   • Carousel: prev / next arrows + dot indicator + "X to dismiss from
//     view" (advances index, doesn't ack). Self-resets when the index
//     goes past the array length.
//   • Click anywhere on the card → opens the announcements view + emits
//     `announcements:openDetail` so the matching view scrolls into the
//     specific comm.
//
// Returns null when there's nothing pending — caller can mount it
// unconditionally and trust it to disappear when the inbox is clean.

import { useEffect, useMemo, useState } from 'react';
import { matchesAudience } from '../../data/comms';

const BANNER_THEMES = {
  alert:    { bg:'#ffe2de', accent:'#d42d35', circle1:'rgba(212,45,53,0.08)', circle2:'rgba(212,45,53,0.05)', icon:'bi-exclamation-triangle-fill', iconBg:'#d42d35' },
  announce: { bg:'#fff8e6', accent:'#ed8d00', circle1:'rgba(237,141,0,0.08)', circle2:'rgba(237,141,0,0.05)', icon:'bi-megaphone-fill',           iconBg:'#ed8d00' },
  update:   { bg:'#e8f0fe', accent:'#1f74b3', circle1:'rgba(31,116,179,0.08)', circle2:'rgba(31,116,179,0.05)', icon:'bi-arrow-up-circle-fill',  iconBg:'#1f74b3' },
  guidance: { bg:'#ede9fe', accent:'#7c3aed', circle1:'rgba(124,58,237,0.08)', circle2:'rgba(124,58,237,0.05)', icon:'bi-book-half',              iconBg:'#7c3aed' },
  kudos:    { bg:'#F0FDF4', accent:'#29811e', circle1:'rgba(41,129,30,0.08)',  circle2:'rgba(41,129,30,0.05)', icon:'bi-trophy-fill',            iconBg:'#29811e' },
};

const TYPE_LABEL = {
  alert: 'Alert', announce: 'Announcement', update: 'Update',
  guidance: 'Guidance', kudos: 'Kudos',
};

function defaultIsAckedByMe(comm, userEmail) {
  if (!comm || !userEmail) return false;
  const me = String(userEmail).toLowerCase();
  if (Array.isArray(comm.ackEmails)) {
    return comm.ackEmails.some(e => String(e || '').toLowerCase() === me);
  }
  return false;
}

export default function PendingAcksBanner({
  user,
  comms = [],
  setView,
  isAckedByMe: isAckedByMeProp,
  // Optional render override so a host can wrap the carousel in a custom
  // outer container (e.g. drop the default `padding: 12px 24px 0`).
  noPadding = false,
}) {
  const [idx, setIdx] = useState(0);

  const pendingAcks = useMemo(() => {
    if (!Array.isArray(comms) || comms.length === 0) return [];
    const isAcked = typeof isAckedByMeProp === 'function'
      ? isAckedByMeProp
      : (c) => defaultIsAckedByMe(c, user?.email);
    const targetMatch = (c) => {
      // ID match (legacy) — kept for backward compat; new audience targeting
      // is by team string and matchesAudience handles wildcard / array forms.
      if (Array.isArray(c.target) && user?.id != null && c.target.includes(user.id)) return true;
      if (c.author && user?.id != null && c.author.id === user.id) return true;
      return matchesAudience(c.target, user?.team);
    };
    return comms.filter(c =>
      c.status === 'sent'
      && targetMatch(c)
      && !isAcked(c)
      && !(c.author && user?.id != null && c.author.id === user.id),
    );
  }, [comms, user?.id, user?.email, user?.team, isAckedByMeProp]);

  // Self-heal when the underlying list shrinks past the current index
  // (e.g. user opens a comm in another tab and acks it).
  useEffect(() => {
    if (idx >= pendingAcks.length) setIdx(0);
  }, [idx, pendingAcks.length]);

  if (pendingAcks.length === 0) return null;

  const safeIdx = idx >= pendingAcks.length ? 0 : idx;
  const comm = pendingAcks[safeIdx];
  const theme = BANNER_THEMES[comm.type] || BANNER_THEMES.announce;
  const total = pendingAcks.length;
  const goPrev = () => setIdx(i => (i - 1 + total) % total);
  const goNext = () => setIdx(i => (i + 1) % total);
  const open = () => {
    try { setView?.('announcements'); } catch {}
    try { window.dispatchEvent(new CustomEvent('announcements:openDetail', { detail: { id: comm.id } })); } catch {}
  };

  return (
    <div style={{ padding: noPadding ? 0 : '12px 24px 0' }}>
      <div onClick={open} style={{
        background: theme.bg, borderRadius: 16, padding: '20px 28px',
        cursor: 'pointer', position: 'relative', overflow: 'hidden',
        transition: 'all .2s', minHeight: 80,
        display: 'flex', alignItems: 'center', gap: 20,
      }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
      >
        {/* Decorative circles */}
        <div aria-hidden style={{ position:'absolute', right:60, top:-30, width:140, height:140, borderRadius:'50%', background: theme.circle1, pointerEvents:'none' }} />
        <div aria-hidden style={{ position:'absolute', right:-10, bottom:-20, width:100, height:100, borderRadius:'50%', background: theme.circle2, pointerEvents:'none' }} />
        <div aria-hidden style={{ position:'absolute', right:180, top:10, width:60, height:60, borderRadius:'50%', border: `2px solid ${theme.accent}20`, pointerEvents:'none' }} />

        {/* Text + CTA */}
        <div style={{ flex: 1, minWidth: 0, position:'relative', zIndex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1b1b1b', lineHeight: 1.3, marginBottom: 6 }}>{comm.title}</div>
          <div style={{
            fontSize: 13, color: '#4a4a4a', lineHeight: 1.5, maxWidth: 600,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {(comm.body || '').slice(0, 160)}{(comm.body || '').length > 160 ? '…' : ''}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); open(); }}
            style={{
              marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 20px', borderRadius: 128, border: 'none',
              background: '#1b1b1b', color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', transition: 'opacity .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Review &amp; acknowledge
          </button>
        </div>

        {/* Right icon badge */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: 'var(--surface)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={theme.icon} style={{ fontSize: 24, color: theme.iconBg }} />
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: theme.accent, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {TYPE_LABEL[comm.type] || 'Announcement'}
          </div>
        </div>

        {/* Dismiss-from-view (advance index, doesn't ack) */}
        <button
          onClick={(e) => { e.stopPropagation(); if (total > 1) goNext(); }}
          aria-label="Show next announcement"
          style={{
            position: 'absolute', top: 10, right: 12,
            width: 24, height: 24, borderRadius: '50%',
            background: 'rgba(0,0,0,0.06)', border: 'none', cursor: 'pointer',
            color: '#9e9e9e', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <i className="bi-x" />
        </button>
      </div>

      {total > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 0 2px' }}>
          <button onClick={goPrev} aria-label="Previous"
            style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #e0e0e0', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#616161', fontSize: 13, transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
            <i className="bi-chevron-left" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {pendingAcks.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} aria-label={`Go to announcement ${i + 1}`}
                style={{
                  width: i === safeIdx ? 10 : 8, height: i === safeIdx ? 10 : 8,
                  borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: i === safeIdx ? '#1b1b1b' : '#d1d5db',
                  transition: 'all .2s', padding: 0,
                }}
              />
            ))}
          </div>
          <button onClick={goNext} aria-label="Next"
            style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #e0e0e0', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#616161', fontSize: 13, transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
            <i className="bi-chevron-right" />
          </button>
        </div>
      )}
    </div>
  );
}
