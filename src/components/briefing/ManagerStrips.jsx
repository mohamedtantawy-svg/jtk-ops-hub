// ── ManagerStrips ─────────────────────────────────────────────────────────
// Two strips dropped into BriefingView for any manager (TL / RM / Admin):
//
//   • TriageStrip      — 4 KPIs: Breached / At-Risk / Paused / Synth-only
//                        Sits ABOVE the Team Summary table. Click → Workspace.
//   • DecisionsStrip   — 4 tiles: hide-task approvals / unacked Leader Alerts
//                        / Urgent Assist / HR Hub. Replaces the legacy
//                        Active-Requests / Meetings / Projects / Escalations /
//                        Announcements / My To-Do strip under the greeting.
//
// Both pull from the existing IntegrationsContext + a couple of cheap on-mount
// fetches. No new endpoints. The data is computed against the manager's own
// hierarchical scope (`scopeMembers` from usePermissions) so a TL sees
// "own + direct reports", an RM sees "own + full subtree", admin sees all.
//
// Helpers (formatLastLogin / LAST_LOGIN_TONE / ACCESS_BADGE / LoginAsButton /
// CountriesCell) are also exported here — BriefingView's team table reuses
// them so the Briefing rows match the Team-tab look-and-feel exactly.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { TOOLS } from '../../data/constants';
import { slaInfo } from '../../utils/helpers';
import {
  normalizeOnboarding, normalizePausedOnboarding, normalizeOffboarding,
  normalizeAmendments, normalizeRedlines, normalizeWorkbench, normalizeIncentivePlans,
} from '../../utils/normalizeSourceRows';
import MultiCountryPicker from '../team/MultiCountryPicker';

// ── Pure helpers (mirrored from Team.jsx so the look matches) ──────────────

export function formatLastLogin(iso) {
  if (!iso) return { label: 'Never logged in', tone: 'never' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: 'Never logged in', tone: 'never' };
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return { label: 'Just now', tone: 'fresh', iso };
  if (diffMin < 60) return { label: `${diffMin} min ago`, tone: 'fresh', iso };
  if (diffHr < 24) return { label: `${diffHr} hr ago`, tone: 'fresh', iso };
  if (diffDay === 1) return { label: 'Yesterday', tone: 'recent', iso };
  if (diffDay < 7) return { label: `${diffDay} days ago`, tone: 'recent', iso };
  if (diffDay < 30) return { label: `${Math.floor(diffDay / 7)}w ago`, tone: 'stale', iso };
  if (diffDay < 365) return { label: `${Math.floor(diffDay / 30)}mo ago`, tone: 'stale', iso };
  return { label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), tone: 'stale', iso };
}

export const LAST_LOGIN_TONE = {
  fresh:  { bg: '#e8f5e3', color: '#29811e' },
  recent: { bg: '#e8f0fe', color: '#1f74b3' },
  stale:  { bg: '#f7f5f2', color: '#616161' },
  never:  { bg: '#ffe2de', color: '#d42d35' },
};

export const ACCESS_BADGE = {
  admin:            { label: 'Admin',        bg: '#ffe2de', color: '#d42d35' },
  regional_manager: { label: 'Regional Mgr', bg: '#e8f0fe', color: '#1f74b3' },
  team_lead:        { label: 'Team Lead',    bg: '#f3eff8', color: '#7c3aed' },
  agent:            { label: 'Agent',        bg: '#f7f5f2', color: '#616161' },
};

// ── SLA classifiers (shared by Triage strip + per-row counters) ───────────

function rowSlaSeverity(row) {
  if (!row) return 'ok';
  if (row.slaBreachStatus === 'SLA_BREACHED' || (typeof row.slaRemaining === 'number' && row.slaRemaining <= 0)) return 'breached';
  if (typeof row.slaRemaining !== 'number') return 'ok';
  const windowSeconds = Number.isFinite(row.slaWindowMs) && row.slaWindowMs > 0
    ? row.slaWindowMs / 1000
    : 24 * 60 * 60;
  return row.slaRemaining > 0 && row.slaRemaining < windowSeconds / 4 ? 'at_risk' : 'ok';
}

function ticketSeverity(t) {
  const s = slaInfo(t);
  if (!s) return 'ok';
  if (s.breach) return 'breached';
  if (!s.ok) return 'at_risk';
  return 'ok';
}

// ── Build the manager's queue from IntegrationsContext data ──────────────
//
// `scopeEmails` is the lowercased email set the manager owns (own + reports).
// Admins get all rows (skip the team filter).
function useManagerQueue({ queueUnified, hiddenTasks, queueSla, tasks, scopeEmails, isAdmin }) {
  const isHidden = useCallback((source, id) => {
    if (!source || !id) return false;
    return !!(hiddenTasks?.hiddenKeys?.has(`${String(source).toLowerCase()}:${String(id)}`));
  }, [hiddenTasks?.hiddenKeys]);

  const onb = queueUnified?.onboardingData || { items: [] };
  const pob = queueUnified?.pausedOnboardingData || { items: [] };
  const off = queueUnified?.offboardingData || { items: [] };
  const cr = queueUnified?.changeRequestData || { amendments: [], redlines: [] };
  const wb = queueUnified?.workbenchData || { tasks: [] };
  const ip = queueUnified?.incentivePlansData || { items: [] };

  const sourceRows = useMemo(() => {
    const a = normalizeOnboarding(onb.items, queueSla).filter(r => !isHidden('onboarding', r.id));
    const b = normalizePausedOnboarding(pob.items, queueSla).filter(r => !isHidden('paused_onboarding', r.id) && !isHidden('onboarding', r.id));
    const c = normalizeOffboarding(off.items, queueSla).filter(r => !isHidden('offboarding', r.id));
    const d = normalizeAmendments(cr.amendments, queueSla).filter(r => !isHidden('amendments', r.id));
    const e = normalizeRedlines(cr.redlines, queueSla).filter(r => !isHidden('redlines', r.id));
    const f = normalizeWorkbench(wb.tasks, queueSla).filter(r => !isHidden('workbench', r.id));
    const g = normalizeIncentivePlans(ip.items, queueSla).filter(r => !isHidden('incentive_plans', r.id));
    return [...a, ...b, ...c, ...d, ...e, ...f, ...g];
  }, [onb.items, pob.items, off.items, cr.amendments, cr.redlines, wb.tasks, ip.items, queueSla, isHidden]);

  const ticketRows = useMemo(() => (tasks || [])
    .filter(t => t.source === 'zendesk' || t.source === 'jira')
    .filter(t => !isHidden(t.source, t.id))
    .filter(t => t.status !== 'resolved'),
  [tasks, isHidden]);

  const teamSourceRows = useMemo(() => {
    if (isAdmin) return sourceRows;
    return sourceRows.filter(r => {
      const ae = (r.assigneeEmail || '').toLowerCase();
      return ae && scopeEmails.has(ae);
    });
  }, [sourceRows, scopeEmails, isAdmin]);

  const teamTickets = useMemo(() => {
    if (isAdmin) return ticketRows;
    return ticketRows.filter(t => {
      const ae = (t.assigneeEmail || '').toLowerCase();
      return ae && scopeEmails.has(ae);
    });
  }, [ticketRows, scopeEmails, isAdmin]);

  return { teamSourceRows, teamTickets };
}

// ── TriageStrip ──────────────────────────────────────────────────────────

export function TriageStrip({ queueUnified, hiddenTasks, queueSla, tasks, scopeEmails, isAdmin, onNavigate }) {
  const { teamSourceRows, teamTickets } = useManagerQueue({
    queueUnified, hiddenTasks, queueSla, tasks, scopeEmails, isAdmin,
  });

  const tally = useMemo(() => {
    let breached = 0, atRisk = 0, paused = 0, synth = 0;
    const breakdown = (key) => ({ breached: 0, atRisk: 0 }[key] === undefined ? null : null);
    const breachedBy = {}, atRiskBy = {};
    const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
    for (const r of teamSourceRows) {
      const sev = rowSlaSeverity(r);
      if (sev === 'breached') { breached++; bump(breachedBy, r.source); }
      else if (sev === 'at_risk') { atRisk++; bump(atRiskBy, r.source); }
      if (r.isPaused) paused++;
      if (r.assigneeIsSynthetic) synth++;
    }
    for (const t of teamTickets) {
      const sev = ticketSeverity(t);
      if (sev === 'breached') { breached++; bump(breachedBy, t.source); }
      else if (sev === 'at_risk') { atRisk++; bump(atRiskBy, t.source); }
      if (t.status === 'waiting') paused++;
      if (!t.assigneeEmail) synth++;
    }
    void breakdown;
    return { breached, atRisk, paused, synth, breachedBy, atRiskBy };
  }, [teamSourceRows, teamTickets]);

  const tile = (props) => (
    <button
      key={props.label}
      onClick={() => onNavigate?.('my-queue')}
      style={{
        flex: 1,
        border: tally[props.k] > 0 ? `1.5px solid ${props.color}` : '1px solid #e8e8e8',
        background: tally[props.k] > 0 ? props.bg : 'white',
        borderRadius: 14,
        padding: '14px 16px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'transform .12s, box-shadow .15s',
        boxShadow: tally[props.k] > 0 ? `0 1px 6px ${props.color}1a` : 'none',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <i className={props.icon} style={{ fontSize: 14, color: props.color }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#616161',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{props.label}</span>
      </div>
      <div style={{
        fontSize: 30, fontWeight: 800, lineHeight: 1,
        color: tally[props.k] > 0 ? props.color : '#9e9e9e',
        fontVariantNumeric: 'tabular-nums',
      }}>{tally[props.k]}</div>
      {props.sub && <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 5 }}>{props.sub}</div>}
      {props.breakdownKey && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 16 }}>
          {Object.entries(tally[props.breakdownKey] || {})
            .sort((a, b) => b[1] - a[1]).slice(0, 4)
            .map(([src, n]) => (
              <span key={src} style={{
                fontSize: 10, fontWeight: 600,
                color: TOOLS[src]?.color || '#616161',
                background: TOOLS[src]?.bg || '#f3f3f3',
                padding: '1px 7px', borderRadius: 128,
              }}>
                {TOOLS[src]?.label || src} {n}
              </span>
            ))}
        </div>
      )}
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      {tile({ k: 'breached', label: 'Breached',   icon: 'bi-x-circle-fill',           color: '#d42d35', bg: '#ffe2de', breakdownKey: 'breachedBy' })}
      {tile({ k: 'atRisk',   label: 'At risk',    icon: 'bi-exclamation-circle-fill', color: '#ed8d00', bg: '#fff8e6', sub: '<25% of SLA window left', breakdownKey: 'atRiskBy' })}
      {tile({ k: 'paused',   label: 'Paused',     icon: 'bi-pause-circle-fill',       color: '#6b6560', bg: '#f5f5f4', sub: 'onb pause / waiting tickets' })}
      {tile({ k: 'synth',    label: 'No real owner', icon: 'bi-person-dash',          color: '#7c3aed', bg: '#f3eff8', sub: 'still on country round-robin' })}
    </div>
  );
}

// ── DecisionsStrip ───────────────────────────────────────────────────────

export function DecisionsStrip({ onNavigate }) {
  const [approvalsCount, setApprovalsCount] = useState(null);
  const [leaderAlerts, setLeaderAlerts] = useState(null);
  const [urgentAssist, setUrgentAssist] = useState(null);
  const [hrHubPending, setHrHubPending] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const safe = async (path) => {
      try { const r = await fetch(path, { credentials: 'include' }); if (!r.ok) return null; return r.json(); }
      catch { return null; }
    };
    (async () => {
      const [approvals, alerts, urgent, hr] = await Promise.all([
        safe('/api/v1/hr-hub/requests?flow=hide_task_request&status=pending'),
        safe('/api/v1/leader-alerts/unacked-count'),
        safe('/api/v1/urgent-assist'),
        safe('/api/v1/hr-hub/requests?status=pending'),
      ]);
      if (cancelled) return;
      const lenOf = (j) => Array.isArray(j?.items) ? j.items.length : (j?.total ?? 0);
      if (approvals) setApprovalsCount(lenOf(approvals));
      if (alerts) setLeaderAlerts(alerts?.count ?? alerts?.total ?? 0);
      if (urgent) setUrgentAssist(lenOf(urgent));
      if (hr) setHrHubPending(lenOf(hr));
    })();
    return () => { cancelled = true; };
  }, []);

  const tile = ({ icon, label, count, hint, color, target }) => {
    const n = count == null ? '—' : count;
    const has = typeof count === 'number' && count > 0;
    return (
      <button
        key={label}
        onClick={() => onNavigate?.(target)}
        style={{
          flex: 1,
          padding: '14px 16px',
          borderRadius: 14,
          border: has ? `1.5px solid ${color}` : '1px solid #e8e8e8',
          background: has ? `${color}0d` : 'white',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 12,
          transition: 'transform .12s, box-shadow .15s',
          boxShadow: has ? `0 1px 6px ${color}1a` : 'none',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
      >
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: has ? `${color}1f` : '#f7f5f2',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <i className={icon} style={{ fontSize: 16, color }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#1b1b1b',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</div>
          {hint && <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 2 }}>{hint}</div>}
        </div>
        <div style={{
          fontSize: 26, fontWeight: 800, lineHeight: 1,
          color: has ? color : '#9e9e9e',
          minWidth: 32, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}>{n}</div>
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {tile({
        icon: 'bi-eye-slash-fill',
        label: 'Hide-task approvals',
        hint: 'from your reports',
        count: approvalsCount,
        color: '#d42d35',
        target: 'approval-queue',
      })}
      {tile({
        icon: 'bi-bell-fill',
        label: 'Unacked Leader Alerts',
        hint: 'targeted at your team',
        count: leaderAlerts,
        color: '#7c3aed',
        target: 'leader-alerts',
      })}
      {tile({
        icon: 'bi-lightning-fill',
        label: 'Urgent Assist',
        hint: 'open requests',
        count: urgentAssist,
        color: '#ed8d00',
        target: 'urgent-assist',
      })}
      {tile({
        icon: 'bi-clipboard-check-fill',
        label: 'HR Hub pending',
        hint: 'open requests in HR Hub',
        count: hrHubPending,
        color: '#0e7490',
        target: 'hr-hub',
      })}
    </div>
  );
}

// ── Per-row helpers used by BriefingView's enriched team table ────────────

export function AccessBadge({ access }) {
  const b = ACCESS_BADGE[access] || ACCESS_BADGE.agent;
  return (
    <span style={{
      background: b.bg, color: b.color,
      fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 128,
      whiteSpace: 'nowrap',
    }}>
      {b.label}
    </span>
  );
}

export function LastLoginPill({ iso, loading = false }) {
  if (loading && !iso) {
    return (
      <span style={{
        background: '#f5f4f2', color: '#9e9e9e',
        fontSize: 10, fontWeight: 700,
        padding: '2px 8px', borderRadius: 128,
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      }}>
        <i className="bi-arrow-clockwise spin" style={{ fontSize: 9 }} />
        Loading…
      </span>
    );
  }
  const ll = formatLastLogin(iso);
  const tone = LAST_LOGIN_TONE[ll.tone] || LAST_LOGIN_TONE.never;
  return (
    <span
      title={ll.iso ? `Last login: ${new Date(ll.iso).toLocaleString()}` : 'This user has never signed in to Ops Hub'}
      style={{
        background: tone.bg, color: tone.color,
        fontSize: 10, fontWeight: 700,
        padding: '2px 8px', borderRadius: 128,
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      }}
    >
      <i className={ll.tone === 'never' ? 'bi-person-slash' : 'bi-clock-history'} style={{ fontSize: 9 }} />
      {ll.tone === 'never' ? 'Never logged in' : ll.label}
    </span>
  );
}

export function CountriesCell({ member, setCountries, canEdit = false }) {
  const countries = member?.countries || [];
  const email = member?.email;
  return (
    <div
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <MultiCountryPicker
        selected={countries}
        canEdit={!!canEdit}
        size="sm"
        onSave={async (next) => {
          if (typeof setCountries === 'function' && email) {
            await setCountries(email, next);
          }
        }}
      />
    </div>
  );
}

export function LoginAsButton({ targetEmail, targetName, onImpersonate, canImpersonate }) {
  if (!canImpersonate || !onImpersonate) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onImpersonate(targetEmail); }}
      title={`Login as ${targetName}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 128,
        border: '1px solid #7c3aed33', background: '#7c3aed', color: 'white',
        fontSize: 10, fontWeight: 700, cursor: 'pointer',
        whiteSpace: 'nowrap', transition: 'opacity .15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
    >
      <i className="bi-box-arrow-in-right" style={{ fontSize: 10 }} />
      Login as
    </button>
  );
}
