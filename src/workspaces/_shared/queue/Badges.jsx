'use client';

import { memo } from 'react';

import { TOOLS, STATUSES, FUNCTIONS } from './queueConstants';

// Visual badges for the workspace queue table. Copied from src/components/
// ui/Badges.jsx (HR territory) and adapted to read from the workspace-local
// queueConstants instead of src/data/constants.

const badgeBase = {
  borderRadius: 'var(--radius-pill, 20px)',
  padding: '3px 10px',
  fontSize: 'var(--font-xs, 11px)',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
};

export const ToolBadge = memo(function ToolBadge({ source }) {
  const t = TOOLS[source];
  if (!t) return null;
  return (
    <span style={{ ...badgeBase, borderRadius: 'var(--radius-sm, 4px)', background: t.bg, color: t.color }}>
      <i className={t.icon} style={{ fontSize: 10 }} />
      {t.label}
    </span>
  );
});

export const FnBadge = memo(function FnBadge({ type }) {
  const f = FUNCTIONS[type];
  if (!f) return null;
  return (
    <span style={{ ...badgeBase, background: f.bg, color: f.color }}>
      {f.label}
    </span>
  );
});

const STATUS_TOOLTIPS = {
  new:         'Zendesk: New',
  in_progress: 'Zendesk: Open / On-Hold',
  waiting:     'Zendesk: Pending (pauses SLA)',
  escalated:   'Task has been escalated',
  resolved:    'Zendesk: Solved',
};

export const StatusBadge = memo(function StatusBadge({ status, subStatus }) {
  const s = STATUSES[status];
  if (!s) return null;
  const tooltip = STATUS_TOOLTIPS[status] || '';
  const fullTooltip = subStatus ? `${tooltip}${tooltip ? '\n' : ''}Status: ${subStatus}` : tooltip;
  return (
    <span title={fullTooltip} style={{ ...badgeBase, background: s.bg, color: s.color }}>
      {s.label}
      {subStatus && (
        <span style={{ opacity: 0.7, fontWeight: 500 }}>
          {' · '}{subStatus}
        </span>
      )}
    </span>
  );
});

// Cap long durations at days / weeks / months so a 6-month-old ticket
// renders as ">90d" instead of "-4368h". Matches HR's fmtRemain.
function fmtRemain(rem) {
  if (!Number.isFinite(rem) || rem <= 0) return null;
  if (rem < 60) return `${rem}m`;
  if (rem < 24 * 60) {
    const h = Math.floor(rem / 60), m = rem % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(rem / (24 * 60));
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return '1y+';
}

export const SlaBadge = memo(function SlaBadge({ sla, status }) {
  if (status === 'waiting') {
    return (
      <span style={{ ...badgeBase, background: '#f5f3f0', color: '#9b928a', border: '1px solid #e8e4df' }} title="SLA paused while snoozed">
        <i className="bi-pause-circle" style={{ fontSize: 9, marginRight: 2 }} />Paused
      </span>
    );
  }
  if (sla) {
    if (sla.breach) {
      const overdue = sla.remain ? fmtRemain(Math.abs(sla.remain)) : null;
      return (
        <span style={{ ...badgeBase, background: 'var(--red-light, #fef2f2)', color: 'var(--red, #b91c1c)', border: '1px solid var(--red-mid, #fee2e2)' }} title={overdue ? `Breached ${overdue} ago` : 'SLA Breached'}>
          {overdue ? `-${overdue}` : 'BREACH'}
        </span>
      );
    }
    const timeLeft = sla.remain ? fmtRemain(sla.remain) : null;
    if (sla.ok) {
      return (
        <span style={{ ...badgeBase, background: 'var(--surface-3, #f5f3f0)', color: 'var(--text-secondary, #6b6560)', border: '1px solid var(--border, #e8e4df)' }} title={timeLeft ? `${timeLeft} remaining` : 'On track'}>
          {timeLeft || 'OK'}
        </span>
      );
    }
    return (
      <span style={{ ...badgeBase, background: 'var(--orange-light, #fffbeb)', color: 'var(--orange, #b45309)', border: '1px solid var(--orange-mid, #fef3c7)' }} title={`${timeLeft} remaining — at risk`}>
        {timeLeft || sla.short || 'AT RISK'}
      </span>
    );
  }
  if (status === 'resolved') {
    return (
      <span style={{ ...badgeBase, color: 'var(--text-muted, #9b928a)', fontSize: 'var(--font-xs, 11px)' }}>--</span>
    );
  }
  return (
    <span style={{ ...badgeBase, background: 'var(--surface-3, #f5f3f0)', color: 'var(--text-secondary, #6b6560)', border: '1px solid var(--border, #e8e4df)' }}>OK</span>
  );
});

// Lightweight avatar used inside table cells.
export function Avatar({ name, size = 'sm' }) {
  const dim = size === 'xs' ? 20 : size === 'sm' ? 24 : 32;
  const initials = (() => {
    if (!name) return '··';
    const w = name.trim().split(/\s+/).filter(Boolean);
    if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  })();
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim, height: dim,
      borderRadius: '50%',
      background: 'var(--purple, #7c3aed)',
      color: '#fff',
      fontSize: dim <= 20 ? 9 : 10,
      fontWeight: 700,
      flexShrink: 0,
    }}>{initials}</span>
  );
}

// SLA computation — adapted from src/utils/helpers.js slaInfo() for the
// local-fallback path (workspaces don't have Zendesk policy_metrics sync
// yet). Returns { ok, breach, remain, short } or null when status is
// resolved/waiting.
export function computeSlaInfo(task) {
  if (!task || task.status === 'resolved' || task.status === 'waiting') return null;
  const anchorIso = task.lastCustomerResponseAt || task.updatedAt || task.createdAt;
  if (!anchorIso) return null;
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(anchorMs)) return null;
  const elapsedMins = Math.floor((Date.now() - anchorMs) / 60_000);
  const lim = Number.isFinite(task.slaMinsOverride) && task.slaMinsOverride > 0
    ? task.slaMinsOverride
    : 24 * 60;
  const rem = lim - elapsedMins;
  if (rem <= 0) return { breach: true, remain: rem, ok: false };
  if (rem <= Math.max(30, lim * 0.25)) return { breach: false, remain: rem, ok: false, short: 'AT RISK' };
  return { breach: false, remain: rem, ok: true };
}
