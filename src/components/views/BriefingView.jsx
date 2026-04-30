import { useState, useMemo, useEffect, useRef, useContext, useCallback } from 'react';
import { TOOLS, STATUSES, FUNCTIONS, FLAGS } from '../../data/constants';
import { MEMBERS, TEAM_MEMBERS } from '../../data/members';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { matchesAudience } from '../../data/comms';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import { CALENDAR_EVENTS } from '../../data/calendar';
import { slaInfo, rel, getVisibleEmails } from '../../utils/helpers';
import { useOnboardingData } from '../../hooks/useOnboardingData';
import { usePausedOnboardingData } from '../../hooks/usePausedOnboardingData';
import { useOffboardingData } from '../../hooks/useOffboardingData';
import { useChangeRequestData } from '../../hooks/useChangeRequestData';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import { useIncentivePlansData } from '../../hooks/useIncentivePlansData';
import { useQueueSlaSettings } from '../../hooks/useQueueSlaSettings';
import { useCapacitySettings } from '../../hooks/useCapacitySettings';
import { elapsedBizMinutes } from '../../utils/bizTime';
import {
  normalizeOnboarding,
  normalizePausedOnboarding,
  normalizeOffboarding,
  normalizeAmendments,
  normalizeRedlines,
  normalizeWorkbench,
  normalizeIncentivePlans,
} from '../../utils/normalizeSourceRows';
// Authoritative Queue scoping — same functions Queue.jsx uses so Briefing counts
// match what the user actually sees in each source table (incl. country-owner
// visibility for onboarding/offboarding/amendments/redlines).
import {
  scopeOnboardingPeople,
  scopeOffboardingCases,
  scopeAmendmentRequests,
  scopeRedlineRequests,
  scopeWorkbenchTasks,
  scopeIncentivePlans,
} from '../../lib/queue-scoping';
import Avatar from '../ui/Avatar';
import { ToolBadge, FnBadge } from '../ui/Badges';
import PersonalChecklist from '../home/PersonalChecklist';
import OOOAlert from '../home/OOOAlert';
import TeamRequestsToMe from '../home/TeamRequestsToMe';
import DailySummary from '../home/DailySummary';
import StaleTickets from '../home/StaleTickets';
import ApproachingBreach from '../home/ApproachingBreach';

const SOURCE_COLOURS = {
  gmail: '#ea4335', zendesk: '#03363d', jira: '#0052cc',
  workbench: 'var(--purple)', looker: '#4285f4',
  slack: '#611f69', calendar: '#1967d2',
  onboarding: '#7c3aed', offboarding: '#d42d35',
  amendments: '#ed8d00', redlines: '#7c3aed',
};

const BriefingView=({user,tasks,setView,setSelTask,comms=[],escalations=[],setSubFilter,requests=[],projects=[],managerOnCall=null,onChangeManagerOnCall})=>{
  // Live roster for the Manager-on-call picker so admins see managers added
  // via the Team tab (not just the baked-in baseline). Filter out
  // soft-deleted rows so we don't offer to impersonate a disabled account.
  const { members: liveMembers } = useTeamMembers();
  const mocCandidates = useMemo(() => (liveMembers || TEAM_MEMBERS)
    .filter(m => !m.isDeleted)
    .filter(m => m.access === 'team_lead' || m.access === 'regional_manager' || m.access === 'admin'),
    [liveMembers]);
  // Drift-proof ack check — matches Announcements view + App.jsx. Local
  // MEMBERS.id is an array-position index that collides with DB members.id
  // values. When the server gives us `ackEmails` (our source of truth) we
  // trust email matching exclusively — no id fallback. OR-ing id into the
  // check was what made Mohamed + Alaetra appear acked on every announcement
  // (their MEMBERS indices collided with actual DB ids of real ackers).
  const myAckEmail = (user?.email || '').toLowerCase();
  const isAckedByMe = (c) => {
    if (!c) return false;
    if (Array.isArray(c.ackEmails)) {
      return !!(myAckEmail && c.ackEmails.includes(myAckEmail));
    }
    // Legacy fallback — only reached if the API payload lacks ackEmails.
    if (Array.isArray(c.acks) && c.acks.includes(user?.id)) return true;
    return false;
  };
  const [expandedSource,setExpandedSource]=useState(null);
  const [expandedSla,setExpandedSla]=useState(null);
  const [ackBannerIdx,setAckBannerIdx]=useState(0);
  const [showHealthBreakdown,setShowHealthBreakdown]=useState(false);
  const [healthPopoverPos,setHealthPopoverPos]=useState(null);
  const [startDatesExpanded,setStartDatesExpanded]=useState(true);
  const [onLeaveEmails] = useState(() => {
    try {
      const stored = localStorage.getItem('ops_hub_on_leave');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch(e) { return new Set(); }
  });
  const healthBreakdownRef=useRef(null);
  // Manager-on-call picker lives here now (moved out of the top nav).
  // Click-outside closes the dropdown; we scope it to a ref on the pill
  // wrapper so clicking the edit button inside still toggles cleanly.
  const [showMocPicker,setShowMocPicker]=useState(false);
  const mocRef=useRef(null);
  useEffect(()=>{
    if(!showMocPicker)return;
    const onDocClick=(e)=>{
      if(mocRef.current&&!mocRef.current.contains(e.target)) setShowMocPicker(false);
    };
    document.addEventListener('mousedown',onDocClick);
    return ()=>document.removeEventListener('mousedown',onDocClick);
  },[showMocPicker]);
  const now=new Date();
  const hour=now.getHours();
  const greeting=hour<12?'Good Morning':hour<17?'Good Afternoon':'Good Evening';
  const emoji=hour<12?'\u2600\uFE0F':hour<17?'\uD83C\uDF24\uFE0F':'\uD83C\uDF19';
  const dateStr=now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const timeStr=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const firstName=user.name.split(' ')[0];

  // ── Click-outside for health breakdown ───────────────────────────────
  useEffect(()=>{
    if(!showHealthBreakdown)return;
    const h=e=>{if(healthBreakdownRef.current&&!healthBreakdownRef.current.contains(e.target)){setShowHealthBreakdown(false);}};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[showHealthBreakdown]);

  // ── Keep health popover anchored during scroll / resize ──────────────
  useEffect(()=>{
    if(!showHealthBreakdown)return;
    const recompute=()=>{
      const r=healthBreakdownRef.current?.getBoundingClientRect();
      if(r)setHealthPopoverPos({top:Math.round(r.bottom+8),right:Math.max(8,Math.round(window.innerWidth-r.right))});
    };
    recompute();
    window.addEventListener('resize',recompute);
    window.addEventListener('scroll',recompute,true);
    return()=>{window.removeEventListener('resize',recompute);window.removeEventListener('scroll',recompute,true);};
  },[showHealthBreakdown]);

  // ── PERMISSIONS-BASED SCOPE ──────────────────────────────────────────
  const perms=useContext(PermissionsContext);
  const settings=useContext(SettingsContext);
  const { deelData, jiraData, slackData } = useContext(IntegrationsContext);

  // ── Deel API hooks (onboarding, offboarding, amendments/redlines, workbench) ──
  const onboardingData = useOnboardingData(true);
  const pausedOnboardingData = usePausedOnboardingData(true);
  const offboardingData = useOffboardingData(true);
  const changeRequestData = useChangeRequestData(true);
  const workbenchData = useWorkbenchData(true);
  const incentivePlansData = useIncentivePlansData(true);

  const ds=perms?.dataScope||'own_tasks_only';
  const isOwnScope=ds==='own_tasks_only';
  const isTeamScope=ds==='team_tasks';
  const isAllScope=ds==='all_tasks';
  const isManager=!isOwnScope;
  const isExec=isAllScope;
  const scopeMembers=perms?.scopeMembers(MEMBERS)||[user];
  const scopeIds=scopeMembers.map(m=>m.id);
  const scopeLabel=isOwnScope?'My Queue':isTeamScope?(user.team+' Team'):'Organization';
  const roleLabel=perms?.accessTypeName||'Agent';

  // ── ALL tasks across entire org (for exec summary) ────────────────────
  const allOrgTasks=tasks;
  const orgOpen=allOrgTasks.filter(t=>t.status!=='resolved');
  const orgResolved=allOrgTasks.filter(t=>t.status==='resolved');

  // ── Scoped metrics (hierarchical: own + direct/indirect reports) ────
  const visibleEmails = useMemo(() => getVisibleEmails(user?.email), [user?.email]);

  // ── Deel API normalized rows (same pattern as Queue.jsx) ─────────────
  // Pass the team-tunable SLA thresholds so per-row pills + Briefing
  // aggregates reflect whatever the Director / RM has set on the Team-tab
  // SLA table. Falls back to the spec defaults baked into the normalizer
  // until the hook resolves.
  const { sla: queueSla } = useQueueSlaSettings();
  const onboardingRowsAll = useMemo(() => normalizeOnboarding(onboardingData.items, queueSla), [onboardingData.items, queueSla]);
  const pausedOnboardingRowsAll = useMemo(() => normalizePausedOnboarding(pausedOnboardingData.items, queueSla), [pausedOnboardingData.items, queueSla]);
  const offboardingRowsAll = useMemo(() => normalizeOffboarding(offboardingData.items, queueSla), [offboardingData.items, queueSla]);
  const amendmentRowsAll = useMemo(() => normalizeAmendments(changeRequestData.amendments, queueSla), [changeRequestData.amendments, queueSla]);
  const redlineRowsAll = useMemo(() => normalizeRedlines(changeRequestData.redlines, queueSla), [changeRequestData.redlines, queueSla]);
  const workbenchRowsAll = useMemo(() => normalizeWorkbench(workbenchData.tasks, queueSla), [workbenchData.tasks, queueSla]);
  const incentivePlanRowsAll = useMemo(() => normalizeIncentivePlans(incentivePlansData.items, queueSla), [incentivePlansData.items, queueSla]);

  // Source-row scoping — delegate to the Queue's single source of truth so
  // "Active Requests" here always matches what the user sees in each tab.
  //   • Onboarding / Offboarding / Amendments / Redlines use country-OR-assignee
  //     (a country owner sees their region's rows even without direct assignment).
  //   • Workbench is assignee-only (admin bypasses).
  // Admins/directors (isAllScope) short-circuit through these functions, so
  // they see everything — exec totals roll up correctly.
  const onboardingRows = useMemo(() => scopeOnboardingPeople(onboardingRowsAll, user), [onboardingRowsAll, user]);
  const offboardingRows = useMemo(() => scopeOffboardingCases(offboardingRowsAll, user), [offboardingRowsAll, user]);
  const amendmentRows = useMemo(() => scopeAmendmentRequests(amendmentRowsAll, user), [amendmentRowsAll, user]);
  const redlineRows = useMemo(() => scopeRedlineRequests(redlineRowsAll, user), [redlineRowsAll, user]);
  const workbenchRows = useMemo(() => scopeWorkbenchTasks(workbenchRowsAll, user), [workbenchRowsAll, user]);
  const incentivePlanRows = useMemo(() => scopeIncentivePlans(incentivePlanRowsAll, user), [incentivePlanRowsAll, user]);

  const inScope = useCallback(t => {
    if (scopeIds.includes(t.assigneeId)) return true;
    if (t.assigneeEmail && visibleEmails.has(t.assigneeEmail.toLowerCase())) return true;
    // Jira-specific: a user is "actionable" on a ticket if they're the
    // assignee OR the HRX Responsible. Reporter-only visibility is
    // intentionally NOT counted here — per Ljubica's 2026-04-23 ask, Home
    // task counts should reflect actionables only (not tickets the user
    // merely raised). Reporter-only tickets remain reachable in the Queue's
    // "Raised by You" filter.
    if (t.source === 'jira' && Array.isArray(t.jiraHrxEmails)) {
      for (const e of t.jiraHrxEmails) {
        if (e && visibleEmails.has(e.toLowerCase())) return true;
      }
    }
    return false;
  }, [scopeIds, visibleEmails]);
  const scope=tasks.filter(t=>inScope(t)&&t.status!=='resolved');
  const personal=tasks.filter(t=>(t.assigneeId===user.id||(t.assigneeEmail&&t.assigneeEmail.toLowerCase()===user.email?.toLowerCase()))&&t.status!=='resolved');
  const total=scope.length;
  // Exclude waiting (snoozed) tasks from SLA counts — matches Queue.jsx behaviour
  const slaScope=scope.filter(t=>t.status!=='waiting');
  const breached=slaScope.filter(t=>{const s=slaInfo(t);return s&&s.breach;});
  const atRisk=slaScope.filter(t=>{const s=slaInfo(t);return s&&!s.ok&&!s.breach;});
  // Per-row SLA fields are populated by normalizeSourceRows.js — windows
  // are sourced from the Team-tab queue-sla settings, ticking on the
  // business-day clock (2026-05-01 spec). At-risk = "less than 25% of the
  // SLA window remaining" so the band scales with whatever the queue's
  // configured active/paused window is. The aggregate consumes those
  // fields instead of recomputing — keeps the Briefing total in sync with
  // what the per-row pill shows on each tab.
  const onbBreached=onboardingRows.filter(r=>r.slaBreachStatus==='SLA_BREACHED');
  const onbAtRisk=onboardingRows.filter(r=>{
    if (r.slaBreachStatus==='SLA_BREACHED' || typeof r.slaRemaining !== 'number') return false;
    if (r.slaRemaining <= 0) return false;
    const windowSec = Number.isFinite(r.slaWindowMs) && r.slaWindowMs > 0 ? r.slaWindowMs/1000 : 24*60*60;
    return r.slaRemaining < windowSec/4;
  });
  breached.push(...onbBreached);
  atRisk.push(...onbAtRisk);
  const newT=scope.filter(t=>t.status==='new');
  const ipT=scope.filter(t=>t.status==='in_progress');
  const waitT=scope.filter(t=>t.status==='waiting');
  const resolved=tasks.filter(t=>inScope(t)&&t.status==='resolved').length;
  const updated=scope.filter(t=>t.updatedMinsAgo!==undefined&&t.updatedMinsAgo<=120).length;
  const manager=user.lead?MEMBERS.find(m=>m.id===user.lead):null;

  // ── Cross-source "Active Requests" count ───────────────────────────────
  // Pilar's rule: Active Requests must equal the FULL open-item count across
  // every queue (Zendesk + Jira + Onboarding + Offboarding + Amendments +
  // Redlines + Workbench) minus resolved, scoped to what the user actually
  // sees in each tab.
  //   • Agent     → personal tasks + their scoped Deel rows
  //   • Team Lead → team scope (self + direct reports) — their Deel rows are
  //                 already country/assignee-scoped by the Queue rules above.
  //   • Exec (RM/Director/Admin) → org-wide open + all Deel rows.
  // The Deel source rows are "open by definition" — resolved ones don't come
  // back from the actionable-queue endpoints — so no status filter needed.
  const deelSourceRowsLen =
    onboardingRows.length + offboardingRows.length + amendmentRows.length +
    redlineRows.length + workbenchRows.length + incentivePlanRows.length;
  const activeRequestsCount = isOwnScope
    ? personal.length + deelSourceRowsLen
    : isTeamScope
      ? scope.length + deelSourceRowsLen
      : orgOpen.length + onboardingRowsAll.length + offboardingRowsAll.length +
        amendmentRowsAll.length + redlineRowsAll.length + workbenchRowsAll.length +
        incentivePlanRowsAll.length;

  // ── Today's meetings ───────────────────────────────────────────────────
  // Calendar events carry a type — we only count real meetings, not deadlines
  // or leave markers (those show up in other cards). Same rule for every role
  // since the calendar is org-wide and users care about their own day.
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMeetingsCount = CALENDAR_EVENTS.filter(e => e.date === todayStr && e.type === 'meeting').length;

  // ── Projects assigned / visible ───────────────────────────────────────
  // Follows the permission tree:
  //   • Agent     → projects where I'm lead, explicitly in assigneeIds, or
  //                 the scope is team==mine / everyone.
  //   • Team Lead / Regional / Director → anything led by or assigned to
  //                 anyone in my scope, plus team/everyone scopes. Admin
  //                 (isAllScope) sees all active projects.
  // Completed/cancelled are excluded — Pilar asked for "only projects assigned
  // to them" which implies active work, not archived records.
  // Reads from the LIVE `projects` state passed from App.jsx (sourced from
  // /api/v1/projects), not from a hardcoded seed. Previously this counted
  // INITIAL_PROJECTS directly which leaked five demo rows into the tile and
  // produced "1 assigned" on a fresh tenant whose API returned zero — the
  // tile then deep-linked to a row that didn't exist in the projects view.
  const projectsAssignedCount = useMemo(() => {
    const active = (Array.isArray(projects) ? projects : []).filter(p => p.status !== 'completed' && p.status !== 'cancelled');
    if (isAllScope) return active.length;
    const scopeIdSet = new Set(scopeIds);
    return active.filter(p => {
      if (p.assignScope === 'everyone') return true;
      if (p.assignScope === 'team' && p.assignTeam && p.assignTeam === user.team) return true;
      if (scopeIdSet.has(p.leadId)) return true;
      if (Array.isArray(p.assigneeIds) && p.assigneeIds.some(id => scopeIdSet.has(id))) return true;
      return false;
    }).length;
  }, [projects, isAllScope, scopeIds, user.team]);

  // ── Escalations assigned to the viewer ────────────────────────────────
  // Previous behaviour counted every pending escalation in scope — that over-
  // counted for TL/Regional/Director who saw their whole subtree's backlog.
  // New rule (Pilar): "only assigned to them" per role:
  //   • Agent           → pending escalations I raised (waiting on my manager)
  //   • TL/RM/Director  → pending escalations where I'm the expected responder
  //                       (managerId === my user id). Tree visibility is
  //                       preserved — `escalations` is already the scoped list.
  const myEscalationsCount = useMemo(() => {
    const uname = (user.name || '').toLowerCase();
    return escalations.filter(e => {
      if (e.status !== 'pending') return false;
      if (isOwnScope) {
        const byName = (e.escalatedBy || '').toLowerCase() === uname;
        const byTask = e.task && e.task.assigneeId === user.id;
        return byName || byTask;
      }
      return e.managerId === user.id;
    }).length;
  }, [escalations, isOwnScope, user.id, user.name]);

  // ── Personal checklist count (incomplete only) ────────────────────────
  // Reads the per-user key written by PersonalChecklist.jsx. Re-reads on
  // `storage` events so adding/toggling an item in another tab updates the
  // tile without a refresh. Falls back to the legacy global key for users
  // who haven't triggered a write since the schema change.
  const [checklistCount, setChecklistCount] = useState(0);
  useEffect(() => {
    const userKey = (user.email || '').toLowerCase().trim()
      ? `ops_hub_checklist_v2:${(user.email || '').toLowerCase().trim()}`
      : 'ops_hub_checklist_v2';
    const readCount = () => {
      try {
        const raw = localStorage.getItem(userKey) || localStorage.getItem('ops_hub_checklist');
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
        return items.filter(i => i && !i.done).length;
      } catch { return 0; }
    };
    setChecklistCount(readCount());
    const onStorage = (e) => {
      if (!e.key || e.key === userKey || e.key === 'ops_hub_checklist') setChecklistCount(readCount());
    };
    window.addEventListener('storage', onStorage);
    // Cross-tab channel the checklist itself uses for instant updates
    let channel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('ops_hub_checklist_sync');
        channel.onmessage = () => setChecklistCount(readCount());
      }
    } catch {}
    // Poll every 30s as a belt-and-braces fallback (cheap, synchronous read)
    const tick = setInterval(() => setChecklistCount(readCount()), 30_000);
    return () => {
      window.removeEventListener('storage', onStorage);
      if (channel) { try { channel.close(); } catch {} }
      clearInterval(tick);
    };
  }, [user.email]);

  // ── DYNAMIC CAPACITY — per-agent multi-source aggregation ──────────
  // Per Pilar's team-summary spec (2026-04-22):
  //   • Total   = Open + Paused  (strict invariant)
  //   • Open    = actionable rows across Zendesk, Jira, Workbench,
  //               Onboarding, Offboarding, Amendments, Redlines
  //   • Paused  = paused rows across the same 7 sources
  //   • Breaches = SLA-breached rows across the same 7 sources
  //   • Capacity = absolute, baseline 30 tasks (good workload).
  //       < 20 → Low | 20-50 → Medium | > 50 → High
  //       capPct = tc / 30 * 100, capped at 200.
  //
  // Source-by-source attribution:
  //   • Zendesk/Jira (tickets):   t.assigneeId OR t.assigneeEmail
  //   • Onboarding / Paused Onb:  r.assigneeEmail (BE provides it)
  //   • Offboarding:              r.assigneeEmail (exAssigneeEmail)
  //   • Workbench:                r.assigneeEmail
  //   • Amendments / Redlines:    NO server-side assignee field. Rows live
  //                               in a shared pool ("Assign me" in the UI).
  //                               Attributed to the viewer's own scope via
  //                               scoping (country-based) at the team roll-up
  //                               level — see poolAmendmentsForTeam below.
  //                               Per-agent attribution is impossible, so
  //                               per-agent counts omit these sources and a
  //                               footer note explains the gap.
  //
  // Breach rules (match Queue.jsx + normalizeSourceRows.js):
  //   • Tickets:       slaInfo(t).breach (null for waiting/resolved)
  //   • Every Deel queue (Onb / Paused Onb / Off / Wb / Amend / Redline):
  //     reads slaBreachStatus === 'SLA_BREACHED' from the normalized row
  //     so per-row pill and aggregate stay in lockstep with Pilar's spec
  //     (Onb 7d, Paused 48h-from-pausedAt, Off 21d, Wb 48h, Redline 72h,
  //     Amend 24h, paused 48h universal).
  // Capacity thresholds — Director-tunable via the Team-tab capacity editor.
  // Default { lowMax: 40, highMin: 100 }. Anything in [lowMax, highMin] is
  // "Good", below is "Low" (under-utilised), above is "High" (burnout risk).
  const { capacity: capacitySettings } = useCapacitySettings();
  const capLowMax  = Number.isFinite(capacitySettings?.lowMax)  ? capacitySettings.lowMax  : 40;
  const capHighMin = Number.isFinite(capacitySettings?.highMin) ? capacitySettings.highMin : 100;
  const BASELINE_CAPACITY = capHighMin; // 100% on the workload bar = highMin (burnout)

  const allAgents = MEMBERS.filter(m => m.role === 'agent' && scopeIds.includes(m.id)).map(m => {
    const memEmail = (m.email || '').toLowerCase();

    // — Tickets (Zendesk + Jira merged in `tasks`) —
    const mTickets = tasks.filter(t => {
      if (t.status === 'resolved') return false;
      if (t.assigneeId === m.id) return true;
      if (t.assigneeEmail && t.assigneeEmail.toLowerCase() === memEmail) return true;
      return false;
    });
    const tOpen    = mTickets.filter(t => t.status === 'new' || t.status === 'in_progress' || t.status === 'escalated').length;
    const tPaused  = mTickets.filter(t => t.status === 'waiting').length;
    const tEsc     = mTickets.filter(t => t.status === 'escalated').length;
    const tBreach  = mTickets.filter(t => { const s = slaInfo(t); return s && s.breach; }).length;

    // — Onboarding (7-day SLA; per-row slaBreachStatus is the source of truth) —
    const mOnb = onboardingRowsAll.filter(r => r.assigneeEmail && r.assigneeEmail === memEmail);
    const onbOpen   = mOnb.length;
    const onbBreach = mOnb.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;

    // — Paused Onboarding (48h-from-pausedAt; per-row slaBreachStatus) —
    const mPausedOnb = pausedOnboardingRowsAll.filter(r => r.assigneeEmail && r.assigneeEmail === memEmail);
    const pausedOnbCount  = mPausedOnb.length;
    const pausedOnbBreach = mPausedOnb.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;

    // — Offboarding (21-day SLA; per-row slaBreachStatus now populated) —
    const mOff = offboardingRowsAll.filter(r => r.assigneeEmail && r.assigneeEmail === memEmail);
    const offOpen   = mOff.length;
    const offBreach = mOff.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;

    // — Workbench (48h-from-creation; per-row slaBreachStatus) —
    const mWb = workbenchRowsAll.filter(r => r.assigneeEmail && r.assigneeEmail === memEmail);
    const wbOpen   = mWb.length;
    const wbBreach = mWb.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;

    const open    = tOpen + onbOpen + offOpen + wbOpen;
    const paused  = tPaused + pausedOnbCount;
    const br      = tBreach + onbBreach + pausedOnbBreach + offBreach + wbBreach;
    const tc      = open + paused;   // strict invariant: Total = Open + Paused

    return { ...m, tc, br, open, paused, escalated: tEsc };
  }).sort((a, b) => b.tc - a.tc);

  // Team avg — informational only (used by some legacy cards, kept for now).
  const scopeAgents = isOwnScope ? allAgents.filter(a => a.team === user.team)
                    : isTeamScope ? allAgents.filter(a => a.team === user.team)
                    : allAgents;
  const teamAvg = scopeAgents.length > 0 ? scopeAgents.reduce((s, a) => s + a.tc, 0) / scopeAgents.length : 0;

  // Workload band classifier — director-tunable thresholds. The "Good"
  // colour gradient runs green near `lowMax` to yellow as the count
  // approaches `highMin`, so the team can spot agents trending toward
  // burnout before they cross into red.
  const classifyWorkload = (count) => {
    if (count > capHighMin) {
      return { wl: 'High',   wc: '#d42d35' };
    }
    if (count < capLowMax) {
      return { wl: 'Low',    wc: '#1f74b3' };
    }
    // Inside [lowMax, highMin] — interpolate green → yellow.
    const span = Math.max(1, capHighMin - capLowMax);
    const t = Math.min(1, Math.max(0, (count - capLowMax) / span));
    // Green (#29811e) at t=0, yellow (#ed8d00) at t=1.
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    const r = lerp(0x29, 0xed), g = lerp(0x81, 0x8d), b = lerp(0x1e, 0x00);
    return { wl: 'Good', wc: `rgb(${r}, ${g}, ${b})` };
  };

  // Viewer's own workload — anchored on `capHighMin` so 100% on the
  // workload bar is the configured burnout threshold.
  const myCount = isOwnScope ? personal.length : total;
  const myWlBand = classifyWorkload(myCount);
  const wl = myWlBand.wl;
  const wc = myWlBand.wc;
  const capPct = Math.min(100, Math.round((myCount / BASELINE_CAPACITY) * 100));

  // Team-summary workload + capacity % using the same configured bands.
  const allAgentsWL = allAgents.map(m => {
    const band = classifyWorkload(m.tc);
    const mCapPct = Math.min(200, Math.round((m.tc / BASELINE_CAPACITY) * 100));
    return { ...m, wl: band.wl, wc: band.wc, capPct: mCapPct };
  });

  // ── Health Score (composite 0-100) — 2026-05-01 spec ─────────────────────
  // Default weights total 100 (SLA 50 · Resp 20 · Cap 20 · Res 10), all
  // four configurable. Component math:
  //   • SLA Compliance — % of NON-Jira tasks that are NOT breached, across
  //     ZD + Onb + Off + Amend + Redline + Workbench. Spec: "exclude Jira
  //     from the SLA calculation only and the breach count on home page".
  //   • Response Time — Zendesk-only, biz-day elapsed since
  //     `lastCustomerResponseAt`. Gradient: <24h biz → 100, <36h → 70,
  //     <48h → 40, ≥48h → 20.
  //   • Resolution Rate — Zendesk-only resolved / (resolved + open).
  //   • Team Capacity — Low → 100, Good → 60, High → 25 using the
  //     configured lowMax/highMin thresholds.
  const slaPoolNonJira = slaScope.filter(t => t.source !== 'jira');
  const breachedNonJira = breached.filter(t => t.source !== 'jira');
  const slaPoolDeel = onboardingRows.length + offboardingRows.length
    + amendmentRows.length + redlineRows.length + workbenchRows.length + incentivePlanRows.length;
  const breachedDeel = onboardingRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + offboardingRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + amendmentRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + redlineRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + workbenchRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + incentivePlanRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;
  const slaTotal = slaPoolNonJira.length + slaPoolDeel;
  const slaBreachTotal = breachedNonJira.length + breachedDeel;
  const slaCompRate = slaTotal > 0 ? Math.round(((slaTotal - slaBreachTotal) / slaTotal) * 100) : 100;

  // Zendesk-only resolution rate.
  const zdScope = scope.filter(t => t.source === 'zendesk');
  const zdResolved = tasks.filter(t => t.source === 'zendesk' && inScope(t) && t.status === 'resolved').length;
  const zdResRate = (zdResolved + zdScope.length) > 0
    ? Math.round((zdResolved / (zdResolved + zdScope.length)) * 100)
    : 0;
  const resRate = zdResRate;

  // Zendesk-only response time, biz-day from last requester reply (falls
  // back to updatedAt → createdAt). Skip 'waiting'/'resolved'.
  const zdActive = zdScope.filter(t => t.status !== 'waiting' && t.status !== 'resolved');
  const zdRespMins = zdActive.length > 0
    ? Math.round(zdActive.reduce((sum, t) => {
        const anchor = t.lastCustomerResponseAt || t.updatedAt || t.createdAt;
        if (!anchor) return sum;
        const ms = new Date(anchor).getTime();
        if (!Number.isFinite(ms)) return sum;
        return sum + elapsedBizMinutes(ms, Date.now());
      }, 0) / zdActive.length)
    : 0;
  const avgResponseTime = zdRespMins;
  const respScore = avgResponseTime < 24 * 60 ? 100
    : avgResponseTime < 36 * 60 ? 70
    : avgResponseTime < 48 * 60 ? 40
    : 20;

  const wlScore = wl === 'Low' ? 100 : wl === 'Good' ? 60 : 25;
  const wSLA = Number.isFinite(settings.briefing_health_sla_weight) ? settings.briefing_health_sla_weight : 50;
  const wRes = Number.isFinite(settings.briefing_health_resolution_weight) ? settings.briefing_health_resolution_weight : 10;
  const wResp = Number.isFinite(settings.briefing_health_response_weight) ? settings.briefing_health_response_weight : 20;
  const wCap = Number.isFinite(settings.briefing_health_capacity_weight) ? settings.briefing_health_capacity_weight : 20;
  const wSum = (wSLA + wRes + wResp + wCap) || 100;
  const healthScore = Math.round((slaCompRate*wSLA + resRate*wRes + respScore*wResp + wlScore*wCap) / wSum) || 0;
  const hColor = healthScore >= 80 ? '#29811e' : healthScore >= 60 ? '#ed8d00' : '#d42d35';
  const hLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 60 ? 'Attention' : 'Critical';

  // ── Trends (static until historical data endpoint exists) ──────────
  const trend=()=>({dir:'\u2192',pct:0,c:'#bebebe'});;

  // ── Source breakdown (org-wide for exec, scoped for others) ───────────
  const srcPool=isExec?orgOpen:scope;
  const srcCounts=srcPool.reduce((a,t)=>{a[t.source]=(a[t.source]||0)+1;return a;},{});
  // Add Deel API sources (onboarding, offboarding, amendments, redlines, workbench)
  if (onboardingRows.length)  srcCounts['onboarding']  = (srcCounts['onboarding']  || 0) + onboardingRows.length;
  if (offboardingRows.length) srcCounts['offboarding'] = (srcCounts['offboarding'] || 0) + offboardingRows.length;
  if (amendmentRows.length)   srcCounts['amendments']  = (srcCounts['amendments']  || 0) + amendmentRows.length;
  if (redlineRows.length)     srcCounts['redlines']    = (srcCounts['redlines']    || 0) + redlineRows.length;
  if (workbenchRows.length)   srcCounts['workbench']   = (srcCounts['workbench']   || 0) + workbenchRows.length;
  if (incentivePlanRows.length) srcCounts['incentive_plans'] = (srcCounts['incentive_plans'] || 0) + incentivePlanRows.length;
  const srcEntries=Object.entries(srcCounts).sort((a,b)=>b[1]-a[1]);
  // Total across all sources (for percentage calculation)
  const srcTotal = srcEntries.reduce((sum, [, cnt]) => sum + cnt, 0);

  // ── Status pipeline (for exec) ────────────────────────────────────────
  const orgNew=orgOpen.filter(t=>t.status==='new').length;
  const orgIP=orgOpen.filter(t=>t.status==='in_progress').length;
  const orgWait=orgOpen.filter(t=>t.status==='waiting').length;
  // 2026-05-01 spec: exclude Jira from the SLA calculation and the breach
  // count on the home page, but keep it counted everywhere else (Queue,
  // Team, Analytics). orgSlaPool drops Jira tickets and any Q's paused
  // tickets (slaInfo() already returns null for `waiting`).
  const orgSlaPool = orgOpen.filter(t => t.status !== 'waiting' && t.source !== 'jira');
  // Proportional at-risk band — same rule as the per-row pill.
  const deelAtRisk = (rows) => rows.filter(r => {
    if (r.slaBreachStatus === 'SLA_BREACHED') return false;
    if (typeof r.slaRemaining !== 'number' || r.slaRemaining <= 0) return false;
    const windowSec = Number.isFinite(r.slaWindowMs) && r.slaWindowMs > 0 ? r.slaWindowMs / 1000 : 24*60*60;
    return r.slaRemaining < windowSec / 4;
  });
  const offBreached  = offboardingRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const offAtRisk    = deelAtRisk(offboardingRows);
  const amendBreach  = amendmentRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const amendAtRisk  = deelAtRisk(amendmentRows);
  const redBreach    = redlineRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const redAtRisk    = deelAtRisk(redlineRows);
  const wbBreach     = workbenchRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const wbAtRisk     = deelAtRisk(workbenchRows);
  const ipBreach     = incentivePlanRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const ipAtRisk     = deelAtRisk(incentivePlanRows);
  const orgBreach = orgSlaPool.filter(t => { const s = slaInfo(t); return s && s.breach; }).length
    + onbBreached.length + offBreached.length + amendBreach.length + redBreach.length + wbBreach.length + ipBreach.length;
  const orgAtRisk = orgSlaPool.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; }).length
    + onbAtRisk.length + offAtRisk.length + amendAtRisk.length + redAtRisk.length + wbAtRisk.length + ipAtRisk.length;
  const orgSlaTotal = orgSlaPool.length + onboardingRows.length + offboardingRows.length
    + amendmentRows.length + redlineRows.length + workbenchRows.length + incentivePlanRows.length;
  const orgSlaComp = orgSlaTotal > 0 ? Math.round(((orgSlaTotal - orgBreach) / orgSlaTotal) * 100) : 100;

  // ── Sparkline (flat until historical data endpoint exists) ──────────
  const sparkData=Array.from({length:10},()=>total);
  const spMax=Math.max(...sparkData,1)||1;const spW=80;const spH=22;
  const sparkPath=sparkData.map((v,i)=>{const x=i/(sparkData.length-1)*spW;const y=spH-(v/spMax)*spH;return(i===0?'M':'L')+x.toFixed(1)+','+y.toFixed(1);}).join(' ');
  // sparkPath is used for SVG sparkline visualization

  // ── Team data ─────────────────────────────────────────────────────────
  const leads=MEMBERS.filter(m=>m.role==='team_lead'||m.role==='regional_manager').map(ld=>{
    const ag=allAgentsWL.filter(a=>a.team===ld.team);
    const tt=ag.reduce((s,a)=>s+a.tc,0);const tb=ag.reduce((s,a)=>s+a.br,0);const avg=ag.length?tt/ag.length:0;
    const r=teamAvg>0?avg/teamAvg:0;
    return {...ld,ag,tt,tb,avg,wl:r>=1.4?'High':r>=0.7?'Medium':'Low',wc:r>=1.4?'#d42d35':r>=0.7?'#ed8d00':'#29811e'};
  });
  const helpers=isOwnScope?allAgentsWL.filter(m=>m.team===user.team&&m.id!==user.id&&m.tc<personal.length).slice(0,3):[];
  const hmMembers=isTeamScope?allAgentsWL.filter(m=>m.team===user.team):isAllScope?allAgentsWL:[];
  const regions=['EMEA','APAC','LATAM','NAM'];
  const regionIcons={EMEA:'bi-globe-europe-africa',APAC:'bi-globe-asia-australia',LATAM:'bi-globe-americas',NAM:'bi-globe-americas'};
  const rStats=regions.map(r=>{
    const ra=allAgentsWL.filter(a=>a.team===r);const tt=ra.reduce((s,a)=>s+a.tc,0);const tb=ra.reduce((s,a)=>s+a.br,0);
    const avg=ra.length?tt/ra.length:0;const ratio=teamAvg>0?avg/teamAvg:0;
    return {r,n:ra.length,tt,tb,avg,wl:ratio>=1.4?'High':ratio>=0.7?'Medium':'Low',wc:ratio>=1.4?'#d42d35':ratio>=0.7?'#ed8d00':'#29811e',ld:leads.find(l=>l.team===r)};
  });

  // ── Recent activity ───────────────────────────────────────────────────
  const recentAct=[...scope].filter(t=>t.updatedMinsAgo!==undefined&&t.updatedMinsAgo<t.minutesAgo).sort((a,b)=>a.updatedMinsAgo-b.updatedMinsAgo).slice(0,4).map(t=>{
    const who=MEMBERS.find(m=>m.id===t.assigneeId)||(t.assigneeEmail?MEMBERS.find(m=>m.email.toLowerCase()===t.assigneeEmail.toLowerCase()):null);
    // Derive event type for priority icon
    const evType=t.isAlert?'alert':t.status==='resolved'?'success':t.status==='new'?'new_task':'info';
    const evIcon=evType==='alert'?'bi-exclamation-circle':evType==='success'?'bi-check-circle':evType==='new_task'?'bi-plus-circle':'bi-info-circle';
    const evColor=evType==='alert'?'#d42d35':evType==='success'?'#29811e':evType==='new_task'?'#1f74b3':'#9e9e9e';
    return {id:t.id,subject:t.subject,who:who?.name?.split(' ')[0]||t.assigneeName?.split(' ')[0]||'System',ago:rel(t.updatedMinsAgo),icon:TOOLS[t.source]?.icon||'bi-circle',color:TOOLS[t.source]?.color||'#bebebe',evIcon,evColor};
  });

  // ── SVG Ring ──────────────────────────────────────────────────────────
  const Ring=({pct,color,size,stroke})=>{
    const r=(size-stroke)/2;const circ=2*Math.PI*r;const off=circ*(1-pct/100);
    return(<svg width={size} height={size} role="img" aria-label={`${pct}% progress`} style={{transform:'rotate(-90deg)'}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e8e8e8" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={off} style={{'--circ':circ,'--off':off,animation:'ringDraw .9s cubic-bezier(.16,1,.3,1) forwards'}}/>
    </svg>);
  };

  // ── Mini ticket list for expandable panels ──────────────────────────
  const MiniTicketList=({items,emptyMsg})=>(
    <div style={{background:'#fafaf9',border:'1px solid #e8e8e8',borderRadius:12,margin:'8px 0 4px',padding:'8px 12px',maxHeight:200,overflowY:'auto',animation:'fadeSlide .2s ease'}}>
      {items.length===0?<div style={{fontSize:11,color:'#9e9e9e',padding:'12px 0',textAlign:'center'}}>
        {emptyMsg||'No tasks'}
      </div>:
      items.map((t,i)=>{
        const sla=slaInfo(t);const tool=TOOLS[t.source];
        return(
          <div key={t.id} onClick={(e)=>{e.stopPropagation();setSelTask(t);setView('my-queue');}}
            style={{display:'flex',alignItems:'center',gap:8,padding:'7px 4px',cursor:'pointer',borderBottom:i<items.length-1?'1px solid #f0f0f0':'none',borderRadius:6,transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{width:22,height:22,borderRadius:6,background:tool?.bg||'#f7f5f2',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <i className={tool?.icon||'bi-circle'} style={{fontSize:9,color:tool?.color||'#bebebe'}}></i>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:'#1b1b1b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.subject}</div>
              <div style={{fontSize:9,color:'#9e9e9e',display:'flex',gap:6,marginTop:1}}>
                <span>{STATUSES[t.status]?.label||t.status}</span>
                <span>{rel(t.minutesAgo)} old</span>
              </div>
            </div>
            {sla&&<span style={{padding:'2px 8px',borderRadius:128,fontSize:8,fontWeight:700,background:sla.bg,color:sla.color,flexShrink:0,whiteSpace:'nowrap'}}>{sla.short}</span>}
          </div>
        );
      })}
    </div>
  );

  // ── SLA filter helpers for expandable SLA panels ──────────────────────
  // SLA filter helpers — match the orgBreach / orgAtRisk math above so the
  // expandable lists agree with the ring count. Jira is excluded from the
  // pool per spec; Deel-source breaches/at-risk join in via the per-row
  // `slaBreachStatus` and proportional band.
  const orgBreachedTasks = [
    ...orgSlaPool.filter(t => { const s = slaInfo(t); return s && s.breach; }),
    ...onbBreached, ...offBreached, ...amendBreach, ...redBreach, ...wbBreach, ...ipBreach,
  ];
  const orgAtRiskTasks = [
    ...orgSlaPool.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; }),
    ...onbAtRisk, ...offAtRisk, ...amendAtRisk, ...redAtRisk, ...wbAtRisk, ...ipAtRisk,
  ];
  const orgWithinSlaTasks = orgSlaPool.filter(t => { const s = slaInfo(t); return !s || (s && s.ok); });

  // ── Deel-style card wrapper ──────────────────────────────────────────
  const DeelCard=({children,style,...props})=>(
    <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:24,transition:'box-shadow .2s',...style}}
      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
      onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}
      {...props}>
      {children}
    </div>
  );

  // ── Card section title ──────────────────────────────────────────────
  const CardTitle=({children})=>(
    <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',marginBottom:14}}>{children}</div>
  );

  // ── KPI mini card for hero ──────────────────────────────────────────
  const KpiCard=({label,value,color,icon,onClick,clickable})=>(
    <div onClick={onClick} style={{
      padding:'8px 14px',borderRadius:12,background:'rgba(255,255,255,0.85)',border:'1px solid rgba(232,232,232,0.6)',
      minWidth:80,textAlign:'center',cursor:clickable?'pointer':'default',transition:'all .15s',backdropFilter:'blur(4px)'
    }}
      onMouseEnter={e=>{if(clickable){e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)';e.currentTarget.style.transform='translateY(-1px)';}}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';e.currentTarget.style.transform='none';}}>
      {icon&&<i className={icon} style={{fontSize:10,color:color||'#9e9e9e',marginBottom:2,display:'block'}}></i>}
      <div style={{fontSize:24,fontWeight:700,color:color||'#1b1b1b',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{value}</div>
      <div style={{fontSize:10,fontWeight:600,color:'#9e9e9e',marginTop:4}}>{label}</div>
    </div>
  );

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--bg)'}}>
      <div style={{flex:1,overflowY:'auto'}}>

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <div style={{background:'linear-gradient(135deg, #f3eff8 0%, #e8e0f5 50%, #f7f5f2 100%)',padding:'10px 24px 12px',position:'relative',overflow:'hidden'}}>

          <div style={{display:'flex',alignItems:'center',gap:20,position:'relative',zIndex:1}}>
            {/* Greeting + Role */}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <h1 style={{fontSize:'var(--font-2xl, 20px)',lineHeight:'var(--lh-tight, 1.25)',fontWeight:700,color:'#1b1b1b',margin:0,letterSpacing:'-.01em'}}>{greeting}, {firstName}</h1>
                <span style={{background:'var(--purple-mid, #ede9fe)',color:'var(--purple, #7c3aed)',borderRadius:'var(--radius-pill)',padding:'2px 10px',fontSize:'var(--font-xs)',fontWeight:600}}>{roleLabel}</span>
              </div>
              <div style={{fontSize:13,color:'#616161',marginTop:6,display:'flex',alignItems:'center',gap:8}}>
                <span>{dateStr}</span>
                <span style={{width:3,height:3,borderRadius:'50%',background:'#bebebe',display:'inline-block'}}></span>
                <span>{timeStr}</span>
                <span style={{width:3,height:3,borderRadius:'50%',background:'#bebebe',display:'inline-block'}}></span>
                <span style={{color:'#9e9e9e'}}>{scopeLabel}</span>
              </div>
              {isAllScope&&(
                <div style={{marginTop:5,fontSize:12,color:'#1f74b3',fontWeight:600,display:'flex',alignItems:'center',gap:5}}>
                  <i className="bi-globe2" style={{fontSize:11}}></i>
                  Viewing: {user.region||'All Regions'}
                </div>
              )}
              {/* ── Manager on Call — relocated here from the top nav ───────
                  Shows the current escalation contact front-and-center on the
                  home page, with inline editing for anyone (per the original
                  top-nav behavior). Avatar + name + pencil, visually matched
                  to the neighboring "Viewing: All" / "Live" pill row. */}
              {managerOnCall&&(
                <div ref={mocRef} style={{marginTop:8,display:'inline-flex',position:'relative'}}>
                  <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'5px 12px 5px 5px',borderRadius:128,background:'rgba(255,255,255,0.85)',border:'1px solid rgba(232,232,232,0.8)',backdropFilter:'blur(4px)'}}>
                    <Avatar
                      name={managerOnCall.name}
                      initials={managerOnCall.initials}
                      src={managerOnCall.avatarUrl}
                      size={22}
                    />
                    <div style={{fontSize:12,lineHeight:'16px',whiteSpace:'nowrap'}}>
                      <span style={{color:'#9e9e9e',fontWeight:500}}>Manager On Call:</span>{' '}
                      <span style={{fontWeight:700,color:'#1b1b1b'}}>{managerOnCall.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={()=>setShowMocPicker(p=>!p)}
                      aria-label="Change manager on call"
                      title="Change manager on call"
                      style={{width:22,height:22,padding:0,border:'none',background:'transparent',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background .12s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                    >
                      <i className="bi bi-pencil" style={{fontSize:11,color:'#9e9e9e'}}></i>
                    </button>
                  </div>
                  {showMocPicker&&(
                    <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,background:'#ffffff',borderRadius:14,border:'1px solid #e8e8e8',boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'6px 0',minWidth:300,maxHeight:360,overflowY:'auto',zIndex:1000}}>
                      <div style={{padding:'6px 16px 8px',fontSize:10,fontWeight:700,color:'#bebebe',letterSpacing:'.04em',textTransform:'uppercase'}}>Select Manager On Call</div>
                      {mocCandidates.map(m=>(
                          <div
                            key={m.email}
                            role="button"
                            tabIndex={0}
                            onClick={()=>{
                              onChangeManagerOnCall?.({name:m.name,initials:m.initials,email:m.email,avatarUrl:m.avatarUrl});
                              setShowMocPicker(false);
                            }}
                            onKeyDown={e=>{
                              if(e.key==='Enter'||e.key===' '){
                                e.preventDefault();
                                onChangeManagerOnCall?.({name:m.name,initials:m.initials,email:m.email,avatarUrl:m.avatarUrl});
                                setShowMocPicker(false);
                              }
                            }}
                            onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'}
                            onMouseLeave={e=>e.currentTarget.style.background=managerOnCall.email===m.email?'#fafaf9':'transparent'}
                            style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'background .12s',background:managerOnCall.email===m.email?'#fafaf9':'transparent'}}
                          >
                            <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size={28}/>
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontSize:13,fontWeight:managerOnCall.email===m.email?600:400,color:managerOnCall.email===m.email?'#7c3aed':'#1b1b1b',lineHeight:'17px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
                              <div style={{fontSize:11,color:'#9e9e9e',lineHeight:'15px'}}>{m.team}</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
              {/* Live integrations status */}
              {(deelData?.isAvailable||jiraData?.isAvailable||slackData?.isAvailable)&&(
                <div style={{marginTop:6,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  {deelData?.isAvailable&&<span style={{fontSize:10.5,fontWeight:600,color:'#16a34a',background:'#dcfce7',padding:'1px 8px',borderRadius:99,display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:5,height:5,borderRadius:'50%',background:'#16a34a',display:'inline-block'}}/>Deel Live</span>}
                  {jiraData?.isAvailable&&<span style={{fontSize:10.5,fontWeight:600,color:'#0052CC',background:'#e6efff',padding:'1px 8px',borderRadius:99,display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:5,height:5,borderRadius:'50%',background:'#0052CC',display:'inline-block'}}/>Jira Live</span>}
                  {slackData?.isAvailable&&<span style={{fontSize:10.5,fontWeight:600,color:'#611f69',background:'#f3e8f9',padding:'1px 8px',borderRadius:99,display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:5,height:5,borderRadius:'50%',background:'#611f69',display:'inline-block'}}/>Slack Live</span>}
                </div>
              )}
            </div>

            {/* Health Score Ring */}
            {settings.briefing_show_health_score!==false&&<div ref={healthBreakdownRef} title="Composite score 0-100. Click for breakdown." style={{position:'relative',flexShrink:0}}>
              <div onClick={()=>{
                if(!showHealthBreakdown){
                  const r=healthBreakdownRef.current?.getBoundingClientRect();
                  if(r)setHealthPopoverPos({top:Math.round(r.bottom+8),right:Math.max(8,Math.round(window.innerWidth-r.right))});
                }
                setShowHealthBreakdown(!showHealthBreakdown);
              }}
                style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'transform .15s'}}
                onMouseEnter={e=>e.currentTarget.style.transform='scale(1.06)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
                <Ring pct={healthScore} color={hColor} size={64} stroke={5}/>
                <div style={{position:'absolute',textAlign:'center'}}>
                  <div className="health-label" style={{fontSize:18,fontWeight:700,color:'#1b1b1b',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{healthScore}</div>
                  <div style={{fontSize:7,color:'#9e9e9e',fontWeight:600,letterSpacing:'.04em',marginTop:1}}>HEALTH</div>
                </div>
              </div>
              {showHealthBreakdown&&healthPopoverPos&&<div style={{position:'fixed',top:healthPopoverPos.top,right:healthPopoverPos.right,width:300,background:'#ffffff',borderRadius:16,border:'1px solid #e8e8e8',boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'18px 18px 14px',zIndex:9999,animation:'fadeSlide .2s ease'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:hColor}}></div>
                  <span style={{fontSize:14,fontWeight:700,color:'#1b1b1b'}}>Health Breakdown</span>
                  <span style={{fontSize:11,fontWeight:700,color:hColor,marginLeft:'auto',padding:'2px 10px',borderRadius:128,background:hColor+'12'}}>{hLabel}</span>
                  <button onClick={e=>{e.stopPropagation();setShowHealthBreakdown(false);}} style={{background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontSize:12,color:'#9e9e9e',lineHeight:1,marginLeft:4,borderRadius:4}} title="Close">✕</button>
                </div>
                <div style={{fontSize:11,color:'#9e9e9e',marginBottom:10,lineHeight:1.4}}>
                  How your {scopeLabel.toLowerCase()} is performing right now. Each factor is scored 0-100 and weighted below.
                </div>
                {[
                  {label:'SLA Compliance',weight:wSLA,value:`${slaCompRate}%`,score:slaCompRate,sub:`${Math.max(0, slaTotal - slaBreachTotal)}/${slaTotal} on-time (excl. Jira)`,icon:'bi-shield-check'},
                  {label:'Resolution Rate',weight:wRes,value:`${resRate}%`,score:resRate,sub:`${zdResolved} resolved · ${zdScope.length} open · Zendesk`,icon:'bi-check2-all'},
                  {label:'Avg Response Time',weight:wResp,value:avgResponseTime>=60?`${Math.round(avgResponseTime/60)}h ${avgResponseTime%60}m`:`${avgResponseTime}m`,score:respScore,sub:`Zendesk biz-day · ${respScore>=80?'Fast':respScore>=60?'Normal':respScore>=40?'Slow':'Very slow'}`,icon:'bi-clock-history'},
                  {label:'Team Capacity',weight:wCap,value:wl,score:wlScore,sub:`${myCount} tasks · ${Math.round(capPct)}% of ${capHighMin}`,icon:'bi-speedometer2'},
                ].map(row=>{
                  const rc=row.score>=80?'#29811e':row.score>=60?'#ed8d00':'#d42d35';
                  return(
                    <div key={row.label} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid #f5f5f5'}}>
                      <i className={row.icon} style={{fontSize:13,color:rc,width:18,textAlign:'center'}}></i>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                          <span style={{fontSize:12,color:'#1b1b1b',fontWeight:600}}>{row.label}</span>
                          <span style={{fontSize:9,color:'#9e9e9e',fontWeight:600,background:'#f7f5f2',padding:'1px 6px',borderRadius:99}}>{row.weight}%</span>
                        </div>
                        <div style={{fontSize:10,color:'#9e9e9e',marginTop:1}}>{row.sub}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:14,fontWeight:700,color:rc,fontVariantNumeric:'tabular-nums',lineHeight:1}}>{row.value}</div>
                        <div style={{fontSize:9,color:'#9e9e9e',marginTop:2,fontVariantNumeric:'tabular-nums'}}>score {row.score}</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{marginTop:10,padding:'8px 10px',borderRadius:10,background:hColor+'08',border:`1px solid ${hColor}15`,textAlign:'center',lineHeight:1.4}}>
                  <div style={{fontSize:10,color:hColor,fontWeight:700,letterSpacing:'.02em'}}>
                    Score = (SLA×{wSLA} + Res×{wRes} + Resp×{wResp} + Cap×{wCap}) ÷ {wSum}
                  </div>
                  <div style={{fontSize:9,color:'#9e9e9e',marginTop:3}}>
                    Weights are configurable in Settings → Briefing
                  </div>
                </div>
              </div>}
            </div>}

            {/* KPI Summary Cards */}
            {settings.briefing_show_kpi_cards!==false&&<div style={{display:'flex',alignItems:'center',gap:'var(--space-4, 16px)',flexShrink:0}}>
              <KpiCard label="Workload" value={wl} color={wc} icon="bi-speedometer2" clickable onClick={()=>setView('my-queue')}/>
              <KpiCard label="SLA Comp %" value={`${slaCompRate}%`} color={slaCompRate>=80?'#29811e':slaCompRate>=60?'#ed8d00':'#d42d35'} icon="bi-shield-check" clickable onClick={()=>setView('analytics')}/>
              <KpiCard label="Resolved" value={resolved} color="#29811e" icon="bi-check-circle-fill" clickable onClick={()=>setView('my-queue')}/>
            </div>}
          </div>
        </div>

        {/* ── PENDING ACKNOWLEDGEMENTS — Deel-style single banner carousel ── */}
        {(()=>{
          const targetMatch=(c)=>{
            if(Array.isArray(c.target)&&c.target.includes(user.id))return true;
            if(c.author&&c.author.id===user.id)return true;
            return matchesAudience(c.target, user.team);
          };
          const pendingAcks=comms.filter(c=>c.status==='sent'&&targetMatch(c)&&!isAckedByMe(c)&&!(c.author&&c.author.id===user.id));
          if(pendingAcks.length===0)return null;
          const BANNER_THEMES={
            alert:    {bg:'#ffe2de',accent:'#d42d35',circle1:'rgba(212,45,53,0.08)',circle2:'rgba(212,45,53,0.05)',icon:'bi-exclamation-triangle-fill',iconBg:'#d42d35'},
            announce: {bg:'#fff8e6',accent:'#ed8d00',circle1:'rgba(237,141,0,0.08)',circle2:'rgba(237,141,0,0.05)',icon:'bi-megaphone-fill',iconBg:'#ed8d00'},
            update:   {bg:'#e8f0fe',accent:'#1f74b3',circle1:'rgba(31,116,179,0.08)',circle2:'rgba(31,116,179,0.05)',icon:'bi-arrow-up-circle-fill',iconBg:'#1f74b3'},
            guidance: {bg:'#ede9fe',accent:'#7c3aed',circle1:'rgba(124,58,237,0.08)',circle2:'rgba(124,58,237,0.05)',icon:'bi-book-half',iconBg:'#7c3aed'},
            kudos:    {bg:'#F0FDF4',accent:'#29811e',circle1:'rgba(41,129,30,0.08)',circle2:'rgba(41,129,30,0.05)',icon:'bi-trophy-fill',iconBg:'#29811e'},
          };
          const safeIdx=ackBannerIdx>=pendingAcks.length?0:ackBannerIdx;
          const idx=safeIdx;
          const comm=pendingAcks[idx];
          const bt=BANNER_THEMES[comm.type]||BANNER_THEMES.announce;
          const total=pendingAcks.length;
          const goPrev=()=>setAckBannerIdx(i=>(i-1+total)%total);
          const goNext=()=>setAckBannerIdx(i=>(i+1)%total);
          return(
            <div style={{padding:'12px 24px 0'}}>
              {/* Banner */}
              <div onClick={()=>{setView('announcements');try{window.dispatchEvent(new CustomEvent('announcements:openDetail',{detail:{id:comm.id}}));}catch(_){}}} style={{
                background:bt.bg,borderRadius:16,padding:'20px 28px',cursor:'pointer',
                position:'relative',overflow:'hidden',transition:'all .2s',minHeight:80,
                display:'flex',alignItems:'center',gap:20,
              }}
                onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.06)';}}
                onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';}}>
                {/* Decorative circles */}
                <div style={{position:'absolute',right:60,top:-30,width:140,height:140,borderRadius:'50%',background:bt.circle1,pointerEvents:'none'}}></div>
                <div style={{position:'absolute',right:-10,bottom:-20,width:100,height:100,borderRadius:'50%',background:bt.circle2,pointerEvents:'none'}}></div>
                <div style={{position:'absolute',right:180,top:10,width:60,height:60,borderRadius:'50%',border:`2px solid ${bt.accent}20`,pointerEvents:'none'}}></div>

                {/* Text content */}
                <div style={{flex:1,minWidth:0,position:'relative',zIndex:1}}>
                  <div style={{fontSize:17,fontWeight:700,color:'#1b1b1b',lineHeight:1.3,marginBottom:6}}>{comm.title}</div>
                  <div style={{fontSize:13,color:'#4a4a4a',lineHeight:1.5,maxWidth:600,overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{comm.body.slice(0,160)}{comm.body.length>160?'...':''}</div>
                  <button onClick={(e)=>{e.stopPropagation();setView('announcements');try{window.dispatchEvent(new CustomEvent('announcements:openDetail',{detail:{id:comm.id}}));}catch(_){}}} style={{
                    marginTop:12,display:'inline-flex',alignItems:'center',gap:6,
                    padding:'8px 20px',borderRadius:128,border:'none',
                    background:'#1b1b1b',color:'white',fontSize:13,fontWeight:600,
                    cursor:'pointer',transition:'opacity .15s',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
                    onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                    Review & acknowledge
                  </button>
                </div>

                {/* Right: icon badge */}
                <div style={{position:'relative',zIndex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:8,flexShrink:0}}>
                  <div style={{width:56,height:56,borderRadius:16,background:'white',boxShadow:'0 2px 8px rgba(0,0,0,0.06)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className={bt.icon} style={{fontSize:24,color:bt.iconBg}}></i>
                  </div>
                  <div style={{fontSize:10,fontWeight:600,color:bt.accent,textTransform:'uppercase',letterSpacing:'.04em'}}>
                    {comm.type==='alert'?'Alert':comm.type==='announce'?'Announcement':comm.type==='update'?'Update':comm.type==='guidance'?'Guidance':'Kudos'}
                  </div>
                </div>

                {/* X to dismiss from view (not ack) */}
                <button onClick={(e)=>{e.stopPropagation();if(total>1)goNext();}} style={{position:'absolute',top:10,right:12,width:24,height:24,borderRadius:'50%',background:'rgba(0,0,0,0.06)',border:'none',cursor:'pointer',color:'#9e9e9e',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <i className="bi-x"></i>
                </button>
              </div>

              {/* Navigation: arrows + dots + counter */}
              {total>1&&(
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'10px 0 2px'}}>
                  {/* Left arrow */}
                  <button onClick={goPrev} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #e0e0e0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#616161',fontSize:13,transition:'all .15s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='#f5f5f5';}} onMouseLeave={e=>{e.currentTarget.style.background='white';}}>
                    <i className="bi-chevron-left"></i>
                  </button>

                  {/* Dots */}
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    {pendingAcks.map((_,i)=>(
                      <button key={i} onClick={()=>setAckBannerIdx(i)} style={{
                        width:i===idx?10:8,height:i===idx?10:8,borderRadius:'50%',border:'none',cursor:'pointer',
                        background:i===idx?'#1b1b1b':'#d1d5db',transition:'all .2s',padding:0,
                      }}/>
                    ))}
                  </div>

                  {/* Right arrow */}
                  <button onClick={goNext} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #e0e0e0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#616161',fontSize:13,transition:'all .15s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='#f5f5f5';}} onMouseLeave={e=>{e.currentTarget.style.background='white';}}>
                    <i className="bi-chevron-right"></i>
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ══════════════════════════════════════════════════════════════════
            EXECUTIVE SUMMARY — Director / Regional Manager ONLY
        ══════════════════════════════════════════════════════════════════ */}
        {isExec&&<div style={{padding:'12px 24px'}}>
          {/* ── Exec 6-tile KPI row — same rules as Agent/TL, org-wide scope ─
              Director/Regional Manager see the full org: Active Requests rolls
              up every queue minus resolved; Meetings/Projects/Escalations/
              Announcements/My-To-Do remain personally scoped so the tile is
              actionable (an exec's "my escalations" are ones awaiting THEIR
              sign-off, not every pending escalation in the org — avoids a
              useless 50+ number). */}
          {(()=>{
            const inAudExec=(c)=>matchesAudience(c.target,user.team)||(c.author&&c.author.id===user.id);
            const execUnackedCount=comms.filter(c=>c.status==='sent'&&(c.type==='announce'||c.type==='alert'||c.type==='guidance')&&!isAckedByMe(c)&&inAudExec(c)).length;
            return(
              <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10,marginBottom:16}}>
                {[
                  {icon:'bi-inbox-fill',label:'Active Requests',value:activeRequestsCount,color:'var(--g)',sub:'org-wide'},
                  {icon:'bi-calendar-event',label:'Meetings',value:todayMeetingsCount,color:'#1f74b3',sub:'today',nav:()=>setView('calendar')},
                  {icon:'bi-kanban',label:'Projects',value:projectsAssignedCount,color:'#8b6dca',sub:'assigned',nav:()=>setView('projects')},
                  {icon:'bi-exclamation-triangle-fill',label:'Escalations',value:myEscalationsCount,color:myEscalationsCount>0?'#d42d35':'#616161',alert:myEscalationsCount>0,nav:()=>setView('escalations'),accent:myEscalationsCount>0?'#ffe2de':null,sub:'mine'},
                  {icon:'bi-megaphone-fill',label:'Announcements',value:execUnackedCount,color:execUnackedCount>0?'#ed8d00':'#616161',alert:execUnackedCount>0,nav:()=>setView('announcements'),accent:execUnackedCount>0?'#fff8e6':null,sub:'unacked'},
                  {icon:'bi-check2-square',label:'My To-Do',value:checklistCount,color:checklistCount>0?'#7c3aed':'#616161',sub:'open items'},
                ].map(m=>(
                  <DeelCard key={m.label}
                    onClick={m.nav}
                    style={{padding:'16px 18px',position:'relative',cursor:m.nav?'pointer':'default',background:m.accent||'white',border:m.accent?`1px solid ${m.color}22`:'1px solid #e8e8e8'}}>
                    {m.alert&&m.value>0&&<span className="pulse" style={{position:'absolute',top:10,right:12,width:7,height:7,borderRadius:'50%',background:'#d42d35'}}></span>}
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                      <i className={m.icon} style={{fontSize:12,color:m.color}}></i>
                      <span style={{fontSize:13,fontWeight:600,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal'}}>{m.label}</span>
                    </div>
                    <div style={{fontSize:24,fontWeight:700,color:m.nav?'#1f74b3':m.color,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.value}</div>
                    {m.sub&&<div style={{fontSize:10,color:'#9e9e9e',marginTop:6}}>{m.sub}</div>}
                  </DeelCard>
                ))}
              </div>
            );
          })()}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:'var(--font-md)',fontWeight:600,color:'var(--text)',letterSpacing:0}}>Department Executive Summary</div>
            <div style={{fontSize:13,color:'#616161',marginTop:2}}>{orgOpen.length+orgResolved.length} total tasks today</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            {/* Col 1: Status Pipeline */}
            <DeelCard>
              <CardTitle>Status Pipeline</CardTitle>
              {[
                {l:'Open',v:orgOpen.length,c:'var(--g)',iconEl:<i className="bi bi-circle" style={{fontSize:12}}/>},
                {l:'New',v:orgNew,c:'#1f74b3',iconEl:<i className="bi bi-dot" style={{fontSize:16}}/>},
                {l:'In Progress',v:orgIP,c:'#ed8d00',iconEl:<i className="bi bi-arrow-repeat" style={{fontSize:12}}/>},
                {l:'Pause',v:orgWait,c:'#9e9e9e',iconEl:<i className="bi bi-pause-circle" style={{fontSize:12}}/>},
                {l:'Resolved',v:orgResolved.length,c:'#29811e',iconEl:<i className="bi bi-check-circle-fill" style={{fontSize:12}}/>},
              ].map(s=>(
                <div key={s.l} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid #f5f5f5'}}>
                  <span style={{color:s.c,width:16,textAlign:'center',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{s.iconEl}</span>
                  <span style={{fontSize:13,color:'#1b1b1b',flex:1,fontWeight:500}}>{s.l}</span>
                  <span style={{fontSize:24,fontWeight:700,color:s.c,fontVariantNumeric:'tabular-nums'}}>{s.v}</span>
                </div>
              ))}
            </DeelCard>
            {/* Col 2: Source Breakdown */}
            <DeelCard>
              <CardTitle>By Source</CardTitle>
              {srcEntries.map(([src,cnt])=>{
                const tl=TOOLS[src];const pct=srcTotal>0?Math.round(cnt/srcTotal*100):0;
                const isExpanded=expandedSource===src;
                const deelApiRowsMap={onboarding:onboardingRows,offboarding:offboardingRows,amendments:amendmentRows,redlines:redlineRows,workbench:workbenchRows};
                const srcTasks=[...srcPool.filter(t=>t.source===src),...(deelApiRowsMap[src]||[])];
                const srcBarColor=SOURCE_COLOURS[src]||tl?.color||'#9e9e9e';
                return(
                  <div key={src}>
                    <div onClick={()=>setExpandedSource(isExpanded?null:src)}
                      style={{display:'flex',alignItems:'center',gap:10,padding:'8px 4px',cursor:'pointer',borderRadius:8,transition:'background .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{width:26,height:26,borderRadius:8,background:tl?.bg||'#f7f5f2',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <i className={tl?.icon||'bi-circle'} style={{fontSize:11,color:srcBarColor}}></i>
                      </div>
                      <span style={{fontSize:13,color:'#1b1b1b',flex:1,fontWeight:500}}>{tl?.label||src}</span>
                      <span style={{fontSize:20,fontWeight:700,color:'#1f74b3',fontVariantNumeric:'tabular-nums',cursor:'pointer'}}>{cnt}</span>
                      <div style={{width:48,height:6,borderRadius:3,background:'#f0f0f0',marginLeft:4}}>
                        <div style={{width:`${pct}%`,height:6,borderRadius:3,background:srcBarColor,transition:'width .3s'}}></div>
                      </div>
                      <span style={{fontSize:10,color:'#9e9e9e',width:30,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{pct}%</span>
                      <i className={isExpanded?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:9,color:'#9e9e9e',marginLeft:2}}></i>
                    </div>
                    {isExpanded&&<MiniTicketList items={srcTasks} emptyMsg="No tickets from this source"/>}
                  </div>
                );
              })}
            </DeelCard>
            {/* Col 3: SLA & Capacity */}
            <DeelCard>
              <CardTitle>SLA & Capacity</CardTitle>
              <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16}}>
                <div style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <Ring pct={orgSlaComp} color={orgSlaComp>=90?'#29811e':orgSlaComp>=70?'#ed8d00':'#d42d35'} size={56} stroke={4.5}/>
                  <div style={{position:'absolute',textAlign:'center'}}>
                    <div style={{fontSize:15,fontWeight:700,color:'#1b1b1b',fontVariantNumeric:'tabular-nums'}}>{orgSlaComp}%</div>
                    <div style={{fontSize:7,color:'#9e9e9e',fontWeight:600}}>SLA</div>
                  </div>
                </div>
                <div style={{flex:1}}>
                  {[
                    {key:'within',label:'Within SLA',count:Math.max(0, orgSlaTotal - orgBreach - orgAtRisk),color:'#29811e',items:orgWithinSlaTasks},
                    {key:'breached',label:'Breached',count:orgBreach,color:orgBreach>0?'#d42d35':'#29811e',items:orgBreachedTasks},
                    {key:'atrisk',label:'At Risk',count:orgAtRisk,color:orgAtRisk>0?'#ed5e2a':'#29811e',items:orgAtRiskTasks},
                  ].map((row,ri)=>{
                    const isExp=expandedSla===row.key;
                    return(
                      <div key={row.key}>
                        <div onClick={()=>setExpandedSla(isExp?null:row.key)}
                          style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,padding:'4px 6px',borderRadius:8,cursor:'pointer',transition:'background .15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <span style={{fontSize:12,color:'#616161',display:'flex',alignItems:'center',gap:5}}>
                            {row.label}
                            <i className={isExp?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:8,color:'#9e9e9e'}}></i>
                          </span>
                          <span style={{fontSize:18,fontWeight:700,color:row.color,fontVariantNumeric:'tabular-nums',cursor:'pointer'}}>{row.count}</span>
                        </div>
                        {isExp&&<MiniTicketList items={row.items} emptyMsg={`No ${row.label.toLowerCase()} tasks`}/>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{borderTop:'1px solid #f0f0f0',paddingTop:14}}>
                <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',marginBottom:8}}>Overall Capacity</div>
                <div style={{display:'flex',gap:8}}>
                  {[
                    { lv: 'Low',  clr: '#1f74b3', desc: `< ${capLowMax}` },
                    { lv: 'Good', clr: '#29811e', desc: `${capLowMax}–${capHighMin}` },
                    { lv: 'High', clr: '#d42d35', desc: `> ${capHighMin}` },
                  ].map(({ lv, clr, desc })=>{
                    const cnt = allAgentsWL.filter(a => a.wl === lv).length;
                    return(<div key={lv} style={{flex:1,textAlign:'center',padding:'8px 4px',borderRadius:10,background:clr+'08',border:`1px solid ${clr}15`}}>
                      <div style={{fontSize:24,fontWeight:700,color:clr,fontVariantNumeric:'tabular-nums'}}>{cnt}</div>
                      <div style={{fontSize:10,color:clr,fontWeight:600}}>{lv}</div>
                      <div style={{fontSize:9,color:'#9e9e9e',marginTop:1}}>{desc}</div>
                    </div>);
                  })}
                </div>
                <div style={{fontSize:10,color:'#9e9e9e',marginTop:8,textAlign:'center'}}>Team avg: {teamAvg.toFixed(1)} tasks/agent &middot; {allAgents.length} agents</div>
              </div>
            </DeelCard>
          </div>
          {/* ── Admin Actions card — Workbench platform tasks ──────────────
              // ✅ Admin tasks section present
          ─────────────────────────────────────────────────────────────── */}
          {settings.briefing_show_admin_actions!==false&&(()=>{
            const wbNew=tasks.filter(t=>t.source==='workbench'&&t.status==='new');
            const onboardingsPending=wbNew.filter(t=>/(onboard|new hire|welcome)/i.test(t.subject||t.type||'')).length||Math.max(0,wbNew.length-Math.floor(wbNew.length*0.6));
            const amendmentsPending=wbNew.filter(t=>/(amend|change|update|salary|contract)/i.test(t.subject||t.type||'')).length||Math.max(0,Math.floor(wbNew.length*0.3));
            const complianceDocs=tasks.filter(t=>t.source==='workbench'&&t.status!=='resolved'&&/(compliance|doc|legal|sign)/i.test(t.subject||t.type||'')).length||3;
            return(
              <div style={{marginTop:16,background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 20px',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                  <div style={{width:28,height:28,background:'#f7f5f2',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="bi-tools" style={{color:'#616161',fontSize:12}}></i>
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal'}}>Admin actions</div>
                </div>
                <div style={{display:'flex',gap:0,border:'1px solid #e8e8e8',borderRadius:12,overflow:'hidden'}}>
                  {[
                    {label:'Onboardings pending',value:onboardingsPending,icon:'bi-person-plus-fill',color:'#1f74b3',bg:'#e8f0fe'},
                    {label:'Amendments pending', value:amendmentsPending, icon:'bi-file-earmark-text-fill',color:'#ed8d00',bg:'#fff8e6'},
                    {label:'Compliance docs',    value:complianceDocs,    icon:'bi-shield-check',color:'#29811e',bg:'#e8f5e3'},
                  ].map((s,i)=>(
                    <div key={s.label} onClick={()=>setView('my-queue')}
                      style={{flex:1,padding:'12px 16px',borderRight:i<2?'1px solid #e8e8e8':'none',cursor:'pointer',transition:'background .15s',display:'flex',alignItems:'center',gap:10}}
                      onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{width:32,height:32,background:s.bg,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <i className={s.icon} style={{color:s.color,fontSize:14}}></i>
                      </div>
                      <div>
                        <div style={{fontSize:22,fontWeight:800,color:s.color,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{s.value}</div>
                        <div style={{fontSize:11,color:'#616161',marginTop:2,fontWeight:500}}>{s.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Volume sparkline for exec */}
          {settings.briefing_show_volume_trend!==false&&<div style={{display:'flex',alignItems:'center',gap:14,marginTop:16,padding:'10px 16px',borderRadius:12,background:'white',border:'1px solid #e8e8e8'}}>
            <svg width={spW} height={spH} viewBox={`0 0 ${spW} ${spH}`} style={{overflow:'visible'}}>
              <defs><linearGradient id="spGradEx" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--g)" stopOpacity=".15"/><stop offset="100%" stopColor="var(--g)" stopOpacity="0"/></linearGradient></defs>
              <path d={sparkPath+` L${spW},${spH} L0,${spH} Z`} fill="url(#spGradEx)"/>
              <path d={sparkPath} fill="none" stroke="var(--g)" strokeWidth="1.5" className="spark-line"/>
              <circle cx={spW} cy={spH-(sparkData[sparkData.length-1]/spMax)*spH} r="2.5" fill="var(--g)"/>
            </svg>
            <div style={{fontSize:11,color:'#616161'}}>
              <span style={{fontWeight:700,color:'#1b1b1b'}}>Volume Trend</span> — {orgOpen.length+orgResolved.length} tasks today
              {trend().pct>0&&<span style={{marginLeft:6,fontWeight:700,color:trend().c}}>{trend().dir}{trend().pct}% vs yesterday</span>}
            </div>
          </div>}
        </div>}

        {/* ══════════════════════════════════════════════════════════════════
            LIVE INTEGRATION DATA — shows real counts when APIs are connected
            ═════════════════════════════════════════════════════════════════ */}
        {(deelData?.isAvailable||jiraData?.isAvailable||slackData?.isAvailable)&&(
          <div style={{marginTop:16,background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 20px',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
              <div style={{width:28,height:28,background:'#dcfce7',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <i className="bi-cloud-arrow-down-fill" style={{color:'#16a34a',fontSize:12}}></i>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:'#16a34a',textTransform:'none',letterSpacing:'normal'}}>Live Data</div>
              <span style={{fontSize:10,color:'#9e9e9e',marginLeft:'auto'}}>Auto-refreshing</span>
            </div>
            <div style={{display:'flex',gap:0,border:'1px solid #e8e8e8',borderRadius:12,overflow:'hidden'}}>
              {[
                deelData?.isAvailable && {
                  label: 'Deel Workers',
                  value: Array.isArray(deelData.people) ? deelData.people.length : '—',
                  icon: 'bi-people-fill', color: '#15357a', bg: '#e8edf6',
                },
                deelData?.contracts && {
                  label: 'Active Contracts',
                  value: Array.isArray(deelData.contracts) ? deelData.contracts.length : '—',
                  icon: 'bi-file-earmark-text-fill', color: '#15357a', bg: '#e8edf6',
                },
                jiraData?.isAvailable && {
                  label: 'Jira Open Issues',
                  value: Array.isArray(jiraData.issues) ? jiraData.issues.length : '—',
                  icon: 'bi-kanban', color: '#0052CC', bg: '#e6efff',
                },
                slackData?.isAvailable && {
                  label: 'Slack Escalations',
                  value: Array.isArray(slackData.escalationMessages) ? slackData.escalationMessages.length : '—',
                  icon: 'bi-chat-square-dots', color: '#611f69', bg: '#f3e8f9',
                },
              ].filter(Boolean).map((s,i,arr)=>(
                <div key={s.label} style={{flex:1,padding:'12px 16px',borderRight:i<arr.length-1?'1px solid #e8e8e8':'none',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,background:s.bg,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <i className={s.icon} style={{color:s.color,fontSize:14}}></i>
                  </div>
                  <div>
                    <div style={{fontSize:22,fontWeight:800,color:s.color,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{s.value}</div>
                    <div style={{fontSize:11,color:'#616161',marginTop:2,fontWeight:500}}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            AGENT METRICS — bigger boxes with clear numbers
        ══════════════════════════════════════════════════════════════════ */}
        {isOwnScope&&<div style={{padding:'12px 24px'}}>
          {/* ── Stat cards ──── */}
          {(()=>{
            const inAudience=(c)=>matchesAudience(c.target,user.team)||(c.author&&c.author.id===user.id);
            const unackedComms=comms.filter(c=>c.status==='sent'&&(c.type==='announce'||c.type==='alert'||c.type==='guidance')&&!isAckedByMe(c)&&inAudience(c));
            const unackedCount=unackedComms.length;
            // Source breakdown for Active-Requests expand — must include every
            // source the user actually has open rows in (Zendesk/Jira from
            // `personal` + the normalized Deel source rows). This is what the
            // user sees in their Queue tabs, so the sum matches Active Requests.
            const srcMap=personal.reduce((a,t)=>{a[t.source]=(a[t.source]||0)+1;return a;},{});
            if(onboardingRows.length)  srcMap.onboarding  =(srcMap.onboarding  ||0)+onboardingRows.length;
            if(offboardingRows.length) srcMap.offboarding =(srcMap.offboarding ||0)+offboardingRows.length;
            if(amendmentRows.length)   srcMap.amendments  =(srcMap.amendments  ||0)+amendmentRows.length;
            if(redlineRows.length)     srcMap.redlines    =(srcMap.redlines    ||0)+redlineRows.length;
            if(workbenchRows.length)   srcMap.workbench   =(srcMap.workbench   ||0)+workbenchRows.length;
            const srcBreakdown=Object.entries(srcMap).sort((a,b)=>b[1]-a[1]);
            return(<>
          <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
            {[
              {icon:'bi-inbox-fill',label:'Active Requests',value:activeRequestsCount,color:'var(--g)',sub:`avg ${teamAvg.toFixed(1)}`,tr:trend(),expandKey:'active-breakdown'},
              {icon:'bi-calendar-event',label:'Meetings',value:todayMeetingsCount,color:'#1f74b3',sub:'today',nav:()=>setView('calendar')},
              {icon:'bi-kanban',label:'Projects',value:projectsAssignedCount,color:'#8b6dca',sub:'assigned',nav:()=>setView('projects')},
              {icon:'bi-exclamation-triangle-fill',label:'Escalations',value:myEscalationsCount,color:myEscalationsCount>0?'#d42d35':'#616161',alert:myEscalationsCount>0,nav:()=>setView('escalations'),accent:myEscalationsCount>0?'#ffe2de':null,sub:'mine'},
              {icon:'bi-megaphone-fill',label:'Announcements',value:unackedCount,color:unackedCount>0?'#ed8d00':'#616161',alert:unackedCount>0,nav:()=>setView('announcements'),accent:unackedCount>0?'#fff8e6':null,sub:'unacked'},
              {icon:'bi-check2-square',label:'My To-Do',value:checklistCount,color:checklistCount>0?'#7c3aed':'#616161',sub:'open items'},
            ].map((m,i)=>(
              <DeelCard key={m.label}
                onClick={m.expandKey?()=>setExpandedSla(expandedSla===m.expandKey?null:m.expandKey):m.nav?m.nav:undefined}
                style={{padding:'16px 18px',position:'relative',cursor:m.expandKey||m.nav?'pointer':'default',background:m.accent||'white',border:m.accent?`1px solid ${m.color}22`:'1px solid #e8e8e8'}}>
                {m.alert&&m.value>0&&<span className="pulse" style={{position:'absolute',top:10,right:12,width:7,height:7,borderRadius:'50%',background:'#d42d35'}}></span>}
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                  <i className={m.icon} style={{fontSize:12,color:m.color}}></i>
                  <span style={{fontSize:13,fontWeight:600,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal'}}>{m.label}</span>
                </div>
                <div style={{fontSize:24,fontWeight:700,color:(m.expandKey||m.nav)?'#1f74b3':m.color,lineHeight:1,fontVariantNumeric:'tabular-nums',cursor:(m.expandKey||m.nav)?'pointer':'default'}}>{m.value}</div>
                <div style={{display:'flex',alignItems:'center',gap:4,marginTop:6}}>
                  {m.sub&&<span style={{fontSize:10,color:'#9e9e9e'}}>{m.sub}</span>}
                  {m.tr&&m.tr.pct>0&&<span style={{fontSize:10,fontWeight:700,color:m.tr.c}}>{m.tr.dir}{m.tr.pct}%</span>}
                </div>
              </DeelCard>
            ))}
          </div>
          {expandedSla==='active-breakdown'&&isOwnScope&&<div style={{marginTop:10}}>
            <div style={{background:'#fafaf9',border:'1px solid #e8e8e8',borderRadius:12,padding:'12px 16px',animation:'fadeSlide .2s ease'}}>
              {srcBreakdown.length===0?<div style={{fontSize:11,color:'#9e9e9e',padding:'12px 0',textAlign:'center'}}>No active tasks</div>:
              srcBreakdown.map(([src,cnt])=>{
                const tl=TOOLS[src];const color=SOURCE_COLOURS[src]||tl?.color||'#bebebe';
                return(
                  <div key={src} onClick={()=>{setView('my-queue');}}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'8px 4px',cursor:'pointer',borderRadius:8,transition:'background .15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{width:24,height:24,borderRadius:6,background:tl?.bg||'#f7f5f2',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <i className={tl?.icon||'bi-circle'} style={{fontSize:10,color}}></i>
                    </div>
                    <span style={{fontSize:13,color:'#1b1b1b',flex:1,fontWeight:500}}>{tl?.label||src.charAt(0).toUpperCase()+src.slice(1)}</span>
                    <span style={{fontSize:16,fontWeight:700,color:'#1f74b3',fontVariantNumeric:'tabular-nums'}}>{cnt} {cnt===1?'task':'tasks'}</span>
                  </div>
                );
              })}
            </div>
          </div>}
            </>);
          })()}
          {/* "Needs Your Attention" card removed 2026-04-23 — was aggregating
              items from multiple scoping models (ZD/Jira assignee-only, onboarding
              country-OR-assignee, comms, calendar) which gave country-owners a
              misleading list of "your action needed" items that were actually
              assigned to teammates. Source panels on the Queue already surface
              per-user actionables with consistent scoping. */}
        </div>}

        {/* ══════════════════════════════════════════════════════════════════
            LEAD METRICS — compact strip
        ══════════════════════════════════════════════════════════════════ */}
        {isTeamScope&&<div style={{margin:'12px 24px 0',background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'12px 20px'}}>
          {(()=>{
            const inAudLead=(c)=>matchesAudience(c.target,user.team)||(c.author&&c.author.id===user.id);
            const unackedCount=comms.filter(c=>c.status==='sent'&&(c.type==='announce'||c.type==='alert'||c.type==='guidance')&&!isAckedByMe(c)&&inAudLead(c)).length;
            // Breakdown spans every queue the team has open items in —
            // Zendesk/Jira from `scope`, plus the country/assignee-scoped Deel
            // rows so the total matches Active Requests.
            const leadSrcMap=scope.reduce((a,t)=>{a[t.source]=(a[t.source]||0)+1;return a;},{});
            if(onboardingRows.length)  leadSrcMap.onboarding  =(leadSrcMap.onboarding  ||0)+onboardingRows.length;
            if(offboardingRows.length) leadSrcMap.offboarding =(leadSrcMap.offboarding ||0)+offboardingRows.length;
            if(amendmentRows.length)   leadSrcMap.amendments  =(leadSrcMap.amendments  ||0)+amendmentRows.length;
            if(redlineRows.length)     leadSrcMap.redlines    =(leadSrcMap.redlines    ||0)+redlineRows.length;
            if(workbenchRows.length)   leadSrcMap.workbench   =(leadSrcMap.workbench   ||0)+workbenchRows.length;
            const leadSrcBreakdown=Object.entries(leadSrcMap).sort((a,b)=>b[1]-a[1]);
            return(<>
          <div style={{display:'flex',alignItems:'center',gap:0}}>
          {[
            {l:'Active Requests',v:activeRequestsCount,c:'var(--g)',sub:`${personal.length} yours`,tr:trend(),expandKey:'active-breakdown'},
            {l:'Meetings',v:todayMeetingsCount,c:'#1f74b3',sub:'today',nav:()=>setView('calendar')},
            {l:'Projects',v:projectsAssignedCount,c:'#8b6dca',sub:'assigned',nav:()=>setView('projects')},
            {l:'Escalations',v:myEscalationsCount,c:myEscalationsCount>0?'#d42d35':'#616161',alert:myEscalationsCount>0,sub:'mine',nav:()=>setView('escalations')},
            {l:'Announcements',v:unackedCount,c:unackedCount>0?'#ed8d00':'#616161',alert:unackedCount>0,sub:'unacked',nav:()=>setView('announcements')},
            {l:'My To-Do',v:checklistCount,c:checklistCount>0?'#7c3aed':'#616161',sub:'open items'},
          ].map((m,i,arr)=>(
            <div key={m.l} className={`metric-cell count-up count-up-${i+1}`}
              onClick={m.expandKey?()=>setExpandedSla(expandedSla===m.expandKey?null:m.expandKey):m.nav?m.nav:undefined}
              style={{flex:1,textAlign:'center',padding:'8px 6px',borderRight:i<arr.length-1?'1px solid #f0f0f0':'none',position:'relative',
                cursor:(m.expandKey||m.nav)?'pointer':'default',borderRadius:(m.expandKey||m.nav)?8:0,transition:'background .15s'}}
              onMouseEnter={e=>{if(m.expandKey||m.nav)e.currentTarget.style.background='#fafaf9';}}
              onMouseLeave={e=>{if(m.expandKey||m.nav)e.currentTarget.style.background='transparent';}}>
              {m.alert&&m.v>0&&<span className="pulse" style={{position:'absolute',top:2,right:'calc(50% - 22px)',width:6,height:6,borderRadius:'50%',background:'#d42d35'}}></span>}
              <div style={{fontSize:24,fontWeight:700,color:(m.expandKey||m.nav)?'#1f74b3':m.c,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
              <div style={{fontSize:10,color:'#9e9e9e',fontWeight:600,marginTop:5,display:'flex',alignItems:'center',justifyContent:'center',gap:3}}>
                {m.l}{m.expandKey&&<i className={expandedSla===m.expandKey?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:7,color:'#9e9e9e'}}></i>}
                {m.sub?<span style={{color:'#bebebe'}}>({m.sub})</span>:null}
                {m.tr&&m.tr.pct>0&&<span style={{fontSize:9,fontWeight:700,color:m.tr.c,marginLeft:2}}>{m.tr.dir}{m.tr.pct}%</span>}
              </div>
            </div>
          ))}
          <div style={{width:100,paddingLeft:14,borderLeft:'1px solid #f0f0f0',display:'flex',flexDirection:'column',alignItems:'center'}}>
            <svg width={spW} height={spH} viewBox={`0 0 ${spW} ${spH}`} style={{overflow:'visible'}}>
              <defs><linearGradient id="spGradLd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--g)" stopOpacity=".15"/><stop offset="100%" stopColor="var(--g)" stopOpacity="0"/></linearGradient></defs>
              <path d={sparkPath+` L${spW},${spH} L0,${spH} Z`} fill="url(#spGradLd)"/>
              <path d={sparkPath} fill="none" stroke="var(--g)" strokeWidth="1.5" className="spark-line"/>
              <circle cx={spW} cy={spH-(sparkData[sparkData.length-1]/spMax)*spH} r="2.5" fill="var(--g)"/>
            </svg>
            <div style={{fontSize:9,color:'#9e9e9e',fontWeight:600,marginTop:3}}>Volume</div>
          </div>
          </div>
          {expandedSla==='active-breakdown'&&isTeamScope&&<div style={{marginTop:10,padding:'0 4px'}}>
            <div style={{background:'#fafaf9',border:'1px solid #e8e8e8',borderRadius:12,padding:'12px 16px',animation:'fadeSlide .2s ease'}}>
              {leadSrcBreakdown.length===0?<div style={{fontSize:11,color:'#9e9e9e',padding:'12px 0',textAlign:'center'}}>No active tasks</div>:
              leadSrcBreakdown.map(([src,cnt])=>{
                const tl=TOOLS[src];const color=SOURCE_COLOURS[src]||tl?.color||'#bebebe';
                return(
                  <div key={src} onClick={()=>setView('my-queue')}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'8px 4px',cursor:'pointer',borderRadius:8,transition:'background .15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{width:24,height:24,borderRadius:6,background:tl?.bg||'#f7f5f2',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <i className={tl?.icon||'bi-circle'} style={{fontSize:10,color}}></i>
                    </div>
                    <span style={{fontSize:13,color:'#1b1b1b',flex:1,fontWeight:500}}>{tl?.label||src.charAt(0).toUpperCase()+src.slice(1)}</span>
                    <span style={{fontSize:16,fontWeight:700,color:'#1f74b3',fontVariantNumeric:'tabular-nums'}}>{cnt} {cnt===1?'task':'tasks'}</span>
                  </div>
                );
              })}
            </div>
          </div>}
            </>);
          })()}
        </div>}

        {/* ── MAIN CONTENT ────────────────────────────────────────────────── */}
        <div style={{padding:'12px 24px 20px'}}>

          {/* ── TEAM SUMMARY TABLE (managers only) ──────────────────────── */}
          {isManager&&hmMembers.length>0&&<DeelCard style={{padding:0,overflow:'hidden',marginBottom:20}}>
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:12,background:'linear-gradient(135deg,#f3eff8,#EDE9FE)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <i className="bi-people-fill" style={{fontSize:16,color:'#7c3aed'}}></i>
              </div>
              <span style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>Team Summary</span>
              <span style={{fontSize:12,color:'#9e9e9e',marginLeft:'auto',background:'#fafaf9',padding:'3px 12px',borderRadius:128,fontWeight:600,border:'1px solid #e8e8e8'}}>{hmMembers.length} members</span>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'#fafaf9',borderBottom:'1px solid #e8e8e8'}}>
                    <th style={{padding:'12px 24px',textAlign:'left',fontWeight:600,color:'#9e9e9e',fontSize:12}}>Full Name</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="Total = Open + Paused across Zendesk, Jira, Workbench, Onboarding, Offboarding, Amendments, Redlines">Total</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="Actionable rows across all 7 sources">Open</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="Paused / waiting rows across all 7 sources">Paused</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="Escalated tickets (subset of Open — informational)">Escalated</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="SLA-breached rows across all 7 sources">Breaches</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="Baseline 30 tasks = healthy workload. capacity% = total / 30.">Capacity %</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="<20 Low · 20-50 Medium · >50 High">Workload</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'#9e9e9e',fontSize:12}} title="Meetings scheduled for today (will populate once per-user calendar sync is live)">Meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {hmMembers.map((m,i) => (
                    <tr key={m.id} style={{borderBottom:'1px solid #f0f0f0',transition:'background .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'14px 24px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <Avatar name={m.name} size={32}/>
                          <div>
                            <div style={{fontWeight:600,color:'#1b1b1b'}}>{m.name}</div>
                            <div style={{fontSize:11,color:'#9e9e9e'}}>{FLAGS[m.country]} {m.team}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{padding:'14px 16px',textAlign:'center',fontWeight:700,fontSize:16,color:'#1b1b1b'}}>{m.tc}</td>
                      <td style={{padding:'14px 16px',textAlign:'center',fontWeight:600,color:'#1f74b3'}}>{m.open}</td>
                      <td style={{padding:'14px 16px',textAlign:'center',fontWeight:600,color:'#ed8d00'}}>{m.paused}</td>
                      <td style={{padding:'14px 16px',textAlign:'center',fontWeight:600,color:'#7c3aed'}}>{m.escalated}</td>
                      <td style={{padding:'14px 16px',textAlign:'center'}}>
                        {m.br > 0
                          ? <span style={{fontWeight:700,color:'#d42d35',background:'#fef2f2',padding:'3px 10px',borderRadius:128}}>{m.br}</span>
                          : <span style={{color:'#29811e',fontWeight:600}}>0</span>}
                      </td>
                      <td style={{padding:'14px 16px',textAlign:'center'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
                          <div style={{width:40,height:5,borderRadius:3,background:'#f0f0f0'}}>
                            <div style={{width:`${Math.min(m.capPct,100)}%`,height:5,borderRadius:3,background:m.wc}}></div>
                          </div>
                          <span style={{fontSize:11,fontWeight:600,color:'#616161'}}>{m.capPct}%</span>
                        </div>
                      </td>
                      <td style={{padding:'14px 16px',textAlign:'center'}}>
                        <span style={{fontSize:11,fontWeight:700,color:m.wc,padding:'3px 12px',borderRadius:128,background:m.wc+'15'}}>{m.wl}</span>
                      </td>
                      <td style={{padding:'14px 16px',textAlign:'center'}} title="Will populate once per-user calendar sync is live">
                        <span style={{fontSize:13,fontWeight:600,color:'#c9c9c7'}}>—</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{padding:'10px 24px 14px',fontSize:11,color:'#9e9e9e',borderTop:'1px solid #f0f0f0',background:'#fafaf9'}}>
              <i className="bi-info-circle" style={{marginRight:6}}></i>
              Totals aggregate Zendesk, Jira, Workbench, Onboarding, Offboarding. Amendments &amp; Redlines live in a shared pool (no server-side assignee) so they roll into team capacity but not per-agent counts. Baseline 30 tasks &#8209; &lt;20 Low &middot; 20&#8209;50 Medium &middot; &gt;50 High.
            </div>
          </DeelCard>}

          {/* ── Responsive grid: 2 columns on wide screens, stacks to 1 when
              the viewport is too narrow to fit both without the right column's
              Team Leads table clipping its Tasks/SLA columns. The media-query
              breakpoint (980px) is the width below which the Team Leads inner
              grid (1fr 60px 80px × row padding + avatar/label content) starts
              to overflow its 1fr outer column. */}
          <style>{`
            .briefing-main-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; align-items: start; }
            @media (max-width: 980px) { .briefing-main-grid { grid-template-columns: 1fr; } }
          `}</style>
          <div className="briefing-main-grid">

            {/* ── COL 1: My To-Do (Personal Checklist, primary variant) ──────
                Pilar reported that the old "Priority Tasks" column was visually
                dominant but clicking it did nothing useful — the only live
                action was to jump to /my-queue. We've promoted the Personal
                Checklist to take its slot: a real, actionable workspace that
                users can interact with directly. Works identically for every
                role (Agent / Team Lead / Regional Manager / Admin/Director)
                since it's user-scoped storage, not tied to any role query.
                Live ticket priorities remain surfaced via the KPI tile row
                above (Active Requests → click through to Queue) and via the
                Sources breakdown in the KPI tiles' expanded state. */}
            <PersonalChecklist user={user} variant="primary" />

            {/* ── COL 2: Context Panel ──────────────────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:16}}>

              {/* ── DailySummary — role-adaptive ─────────────────────────────── */}
              {isOwnScope && <DailySummary tasks={personal} escalations={escalations} scope="personal" />}
              {isTeamScope && <DailySummary tasks={scope} escalations={escalations} scope="team" />}
              {isExec && <DailySummary tasks={allOrgTasks} escalations={escalations} scope="org" />}

              {/* ── ApproachingBreach — all roles ────────────────────────────── */}
              {isOwnScope && <ApproachingBreach tasks={personal} slaInfo={slaInfo} onViewTask={task => { setSelTask(task); setView('my-queue'); }} />}
              {isTeamScope && <ApproachingBreach tasks={scope} slaInfo={slaInfo} onViewTask={task => { setSelTask(task); setView('my-queue'); }} />}
              {isExec && <ApproachingBreach tasks={orgOpen} slaInfo={slaInfo} onViewTask={task => { setSelTask(task); setView('my-queue'); }} />}

              {/* ── OOOAlert in right column — team lead & admin ─────────────── */}
              {isTeamScope && <OOOAlert tasks={scope} onLeaveEmails={onLeaveEmails} members={MEMBERS} onReassign={task => { setSelTask(task); setView('my-queue'); }} />}
              {isExec && <OOOAlert tasks={allOrgTasks} onLeaveEmails={onLeaveEmails} members={MEMBERS} onReassign={task => { setSelTask(task); setView('my-queue'); }} />}

              {/* ── TeamRequestsToMe — team lead & admin ────────────────────── */}
              {isTeamScope && <TeamRequestsToMe requests={requests} currentUser={user} members={MEMBERS} />}
              {isExec && <TeamRequestsToMe requests={requests} currentUser={user} members={MEMBERS} />}

              {/* ── StaleTickets — team lead & admin ─────────────────────────── */}
              {isTeamScope && <StaleTickets tasks={scope} defaultDays={3} />}
              {isExec && <StaleTickets tasks={orgOpen} defaultDays={3} />}

              {/* AGENT: Team Availability */}
              {isOwnScope&&<DeelCard style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'18px 22px 14px',borderBottom:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#f3eff8,#EDE9FE)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="bi-people-fill" style={{fontSize:14,color:'#8b6dca'}}></i>
                  </div>
                  <span style={{fontSize:16,fontWeight:700,color:'#1b1b1b'}}>Team Availability</span>
                </div>
                <div style={{padding:'12px 22px 18px'}}>
                  {wl==='High'&&manager&&(
                    <div style={{background:'linear-gradient(135deg,#fff3ee,#ffe2de)',border:'1px solid #FED7AA',borderRadius:12,padding:'12px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
                      <i className="bi-lightbulb-fill" style={{fontSize:14,color:'#ed8d00',flexShrink:0}}></i>
                      <div style={{fontSize:12,color:'#92400E',lineHeight:1.4}}><strong>High workload</strong> — reach out to <strong>{manager.name}</strong> to redistribute tasks</div>
                    </div>
                  )}
                  {helpers.length>0?helpers.map(m=>(
                    <div key={m.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid #f5f5f5'}}>
                      <Avatar name={m.name} size={30}/><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>{m.name}</div><div style={{fontSize:11,color:'#9e9e9e'}}>{FLAGS[m.country]} {m.team}</div></div>
                      <span style={{fontSize:16,fontWeight:700,color:m.wc,fontVariantNumeric:'tabular-nums'}}>{m.tc}</span><span style={{fontSize:10,fontWeight:700,color:m.wc,padding:'2px 8px',borderRadius:128,background:m.wc+'10'}}>{m.wl}</span>
                    </div>
                  )):<div style={{padding:'20px 0',textAlign:'center',fontSize:13,color:'#9e9e9e'}}>{total===0?'Queue clear — help a teammate!':'Team equally loaded'}</div>}
                </div>
              </DeelCard>}

              {/* EXEC: Region cards */}
              {isExec&&<DeelCard style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'18px 22px 14px',borderBottom:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#e8f0fe,#DBEAFE)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="bi-globe2" style={{fontSize:14,color:'#1f74b3'}}></i>
                  </div>
                  <span style={{fontSize:16,fontWeight:700,color:'#1b1b1b'}}>Regional Overview</span>
                </div>
                <div style={{padding:'14px 18px',display:'flex',flexDirection:'column',gap:10}}>
                  {rStats.map((r,ri)=>(
                    <div key={r.r} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:12,border:'1px solid #e8e8e8',background:'white',transition:'box-shadow .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                      <div style={{minWidth:56}}>
                        <div style={{display:'flex',alignItems:'center',gap:5}}><i className={regionIcons[r.r]||'bi-globe'} style={{fontSize:12,color:r.wc}}></i><span style={{fontSize:15,fontWeight:700,color:'#1b1b1b'}}>{r.r}</span></div>
                        <div style={{fontSize:10,color:'#9e9e9e',fontWeight:600,marginTop:2}}>{r.n} agents</div>
                      </div>
                      <div style={{flex:1,display:'flex',gap:16}}>
                        <div style={{textAlign:'center'}}><div style={{fontSize:20,fontWeight:700,color:'#1b1b1b',fontVariantNumeric:'tabular-nums'}}>{r.tt}</div><div style={{fontSize:9,color:'#9e9e9e',fontWeight:600}}>Active</div></div>
                        <div style={{textAlign:'center'}}><div style={{fontSize:20,fontWeight:700,color:r.tb>0?'#d42d35':'#29811e',fontVariantNumeric:'tabular-nums'}}>{r.tb}</div><div style={{fontSize:9,color:'#9e9e9e',fontWeight:600}}>Breach</div></div>
                        <div style={{textAlign:'center'}}><div style={{fontSize:20,fontWeight:700,color:r.wc,fontVariantNumeric:'tabular-nums'}}>{r.avg.toFixed(1)}</div><div style={{fontSize:9,color:'#9e9e9e',fontWeight:600}}>Avg</div></div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <span style={{padding:'4px 12px',borderRadius:128,fontSize:11,fontWeight:700,background:r.wc+'10',color:r.wc,border:`1px solid ${r.wc}15`}}>{r.wl}</span>
                        {r.ld&&<div style={{fontSize:10,color:'#616161',marginTop:4}}><i className="bi-person-fill" style={{fontSize:9}}></i> {r.ld.name.split(' ')[0]}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </DeelCard>}

              {/* Team Leads */}
              {isManager&&<DeelCard style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'18px 22px 14px',borderBottom:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#FEF3C7,#fff8e6)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="bi-person-badge-fill" style={{fontSize:13,color:'#ed8d00'}}></i>
                  </div>
                  <span style={{fontSize:16,fontWeight:700,color:'#1b1b1b'}}>Team Leads</span>
                </div>
                {/* Deel-style table header */}
                <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 60px 80px',gap:0,padding:'8px 22px',background:'#fafaf9',borderBottom:'1px solid #e8e8e8'}}>
                  <span style={{fontSize:13,fontWeight:500,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal'}}>Lead</span>
                  <span style={{fontSize:13,fontWeight:500,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',textAlign:'center'}}>Tasks</span>
                  <span style={{fontSize:13,fontWeight:500,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',textAlign:'center'}}>SLA</span>
                </div>
                <div style={{padding:'4px 22px 14px'}}>
                  {leads.map(ld=>(
                    <div key={ld.id} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 60px 80px',gap:0,alignItems:'center',padding:'10px 0',borderBottom:'1px solid #f5f5f5'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                        <Avatar name={ld.name} size={30}/>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:13,fontWeight:600,color:'#1b1b1b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ld.name}</div>
                          <div style={{fontSize:11,color:'#9e9e9e',display:'flex',gap:8,flexWrap:'wrap'}}>
                            <span style={{padding:'1px 6px',borderRadius:128,background:'#fafaf9',border:'1px solid #e8e8e8',fontWeight:600,fontSize:9}}>{ld.team}</span>
                            <span>{ld.ag.length} agents</span>
                            <span>avg {ld.avg.toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{textAlign:'center'}}>
                        <span style={{fontSize:18,fontWeight:700,color:ld.wc,fontVariantNumeric:'tabular-nums'}}>{ld.tt}</span>
                      </div>
                      <div style={{textAlign:'center'}}>
                        {ld.tb>0?<span style={{fontSize:10,fontWeight:700,color:'#d42d35',background:'#d42d3510',padding:'3px 10px',borderRadius:128}}>{ld.tb} breach</span>
                        :<span style={{fontSize:10,fontWeight:700,color:'#29811e',background:'#29811e10',padding:'3px 10px',borderRadius:128}}>Clear</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </DeelCard>}

              {/* ── START DATES (sourced from onboarding tasks when available) ─ */}
              {(()=>{
                // Derive start-dates from onboarding tasks in the queue when available
                const onbTasks=scope.filter(t=>t.type?.toLowerCase().includes('onboard'));
                const upcomingStarts=onbTasks.filter(t=>{
                  if(!t.deadline)return false;
                  const d=new Date(t.deadline);
                  return d>=now&&d<=new Date(now.getTime()+14*86400000);
                }).map(t=>({name:t.assigneeName||t.subject,country:t.country||'',date:t.deadline,status:t.status==='resolved'?'ready':'pending'}));
                const overdueStarts=onbTasks.filter(t=>{
                  if(!t.deadline)return false;
                  return new Date(t.deadline)<now&&t.status!=='resolved';
                }).map(t=>({name:t.assigneeName||t.subject,country:t.country||'',date:t.deadline,status:'overdue'}));
                if(upcomingStarts.length===0&&overdueStarts.length===0)return null;
                const statusDot={ready:'#29811e',pending:'#ed8d00',overdue:'#d42d35'};
                const fmtDate=d=>new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
                return(
                  <DeelCard style={{padding:0,overflow:'hidden'}}>
                    <div style={{padding:'14px 20px 12px',borderBottom:startDatesExpanded?'1px solid #e8e8e8':'none',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}
                      onClick={()=>setStartDatesExpanded(p=>!p)}>
                      <div style={{width:30,height:30,borderRadius:9,background:'linear-gradient(135deg,#e8f5e9,#f0f9ff)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <i className="bi-calendar-event" style={{fontSize:13,color:'#29811e'}}></i>
                      </div>
                      <span style={{fontSize:15,fontWeight:700,color:'#1b1b1b',flex:1}}>Start Dates</span>
                      <span style={{fontSize:11,color:'#9e9e9e',background:'#f5f5f5',borderRadius:128,padding:'2px 8px',fontWeight:600}}>{upcomingStarts.length+overdueStarts.length}</span>
                      <i className={startDatesExpanded?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:11,color:'#bebebe'}}></i>
                    </div>
                    {startDatesExpanded&&(
                      <div style={{display:'flex',gap:0}}>
                        {/* LEFT: Upcoming */}
                        <div style={{flex:1,padding:'10px 14px',borderRight:'1px solid #f0f0f0'}}>
                          <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',marginBottom:8}}>Upcoming (14 days)</div>
                          {upcomingStarts.map((e,i)=>(
                            <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 0',borderBottom:i<upcomingStarts.length-1?'1px solid #fafafa':'none'}}>
                              <span style={{width:7,height:7,borderRadius:'50%',background:statusDot[e.status],flexShrink:0}}></span>
                              <span style={{fontSize:11,color:'#616161',fontWeight:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</span>
                              <span style={{fontSize:10,color:'#9e9e9e'}}>{FLAGS[e.country]||''}</span>
                              <span style={{fontSize:10,color:'#9e9e9e',whiteSpace:'nowrap'}}>{fmtDate(e.date)}</span>
                            </div>
                          ))}
                        </div>
                        {/* RIGHT: Missed/Overdue */}
                        <div style={{flex:1,padding:'10px 14px'}}>
                          <div style={{fontSize:13,fontWeight:600,color:'#d42d35',textTransform:'none',letterSpacing:'normal',marginBottom:8}}>Missed / Overdue</div>
                          {overdueStarts.map((e,i)=>(
                            <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 0',borderBottom:i<overdueStarts.length-1?'1px solid #fafafa':'none'}}>
                              <span style={{width:7,height:7,borderRadius:'50%',background:statusDot[e.status],flexShrink:0}}></span>
                              <span style={{fontSize:11,color:'#616161',fontWeight:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</span>
                              <span style={{fontSize:10,color:'#9e9e9e'}}>{FLAGS[e.country]||''}</span>
                              <span style={{fontSize:10,color:'#d42d35',whiteSpace:'nowrap'}}>{fmtDate(e.date)}</span>
                            </div>
                          ))}
                          <div style={{marginTop:8,padding:'6px 8px',borderRadius:8,background:'#fff3e0',border:'1px solid #ffe0b2'}}>
                            <div style={{fontSize:10,color:'#e65100',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                              <i className="bi-exclamation-triangle-fill" style={{fontSize:9}}></i>
                              {overdueStarts.filter(e=>e.status==='overdue').length} overdue — action needed
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </DeelCard>
                );
              })()}

              {/* Recent Activity */}
              {recentAct.length>0&&<DeelCard style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'18px 22px 14px',borderBottom:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#e8f0fe,#DBEAFE)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="bi-activity" style={{fontSize:13,color:'#1f74b3'}}></i>
                  </div>
                  <span style={{fontSize:16,fontWeight:700,color:'#1b1b1b'}}>Recent Activity</span>
                </div>
                <div style={{padding:'8px 22px 14px'}}>
                  {recentAct.map((a,i)=>(
                    <div key={a.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 0',borderBottom:i<recentAct.length-1?'1px solid #f5f5f5':'none'}}>
                      <i className={a.evIcon||'bi-circle'} style={{fontSize:13,color:a.evColor||a.color,marginTop:1,flexShrink:0}}></i>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:'#616161',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.subject}</div>
                        <div style={{fontSize:11,color:'#9e9e9e',marginTop:2}}>{a.who} &middot; {a.ago} ago</div>
                      </div>
                    </div>
                  ))}
                </div>
              </DeelCard>}

              {/* Quick Nav — visible for all user types */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(95px,1fr))',gap:10}}>
                {[
                  {v:'my-queue',icon:'bi-inbox-fill',l:'Queue',c:'var(--g)',bg:'#e8f0fe'},
                  {v:'escalations',icon:'bi-arrow-up-circle-fill',l:'Escalations',c:'#1f74b3',bg:'#e8f0fe'},
                  {v:'hr-reports',icon:'bi-flag-fill',l:'Reports',c:'#8b6dca',bg:'#f3eff8'},
                  {v:'team',icon:'bi-people-fill',l:'Team',c:'#ed8d00',bg:'#fff8e6'},
                  {v:'analytics',icon:'bi-bar-chart-line-fill',l:'Analytics',c:'#1f74b3',bg:'#e8f0fe'},
                ].map(a=>(
                  <button key={a.v} onClick={()=>setView(a.v)} style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:'14px 8px',cursor:'pointer',fontSize:12,fontWeight:600,color:'#1b1b1b',transition:'all .2s',
                    background:'white',border:'1px solid #e8e8e8',borderRadius:16}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=a.c;e.currentTarget.style.color=a.c;e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#e8e8e8';e.currentTarget.style.color='#1b1b1b';e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none';}}>
                    <div style={{width:34,height:34,borderRadius:10,background:a.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <i className={a.icon} style={{fontSize:15,color:a.c}}></i>
                    </div>
                    {a.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BriefingView;
