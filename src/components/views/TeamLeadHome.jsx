// ── TeamLeadHome (DRAFT / PREVIEW) ─────────────────────────────────────────
// Reachable via ?view=lead-home. A purpose-built homepage for Team Leads
// that consolidates the four answers a TL needs at a glance:
//
//   1. What's on fire across my team's full queue right now? (triage strip)
//   2. Who on my team is overloaded vs. underloaded? (workload heatmap)
//   3. What's the single oldest breached row, and the next 9 after that?
//      (hot list — the universal triage)
//   4. What's blocked on a decision from me? (approvals + alerts + urgent)
//
// All data is read from existing hooks already wired into IntegrationsContext;
// no new endpoints. This is a draft — minimal styling, no virtualization, no
// per-person drill-in panel yet (just shows counts + a stub action).

import { useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { IntegrationsContext, PermissionsContext } from '../../App';
import { MEMBERS_BY_EMAIL, getDirectReports, getAllReports } from '../../data/members';
import { TOOLS, getCountryName } from '../../data/constants';
import { slaInfo, getUrl } from '../../utils/helpers';
import {
  normalizeOnboarding, normalizePausedOnboarding, normalizeOffboarding,
  normalizeAmendments, normalizeRedlines, normalizeWorkbench, normalizeIncentivePlans,
} from '../../utils/normalizeSourceRows';
import { applySlaExtensionsToRows } from '../../utils/applySlaExtensions';
import { useQueueSlaSettings } from '../../hooks/useQueueSlaSettings';
import { useCapacitySettings } from '../../hooks/useCapacitySettings';
import { COUNTRY_OWNERS, OWNER_COUNTRIES } from '../../data/countryOwners';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { getHubBrand } from '../../lib/hub-brand';

const CARD = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
};

const SECTION_TITLE = {
  fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-muted)', marginBottom: 10,
};

function rowSlaSeverity(row) {
  if (!row) return 'ok';
  if (row.slaBreachStatus === 'SLA_BREACHED' || (typeof row.slaRemaining === 'number' && row.slaRemaining <= 0)) return 'breached';
  if (typeof row.slaRemaining !== 'number') return 'ok';
  const windowSeconds = Number.isFinite(row.slaWindowMs) && row.slaWindowMs > 0
    ? row.slaWindowMs / 1000
    : 24 * 60 * 60;
  return row.slaRemaining > 0 && row.slaRemaining < windowSeconds / 4 ? 'at_risk' : 'ok';
}

function rowSlaSecondsOverdue(row) {
  if (!row) return 0;
  if (typeof row.slaRemaining === 'number' && row.slaRemaining <= 0) return Math.abs(row.slaRemaining);
  return 0;
}

function ticketSeverity(t) {
  const s = slaInfo(t);
  if (!s) return 'ok';
  if (s.breach) return 'breached';
  if (!s.ok) return 'at_risk';
  return 'ok';
}

function fmtDuration(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return '';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function TeamLeadHome({ user, tasks = [], setView, managerOnCall }) {
  const { queueUnified, hiddenTasks, slaExtensions } = useContext(IntegrationsContext);
  // 2026-05-22 — dept-branded "HR Hub" pending tile.
  const deptState = useCurrentDept();
  const hubBrand = useMemo(() => getHubBrand(deptState.dept), [deptState.dept]);
  // Approved SLA extensions push per-row deadlines out. Queue.jsx and
  // BriefingView.jsx apply this overlay so their breach counts honour
  // extended windows — TeamLeadHome must do the same or its strip
  // counts drift from the Queue (Lyall Genade 2026-05-19 feedback on
  // AgentHome — same divergence class for TL preview).
  const slaExtensionMap = slaExtensions?.map || null;
  const perms = useContext(PermissionsContext);
  const { sla: queueSla } = useQueueSlaSettings();
  const { data: capacityData } = useCapacitySettings();
  const capacity = capacityData?.capacity || { lowMax: 40, highMin: 100 };

  // ── Direct reports (the visibility scope for a TL) ──────────────────────
  const directReports = useMemo(() => {
    const me = user?.email?.toLowerCase();
    if (!me) return [];
    return getDirectReports(me) || [];
  }, [user?.email]);

  const teamEmails = useMemo(() => {
    const set = new Set();
    if (user?.email) set.add(user.email.toLowerCase());
    for (const r of directReports) set.add((r.email || '').toLowerCase());
    return set;
  }, [user?.email, directReports]);

  // For RM/admin testing: also accept the full subtree so the preview shows
  // realistic numbers even when an admin views it without being a TL of
  // record. Falls back to direct reports for actual TLs.
  const effectiveTeamEmails = useMemo(() => {
    if (perms?.dataScope === 'all_tasks' || perms?.dataScope === 'regional_tasks') {
      const set = new Set([user?.email?.toLowerCase()].filter(Boolean));
      for (const e of getAllReports(user?.email?.toLowerCase()) || []) set.add(e);
      return set.size > 1 ? set : teamEmails;
    }
    return teamEmails;
  }, [perms?.dataScope, user?.email, teamEmails]);

  // ── Build the team's queue from every source ─────────────────────────
  const isHiddenKey = useCallback((source, id) => {
    if (!source || !id) return false;
    return !!(hiddenTasks?.hiddenKeys?.has(`${String(source).toLowerCase()}:${String(id)}`));
  }, [hiddenTasks?.hiddenKeys]);

  const onboardingData = queueUnified?.onboardingData || { items: [] };
  const pausedOnboardingData = queueUnified?.pausedOnboardingData || { items: [] };
  const offboardingData = queueUnified?.offboardingData || { items: [] };
  const changeRequestData = queueUnified?.changeRequestData || { amendments: [], redlines: [] };
  const workbenchData = queueUnified?.workbenchData || { tasks: [] };
  const incentivePlansData = queueUnified?.incentivePlansData || { items: [] };

  const sourceRows = useMemo(() => {
    const ob = applySlaExtensionsToRows(
      normalizeOnboarding(onboardingData.items, queueSla).filter(r => !isHiddenKey('onboarding', r.id)),
      slaExtensionMap, 'onboarding');
    const pob = applySlaExtensionsToRows(
      normalizePausedOnboarding(pausedOnboardingData.items, queueSla).filter(r => !isHiddenKey('paused_onboarding', r.id) && !isHiddenKey('onboarding', r.id)),
      slaExtensionMap, 'onboarding');
    const off = applySlaExtensionsToRows(
      normalizeOffboarding(offboardingData.items, queueSla).filter(r => !isHiddenKey('offboarding', r.id)),
      slaExtensionMap, 'offboarding');
    const am = applySlaExtensionsToRows(
      normalizeAmendments(changeRequestData.amendments, queueSla).filter(r => !isHiddenKey('amendments', r.id)),
      slaExtensionMap, 'amendments');
    const rl = applySlaExtensionsToRows(
      normalizeRedlines(changeRequestData.redlines, queueSla).filter(r => !isHiddenKey('redlines', r.id)),
      slaExtensionMap, 'redlines');
    const wb = applySlaExtensionsToRows(
      normalizeWorkbench(workbenchData.tasks, queueSla).filter(r => !isHiddenKey('workbench', r.id)),
      slaExtensionMap, 'workbench');
    const ip = applySlaExtensionsToRows(
      normalizeIncentivePlans(incentivePlansData.items, queueSla).filter(r => !isHiddenKey('incentive_plans', r.id)),
      slaExtensionMap, 'incentive_plans');
    return [...ob, ...pob, ...off, ...am, ...rl, ...wb, ...ip];
  }, [onboardingData.items, pausedOnboardingData.items, offboardingData.items, changeRequestData.amendments, changeRequestData.redlines, workbenchData.tasks, incentivePlansData.items, queueSla, isHiddenKey, slaExtensionMap]);

  // ── Merge ZD/Jira/Workbench tasks (assignee-based) with source rows ────
  const ticketRows = useMemo(() => {
    return (tasks || [])
      .filter(t => t.source === 'zendesk' || t.source === 'jira')
      .filter(t => !isHiddenKey(t.source, t.id))
      .filter(t => t.status !== 'resolved');
  }, [tasks, isHiddenKey]);

  // ── Filter to TL's team ──────────────────────────────────────────────
  // Source rows: assignee-or-country filter via the row's own assigneeEmail.
  // Tickets: assignee-only.
  const teamSourceRows = useMemo(() => {
    if (perms?.dataScope === 'all_tasks') return sourceRows;
    return sourceRows.filter(r => {
      const ae = (r.assigneeEmail || '').toLowerCase();
      return ae && effectiveTeamEmails.has(ae);
    });
  }, [sourceRows, effectiveTeamEmails, perms?.dataScope]);

  const teamTickets = useMemo(() => {
    if (perms?.dataScope === 'all_tasks') return ticketRows;
    return ticketRows.filter(t => {
      const ae = (t.assigneeEmail || '').toLowerCase();
      return ae && effectiveTeamEmails.has(ae);
    });
  }, [ticketRows, effectiveTeamEmails, perms?.dataScope]);

  // ── Triage strip aggregates ─────────────────────────────────────────
  const tally = useMemo(() => {
    let breached = 0, atRisk = 0, paused = 0, unassigned = 0;
    const breachedBySource = {}, atRiskBySource = {};
    const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };

    for (const r of teamSourceRows) {
      const sev = rowSlaSeverity(r);
      const isPaused = !!r.isPaused || (r.status?.severity === 'warning' && r.pausedAt);
      const isUnassigned = !!r.assigneeIsSynthetic; // synth = nobody actually picked it up
      if (sev === 'breached') { breached++; bump(breachedBySource, r.source); }
      else if (sev === 'at_risk') { atRisk++; bump(atRiskBySource, r.source); }
      if (isPaused) paused++;
      if (isUnassigned) unassigned++;
    }
    for (const t of teamTickets) {
      const sev = ticketSeverity(t);
      if (sev === 'breached') { breached++; bump(breachedBySource, t.source); }
      else if (sev === 'at_risk') { atRisk++; bump(atRiskBySource, t.source); }
      if (t.status === 'waiting') paused++;
      if (!t.assigneeEmail) unassigned++;
    }
    return { breached, atRisk, paused, unassigned, breachedBySource, atRiskBySource };
  }, [teamSourceRows, teamTickets]);

  // ── Per-direct-report workload ─────────────────────────────────────
  const perReportRows = useMemo(() => {
    const reports = directReports.length > 0
      ? directReports
      : [...effectiveTeamEmails].slice(1).map(e => MEMBERS_BY_EMAIL[e]).filter(Boolean);

    return reports.map(member => {
      const email = (member.email || '').toLowerCase();
      const mySource = teamSourceRows.filter(r => (r.assigneeEmail || '').toLowerCase() === email);
      const myTickets = teamTickets.filter(t => (t.assigneeEmail || '').toLowerCase() === email);
      let breached = 0, atRisk = 0;
      for (const r of mySource) {
        const sev = rowSlaSeverity(r);
        if (sev === 'breached') breached++;
        else if (sev === 'at_risk') atRisk++;
      }
      for (const t of myTickets) {
        const sev = ticketSeverity(t);
        if (sev === 'breached') breached++;
        else if (sev === 'at_risk') atRisk++;
      }
      const total = mySource.length + myTickets.length;
      const band = total >= capacity.highMin ? 'over'
        : total >= capacity.lowMax ? 'high'
        : 'ok';
      const breachRatio = total > 0 ? breached / total : 0;
      return {
        email, name: member.name || email, avatarUrl: member.avatarUrl,
        title: member.title || '',
        active: total, breached, atRisk, band, breachRatio,
        synthOwned: mySource.filter(r => r.assigneeIsSynthetic).length,
      };
    }).sort((a, b) => (b.breached - a.breached) || (b.active - a.active));
  }, [directReports, effectiveTeamEmails, teamSourceRows, teamTickets, capacity]);

  // ── Hot list — top 10 oldest breaches ──────────────────────────────
  const hotList = useMemo(() => {
    const breachedSource = teamSourceRows.filter(r => rowSlaSeverity(r) === 'breached')
      .map(r => ({
        kind: 'source', id: `${r.source}:${r.id}`, source: r.source,
        subject: r.subject, country: r.country, assignee: r.assignee, assigneeEmail: r.assigneeEmail,
        overdueSecs: rowSlaSecondsOverdue(r), taskUrl: r.taskUrl,
      }));
    const breachedTickets = teamTickets.filter(t => ticketSeverity(t) === 'breached')
      .map(t => {
        const s = slaInfo(t);
        const overdueSecs = s && s.minsRemaining < 0 ? Math.abs(s.minsRemaining) * 60 : 0;
        return {
          kind: 'ticket', id: t.id, source: t.source,
          subject: t.subject, country: t.country, assignee: t.assigneeName, assigneeEmail: t.assigneeEmail,
          overdueSecs, taskUrl: getUrl(t),
        };
      });
    return [...breachedSource, ...breachedTickets]
      .sort((a, b) => b.overdueSecs - a.overdueSecs)
      .slice(0, 10);
  }, [teamSourceRows, teamTickets]);

  // ── Things waiting on me ─────────────────────────────────────────
  const [approvalsCount, setApprovalsCount] = useState(null);
  const [leaderAlertsBadge, setLeaderAlertsBadge] = useState(null);
  const [urgentAssistCount, setUrgentAssistCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Best-effort fetches — silent failure, the tile just shows '—'
      const safeFetch = async (path) => {
        try { const r = await fetch(path, { credentials: 'include' }); if (!r.ok) return null; return r.json(); } catch { return null; }
      };
      const [approval, alerts, urgent] = await Promise.all([
        safeFetch('/api/v1/hr-hub/requests?flow=hide_task_request&status=pending'),
        safeFetch('/api/v1/leader-alerts/unacked-count'),
        safeFetch('/api/v1/urgent-assist'),
      ]);
      if (cancelled) return;
      if (approval) setApprovalsCount(Array.isArray(approval?.items) ? approval.items.length : (approval?.total ?? 0));
      if (alerts) setLeaderAlertsBadge(alerts?.count ?? alerts?.total ?? 0);
      if (urgent) setUrgentAssistCount(Array.isArray(urgent?.items) ? urgent.items.length : (urgent?.total ?? 0));
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Country breakdown of the team's open queue ────────────────────
  const countryBreakdown = useMemo(() => {
    const map = new Map();
    for (const r of teamSourceRows) {
      const cc = (r.country || r.countryCode || '—').toUpperCase();
      map.set(cc, (map.get(cc) || 0) + 1);
    }
    for (const t of teamTickets) {
      const cc = (t.country || '—').toUpperCase();
      map.set(cc, (map.get(cc) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [teamSourceRows, teamTickets]);

  // ── Source breakdown ─────────────────────────────────────────────
  const sourceBreakdown = useMemo(() => {
    const map = new Map();
    for (const r of teamSourceRows) map.set(r.source, (map.get(r.source) || 0) + 1);
    for (const t of teamTickets) map.set(t.source, (map.get(t.source) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [teamSourceRows, teamTickets]);

  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good morning';
    if (hr < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--surface-2)', padding: '20px 32px 80px' }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
            {greeting}, {(user?.name || '').split(' ')[0] || 'Team Lead'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {user?.team || ''} · {directReports.length} direct report{directReports.length === 1 ? '' : 's'}
            {perms?.dataScope === 'all_tasks' && <span style={{ marginLeft: 8, color: '#0e7490' }}>· admin preview (showing org)</span>}
          </div>
        </div>
        <div style={{
          padding: '6px 14px', borderRadius: 128, background: '#dcfce7',
          border: '1px solid #bbf7d0', fontSize: 12, fontWeight: 600, color: '#166534',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#15803d' }} />
          Live · TL Home (preview)
        </div>
      </div>

      {/* ── Triage strip ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <TriageTile
          icon="bi-x-circle-fill"
          label="Breached" count={tally.breached}
          color="#d42d35" bg="#ffe2de"
          breakdown={tally.breachedBySource}
          onClick={() => setView?.('my-queue')}
        />
        <TriageTile
          icon="bi-exclamation-circle-fill"
          label="At risk" count={tally.atRisk}
          color="#ed8d00" bg="#fff8e6"
          subText="<25% of SLA window left"
          breakdown={tally.atRiskBySource}
          onClick={() => setView?.('my-queue')}
        />
        <TriageTile
          icon="bi-pause-circle-fill"
          label="Paused" count={tally.paused}
          color="#6b6560" bg="#f5f5f4"
          subText="onb pause / waiting tickets"
          onClick={() => setView?.('my-queue')}
        />
        <TriageTile
          icon="bi-person-dash"
          label="Synth-assigned" count={tally.unassigned}
          color="#7c3aed" bg="#f3eff8"
          subText="no real owner picked up yet"
          onClick={() => setView?.('my-queue')}
        />
      </div>

      {/* ── Two-column: Team workload + Hot list ──────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={CARD}>
          <div style={SECTION_TITLE}>My Team — Workload + Breaches</div>
          {perReportRows.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
              No direct reports on file. (TL view requires reports in `members.js`.)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {perReportRows.map(rep => <ReportRow key={rep.email} rep={rep} capacity={capacity} />)}
            </div>
          )}
        </div>

        <div style={CARD}>
          <div style={{ ...SECTION_TITLE, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Hot list — 10 oldest breaches in my team</span>
            {hotList.length > 0 && (
              <span style={{ fontWeight: 500, fontSize: 11, color: '#d42d35' }}>
                {hotList.length} of {tally.breached}
              </span>
            )}
          </div>
          {hotList.length === 0 ? (
            <div style={{ color: '#15803d', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
              <i className="bi-check-circle-fill" style={{ marginRight: 6 }} />
              No breached items right now.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {hotList.map(row => <HotRow key={row.id} row={row} />)}
            </div>
          )}
        </div>
      </div>

      {/* ── Things waiting on me + Manager on call ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={CARD}>
          <div style={SECTION_TITLE}>Things waiting on a decision from me</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <DecisionTile
              icon="bi-eye-slash-fill"
              label="Hide-task approvals from my reports"
              count={approvalsCount}
              onClick={() => setView?.('approval-queue')}
              color="#d42d35"
            />
            <DecisionTile
              icon="bi-bell-fill"
              label="Unacked Leader Alerts"
              count={leaderAlertsBadge}
              onClick={() => setView?.('leader-alerts')}
              color="#7c3aed"
            />
            <DecisionTile
              icon="bi-lightning-fill"
              label="Urgent Assist (in any country)"
              count={urgentAssistCount}
              onClick={() => setView?.('urgent-assist')}
              color="#ed8d00"
            />
            <DecisionTile
              icon="bi-clipboard-check-fill"
              label={`${hubBrand.hubLabel} pending`}
              count={null}
              hint="(coming soon)"
              onClick={() => setView?.('hr-hub')}
              color="#0e7490"
            />
          </div>
        </div>

        <div style={CARD}>
          <div style={SECTION_TITLE}>Manager on call</div>
          {managerOnCall?.email ? (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                {MEMBERS_BY_EMAIL[managerOnCall.email.toLowerCase()]?.name || managerOnCall.email}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {managerOnCall.startTime || '09:00'} – {managerOnCall.endTime || '17:00'} {managerOnCall.timezone || 'UTC'}
              </div>
              {managerOnCall.email.toLowerCase() === user?.email?.toLowerCase() && (
                <div style={{
                  marginTop: 8, padding: '6px 10px', borderRadius: 8,
                  background: '#fff8e6', border: '1px solid #ffe27c', color: '#92400E',
                  fontSize: 11, fontWeight: 600,
                }}>
                  You're on call right now.
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No one on call.</div>
          )}
        </div>
      </div>

      {/* ── Country + Source breakdown ────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={CARD}>
          <div style={SECTION_TITLE}>By country (top 8)</div>
          {countryBreakdown.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet.</div>
          ) : (
            <BreakdownBars rows={countryBreakdown} color="#0e7490" />
          )}
        </div>
        <div style={CARD}>
          <div style={SECTION_TITLE}>By source</div>
          {sourceBreakdown.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet.</div>
          ) : (
            <BreakdownBars
              rows={sourceBreakdown.map(([k, v]) => [TOOLS[k]?.label || k, v])}
              colors={sourceBreakdown.map(([k]) => TOOLS[k]?.color || '#616161')}
            />
          )}
        </div>
      </div>

      {/* ── Footer note ───────────────────────────────────────────── */}
      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        TL Home preview · ?view=lead-home · data is live, layout is a draft
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function TriageTile({ icon, label, count, color, bg, subText, breakdown, onClick }) {
  const sortedBreakdown = breakdown ? Object.entries(breakdown).sort((a, b) => b[1] - a[1]).slice(0, 4) : null;
  return (
    <button onClick={onClick} style={{
      ...CARD,
      cursor: 'pointer', textAlign: 'left',
      borderColor: count > 0 ? color : '#e8e8e8',
      background: count > 0 ? bg : 'white',
      transition: 'transform .12s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <i className={icon} style={{ fontSize: 16, color }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: count > 0 ? color : '#9e9e9e', lineHeight: 1 }}>
        {count}
      </div>
      {subText && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{subText}</div>}
      {sortedBreakdown && sortedBreakdown.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {sortedBreakdown.map(([src, n]) => (
            <span key={src} style={{
              fontSize: 10, fontWeight: 600, color: TOOLS[src]?.color || '#616161',
              background: TOOLS[src]?.bg || '#f3f3f3', padding: '1px 7px', borderRadius: 128,
            }}>
              {TOOLS[src]?.label || src} {n}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function ReportRow({ rep, capacity }) {
  const pct = Math.min(100, Math.round((rep.active / capacity.highMin) * 100));
  const barColor = rep.band === 'over' ? '#d42d35' : rep.band === 'high' ? '#ed8d00' : '#15803d';
  const isHotspot = rep.breachRatio > 0.5 && rep.active >= 4;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.7fr 0.6fr 0.6fr',
      gap: 8, alignItems: 'center', padding: '8px 6px',
      borderBottom: '1px solid #f5f5f4', fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {rep.avatarUrl ? (
          <img src={rep.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} />
        ) : (
          <div style={{
            width: 22, height: 22, borderRadius: '50%', background: '#e8e8e8',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
          }}>{(rep.name || '?').slice(0, 1)}</div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rep.name}
            {isHotspot && <span style={{ marginLeft: 6, color: '#d42d35' }} title="More than half of this person's queue is breached">🔥</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rep.title || rep.email}
          </div>
        </div>
      </div>
      <div>
        <div style={{ height: 6, background: '#f0efed', borderRadius: 128, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width .2s' }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {rep.active} / ~{capacity.highMin}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontWeight: 700, color: rep.breached > 0 ? '#d42d35' : '#9e9e9e' }}>{rep.breached}</span>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>brch</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontWeight: 700, color: rep.atRisk > 0 ? '#ed8d00' : '#9e9e9e' }}>{rep.atRisk}</span>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>risk</div>
      </div>
      <div style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>
        {rep.synthOwned > 0 && <span title="Rows assigned to them only via the synthetic country-owner round-robin">{rep.synthOwned} synth</span>}
      </div>
    </div>
  );
}

function HotRow({ row }) {
  const meta = TOOLS[row.source] || { label: row.source, color: 'var(--text-secondary)', bg: '#f3f3f3', icon: 'bi-circle' };
  const overdue = fmtDuration(row.overdueSecs);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 1fr auto auto', gap: 10, alignItems: 'center',
      padding: '8px 4px', borderTop: '1px solid #f5f5f4', fontSize: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 128, background: meta.bg, color: meta.color,
        fontSize: 10, fontWeight: 700,
      }}>
        <i className={meta.icon} style={{ fontSize: 9 }} />
        {meta.label}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.subject || row.id}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {row.country ? `${getCountryName(row.country) || row.country} · ` : ''}{row.assignee || row.assigneeEmail || 'unassigned'}
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#d42d35' }} title="Overdue by">
        {overdue ? `+${overdue}` : 'breached'}
      </div>
      {row.taskUrl ? (
        <a href={row.taskUrl} target="_blank" rel="noopener noreferrer" style={{
          padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
          fontSize: 10, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)',
          textDecoration: 'none',
        }}>Open</a>
      ) : <span />}
    </div>
  );
}

function DecisionTile({ icon, label, count, hint, onClick, color }) {
  const display = count == null ? '—' : count;
  return (
    <button onClick={onClick} style={{
      padding: 12, borderRadius: 10, border: '1px solid var(--border)',
      background: count > 0 ? '#fafaf9' : 'white', textAlign: 'left',
      cursor: 'pointer', transition: 'border-color .12s, background .12s',
      display: 'flex', alignItems: 'center', gap: 12,
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8'; }}
    >
      <i className={icon} style={{ fontSize: 18, color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: count > 0 ? color : '#9e9e9e', lineHeight: 1, minWidth: 32, textAlign: 'right' }}>
        {display}
      </div>
    </button>
  );
}

function BreakdownBars({ rows, color = '#0e7490', colors = null }) {
  const max = rows.reduce((m, r) => Math.max(m, r[1]), 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(([k, v], i) => {
        const pct = Math.round((v / max) * 100);
        const c = colors?.[i] || color;
        return (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 32px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
            <div style={{ height: 8, background: '#f0efed', borderRadius: 128, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: c }} />
            </div>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>{v}</span>
          </div>
        );
      })}
    </div>
  );
}
