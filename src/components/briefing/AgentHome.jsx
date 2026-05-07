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
    // Rolling 24h window (per user request 2026-05-07). Was previously
    // anchored on local midnight, which collapsed the count to 0 every
    // morning and made "resolved today" useless for someone reviewing
    // overnight closes. The window matches the upstream limits we
    // already pull (Zendesk solved updated<24hours; deel-api workbench
    // includeCompleted lookback 24h) so we never paint a partial picture.
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    // Zendesk + Jira from the unified `tasks` array. The queue route
    // already pulls solved-within-24h Zendesk tickets; this filter narrows
    // to the rolling cutoff and the current viewer.
    const ticketResolved = (tasks || [])
      .filter(t => (t.assigneeEmail || '').toLowerCase() === myEmail)
      .filter(t => t.status === 'resolved')
      .map(t => {
        const ms = (() => {
          const d = t.updatedAt || t.resolvedAt;
          return d ? new Date(d).getTime() : 0;
        })();
        return { row: t, ms, source: t.source || 'zendesk', kind: 'ticket' };
      })
      .filter(x => x.ms >= cutoffMs);
    // Workbench — server pulls COMPLETED rows within the last 24h via
    // deel-api.listWorkbenchTasks(includeCompleted=true). Read the RAW
    // `wb.tasks` (not the normalised SourceTable rows) because
    // normalizeWorkbench replaces t.status with a display-object — counting
    // resolved on that loses the raw bucket. Hala El Khalfaoui's 2026-05-07
    // feedback: "the resolved cases on the top right of the Hub doesn't
    // reflect the resolved cases that I worked on." She works mostly on
    // Workbench, which the previous tasks-only count silently dropped.
    const wbResolved = (wb.tasks || [])
      .filter(t => (t?.assignee?.email || '').toLowerCase() === myEmail)
      .filter(t => String(t?.status || '').toUpperCase() === 'COMPLETED')
      .map(t => {
        const ms = (() => {
          const d = t.completedAt || t.updatedAt;
          return d ? new Date(d).getTime() : 0;
        })();
        return { row: t, ms, source: 'workbench', kind: 'workbench' };
      })
      .filter(x => x.ms >= cutoffMs);
    return [...ticketResolved, ...wbResolved].sort((a, b) => b.ms - a.ms);
  }, [tasks, wb.tasks, myEmail]);

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
  const [resolvedListOpen, setResolvedListOpen] = useState(false);

  // Region label for the hero meta line — same source BriefingView reads
  // (`user.region`). For agents it's frequently empty; fall back to team
  // so the line still carries a locator instead of a bare date.
  const localityLine = useMemo(() => {
    const parts = [todayLabel];
    if (user?.region) parts.push(user.region);
    else if (user?.team) parts.push(user.team);
    return parts.join(' · ');
  }, [todayLabel, user?.region, user?.team]);

  // Total tracked items in the SLA tiles (Breached + At-risk + On-track) —
  // matches `tally.total` since every open assignment lands in one bucket.
  const slaTracked = tally.total;

  return (
    <div style={{
      flex: 1, overflow: 'auto', background: '#fafaf9',
      padding: '24px 32px 80px',
    }}>
      {/* Inline responsive grid rules — Workspace uses the same pattern.
          We can't put media queries in inline `style={{}}`, so the
          breakpoint logic for the 3-up + 2-col blocks lives here. */}
      <style>{`
        .agent-home-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .agent-home-grid-2col { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; align-items: start; }
        .agent-home-hero { display: flex; gap: 28px; align-items: stretch; flex-wrap: wrap; }
        .agent-home-hero-left { flex: 1 1 360px; min-width: 0; }
        .agent-home-hero-right { display: flex; flex-direction: column; gap: 12px; align-items: stretch; min-width: 0; }
        .agent-home-kpi-row { display: grid; grid-template-columns: repeat(4, minmax(72px, 96px)); gap: 8px; }
        @media (max-width: 1100px) {
          .agent-home-hero-right { align-items: stretch; flex: 1 1 100%; }
          .agent-home-kpi-row { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        @media (max-width: 980px) {
          .agent-home-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .agent-home-grid-2col { grid-template-columns: 1fr; }
        }
        @media (max-width: 720px) {
          .agent-home-grid-3 { grid-template-columns: 1fr; }
          .agent-home-kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>

      {/* ── Hero — Greeting + KPIs + Open Workspace ───────────────────
          Mirrors the Workspace "Priority of the Day" hero (same dark
          purple radial gradient + decorative grain/glows) so the two
          landings feel like the same product. Personalised for the
          agent: greeting + day/region + N-open, plus the four KPI
          badges and the Open Workspace CTA. */}
      <div style={{
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        background: 'radial-gradient(circle at 0% 0%, #2d1b69 0%, #1a103f 35%, #0e0628 70%, #050211 100%)',
        boxShadow: '0 20px 60px -20px rgba(45, 27, 105, 0.55), 0 8px 24px -8px rgba(0,0,0,0.25)',
        marginBottom: 28,
      }}>
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage:
            'radial-gradient(800px 320px at 12% -10%, rgba(124,58,237,0.55), transparent 60%),' +
            'radial-gradient(700px 360px at 92% 110%, rgba(236,72,153,0.32), transparent 65%),' +
            'radial-gradient(500px 240px at 68% 0%, rgba(56,189,248,0.18), transparent 70%)',
        }} />
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.06,
          backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'140\' height=\'140\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\'/><feColorMatrix values=\'0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0\'/></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\'/></svg>")',
        }} />

        <div className="agent-home-hero" style={{ position: 'relative', padding: '28px 36px 32px', color: 'white' }}>
          <div className="agent-home-hero-left">
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 128,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 12px #34d399' }} />
              {greeting}
            </div>
            <h1 style={{
              fontSize: 36, fontWeight: 800, letterSpacing: '-0.015em',
              lineHeight: 1.1, margin: '14px 0 0',
              background: 'linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.78) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              {greeting}, {myFirstName}.
            </h1>
            <div style={{
              fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.75)',
              margin: '12px 0 0',
            }}>
              {localityLine} · <strong style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{tally.total}</strong> open in your queue
            </div>
          </div>

          <div className="agent-home-hero-right">
            <div className="agent-home-kpi-row">
              <KpiBadgeGlass
                label="Health"
                value={`${healthScore}`}
                color={healthTone.color}
                sub={healthScore >= 80 ? 'Strong' : healthScore >= 50 ? 'Watch it' : 'At risk'}
              />
              <KpiBadgeGlass
                label="Workload"
                value={workloadBand.label}
                color={workloadBand.color}
                sub={`${tally.total} open`}
              />
              <KpiBadgeGlass
                label="SLA %"
                value={`${slaCompPct}%`}
                color={slaCompPct >= 90 ? '#34d399' : slaCompPct >= 70 ? '#fbbf24' : '#fb7185'}
                sub="Non-Jira"
              />
              <KpiBadgeGlass
                label="Resolved"
                value={`${myResolvedToday.length}`}
                color="#34d399"
                sub="past 24h"
                onClick={myResolvedToday.length > 0 ? () => setResolvedListOpen(true) : null}
              />
            </div>
            <button
              onClick={goWorkspace}
              style={{
                alignSelf: 'flex-end',
                padding: '9px 16px', borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
                color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                backdropFilter: 'blur(6px)',
                transition: 'background .15s, transform .12s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <i className="bi-collection-fill" style={{ fontSize: 11 }} />
              Open Workspace
            </button>
          </div>
        </div>
      </div>

      {/* ── Pending acknowledgements carousel ──────────────────────────
          Surfaces anything a comms author has sent that this agent hasn't
          acked yet. Self-hides when nothing's pending. */}
      <PendingAcksBanner user={user} comms={comms} setView={setView} isAckedByMe={isAckedByMeProp} noPadding />
      <div style={{ height: 12 }} aria-hidden />

      {/* ── Your SLA status section ──────────────────────────────────── */}
      <SectionTitle
        title="Your SLA status"
        hint="Your assignments only · Jira excluded per spec"
        rightPill={`${slaTracked.toLocaleString()} ${slaTracked === 1 ? 'item tracked' : 'items tracked'}`}
      />
      <div className="agent-home-grid-3" style={{ marginBottom: 24 }}>
        <SlaTile
          eyebrow="ACTION NOW"
          label="Breached"
          color="#d42d35"
          accent="linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)"
          bgLight="#fff1f2"
          icon="bi-x-octagon-fill"
          count={tally.breached}
          subText={tally.breached === 0 ? 'Nothing breached — keep it that way.' : 'Pick the oldest first.'}
          ctaLabel={tally.breached === 0 ? 'All clear' : 'Show breaches'}
          ctaDisabledOk={tally.breached === 0}
          onClick={() => {
            // Tell the Queue to apply the breached filter on landing —
            // the Queue listens for this event and clears conflicting
            // filters so the user actually sees their breaches, including
            // the per-source hand-off panel for Deel-source breaches.
            try { window.dispatchEvent(new CustomEvent('queue:setSlaFilter', { detail: { sla: 'breached' } })); } catch (_) {}
            setView?.('my-queue');
          }}
        />
        <SlaTile
          eyebrow="DON'T LET SLIP"
          label="At risk"
          color="#ed8d00"
          accent="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
          bgLight="#fff8e6"
          icon="bi-exclamation-triangle-fill"
          count={tally.atRisk}
          subText={tally.atRisk === 0 ? 'Comfortable buffer on every item.' : '<25% of SLA window left.'}
          ctaLabel="Show at-risk"
          onClick={() => {
            try { window.dispatchEvent(new CustomEvent('queue:setSlaFilter', { detail: { sla: 'at_risk' } })); } catch (_) {}
            setView?.('my-queue');
          }}
        />
        <SlaTile
          eyebrow="HEALTHY"
          label="On track"
          color="#15803d"
          accent="linear-gradient(135deg, #29811e 0%, #16a34a 100%)"
          bgLight="#dcfce7"
          icon="bi-check-circle-fill"
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
        />
      </div>

      {/* ── Things waiting on you ───────────────────────────────────── */}
      <SectionTitle
        title="Things waiting on you"
        hint="Inboxes outside the queue feeds"
      />
      <div className="agent-home-grid-3" style={{ marginBottom: 24 }}>
        <InboxTile
          icon="bi-clipboard-check-fill"
          color="#0e7490"
          accent="linear-gradient(135deg, #0369a1 0%, #0e7490 100%)"
          bgLight="#ecfeff"
          label="HR Hub"
          hint="open requests you raised"
          count={hrHubMine}
          ctaLabel="Open HR Hub"
          onClick={() => setView?.('hr-hub')}
        />
        <InboxTile
          icon="bi-lightning-fill"
          color="#ed8d00"
          accent="linear-gradient(135deg, #f59e0b 0%, #ed8d00 100%)"
          bgLight="#fff8e6"
          label="Urgent Assist"
          hint="open requests assigned to you"
          count={urgentMine}
          ctaLabel="Open Urgent Assist"
          onClick={() => setView?.('urgent-assist')}
        />
        <InboxTile
          icon="bi-megaphone-fill"
          color="#7c3aed"
          accent="linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
          bgLight="#f3eff8"
          label="Announcements"
          hint="to acknowledge"
          count={unackedAnnouncements}
          ctaLabel="Open Announcements"
          onClick={() => setView?.('announcements')}
        />
      </div>

      {/* ── Two-column: Your focus + Your queues ───────────────────── */}
      <div className="agent-home-grid-2col" style={{ marginBottom: 24 }}>
        <div style={CARD}>
          <CardHeader
            title="Your focus"
            subtitle="Top 5 most-urgent items"
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
          <CardHeader
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
                    flexShrink: 0,
                  }}>
                    <i className={meta?.icon || 'bi-circle'} style={{ fontSize: 12 }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{meta?.label || id}</span>
                    {id === 'jira' && (
                      <span
                        title="Per spec: Jira breaches are excluded from the SLA tiles above. Click to open your Jira queue."
                        style={{
                          fontSize: 9, fontWeight: 700,
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
                    fontSize: 14, fontWeight: 800, color: meta?.color || '#1b1b1b',
                    fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right',
                  }}>{count}</span>
                  <i className="bi-arrow-right" style={{ fontSize: 11, color: '#9e9e9e' }} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Personal Checklist — full width ────────────────────────── */}
      <div>
        <PersonalChecklist user={user} variant="primary" />
      </div>

      {/* ── Footer hint ─────────────────────────────────────────────── */}
      <div style={{
        marginTop: 24, padding: '12px 16px', borderRadius: 12,
        background: 'white', border: '1px solid #e8e8e8',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 12, color: '#616161',
      }}>
        <i className="bi-info-circle-fill" style={{ fontSize: 13, color: '#0e7490' }} />
        <span>Click any card to jump straight in. All numbers are live and scoped to your assignments only.</span>
        <span style={{ flex: 1 }} />
        {user?.email && (
          <span style={{ color: '#9e9e9e' }}>Signed in as <strong style={{ color: '#1b1b1b' }}>{user.name || user.email}</strong></span>
        )}
      </div>
      {resolvedListOpen && (
        <ResolvedTodayModal items={myResolvedToday} onClose={() => setResolvedListOpen(false)} />
      )}
    </div>
  );
}

const CARD = {
  background: 'white',
  border: '1px solid #e8e8e8',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
};

// Page-level section title — sits between major blocks (e.g. "Your SLA
// status") and mirrors WorkspaceHome's "How to work your queues today"
// row: bold title + grey hint + right-aligned counter pill.
function SectionTitle({ title, hint, rightPill }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12, padding: '0 4px' }}>
      <h2 style={{
        fontSize: 18, fontWeight: 800, color: '#1b1b1b',
        letterSpacing: '-0.01em', margin: 0,
      }}>{title}</h2>
      {hint && (
        <span style={{ fontSize: 12, color: '#9e9e9e', fontWeight: 500 }}>
          {hint}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {rightPill && (
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#616161',
          background: 'white', border: '1px solid #e8e8e8',
          padding: '4px 10px', borderRadius: 128,
          fontVariantNumeric: 'tabular-nums',
        }}>{rightPill}</span>
      )}
    </div>
  );
}

// Card-internal header — used inside the Focus / Queues cards. Smaller
// than SectionTitle and stacks the title above the subtitle, matching
// the existing AgentHome rhythm.
function CardHeader({ title, subtitle, chip, chipColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1b1b1b', letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>{subtitle}</div>}
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

// SlaTile — Workspace step-card aesthetic. White background; 4-px
// gradient bar at the top carries the colour signal. Soft accent shadow
// + border tint on hover. When the count is 0 AND `ctaDisabledOk` is
// set, the tile renders an "all clear" state (green check + text)
// instead of the action CTA so the agent gets a clear positive signal.
function SlaTile({ label, eyebrow, color, accent, bgLight, icon, count, subText, ctaLabel, ctaDisabledOk = false, onClick }) {
  const isAllClear = ctaDisabledOk && count === 0;
  return (
    <button
      onClick={isAllClear ? undefined : onClick}
      style={{
        position: 'relative',
        textAlign: 'left',
        background: 'white',
        border: '1px solid #e8e8e8',
        borderRadius: 18,
        padding: '20px 18px 16px',
        cursor: isAllClear ? 'default' : 'pointer',
        overflow: 'hidden',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        display: 'flex', flexDirection: 'column',
        minHeight: 168,
        opacity: isAllClear ? 0.94 : 1,
      }}
      onMouseEnter={(e) => {
        if (isAllClear) return;
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = `0 12px 30px -10px ${color}40, 0 4px 12px -4px rgba(0,0,0,0.08)`;
        e.currentTarget.style.borderColor = `${color}55`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
        e.currentTarget.style.borderColor = '#e8e8e8';
      }}
    >
      {/* Top accent bar (4px) — matches WorkspaceHome.StepCard */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: accent,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
          color, textTransform: 'uppercase',
        }}>{eyebrow}</span>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: bgLight, color,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className={icon} style={{ fontSize: 14 }} />
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#1b1b1b', letterSpacing: '-0.01em', marginBottom: 4, lineHeight: 1.2 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#616161', lineHeight: 1.45, marginBottom: 12, minHeight: 32 }}>{subText}</div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{
          fontSize: 32, fontWeight: 800, lineHeight: 1,
          color: isAllClear ? '#15803d' : (count > 0 ? color : '#1b1b1b'),
          fontVariantNumeric: 'tabular-nums',
        }}>
          {isAllClear ? '✓' : count.toLocaleString()}
        </span>
      </div>
      <div style={{
        marginTop: 4,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 700,
        color: isAllClear ? '#15803d' : color,
      }}>
        {isAllClear ? (
          <>
            <i className="bi-check-circle-fill" style={{ fontSize: 12 }} />
            {ctaLabel}
          </>
        ) : (
          <>
            {ctaLabel}
            <i className="bi-arrow-right" style={{ fontSize: 12 }} />
          </>
        )}
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

// ── KpiBadgeGlass — KPI mini-card sized for the dark hero. White text
// on a glass / blurred background; the saturated `color` is reserved
// for the value so the four badges read as a quartet rather than a
// rainbow. Light-mode accessible (white on dark gradient) and dark-mode
// neutral (the hero is intentionally always dark).
function KpiBadgeGlass({ label, value, sub, color, onClick }) {
  // Render a button when onClick is supplied so the tile gets keyboard
  // focus + screen-reader semantics; otherwise stay as a presentational
  // <div> (the other three KPIs aren't drillable).
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick || undefined}
      type={onClick ? 'button' : undefined}
      style={{
        position: 'relative',
        padding: '8px 12px 9px', borderRadius: 12,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.14)',
        backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', gap: 1,
        overflow: 'hidden',
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background .12s, transform .12s',
      }}
      title={onClick ? `${label}${sub ? ` — ${sub}` : ''} (click to view)` : `${label}${sub ? ` — ${sub}` : ''}`}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
    >
      <span style={{
        fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 22, fontWeight: 800, color, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums', marginTop: 2,
        textShadow: '0 1px 2px rgba(0,0,0,0.25)',
      }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>
          {sub}
        </span>
      )}
    </Tag>
  );
}

// ── ResolvedTodayModal — popover list of tasks the viewer resolved
// today (Zendesk + Jira tickets + Workbench tasks). Triggered from the
// Resolved KPI tile on the AgentHome hero. Each row links to the
// upstream system so the agent can drill into the original record.
function ResolvedTodayModal({ items, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        width: 'min(640px, 100%)', maxHeight: '80vh',
        background: 'var(--surface)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Resolved · past 24h</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {items.length} item{items.length === 1 ? '' : 's'} closed in the last 24 hours
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Nothing resolved in the last 24 hours.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((entry, idx) => {
                const t = entry.row || {};
                const subject = t.subject || t.name || '(no subject)';
                const url = entry.kind === 'ticket'
                  ? getUrl(t)
                  : (t.id ? `https://admin.deel.network/ops-workbench/${t.id}` : null);
                const ts = entry.ms ? new Date(entry.ms) : null;
                const timeLabel = ts ? ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                const sourceLabel = entry.source === 'zendesk' ? 'Zendesk'
                  : entry.source === 'jira' ? 'Jira'
                  : entry.source === 'workbench' ? 'Workbench'
                  : entry.source;
                return (
                  <li key={`${entry.kind}-${t.id || idx}`} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <a
                      href={url || '#'}
                      target={url ? '_blank' : undefined}
                      rel={url ? 'noreferrer noopener' : undefined}
                      onClick={url ? undefined : (e) => e.preventDefault()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 20px',
                        textDecoration: 'none', color: 'var(--text)',
                        transition: 'background .12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{
                        flex: '0 0 auto', width: 8, height: 8, borderRadius: '50%',
                        background: '#15803d',
                      }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {subject}
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {sourceLabel}{timeLabel ? ` · resolved ${timeLabel}` : ''}
                        </span>
                      </span>
                      {url && <i className="bi-box-arrow-up-right" style={{ fontSize: 12, color: 'var(--text-muted)' }} />}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── InboxTile — Workspace step-card aesthetic, same column rhythm as
// the SLA tiles above so the two 3-up rows feel like one block. White
// background with 4-px gradient bar at the top; eyebrow + icon row,
// title + hint, then big tabular count + CTA at the bottom. `count==null`
// (real fetch failure) renders as `—`; `0` renders as a literal 0 so
// the agent isn't told "—" when we know the inbox is empty.
function InboxTile({ icon, color, accent, bgLight, label, hint, count, ctaLabel, onClick }) {
  const isPending = count == null;
  const display = isPending ? '—' : count.toLocaleString();
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: '20px 18px 16px',
        borderRadius: 18,
        border: '1px solid #e8e8e8',
        background: 'white',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        minHeight: 168,
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = `0 12px 30px -10px ${color}40, 0 4px 12px -4px rgba(0,0,0,0.08)`;
        e.currentTarget.style.borderColor = `${color}55`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
        e.currentTarget.style.borderColor = '#e8e8e8';
      }}
    >
      {accent && (
        <div aria-hidden style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: accent,
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: bgLight || '#f7f5f2', color,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <i className={icon} style={{ fontSize: 14 }} />
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#1b1b1b', letterSpacing: '-0.01em', marginBottom: 4, lineHeight: 1.2 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#616161', lineHeight: 1.45, marginBottom: 12, minHeight: 32 }}>{hint}</div>}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{
          fontSize: 32, fontWeight: 800, lineHeight: 1,
          color: !isPending && count > 0 ? color : '#9e9e9e',
          fontVariantNumeric: 'tabular-nums',
        }}>{display}</span>
      </div>
      <div style={{
        marginTop: 4,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 700, color,
      }}>
        {ctaLabel}
        <i className="bi-arrow-right" style={{ fontSize: 12 }} />
      </div>
    </button>
  );
}
