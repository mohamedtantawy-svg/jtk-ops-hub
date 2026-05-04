// ── AgentHome (DRAFT / PREVIEW) ───────────────────────────────────────────
// A focused, single-column home for agents (`dataScope='own_tasks_only'`).
// Reachable via ?view=agent-home for design review; shipping it as the
// default agent landing is a follow-up patch once the layout's signed off.
//
// Why a separate page from BriefingView?
//   The current Briefing tries to serve agent + TL + RM + admin from one
//   2,000-line tree. The agent path ends up with a 2-tile KPI strip, a
//   collapsible source breakdown, and three right-column cards (DailySummary,
//   ApproachingBreach, Team Availability) — none of which answer the only
//   question an agent has at 9am: "what's in front of me, and what should I
//   pick up first?"
//
// The AgentHome answers it directly:
//   1. Priority of the Day  — same admin-set banner the Workspace landing
//                              shows, so the message is consistent across
//                              every entry point.
//   2. Your SLA status      — Breached / At-Risk / On Track tiles for THIS
//                              agent's queue, click-through to the filter.
//   3. Your focus           — top 5 most-urgent items in their queue
//                              (breached first, then at-risk by oldest).
//   4. Your queues          — a chip row of every source they have open
//                              work in, with counts and one-click jump.
//   5. Progress today       — resolved today vs still open, plus a small
//                              streak chip.
//   6. Personal checklist   — keeps the existing component (their personal
//                              todos that aren't Q items).

import { useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { IntegrationsContext } from '../../App';
import { TOOLS } from '../../data/constants';
import { slaInfo, getUrl } from '../../utils/helpers';
import { useQueueSlaSettings } from '../../hooks/useQueueSlaSettings';
import { useCapacitySettings } from '../../hooks/useCapacitySettings';
import {
  normalizeOnboarding, normalizePausedOnboarding, normalizeOffboarding,
  normalizeAmendments, normalizeRedlines, normalizeWorkbench, normalizeIncentivePlans,
} from '../../utils/normalizeSourceRows';
import { matchesAudience } from '../../data/comms';
import { apiFetch } from '../../services/api';
import PersonalChecklist from '../home/PersonalChecklist';
import PendingAcksBanner from './PendingAcksBanner';

function rowSlaSeverity(row) {
  if (!row) return 'ok';
  if (row.slaBreachStatus === 'SLA_BREACHED' || (typeof row.slaRemaining === 'number' && row.slaRemaining <= 0)) return 'breached';
  if (typeof row.slaRemaining !== 'number') return 'ok';
  const windowSeconds = Number.isFinite(row.slaWindowMs) && row.slaWindowMs > 0
    ? row.slaWindowMs / 1000
    : 24 * 60 * 60;
  return row.slaRemaining > 0 && row.slaRemaining < windowSeconds / 4 ? 'at_risk' : 'ok';
}

function rowOverdueSecs(row) {
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

function ticketOverdueSecs(t) {
  const s = slaInfo(t);
  if (s && Number.isFinite(s.minsRemaining) && s.minsRemaining < 0) return Math.abs(s.minsRemaining) * 60;
  return 0;
}

function fmtDuration(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return '';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function AgentHome({ user, tasks = [], setView, comms = [], ackEmails = null, isAckedByMe: isAckedByMeProp = null }) {
  const { queueUnified, hiddenTasks } = useContext(IntegrationsContext);
  const { sla: queueSla } = useQueueSlaSettings();
  const { data: capData } = useCapacitySettings();
  const capLow = Number.isFinite(capData?.capacity?.lowMax) ? capData.capacity.lowMax : 40;
  const capHigh = Number.isFinite(capData?.capacity?.highMin) ? capData.capacity.highMin : 100;

  const isHidden = useCallback((source, id) => {
    if (!source || !id) return false;
    return !!(hiddenTasks?.hiddenKeys?.has(`${String(source).toLowerCase()}:${String(id)}`));
  }, [hiddenTasks?.hiddenKeys]);

  const myEmail = (user?.email || '').toLowerCase();
  const myFirstName = (user?.name || user?.email || '').split(' ')[0] || 'there';

  // ── My queue rows (own_tasks_only) ─────────────────────────────────────
  // Mirror the same normalize → hide-filter → assignee-self filter chain
  // BriefingView uses for `personal` and per-source rows. The result is the
  // exact set of rows the agent sees in Workspace under their own tabs.
  const onb = queueUnified?.onboardingData || { items: [] };
  const pob = queueUnified?.pausedOnboardingData || { items: [] };
  const off = queueUnified?.offboardingData || { items: [] };
  const cr = queueUnified?.changeRequestData || { amendments: [], redlines: [] };
  const wb = queueUnified?.workbenchData || { tasks: [] };
  const ip = queueUnified?.incentivePlansData || { items: [] };

  const myRows = useMemo(() => {
    const matches = (r) => (r.assigneeEmail || '').toLowerCase() === myEmail;
    const a = normalizeOnboarding(onb.items, queueSla).filter(r => !isHidden('onboarding', r.id) && matches(r));
    const b = normalizePausedOnboarding(pob.items, queueSla).filter(r => !isHidden('paused_onboarding', r.id) && !isHidden('onboarding', r.id) && matches(r));
    const c = normalizeOffboarding(off.items, queueSla).filter(r => !isHidden('offboarding', r.id) && matches(r));
    const d = normalizeAmendments(cr.amendments, queueSla).filter(r => !isHidden('amendments', r.id) && matches(r));
    const e = normalizeRedlines(cr.redlines, queueSla).filter(r => !isHidden('redlines', r.id) && matches(r));
    const f = normalizeWorkbench(wb.tasks, queueSla).filter(r => !isHidden('workbench', r.id) && matches(r));
    const g = normalizeIncentivePlans(ip.items, queueSla).filter(r => !isHidden('incentive_plans', r.id) && matches(r));
    return [...a, ...b, ...c, ...d, ...e, ...f, ...g];
  }, [onb.items, pob.items, off.items, cr.amendments, cr.redlines, wb.tasks, ip.items, queueSla, isHidden, myEmail]);

  const myTickets = useMemo(() => (tasks || [])
    .filter(t => (t.source === 'zendesk' || t.source === 'jira'))
    .filter(t => !isHidden(t.source, t.id))
    .filter(t => (t.assigneeEmail || '').toLowerCase() === myEmail)
    .filter(t => t.status !== 'resolved'),
  [tasks, isHidden, myEmail]);

  // Per Mohamed 2026-05-01 spec: "exclude Jira from the SLA calculation
  // and the breach count on home page". Jira tickets still appear in the
  // per-source chip row (so the agent knows their volume) but they don't
  // contribute to Breached / At-Risk / On-Track tallies or the Focus list.
  const myTicketsForSla = useMemo(() => myTickets.filter(t => t.source !== 'jira'), [myTickets]);

  const myResolvedToday = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    return (tasks || [])
      .filter(t => (t.assigneeEmail || '').toLowerCase() === myEmail)
      .filter(t => t.status === 'resolved')
      .filter(t => {
        const d = t.updatedAt || t.resolvedAt;
        return d && new Date(d).getTime() >= todayMs;
      });
  }, [tasks, myEmail]);

  // ── SLA tally (only the user's open work) ──────────────────────────
  // `total` counts EVERY open assignment (incl. Jira) so the greeting
  // strip's "N open in your queue" reflects the full workload. Per
  // Mohamed 2026-05-01 spec, Jira does NOT contribute to the Breached
  // or At-Risk buckets — but to keep the three SLA tiles summing to
  // total honestly, every open Jira ticket lands in On Track (Jira's
  // SLA isn't tracked here, so for this view it's "fine for now").
  // Net effect: agent sees "24 open · 2 breached · 4 at risk · 18 on
  // track (incl. 5 Jira)" and the math adds up.
  const tally = useMemo(() => {
    let breached = 0, atRisk = 0, ok = 0;
    for (const r of myRows) {
      const s = rowSlaSeverity(r);
      if (s === 'breached') breached++;
      else if (s === 'at_risk') atRisk++;
      else ok++;
    }
    for (const t of myTickets) {
      if (t.source === 'jira') {
        // Jira is excluded from breach / at-risk by spec — bucket it
        // into On Track so totals reconcile.
        ok++;
        continue;
      }
      const s = ticketSeverity(t);
      if (s === 'breached') breached++;
      else if (s === 'at_risk') atRisk++;
      else ok++;
    }
    return {
      breached, atRisk, ok,
      total: myRows.length + myTickets.length,
    };
  }, [myRows, myTickets]);

  // ── Focus list — 5 most-urgent items (breached oldest first, then at-risk)
  const focusList = useMemo(() => {
    const breached = [
      ...myRows.filter(r => rowSlaSeverity(r) === 'breached').map(r => ({
        kind: 'source', id: `${r.source}:${r.id}`, source: r.source,
        subject: r.subject || '(no subject)',
        country: r.country, taskUrl: r.taskUrl,
        overdueSecs: rowOverdueSecs(r), sev: 'breached',
        clientName: r.clientName,
      })),
      // Exclude Jira from the breach focus list — same rule as the SLA
      // tally above.
      ...myTicketsForSla.filter(t => ticketSeverity(t) === 'breached').map(t => ({
        kind: 'ticket', id: t.id, source: t.source,
        subject: t.subject || '(no subject)',
        country: t.country, taskUrl: getUrl(t),
        overdueSecs: ticketOverdueSecs(t), sev: 'breached',
        rawTask: t,
      })),
    ].sort((a, b) => b.overdueSecs - a.overdueSecs);
    const atRisk = [
      ...myRows.filter(r => rowSlaSeverity(r) === 'at_risk').map(r => ({
        kind: 'source', id: `${r.source}:${r.id}`, source: r.source,
        subject: r.subject || '(no subject)',
        country: r.country, taskUrl: r.taskUrl,
        overdueSecs: 0, sev: 'at_risk',
        clientName: r.clientName,
        slaRemaining: r.slaRemaining,
      })),
      ...myTicketsForSla.filter(t => ticketSeverity(t) === 'at_risk').map(t => ({
        kind: 'ticket', id: t.id, source: t.source,
        subject: t.subject || '(no subject)',
        country: t.country, taskUrl: getUrl(t),
        overdueSecs: 0, sev: 'at_risk',
        rawTask: t,
      })),
    ];
    return [...breached, ...atRisk].slice(0, 5);
  }, [myRows, myTicketsForSla]);

  // ── Per-source counts for the chip row ────────────────────────────────
  const sourceCounts = useMemo(() => {
    const counts = {};
    for (const r of myRows) counts[r.source] = (counts[r.source] || 0) + 1;
    for (const t of myTickets) counts[t.source] = (counts[t.source] || 0) + 1;
    return counts;
  }, [myRows, myTickets]);

  const sourcePills = useMemo(() => {
    const order = ['onboarding', 'offboarding', 'zendesk', 'jira', 'workbench', 'amendments', 'redlines', 'incentive_plans'];
    return order
      .map(s => ({ id: s, count: sourceCounts[s] || 0, meta: TOOLS[s] }))
      .filter(s => s.count > 0);
  }, [sourceCounts]);

  // ── Other inboxes — open items waiting on this agent ───────────────────
  // These three signals don't live in the queue feeds but matter to an
  // agent's day: HR Hub items they raised that are still open, Urgent
  // Assist requests assigned to them, and announcements they haven't
  // acknowledged yet. We fetch HR-Hub + Urgent-Assist directly via the
  // existing routes (?scope=mine, status filter loop), and count
  // unacked announcements off the `comms` feed if it's plumbed in.
  const [hrHubMine, setHrHubMine] = useState(null);
  const [urgentMine, setUrgentMine] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const safe = async (path) => {
      try { return await apiFetch(path); }
      catch { return null; }
    };
    (async () => {
      const [hrNew, hrInProg, hrOnHold, uaNew, uaInProg, uaOnHold] = await Promise.all([
        safe('/hr-hub/requests?scope=mine&status=new&limit=100'),
        safe('/hr-hub/requests?scope=mine&status=in_progress&limit=100'),
        safe('/hr-hub/requests?scope=mine&status=on_hold&limit=100'),
        safe('/urgent-assist?scope=mine&status=new&limit=100'),
        safe('/urgent-assist?scope=mine&status=in_progress&limit=100'),
        safe('/urgent-assist?scope=mine&status=on_hold&limit=100'),
      ]);
      if (cancelled) return;
      const lenOf = (j) => Array.isArray(j?.items) ? j.items.length : 0;
      const hrAny = hrNew !== null || hrInProg !== null || hrOnHold !== null;
      if (hrAny) setHrHubMine(lenOf(hrNew) + lenOf(hrInProg) + lenOf(hrOnHold));
      const uaAny = uaNew !== null || uaInProg !== null || uaOnHold !== null;
      if (uaAny) setUrgentMine(lenOf(uaNew) + lenOf(uaInProg) + lenOf(uaOnHold));
    })();
    return () => { cancelled = true; };
  }, []);

  // Unacked announcements — same filter BriefingView uses. `comms` is
  // optional; if the host didn't pass it the tile shows "—" rather than
  // a wrong zero, so the agent isn't told "0 unacked" when we can't tell.
  const unackedAnnouncements = useMemo(() => {
    if (!Array.isArray(comms) || comms.length === 0) return null;
    const isAcked = typeof isAckedByMeProp === 'function'
      ? isAckedByMeProp
      : (c) => {
          if (!c) return false;
          const ackList = Array.isArray(c.ackEmails) ? c.ackEmails
            : Array.isArray(ackEmails?.[c.id]) ? ackEmails[c.id]
            : [];
          return ackList.map(e => String(e || '').toLowerCase()).includes(myEmail);
        };
    const inAud = (c) => matchesAudience(c.target, user?.team) || (c.author && c.author.email && c.author.email.toLowerCase() === myEmail);
    return comms.filter(c =>
      c.status === 'sent'
      && (c.type === 'announce' || c.type === 'alert' || c.type === 'guidance')
      && !isAcked(c)
      && inAud(c)
    ).length;
  }, [comms, ackEmails, isAckedByMeProp, user?.team, myEmail]);

  // ── Header KPIs — Health / Workload / SLA % / Resolved Today ──────────
  // Three signals an agent should see the moment they open Home:
  //   • SLA %  — non-Jira: (open − breached) / open. Anchors the
  //              "am I on top of my queue" feeling.
  //   • Workload band — Low / Med / High using the team-wide capacity
  //                     thresholds (lowMax / highMin) from app_settings.
  //   • Health — composite score 0-100 = 0.7 × SLA% + 0.3 × capacity-fit.
  //              Capacity fit = 100 when count is in the Low band, decays
  //              linearly to 0 at 2× highMin so a wildly overloaded agent
  //              still gets a non-negative score that drags Health down.
  //   • Resolved today — #tasks the agent closed since 00:00 local. Win
  //                       counter, reused on the right side of the header.
  const slaCompPct = useMemo(() => {
    const open = myRows.length + myTicketsForSla.length;
    if (open === 0) return 100;
    return Math.round(((open - tally.breached) / open) * 100);
  }, [myRows.length, myTicketsForSla.length, tally.breached]);

  const workloadBand = useMemo(() => {
    const n = tally.total;
    if (n < capLow)  return { label: 'Low',  color: '#15803d', bg: '#dcfce7' };
    if (n < capHigh) return { label: 'Med',  color: '#1f74b3', bg: '#e8f0fe' };
    return                  { label: 'High', color: '#d42d35', bg: '#ffe2de' };
  }, [tally.total, capLow, capHigh]);

  const healthScore = useMemo(() => {
    const cap = tally.total <= capLow
      ? 100
      : Math.max(0, 100 - Math.round(((tally.total - capLow) / Math.max(1, capHigh - capLow)) * 60));
    const composite = Math.round((slaCompPct * 0.7) + (cap * 0.3));
    return Math.max(0, Math.min(100, composite));
  }, [slaCompPct, tally.total, capLow, capHigh]);

  const healthTone = healthScore >= 80
    ? { color: '#15803d', bg: '#dcfce7' }
    : healthScore >= 50
      ? { color: '#ed8d00', bg: '#fff8e6' }
      : { color: '#d42d35', bg: '#ffe2de' };

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const todayLabel = useMemo(() => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), []);

  const goWorkspace = useCallback(() => setView?.('my-queue'), [setView]);

  return (
    <div style={{
      flex: 1, overflow: 'auto', background: '#fafaf9',
      padding: '20px 32px 64px',
    }}>
      {/* ── Greeting strip + KPI badges ─────────────────────────
          Mirrors the admin Briefing's top-right quartet so an agent
          opens the page and immediately reads their state:
          Health · Workload · SLA % · Resolved Today. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1b1b1b', letterSpacing: '-0.01em' }}>
            {greeting}, {myFirstName}.
          </div>
          <div style={{ fontSize: 13, color: '#616161', marginTop: 4 }}>
            {todayLabel}{user?.team ? ` · ${user.team}` : ''} · <strong style={{ color: '#1b1b1b' }}>{tally.total}</strong> open in your queue
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <KpiBadge
            label="Health"
            value={`${healthScore}`}
            color={healthTone.color}
            bg={healthTone.bg}
            sub={healthScore >= 80 ? 'Strong' : healthScore >= 50 ? 'Watch it' : 'At risk'}
          />
          <KpiBadge
            label="Workload"
            value={workloadBand.label}
            color={workloadBand.color}
            bg={workloadBand.bg}
            sub={`${tally.total} open`}
          />
          <KpiBadge
            label="SLA %"
            value={`${slaCompPct}%`}
            color={slaCompPct >= 90 ? '#15803d' : slaCompPct >= 70 ? '#ed8d00' : '#d42d35'}
            bg={slaCompPct >= 90 ? '#dcfce7' : slaCompPct >= 70 ? '#fff8e6' : '#ffe2de'}
            sub="Non-Jira"
          />
          <KpiBadge
            label="Resolved"
            value={`${myResolvedToday.length}`}
            color="#15803d"
            bg="#dcfce7"
            sub="today"
          />
          <button
            onClick={goWorkspace}
            style={{
              marginLeft: 4,
              padding: '8px 14px', borderRadius: 10,
              border: '1px solid #e8e8e8', background: 'white',
              color: '#1b1b1b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <i className="bi-collection-fill" style={{ fontSize: 11 }} />
            Open Workspace
          </button>
        </div>
      </div>

      {/* ── Pending acknowledgements carousel ──────────────────────────────
          The Priority of the Day banner lives on the Workspace landing,
          so we don't double up here. Instead, surface anything a comms
          author has just sent that this agent hasn't acked yet — the
          same single-banner carousel BriefingView's "Pending
          Acknowledgements" block uses, extracted into PendingAcksBanner.
          Self-hides when there's nothing to ack. */}
      <PendingAcksBanner user={user} comms={comms} setView={setView} isAckedByMe={isAckedByMeProp} noPadding />
      <div style={{ height: 16 }} aria-hidden />

      {/* ── Your SLA status — 3 big tiles ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <SlaTile
          label="Breached"
          eyebrow="ACTION NOW"
          color="#d42d35" bg="#ffe2de" icon="bi-x-circle-fill"
          count={tally.breached}
          subText={tally.breached === 0 ? 'Nothing breached — keep it that way.' : 'Pick the oldest first. Resolve or reassign.'}
          ctaLabel="Show breaches"
          onClick={() => setView?.('my-queue')}
          isSuccess={tally.breached === 0}
        />
        <SlaTile
          label="At risk"
          eyebrow="DON'T LET IT SLIP"
          color="#ed8d00" bg="#fff8e6" icon="bi-exclamation-circle-fill"
          count={tally.atRisk}
          subText={tally.atRisk === 0 ? 'Comfortable buffer on every item.' : '<25% of SLA window left. Tackle next.'}
          ctaLabel="Show at-risk"
          onClick={() => setView?.('my-queue')}
          isSuccess={tally.atRisk === 0}
        />
        <SlaTile
          label="On track"
          eyebrow="HEALTHY"
          color="#15803d" bg="#dcfce7" icon="bi-check-circle-fill"
          count={tally.ok}
          subText={
            tally.ok === 0
              ? 'No active items in your queue.'
              : (myTickets.some(t => t.source === 'jira'))
                ? 'Includes Jira (no SLA tracked here).'
                : 'Everything on this lane has runway.'
          }
          ctaLabel="Open Workspace"
          onClick={goWorkspace}
          isSuccess
        />
      </div>

      {/* ── Things waiting on you — HR Hub / Urgent Assist / Announcements ──
          The SLA tiles cover queue items; this strip surfaces inboxes
          that don't sit in any queue feed but matter to an agent's day.
          Each tile clicks through to its own view. Counts are best-effort
          via apiFetch — null shows "—", 0 shows "0" honestly. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <InboxTile
          icon="bi-clipboard-check-fill"
          color="#0e7490"
          label="HR Hub"
          hint="open requests you raised"
          count={hrHubMine}
          ctaLabel="Open HR Hub"
          onClick={() => setView?.('hr-hub')}
        />
        <InboxTile
          icon="bi-lightning-fill"
          color="#ed8d00"
          label="Urgent Assist"
          hint="open requests assigned to you"
          count={urgentMine}
          ctaLabel="Open Urgent Assist"
          onClick={() => setView?.('urgent-assist')}
        />
        <InboxTile
          icon="bi-megaphone-fill"
          color="#7c3aed"
          label="Announcements"
          hint="to acknowledge"
          count={unackedAnnouncements}
          ctaLabel="Open Announcements"
          onClick={() => setView?.('announcements')}
        />
      </div>

      {/* ── Two-column block: Focus list + Your queues ─────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 20, alignItems: 'start' }}>
        <div style={CARD}>
          <SectionHeader
            icon="bi-lightning-charge-fill"
            title="Your focus"
            subtitle="The 5 most-urgent items in your queue right now"
            chip={focusList.length > 0 ? `${focusList.length} of ${tally.breached + tally.atRisk}` : null}
            chipColor="#d42d35"
          />
          {focusList.length === 0 ? (
            <div style={{ padding: '36px 0', textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, margin: '0 auto 10px',
                background: '#dcfce7', color: '#15803d',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              }}>
                <i className="bi-check-circle-fill" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1b1b1b', marginBottom: 4 }}>
                You're caught up
              </div>
              <div style={{ fontSize: 12, color: '#9e9e9e' }}>
                Nothing breached or at risk. Help a teammate or pick the next item.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {focusList.map(row => <FocusRow key={`${row.kind}:${row.id}`} row={row} />)}
            </div>
          )}
        </div>

        <div style={CARD}>
          <SectionHeader
            icon="bi-collection-fill"
            title="Your queues"
            subtitle="Where your work lives — click to open"
            chip={null}
          />
          {sourcePills.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9e9e9e', fontSize: 12 }}>
              No active items in any source.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sourcePills.map(({ id, count, meta }) => (
                <button
                  key={id}
                  onClick={goWorkspace}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10,
                    border: '1px solid #f0efed', background: 'white',
                    cursor: 'pointer', fontSize: 13, color: '#1b1b1b',
                    textAlign: 'left', fontFamily: 'inherit',
                    transition: 'transform .12s, border-color .15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = meta?.color || '#1b1b1b'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#f0efed'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: meta?.bg || '#f3f3f3',
                    color: meta?.color || '#616161',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <i className={meta?.icon || 'bi-circle'} style={{ fontSize: 12 }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{meta?.label || id}</span>
                    {id === 'jira' && (
                      <span
                        title="Per spec: Jira breaches are excluded from the SLA tiles above. Click to open your Jira queue."
                        style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 700,
                          color: '#9e9e9e', background: '#f7f5f2',
                          padding: '1px 6px', borderRadius: 128,
                          letterSpacing: '0.04em', textTransform: 'uppercase',
                        }}
                      >
                        no breach count
                      </span>
                    )}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 800, color: meta?.color || '#1b1b1b',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{count}</span>
                  <i className="bi-arrow-right" style={{ fontSize: 11, color: '#9e9e9e' }} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Personal Checklist — full width ──────────────────────────────
          Resolved-today + workload now live in the header KPI badges, so
          the Progress Today block was redundant. PersonalChecklist gets
          the full width for clarity. */}
      <div>
        <PersonalChecklist user={user} variant="primary" />
      </div>

      {/* ── Footer hint ─────────────────────────────────────────── */}
      <div style={{
        marginTop: 24, padding: '10px 14px', borderRadius: 10,
        background: 'white', border: '1px solid #e8e8e8',
        fontSize: 11, color: '#616161',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <i className="bi-info-circle-fill" style={{ fontSize: 12, color: '#0e7490' }} />
        Agent home preview · ?view=agent-home · all numbers are live and scoped to your assignments only.
      </div>
    </div>
  );
}

const CARD = {
  background: 'white',
  border: '1px solid #e8e8e8',
  borderRadius: 14,
  padding: 16,
};

function SectionHeader({ icon, iconColor = '#1b1b1b', title, subtitle, chip, chipColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <i className={icon} style={{ fontSize: 14, color: iconColor }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1b1b1b', letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {chip && (
        <span style={{
          fontSize: 11, fontWeight: 700, color: chipColor || '#616161',
          background: chipColor ? `${chipColor}1a` : '#f7f5f2',
          padding: '3px 10px', borderRadius: 128, fontVariantNumeric: 'tabular-nums',
        }}>{chip}</span>
      )}
    </div>
  );
}

function SlaTile({ label, eyebrow, color, bg, icon, count, subText, ctaLabel, onClick, isSuccess }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: count > 0 || isSuccess ? bg : 'white',
        border: count > 0 || isSuccess ? `1.5px solid ${color}` : '1px solid #e8e8e8',
        borderRadius: 16,
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'transform .15s, box-shadow .15s',
        boxShadow: count > 0 ? `0 8px 24px -10px ${color}55` : '0 1px 2px rgba(0,0,0,0.02)',
        display: 'flex', flexDirection: 'column', gap: 4, minHeight: 150,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className={icon} style={{ fontSize: 16, color }} />
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
          color, textTransform: 'uppercase',
        }}>{eyebrow}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1b1b1b', marginTop: 4 }}>{label}</div>
      <div style={{
        fontSize: 38, fontWeight: 800, lineHeight: 1, color,
        fontVariantNumeric: 'tabular-nums', marginTop: 6,
      }}>{count}</div>
      <div style={{ fontSize: 12, color: '#616161', marginTop: 6, lineHeight: 1.4 }}>{subText}</div>
      <div style={{ flex: 1 }} />
      <div style={{
        marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 700, color,
      }}>
        {ctaLabel}
        <i className="bi-arrow-right" style={{ fontSize: 10 }} />
      </div>
    </button>
  );
}

function FocusRow({ row }) {
  const meta = TOOLS[row.source] || { label: row.source, color: '#616161', bg: '#f3f3f3', icon: 'bi-circle' };
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '90px 1fr auto auto',
      gap: 12, alignItems: 'center', padding: '10px 4px',
      borderTop: '1px solid #f5f5f4', fontSize: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 128,
        background: meta.bg, color: meta.color,
        fontSize: 10, fontWeight: 700,
      }}>
        <i className={meta.icon} style={{ fontSize: 9 }} />
        {meta.label}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.subject}
        </div>
        <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 2 }}>
          {row.country ? `${row.country} · ` : ''}{row.clientName || row.id}
        </div>
      </div>
      {row.sev === 'breached' ? (
        <span style={{
          fontSize: 11, fontWeight: 800, color: '#d42d35',
          background: '#ffe2de', padding: '2px 8px', borderRadius: 128,
          fontVariantNumeric: 'tabular-nums',
        }}>
          +{fmtDuration(row.overdueSecs)} overdue
        </span>
      ) : (
        <span style={{
          fontSize: 11, fontWeight: 800, color: '#ed8d00',
          background: '#fff8e6', padding: '2px 8px', borderRadius: 128,
        }}>
          At risk
        </span>
      )}
      {row.taskUrl ? (
        <a
          href={row.taskUrl}
          target="_blank" rel="noopener noreferrer"
          style={{
            padding: '4px 10px', borderRadius: 8,
            border: '1px solid #e8e8e8', background: 'white',
            color: '#1b1b1b', fontSize: 11, fontWeight: 700,
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          Open
          <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }} />
        </a>
      ) : <span />}
    </div>
  );
}

// ── KpiBadge — small header pill for Health / Workload / SLA / Resolved ──
function KpiBadge({ label, value, sub, color, bg }) {
  return (
    <div
      style={{
        minWidth: 78,
        padding: '8px 12px', borderRadius: 12,
        background: bg, border: `1px solid ${color}33`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', gap: 1,
      }}
      title={`${label}${sub ? ` — ${sub}` : ''}`}
    >
      <span style={{ fontSize: 9, fontWeight: 700, color: '#616161', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 9, fontWeight: 600, color: '#9e9e9e' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

// ── InboxTile — for the "Things waiting on you" strip ────────────────
function InboxTile({ icon, color, label, hint, count, ctaLabel, onClick }) {
  // null = real fetch failure → show '—' so the agent knows the count
  // is unavailable. 0 = loaded, empty → show 0 honestly.
  const display = count == null ? '—' : count;
  const isHot = typeof count === 'number' && count > 0;
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 16px', borderRadius: 14,
        border: isHot ? `1.5px solid ${color}` : '1px solid #e8e8e8',
        background: isHot ? `${color}0d` : 'white',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: isHot ? `0 6px 16px -8px ${color}55` : 'none',
        transition: 'transform .12s, box-shadow .15s',
        minHeight: 76,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: isHot ? `${color}1f` : '#f7f5f2', color,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <i className={icon} style={{ fontSize: 16 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: '#9e9e9e', marginTop: 2 }}>{hint}</div>}
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {ctaLabel}
          <i className="bi-arrow-right" style={{ fontSize: 10 }} />
        </div>
      </div>
      <div style={{
        fontSize: 28, fontWeight: 800, lineHeight: 1,
        color: isHot ? color : '#9e9e9e',
        minWidth: 36, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>{display}</div>
    </button>
  );
}
