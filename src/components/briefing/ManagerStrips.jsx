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
// Helpers (formatLastSeen / LAST_SEEN_TONE / ACCESS_BADGE / LoginAsButton /
// CountriesCell) are also exported here — BriefingView's team table reuses
// them so the Briefing rows match the Team-tab look-and-feel exactly.

import { useEffect, useMemo, useState } from 'react';
import { TOOLS } from '../../data/constants';
import { slaInfo } from '../../utils/helpers';
import { apiFetch } from '../../services/api';
import MultiCountryPicker from '../team/MultiCountryPicker';

// ── Pure helpers (mirrored from Team.jsx so the look matches) ──────────────

export function formatLastSeen(iso) {
  if (!iso) return { label: 'Never seen', tone: 'never' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: 'Never seen', tone: 'never' };
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

export const LAST_SEEN_TONE = {
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

// ── TriageStrip ──────────────────────────────────────────────────────────
//
// Renders breach / risk / pause / synth counts off rows that BriefingView
// has ALREADY scoped via the canonical scopeOnboarding / scopeOffboarding /
// scopeAmendmentRequests / scopeRedlineRequests / scopeWorkbenchTasks /
// scopeIncentivePlans (country-OR-assignee for Deel feeds, assignee-only
// for ZD/Jira/Workbench). Re-scoping here would diverge from the Workspace
// view — and a previous draft did exactly that, under-counting rows that
// were country-visible but assigned outside the manager's subtree.
// Tickets come from the manager's `scope` (already filtered ZD/Jira/WB by
// scopeTicketsByAssignee in BriefingView).
//
// Props
//   sourceRows : Array  — concatenation of every scoped Deel-feed row set
//   tickets    : Array  — scoped ZD/Jira tickets (status !== 'resolved')
//   onNavigate : (view) => void

export function TriageStrip({ sourceRows = [], tickets = [], onNavigate }) {
  const tally = useMemo(() => {
    let breached = 0, atRisk = 0, paused = 0, synth = 0;
    const breachedBy = {}, atRiskBy = {};
    const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
    for (const r of sourceRows) {
      const sev = rowSlaSeverity(r);
      if (sev === 'breached') { breached++; bump(breachedBy, r.source); }
      else if (sev === 'at_risk') { atRisk++; bump(atRiskBy, r.source); }
      if (r.isPaused) paused++;
      if (r.assigneeIsSynthetic) synth++;
    }
    for (const t of tickets) {
      // Per Mohamed 2026-05-01 spec: "exclude Jira from the SLA calculation
      // and the breach count on home page". Jira tickets still surface in
      // the Paused / No-real-owner counts and per-source chips, but they
      // don't add to Breached or At-Risk totals — Jira's SLA model differs
      // from ZD/Deel and double-counting it would distort the manager's
      // triage view. Same exclusion rule lives in BriefingView's health
      // score (see slaPoolNonJira / breachedNonJira).
      const isJira = t.source === 'jira';
      if (!isJira) {
        const sev = ticketSeverity(t);
        if (sev === 'breached') { breached++; bump(breachedBy, t.source); }
        else if (sev === 'at_risk') { atRisk++; bump(atRiskBy, t.source); }
      }
      if (t.status === 'waiting') paused++;
      // ZD/Jira: a ticket with no assignee is a true "no real owner"
      // signal (the synth-fallback only exists on Deel feeds).
      if (!t.assigneeEmail) synth++;
    }
    return { breached, atRisk, paused, synth, breachedBy, atRiskBy };
  }, [sourceRows, tickets]);

  const tile = (props) => (
    <button
      key={props.label}
      onClick={() => {
        // Pre-set the Queue's SLA filter so a manager who clicks Breached /
        // At-Risk lands on a view scoped to that tier (including the per-
        // source hand-off panel for Deel-source breaches). Falls back to a
        // plain navigation if the event isn't handled (Queue listens via a
        // useEffect added in the same fix).
        if (props.k === 'breached') {
          try { window.dispatchEvent(new CustomEvent('queue:setSlaFilter', { detail: { sla: 'breached' } })); } catch (_) {}
        } else if (props.k === 'atRisk') {
          try { window.dispatchEvent(new CustomEvent('queue:setSlaFilter', { detail: { sla: 'at_risk' } })); } catch (_) {}
        }
        onNavigate?.('my-queue');
      }}
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
  const [hrHubPending, setHrHubPending] = useState(null);
  const [leaderAlerts, setLeaderAlerts] = useState(null);
  const [urgentAssist, setUrgentAssist] = useState(null);
  const [approvalsCount, setApprovalsCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Use apiFetch so calls carry the JWT (Authorization: Bearer ...) and
    // the X-Impersonate-As header. The previous raw `fetch(path, {
    // credentials: 'include' })` sent NO Authorization header — the API
    // routes treat that as anonymous and return 401, which is why every
    // tile rendered "—" for every manager (admins included). Path is
    // relative to /api/v1 since apiFetch prepends API_BASE.
    const safe = async (path) => {
      try { return await apiFetch(path); }
      catch { return null; }
    };
    (async () => {
      // Count semantics (each tile answers "what's waiting on me?"):
      //
      //   • hrHubPending    — open HR Hub requests across every flow that
      //                       were either raised by someone in the caller's
      //                       subtree (scope=team) OR assigned to the caller
      //                       (scope=assigned). De-duped by id since the
      //                       same row can appear in both scopes.
      //   • leaderAlerts    — sidebar-badge unacked count, server filters by
      //                       severity threshold + caller's ack rows.
      //   • urgentAssist    — open Urgent-Assist where someone in my subtree
      //                       is the assignee. Endpoint takes a single
      //                       status; we make 3 parallel calls and sum.
      //   • approvalsCount  — HR-Hub requests of flow IN (hide_task_request,
      //                       sla_extension_request) that are still
      //                       actionable (not yet resolved). scope=team
      //                       covers caller's full subtree.
      const [
        // HR Hub team-raised — 3 open statuses
        hrTeamNew, hrTeamInProg, hrTeamOnHold,
        // HR Hub assigned-to-me — 3 open statuses
        hrAssignedNew, hrAssignedInProg, hrAssignedOnHold,
        // Leader alerts
        alerts,
        // Urgent Assist — team scope, 3 open statuses
        urgentNew, urgentInProg, urgentOnHold,
        // Hide-task approvals — team scope, 3 open statuses
        hideTaskNew, hideTaskInProg, hideTaskOnHold,
        // SLA Extension approvals — team scope, 3 open statuses
        slaExtNew, slaExtInProg, slaExtOnHold,
      ] = await Promise.all([
        safe('/hr-hub/requests?status=new&scope=team&limit=100'),
        safe('/hr-hub/requests?status=in_progress&scope=team&limit=100'),
        safe('/hr-hub/requests?status=on_hold&scope=team&limit=100'),
        safe('/hr-hub/requests?status=new&scope=assigned&limit=100'),
        safe('/hr-hub/requests?status=in_progress&scope=assigned&limit=100'),
        safe('/hr-hub/requests?status=on_hold&scope=assigned&limit=100'),
        safe('/leader-alerts/unacked-count'),
        safe('/urgent-assist?scope=team&status=new&limit=200'),
        safe('/urgent-assist?scope=team&status=in_progress&limit=200'),
        safe('/urgent-assist?scope=team&status=on_hold&limit=200'),
        safe('/hr-hub/requests?flow=hide_task_request&status=new&scope=team&limit=100'),
        safe('/hr-hub/requests?flow=hide_task_request&status=in_progress&scope=team&limit=100'),
        safe('/hr-hub/requests?flow=hide_task_request&status=on_hold&scope=team&limit=100'),
        safe('/hr-hub/requests?flow=sla_extension_request&status=new&scope=team&limit=100'),
        safe('/hr-hub/requests?flow=sla_extension_request&status=in_progress&scope=team&limit=100'),
        safe('/hr-hub/requests?flow=sla_extension_request&status=on_hold&scope=team&limit=100'),
      ]);
      if (cancelled) return;
      const itemsOf = (j) => Array.isArray(j?.items) ? j.items : [];
      // HR Hub: union team-raised + assigned-to-me, dedup by id so a row
      // assigned to the caller AND raised by a team member counts once.
      const hrTeamRows = [...itemsOf(hrTeamNew), ...itemsOf(hrTeamInProg), ...itemsOf(hrTeamOnHold)];
      const hrAssignedRows = [...itemsOf(hrAssignedNew), ...itemsOf(hrAssignedInProg), ...itemsOf(hrAssignedOnHold)];
      const hrAnyResp = hrTeamNew || hrTeamInProg || hrTeamOnHold || hrAssignedNew || hrAssignedInProg || hrAssignedOnHold;
      if (hrAnyResp) {
        const seenIds = new Set();
        let unique = 0;
        for (const r of [...hrTeamRows, ...hrAssignedRows]) {
          const id = r?.id;
          if (id == null || seenIds.has(id)) continue;
          seenIds.add(id);
          unique++;
        }
        setHrHubPending(unique);
      }
      if (alerts) setLeaderAlerts(alerts?.count ?? 0);
      // Urgent Assist: sum the three open buckets — endpoint paginates
      // beyond ~200 but 200/bucket × 3 = 600 ceiling is above every team.
      const urgentAnyResp = urgentNew || urgentInProg || urgentOnHold;
      if (urgentAnyResp) {
        setUrgentAssist(itemsOf(urgentNew).length + itemsOf(urgentInProg).length + itemsOf(urgentOnHold).length);
      }
      // Approvals: sum hide_task_request + sla_extension_request across
      // the three open statuses. Two disjoint flows → no dedup needed.
      const approvalsAnyResp = hideTaskNew || hideTaskInProg || hideTaskOnHold || slaExtNew || slaExtInProg || slaExtOnHold;
      if (approvalsAnyResp) {
        const hideSum = itemsOf(hideTaskNew).length + itemsOf(hideTaskInProg).length + itemsOf(hideTaskOnHold).length;
        const slaSum = itemsOf(slaExtNew).length + itemsOf(slaExtInProg).length + itemsOf(slaExtOnHold).length;
        setApprovalsCount(hideSum + slaSum);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tiles dispatch a CustomEvent to the destination view (with the desired
  // scope/flow/status filter) BEFORE calling onNavigate. The destination
  // view listens on mount and applies the filters so the user lands on the
  // exact list the tile claims to summarize.
  const handleTileClick = (target, eventName, detail) => {
    if (eventName && typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent(eventName, { detail })); } catch (_) {}
    }
    onNavigate?.(target);
  };

  const tile = ({ icon, label, count, hint, color, onClick }) => {
    const n = count == null ? '—' : count;
    const has = typeof count === 'number' && count > 0;
    return (
      <button
        key={label}
        onClick={onClick}
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
        icon: 'bi-clipboard-check-fill',
        label: 'HR Hub',
        hint: 'team raised or assigned to me',
        count: hrHubPending,
        color: '#0e7490',
        onClick: () => handleTileClick('hr-hub', 'hr-hub:setFilters', { scope: 'team', flow: 'all', status: null }),
      })}
      {tile({
        icon: 'bi-bell-fill',
        label: 'Unacked Leader Alerts',
        hint: 'targeted at your team',
        count: leaderAlerts,
        color: '#7c3aed',
        onClick: () => handleTileClick('leader-alerts', 'leader-alerts:setFilters', { unackedOnly: true }),
      })}
      {tile({
        icon: 'bi-lightning-fill',
        label: 'Urgent Assist',
        hint: 'open requests in my team',
        count: urgentAssist,
        color: '#ed8d00',
        onClick: () => handleTileClick('urgent-assist', 'urgent-assist:setFilters', { scope: 'team', status: null }),
      })}
      {tile({
        icon: 'bi-eye-slash-fill',
        label: 'SLA Extension & Hide-Task',
        hint: 'approvals from your reports',
        count: approvalsCount,
        color: '#d42d35',
        onClick: () => handleTileClick('hr-hub', 'hr-hub:setFilters', { scope: 'team', flow: 'hide_task_request', status: null }),
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

export function LastSeenPill({ iso, loading = false }) {
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
  const ll = formatLastSeen(iso);
  const tone = LAST_SEEN_TONE[ll.tone] || LAST_SEEN_TONE.never;
  return (
    <span
      title={ll.iso ? `Last seen: ${new Date(ll.iso).toLocaleString()}` : 'This user has never been active in Ops Hub'}
      style={{
        background: tone.bg, color: tone.color,
        fontSize: 10, fontWeight: 700,
        padding: '2px 8px', borderRadius: 128,
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      }}
    >
      <i className={ll.tone === 'never' ? 'bi-person-slash' : 'bi-clock-history'} style={{ fontSize: 9 }} />
      {ll.tone === 'never' ? 'Never seen' : ll.label}
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
