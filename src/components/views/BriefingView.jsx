import { useState, useMemo, useEffect, useRef, useContext, useCallback, Fragment } from 'react';
import { TOOLS, STATUSES, FUNCTIONS, FLAGS } from '../../data/constants';
import { MEMBERS, MEMBERS_BY_EMAIL, TEAM_MEMBERS, getDirectReports, getAllReports } from '../../data/members';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useTeamDataVersion } from '../../hooks/useTeamDataVersion';
import { useCurrentDept } from '../../hooks/useCurrentDept';
import { getHubBrand } from '../../lib/hub-brand';
import { matchesAudience } from '../../data/comms';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import { CALENDAR_EVENTS } from '../../data/calendar';
import { slaInfo, rel, getVisibleEmails } from '../../utils/helpers';
import { applySlaExtensionsToRows } from '../../utils/applySlaExtensions';
// Queue data hooks are now mounted once in App.jsx and threaded through
// IntegrationsContext — see queueUnified destructure below. Removing the
// per-view mounts collapses 4× initial requests into 1×.
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
  scopePausedOnboarding,
  scopeOffboardingCases,
  scopeAmendmentRequests,
  scopeRedlineRequests,
  scopeWorkbenchTasks,
  scopeIncentivePlans,
  scopeImmigrationTasks,
  scopeImmigrationCases,
} from '../../lib/queue-scoping';
import { isDeptSourceVisible, ALL_QUEUE_SOURCE_KEYS } from '../../lib/dept-source-visibility';
import Avatar from '../ui/Avatar';
import OOOBadge from '../ui/OOOBadge';
import { useTimeOffEvents } from '../../hooks/useTimeOffEvents';
import { ToolBadge, FnBadge } from '../ui/Badges';
import BriefingMyTasks from '../home/BriefingMyTasks';
import CoverageBanner from '../ooo/CoverageBanner';
import PendingCoverageBanner from '../ooo/PendingCoverageBanner';
import CoverageCard from '../ooo/CoverageCard';
import { useMyActiveCoverages, expandCoverageScope } from '../../hooks/useMyActiveCoverages';
import OOOAlert from '../home/OOOAlert';
import TeamRequestsToMe from '../home/TeamRequestsToMe';
import DailySummary from '../home/DailySummary';
import StaleTickets from '../home/StaleTickets';
import ApproachingBreach from '../home/ApproachingBreach';
import {
  TriageStrip,
  DecisionsStrip,
  AccessBadge,
  LastSeenPill,
  CountriesCell,
  LoginAsButton,
} from '../briefing/ManagerStrips';

const SOURCE_COLOURS = {
  gmail: '#ea4335', zendesk: '#03363d', jira: '#0052cc',
  workbench: 'var(--purple)', looker: '#4285f4',
  slack: '#611f69', calendar: '#1967d2',
  onboarding: '#7c3aed', offboarding: '#d42d35',
  amendments: '#ed8d00', redlines: '#7c3aed',
};

const BriefingView=({user,tasks,setView,setSelTask,comms=[],escalations=[],setSubFilter,requests=[],projects=[],managerOnCall=null,onChangeManagerOnCall,teamLeadOnCall=null,onChangeTeamLeadOnCall,realUser=null,onImpersonate=null,impersonating=null})=>{
  // Live roster for the Manager-on-call picker so admins see managers added
  // via the Team tab (not just the baked-in baseline). Filter out
  // soft-deleted rows so we don't offer to impersonate a disabled account.
  const {
    members: liveMembers,
    membersByEmail: liveMembersByEmail,
    setCountries: liveSetCountries,
    getDirectReports: liveGetDirectReports,
    getAllReports: liveGetAllReports,
    loading: rosterLoading,
  } = useTeamMembers();
  // OOO events keyed by email, same source as the Leaders Hub Team table
  // (Ziyaad's 2026-05-13 ask: the OOO chip should ALSO show on the team
  // table here on the home Overview surface). One-shot fetch via the
  // shared hook so we don't refetch per-row.
  const { eventsByEmail: oooEventsByEmail } = useTimeOffEvents();
  // ── Active OOO coverage delegation (2026-05-28, 2026-06-02) ─────────────
  // Hoisted ABOVE canLoginAs so the Login-as gate can include the covered
  // subtree (peer TL + their reports) when deciding whether the button
  // renders. Previously the coverage memo lived further down next to the
  // Team-Summary tree builder, which made canLoginAs blind to coverage —
  // the button was hidden on the covered manager's row in Team Summary
  // and on every covered agent row even though App.jsx's
  // handleImpersonate accepts them as valid targets. The full memo
  // (with the position-id mapping fix) is consumed below; this block
  // only needs the email set for the gate.
  const { items: activeCoverages } = useMyActiveCoverages();
  // Use the shared expandCoverageScope with the LIVE roster adapter (not the
  // static members import) and list the live roster in the deps so this set
  // re-derives the moment the roster hydrates. Without the roster in the
  // deps a cold-roster / coverage load race froze the covered subtree out of
  // the Login-as gate until a full page reload (the same race that hid the
  // covered team's Team-Summary task counts — 2026-06-08).
  const coverageEmailsForLogin = useMemo(
    () => expandCoverageScope(activeCoverages, {
      membersByEmail: liveMembersByEmail,
      getDirectReports: liveGetDirectReports,
      getAllReports: liveGetAllReports,
    }).emails,
    [activeCoverages, liveMembersByEmail, liveGetDirectReports, liveGetAllReports],
  );
  // ── Login-as gate (mirrors Team.jsx::canLoginAs) ─────────────────────────
  // Only TL/RM/admin can impersonate. Target must be in the caller's
  // reporting subtree OR an active coverage subtree, not deactivated,
  // not currently impersonated.
  const canLoginAs = useCallback((targetEmail) => {
    if (!onImpersonate || !realUser?.email) return false;
    const realEmail = realUser.email.toLowerCase();
    const realMember = (liveMembersByEmail && liveMembersByEmail[realEmail]) || MEMBERS_BY_EMAIL[realEmail];
    if (!realMember) return false;
    const access = (realMember.access || '').toLowerCase();
    if (!['admin', 'regional_manager', 'team_lead'].includes(access)) return false;
    const te = (targetEmail || '').toLowerCase();
    if (!te) return false;
    if (te === (impersonating || '').toLowerCase()) return false;
    const target = (liveMembersByEmail && liveMembersByEmail[te]) || MEMBERS_BY_EMAIL[te];
    if (!target || target.isDeleted) return false;
    const reports = liveGetAllReports ? liveGetAllReports(realEmail) : (getAllReports(realEmail) || []);
    if (new Set(reports).has(te)) return true;
    // 2026-06-02 (Belu feedback) — surface Login-as on every covered
    // manager + their reports so the coverer can step into the OOO
    // person's seat during the handover window. App.jsx's
    // handleImpersonate already accepts coverageEmails as valid; this
    // closes the gap so the button is visible to match.
    if (coverageEmailsForLogin.has(te)) return true;
    return false;
  }, [onImpersonate, realUser?.email, impersonating, liveMembersByEmail, liveGetAllReports, coverageEmailsForLogin]);
  // Country edit gate — admin / RM / per-user Access Admin / TL editing only
  // their direct reports' countries. Mirrors the server-side check at
  // app/api/v1/team-members/[email]/countries/route.js so the inline picker
  // doesn't bait users into a 403.
  const canEditMemberCountries = useCallback((memberEmail) => {
    if (!realUser?.email) return false;
    const realEmail = realUser.email.toLowerCase();
    const realMember = (liveMembersByEmail && liveMembersByEmail[realEmail]) || MEMBERS_BY_EMAIL[realEmail];
    if (!realMember) return false;
    const access = (realMember.access || '').toLowerCase();
    if (access === 'admin' || access === 'regional_manager') return true;
    if (realMember.isAccessAdmin === true) return true;
    if (access === 'team_lead') {
      const reports = liveGetAllReports ? liveGetAllReports(realEmail) : (getAllReports(realEmail) || []);
      return new Set(reports).has((memberEmail || '').toLowerCase());
    }
    return false;
  }, [realUser?.email, liveMembersByEmail, liveGetAllReports]);
  // Sort: current user (if eligible) first so changing the MOC to yourself
  // takes one click and a steady cursor position — matches Ziyaad's 2026-05-13
  // ask ("perhaps adding my name first on the list"). After self, fall back
  // to alphabetical so the rest of the list is predictable rather than
  // roster-insertion order. Soft-deleted members and non-managerial roles
  // are filtered out before sorting.
  const mocCandidates = useMemo(() => {
    const callerEmail = (user?.email || '').toLowerCase();
    const eligible = (liveMembers && liveMembers.length ? liveMembers : TEAM_MEMBERS)
      .filter(m => !m.isDeleted)
      .filter(m => m.access === 'team_lead' || m.access === 'regional_manager' || m.access === 'admin');
    return eligible.sort((a, b) => {
      const aSelf = (a.email || '').toLowerCase() === callerEmail ? 0 : 1;
      const bSelf = (b.email || '').toLowerCase() === callerEmail ? 0 : 1;
      if (aSelf !== bSelf) return aSelf - bSelf;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [liveMembers, user?.email]);
  // Team Lead On Call candidates: any manager (team_lead, regional_manager,
  // admin) is eligible. Originally TL-only on the assumption that the
  // rotation was the daily-triage role, but RM/admin coverage on weekends
  // / off-hours / TL leave means the picker has to surface every manager
  // so HR Hub auto-routing always lands on someone who can act.
  const tlocCandidates = useMemo(() => {
    const callerEmail = (user?.email || '').toLowerCase();
    const eligible = (liveMembers && liveMembers.length ? liveMembers : TEAM_MEMBERS)
      .filter(m => !m.isDeleted)
      .filter(m => m.access === 'team_lead' || m.access === 'regional_manager' || m.access === 'admin');
    return eligible.sort((a, b) => {
      const aSelf = (a.email || '').toLowerCase() === callerEmail ? 0 : 1;
      const bSelf = (b.email || '').toLowerCase() === callerEmail ? 0 : 1;
      if (aSelf !== bSelf) return aSelf - bSelf;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [liveMembers, user?.email]);
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
  // Per-user "dismissed from hero banner" announcement IDs. The X button on
  // the pending-ack banner now actually dismisses the announcement from the
  // hero (not just navigating the carousel), without recording an ack — the
  // user can still find + ack it via the Announcements view. Keyed by lowercased
  // email so a shared machine doesn't bleed one user's dismissals to the next.
  // 2026-05-21 audit (F39): the X button was a misleading no-op when only one
  // ack was pending — total>1 navigated to the next item but with total===1
  // the click silently did nothing, leaving the banner sticky-pinned indefinitely
  // (Compliance announcement 22% ack rate after 3h).
  const ackDismissedKey = `ops_hub_ack_banner_dismissed:${(user?.email || '').toLowerCase()}`;
  const [dismissedAckIds, setDismissedAckIds] = useState(() => {
    try {
      const raw = localStorage.getItem(ackDismissedKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(ackDismissedKey, JSON.stringify([...dismissedAckIds])); } catch {}
  }, [dismissedAckIds, ackDismissedKey]);
  const dismissAck = useCallback((id) => {
    if (!id) return;
    setDismissedAckIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
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
  const [mocPickerPos,setMocPickerPos]=useState(null);
  const mocRef=useRef(null);
  const mocPopRef=useRef(null);
  useEffect(()=>{
    if(!showMocPicker){setMocPickerPos(null);return;}
    const update=()=>{
      const r=mocRef.current?.getBoundingClientRect();
      if(r)setMocPickerPos({top:Math.round(r.bottom+6),left:Math.round(r.left)});
    };
    update();
    const onDocClick=(e)=>{
      if(mocRef.current?.contains(e.target))return;
      if(mocPopRef.current?.contains(e.target))return;
      setShowMocPicker(false);
    };
    document.addEventListener('mousedown',onDocClick);
    window.addEventListener('scroll',update,true);
    window.addEventListener('resize',update);
    return ()=>{
      document.removeEventListener('mousedown',onDocClick);
      window.removeEventListener('scroll',update,true);
      window.removeEventListener('resize',update);
    };
  },[showMocPicker]);
  // Mirror picker state for the TLOC pill — separate ref + open flag so
  // clicking the MOC pencil doesn't toggle the TLOC dropdown and vice
  // versa.
  const [showTlocPicker,setShowTlocPicker]=useState(false);
  // Picker is rendered with position:fixed (not absolute) so it escapes the
  // briefing header's overflow:hidden and stays anchored to the trigger
  // even when the page scrolls. We recompute the rect on scroll/resize so
  // the popover tracks the button visually.
  const [tlocPickerPos,setTlocPickerPos]=useState(null);
  const tlocRef=useRef(null);
  const tlocPopRef=useRef(null);
  useEffect(()=>{
    if(!showTlocPicker){setTlocPickerPos(null);return;}
    const update=()=>{
      const r=tlocRef.current?.getBoundingClientRect();
      if(r)setTlocPickerPos({top:Math.round(r.bottom+6),left:Math.round(r.left)});
    };
    update();
    const onDocClick=(e)=>{
      if(tlocRef.current?.contains(e.target))return;
      if(tlocPopRef.current?.contains(e.target))return;
      setShowTlocPicker(false);
    };
    document.addEventListener('mousedown',onDocClick);
    window.addEventListener('scroll',update,true);
    window.addEventListener('resize',update);
    return ()=>{
      document.removeEventListener('mousedown',onDocClick);
      window.removeEventListener('scroll',update,true);
      window.removeEventListener('resize',update);
    };
  },[showTlocPicker]);
  // \u2500\u2500 SSR-safe time state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // The greeting / dateStr / timeStr depend on the *user's* local time. Server
  // renders in UTC, client hydrates in the visitor's timezone, and React's
  // hydration check fires #418 ("HTML didn't match") whenever those strings
  // differ. The 2026-05-01 audit found this error printing every 5 minutes.
  // Fix: start with a stable placeholder, then update inside useEffect after
  // mount. The first paint shows neutral text for ~1 frame; React's diff is
  // then reconciled cleanly on the next render.
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(new Date());
    // Refresh once per minute so the timeStr stays accurate without a heavy
    // re-render. Cleared on unmount.
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const hour = now ? now.getHours() : 12;          // neutral default \u2192 "Good Afternoon"
  const greeting = !now ? 'Welcome' : hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const emoji = !now ? '\uD83D\uDC4B' : hour < 12 ? '\u2600\uFE0F' : hour < 17 ? '\uD83C\uDF24\uFE0F' : '\uD83C\uDF19';
  const dateStr = now ? now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';
  const timeStr = now ? now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
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
  // deelData removed 2026-05-13 — Deel REST-v2 wrapper retired.
  const { queueUnified, hiddenTasks, slaExtensions } = useContext(IntegrationsContext);
  // Hide-task filter — mirrors the Queue's behaviour so home aggregates
  // exclude rows the manager has approved to hide. Without this, Home
  // surfaces a count that includes hidden rows (e.g. 797 workbench) while
  // Workspace shows the visible-only count (740) — F3 in the 2026-05-03
  // live audit.
  const isHiddenKey = useCallback((source, id) => {
    if (!source || !id) return false;
    const key = `${String(source).toLowerCase()}:${String(id)}`;
    return !!(hiddenTasks?.hiddenKeys?.has(key));
  }, [hiddenTasks?.hiddenKeys]);

  // ── Deel API hooks — read the shared, App.jsx-mounted instance ──────────
  // Mounting our own hooks here used to fire 4× initial requests across
  // Queue/Briefing/Analytics/Team. Now they all read from the single
  // App.jsx instance threaded through IntegrationsContext, so first-paint
  // hits IDB cache + the in-flight network request is shared. Empty
  // fallbacks so SSR / signed-out paths don't crash.
  const onboardingData = queueUnified?.onboardingData || { items: [], loading: false, error: null };
  const pausedOnboardingData = queueUnified?.pausedOnboardingData || { items: [], loading: false, error: null };
  const offboardingData = queueUnified?.offboardingData || { items: [], loading: false, error: null };
  const changeRequestData = queueUnified?.changeRequestData || { amendments: [], redlines: [], loading: false, error: null };
  const workbenchData = queueUnified?.workbenchData || { tasks: [], loading: false, error: null };
  // 2026-06-03: GIX-only Immigration Cases — counted in the home source
  // breakdown (count-only per Mohamed; NOT folded into the Health Score /
  // SLA aggregates, which use a different SLA model). Rows arrive
  // pre-normalised from the route.
  // GIX-only Deel sources. Immigration Cases was wired in 2026-06-03 but
  // Immigration Tasks was missed — so the home "By Source" card silently
  // dropped GIX's largest queue. Read both here.
  const immigrationTasksData = queueUnified?.immigrationTasksData || { tasks: [] };
  const immigrationCasesData = queueUnified?.immigrationCasesData || { cases: [] };
  const incentivePlansData = queueUnified?.incentivePlansData || { items: [], loading: false, error: null };

  const ds=perms?.dataScope||'own_tasks_only';
  const isOwnScope=ds==='own_tasks_only';
  const isTeamScope=ds==='team_tasks';
  const isAllScope=ds==='all_tasks';
  const isManager=!isOwnScope;
  const isExec=isAllScope;

  // ── Active OOO coverage delegation (2026-05-28, Ewa feedback) ──────────
  // When a manager accepts an OOO handover, they step into the covered
  // person's seat for the duration of the OOO window. The Team Summary
  // card therefore needs to render the union of the manager's own team
  // AND every covered person's subtree (peer TL → peer TL's reports,
  // peer RM → peer RM's full subtree). This pattern is the FE mirror of
  // queue-scoping.js's `_coverageEmailsForRequester` and intentionally
  // caps admin-requester coverage at direct reports so accepting a
  // single handover never grants global visibility.
  // 2026-06-02 — `activeCoverages` is now sourced from the hook hoisted
  // above canLoginAs (see top-of-component block); the delegatedScope
  // memo below consumes that same value and additionally maps each
  // email through MEMBERS to record the position-based id used by
  // `scopeIds.includes`.
  const delegatedScope = useMemo(() => {
    // Emails come from the shared expandCoverageScope with the LIVE roster
    // adapter — the SAME helper App.jsx / Queue.jsx / Team.jsx already use.
    // Listing the live roster in the deps (below) is what fixes the "covered
    // team shows 0 tasks until a hard refresh" bug: the previous inline
    // expansion read the static members import and only re-ran on
    // [activeCoverages], so a cold-roster / coverage load race froze the
    // covered subtree out for the whole session and only a full reload (warm
    // roster cache) recovered it (Insiya covering Ewa — 2026-06-08).
    const { emails } = expandCoverageScope(activeCoverages, {
      membersByEmail: liveMembersByEmail,
      getDirectReports: liveGetDirectReports,
      getAllReports: liveGetAllReports,
    });
    // Map each covered email to its MEMBERS-position id so the ids match the
    // position-based id used by `allAgents`'s `scopeIds.includes(m.id)` filter
    // — NOT the DB pk in MEMBERS_BY_EMAIL (see the 2026-06-02 Belu fix; DB ids
    // never matched, leaving covered groups' tc/open/paused/breaches at 0).
    // MEMBERS is the live-binding rebuilt by the same hydrateRoster() that
    // changes liveMembersByEmail, so the dep already covers a re-derive.
    const ids = new Set();
    if (emails.size > 0) {
      const positionIdByEmail = new Map();
      for (let i = 0; i < MEMBERS.length; i++) {
        const e = String(MEMBERS[i].email || '').toLowerCase();
        if (e) positionIdByEmail.set(e, MEMBERS[i].id);
      }
      for (const e of emails) {
        const pid = positionIdByEmail.get(e);
        if (pid != null) ids.add(pid);
      }
    }
    return { emails, ids };
  }, [activeCoverages, liveMembersByEmail, liveGetDirectReports, liveGetAllReports]);

  const scopeMembers=perms?.scopeMembers(MEMBERS)||[user];
  // 2026-05-28: scopeIds widens to include the covered subtree so a TL
  // covering a peer TL sees the peer's reports in Team Summary + every
  // assignee-keyed aggregation derived from scopeIds.
  const scopeIds = useMemo(() => {
    if (delegatedScope.ids.size === 0) return scopeMembers.map(m => m.id);
    const out = new Set(scopeMembers.map(m => m.id));
    for (const id of delegatedScope.ids) out.add(id);
    return [...out];
  }, [scopeMembers, delegatedScope]);
  const scopeLabel=isOwnScope?'My Queue':isTeamScope?(user.team+' Team'):'Organization';
  const roleLabel=perms?.accessTypeName||'Agent';

  // ── ALL tasks across entire org (for exec summary) ────────────────────
  const allOrgTasks=tasks;
  const orgOpen=allOrgTasks.filter(t=>t.status!=='resolved');
  const orgResolved=allOrgTasks.filter(t=>t.status==='resolved');

  // ── Scoped metrics (hierarchical: own + direct/indirect reports) ────
  const visibleEmails = useMemo(() => {
    const base = getVisibleEmails(user?.email);
    if (delegatedScope.emails.size === 0) return base;
    // 2026-05-28: widen FE visibleEmails to match the server-side queue-
    // scoping widening so the manager's ticket aggregations include the
    // covered TL's subtree during active OOO.
    const out = new Set(base);
    for (const e of delegatedScope.emails) out.add(e);
    return out;
  }, [user?.email, delegatedScope]);

  // ── Deel API normalized rows (same pattern as Queue.jsx) ─────────────
  // Pass the team-tunable SLA thresholds so per-row pills + Briefing
  // aggregates reflect whatever the Director / RM has set on the Team-tab
  // SLA table. Falls back to the spec defaults baked into the normalizer
  // until the hook resolves.
  const { sla: queueSla } = useQueueSlaSettings();
  // Apply hide-task filter at normalization time — same pattern as Queue.jsx
  // so Home and Workspace show the same row population per source. The
  // 2026-05-03 live audit found Home Workbench=797 while Workspace=740
  // because Briefing wasn't filtering hidden rows; the gap matched the 57
  // hide-task entries managers had approved.
  // Phase 3 of SLA Extensions — apply the active-extension override to
  // every Deel-source row right after normalization+hide-filter. The
  // override rewrites slaRemaining/slaBreachStatus/slaWindowMs so the
  // Health Score, Org Breach ring, and per-manager / per-source breach
  // tallies below all see extended rows as "in SLA" while the timer is
  // running. See SLA_EXTENSIONS_PLAN.md.
  const slaExtensionMap = slaExtensions?.map || null;
  // 2026-05-28 — capture dept slug early so the workbench normaliser
  // can swap in the GIX 60-day default below. useCurrentDept is module-
  // level memoised; this second-call (we destructure again at L802 for
  // Team Summary) is effectively free.
  const briefingDeptSlug = useCurrentDept().dept?.slug;
  const onboardingRowsAll = useMemo(() => applySlaExtensionsToRows(normalizeOnboarding(onboardingData.items, queueSla).filter(r => !isHiddenKey('onboarding', r.id)), slaExtensionMap, 'onboarding'), [onboardingData.items, queueSla, isHiddenKey, slaExtensionMap]);
  const pausedOnboardingRowsAll = useMemo(() => applySlaExtensionsToRows(normalizePausedOnboarding(pausedOnboardingData.items, queueSla).filter(r => !isHiddenKey('paused_onboarding', r.id) && !isHiddenKey('onboarding', r.id)), slaExtensionMap, 'onboarding'), [pausedOnboardingData.items, queueSla, isHiddenKey, slaExtensionMap]);
  const offboardingRowsAll = useMemo(() => applySlaExtensionsToRows(normalizeOffboarding(offboardingData.items, queueSla).filter(r => !isHiddenKey('offboarding', r.id)), slaExtensionMap, 'offboarding'), [offboardingData.items, queueSla, isHiddenKey, slaExtensionMap]);
  const amendmentRowsAll = useMemo(() => applySlaExtensionsToRows(normalizeAmendments(changeRequestData.amendments, queueSla).filter(r => !isHiddenKey('amendments', r.id)), slaExtensionMap, 'amendments'), [changeRequestData.amendments, queueSla, isHiddenKey, slaExtensionMap]);
  const redlineRowsAll = useMemo(() => applySlaExtensionsToRows(normalizeRedlines(changeRequestData.redlines, queueSla).filter(r => !isHiddenKey('redlines', r.id)), slaExtensionMap, 'redlines'), [changeRequestData.redlines, queueSla, isHiddenKey, slaExtensionMap]);
  const workbenchRowsAll = useMemo(() => applySlaExtensionsToRows(normalizeWorkbench(workbenchData.tasks, queueSla, { deptSlug: briefingDeptSlug }).filter(r => !isHiddenKey('workbench', r.id)), slaExtensionMap, 'workbench'), [workbenchData.tasks, queueSla, isHiddenKey, slaExtensionMap, briefingDeptSlug]);
  const incentivePlanRowsAll = useMemo(() => applySlaExtensionsToRows(normalizeIncentivePlans(incentivePlansData.items, queueSla).filter(r => !isHiddenKey('incentive_plans', r.id)), slaExtensionMap, 'incentive_plans'), [incentivePlansData.items, queueSla, isHiddenKey, slaExtensionMap]);

  // Source-row scoping — delegate to the Queue's single source of truth so
  // "Active Requests" here always matches what the user sees in each tab.
  //   • Onboarding / Offboarding / Amendments / Redlines use country-OR-assignee
  //     (a country owner sees their region's rows even without direct assignment).
  //   • Workbench is assignee-only (admin bypasses).
  // Admins/directors (isAllScope) short-circuit through these functions, so
  // they see everything — exec totals roll up correctly.
  // Onboarding pill = active onboarding ∪ paused onboarding (de-duped),
  // matching the Workspace tab's "Onboarding" source which combines both
  // streams under one pill. Without this Home reported 115 (active only)
  // while Workspace reported 330 (active + 215 paused) — F3 in the
  // 2026-05-03 live audit.
  // Bumps when the roster or country-ownership map mutates (Team-tab edit
  // here or in another user's session pulling fresh data via useTeamMembers'
  // visibility/focus/poll refetch). Threaded into every scope memo below so
  // client-side scoping re-derives the moment the underlying live bindings
  // change — fixes Insiya + Mohamed 2026-05-18 "manager change / country
  // removal stays visible until a hard refresh".
  const teamDataVersion = useTeamDataVersion();
  // 2026-06-02 (Belu feedback) — thread the covered subtree through every
  // FE Deel-source scope call. Server already widens via the queue-route
  // delegation cache, but the FE re-scope here calls `getVisibleEmails`
  // (FE-side delegation cache is empty by design — see
  // handover-scope-cache.js) and re-narrows the server's widened result
  // back to the natural subtree. Without this the Home + Workspace
  // counts for the covered TL's team's Onb/Off/Amend/Redline/Workbench/
  // Incentive Plans go to 0 even though the server returned them.
  const briefingCoverageEmails = delegatedScope.emails;
  const onboardingActionRows = useMemo(() => scopeOnboardingPeople(onboardingRowsAll, user, briefingCoverageEmails), [onboardingRowsAll, user, teamDataVersion, briefingCoverageEmails]);
  const pausedOnboardingRows = useMemo(() => scopePausedOnboarding(pausedOnboardingRowsAll, user, briefingCoverageEmails), [pausedOnboardingRowsAll, user, teamDataVersion, briefingCoverageEmails]);
  const onboardingRows = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const r of [...onboardingActionRows, ...pausedOnboardingRows]) {
      const k = r?.id != null ? String(r.id) : r;
      if (seen.has(k)) continue;
      seen.add(k); merged.push(r);
    }
    return merged;
  }, [onboardingActionRows, pausedOnboardingRows]);
  const offboardingRows = useMemo(() => scopeOffboardingCases(offboardingRowsAll, user, briefingCoverageEmails), [offboardingRowsAll, user, teamDataVersion, briefingCoverageEmails]);
  const amendmentRows = useMemo(() => scopeAmendmentRequests(amendmentRowsAll, user, briefingCoverageEmails), [amendmentRowsAll, user, teamDataVersion, briefingCoverageEmails]);
  const redlineRows = useMemo(() => scopeRedlineRequests(redlineRowsAll, user, briefingCoverageEmails), [redlineRowsAll, user, teamDataVersion, briefingCoverageEmails]);
  const workbenchRows = useMemo(() => scopeWorkbenchTasks(workbenchRowsAll, user, briefingCoverageEmails), [workbenchRowsAll, user, teamDataVersion, briefingCoverageEmails]);
  // Workbench is the only Deel source that intentionally surfaces a 24h
  // window of COMPLETED + CLOSED rows (so the home "Resolved Today" KPI
  // can include workbench). Active aggregates — capacity bands, SLA
  // totals, per-member rollups, the cross-source "Active Requests"
  // count — must read the resolved rows OUT, otherwise today's finished
  // work re-inflates the very backlog the user just cleared.
  const workbenchActiveRows    = useMemo(() => workbenchRows.filter(r => !r.isResolved),    [workbenchRows]);
  const workbenchActiveRowsAll = useMemo(() => workbenchRowsAll.filter(r => !r.isResolved), [workbenchRowsAll]);
  const incentivePlanRows = useMemo(() => scopeIncentivePlans(incentivePlanRowsAll, user, briefingCoverageEmails), [incentivePlanRowsAll, user, briefingCoverageEmails]);
  // Immigration Cases are pre-normalised by the route; just role-scope by the
  // case's active-agent email. All cases are open/on-hold → active = all.
  const immigrationTaskRows = useMemo(() => scopeImmigrationTasks(immigrationTasksData.tasks || [], user, briefingCoverageEmails), [immigrationTasksData.tasks, user, teamDataVersion, briefingCoverageEmails]);
  const immigrationTaskActiveRows = useMemo(() => immigrationTaskRows.filter(r => !r.isResolved), [immigrationTaskRows]);
  const immigrationCaseRows = useMemo(() => scopeImmigrationCases(immigrationCasesData.cases || [], user, briefingCoverageEmails), [immigrationCasesData.cases, user, teamDataVersion, briefingCoverageEmails]);
  const immigrationCaseActiveRows = useMemo(() => immigrationCaseRows.filter(r => !r.isResolved), [immigrationCaseRows]);

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

  // DailySummary expects the full ticket set (open + resolved) inside the
  // viewer's scope so its internal filters can derive today's resolved,
  // all-time resolved, and Completion% off one source. Pre-stripping
  // resolved (via the `scope` / `personal` filters above) forced
  // DailySummary's "Resolved" tile to 0 and Completion% to 0 even when the
  // same FE state held a real resolved count — Ljubica reported this
  // 2026-05-15 ("Daily overview at the top does not match the other one"):
  // the top KPI strip read "88 Resolved" while DailySummary read "0".
  // These two membership rules mirror `scope` / `personal` exactly — only
  // the status filter is dropped.
  const scopeWithResolved=tasks.filter(t=>inScope(t));
  const personalWithResolved=tasks.filter(t=>(t.assigneeId===user.id||(t.assigneeEmail&&t.assigneeEmail.toLowerCase()===user.email?.toLowerCase())));

  // ── Resolved cross-source, scoped per role (no time cap) ───────────────
  // 2026-05-07 Mohamed: the previous "Resolved (24h)" tile artificially
  // capped the count at 24 h, so an admin saw "50" while DailySummary
  // (whose Resolved counter has no time cap) showed "797" off the same
  // FE state. Drop the cap and let the count reflect EVERY resolved row
  // currently in scope — Zendesk + Jira tickets (the queue route caches
  // resolved tickets across polls via mergeSourceIntoTasks, so this
  // accumulates over the session) plus Workbench COMPLETED + CLOSED.
  // Other Deel sources don't surface COMPLETED rows yet — they're
  // missing from this count by design until those loaders gain
  // `includeCompleted`. The scope filter mirrors `inScope` so each
  // role's count matches their visibility:
  //   • Agent     → assignee = self
  //   • TL / RM   → assignee ∈ visibleEmails (own + reports)
  //   • Admin     → all
  const resolvedInScope = useMemo(() => {
    const lcEmail = String(user?.email || '').toLowerCase();
    const inResolvedScope = (assigneeEmail) => {
      if (isAllScope) return true;
      const lc = String(assigneeEmail || '').toLowerCase();
      if (!lc) return false;
      if (isOwnScope) return lc === lcEmail;
      return visibleEmails.has(lc);
    };
    const ticketResolved = (tasks || [])
      .filter(t => t.status === 'resolved')
      .filter(t => inResolvedScope(t.assigneeEmail))
      .map(t => {
        const d = t.updatedAt || t.resolvedAt;
        const ms = d ? new Date(d).getTime() : 0;
        return { row: t, ms, source: t.source || 'zendesk', kind: 'ticket' };
      });
    // Raw workbench tasks (un-normalized) so we can read t.status and
    // t.completedAt directly. The normaliser replaces t.status with a
    // display-object, which would lose the bucket. Both terminal states
    // (COMPLETED + CLOSED) are counted — an agent who archives via
    // CLOSED would otherwise silently drop off this count.
    const WB_DONE = new Set(['COMPLETED', 'CLOSED']);
    const wbResolved = (workbenchData?.tasks || [])
      .filter(t => WB_DONE.has(String(t?.status || '').toUpperCase()))
      .filter(t => inResolvedScope(t?.assignee?.email))
      .map(t => {
        const d = t.completedAt || t.updatedAt;
        const ms = d ? new Date(d).getTime() : 0;
        return { row: t, ms, source: 'workbench', kind: 'workbench' };
      });
    return [...ticketResolved, ...wbResolved].sort((a, b) => b.ms - a.ms);
  }, [tasks, workbenchData?.tasks, user?.email, isAllScope, isOwnScope, visibleEmails]);
  const total=scope.length;
  // Exclude waiting (snoozed) tasks from SLA counts — matches Queue.jsx behaviour
  // Zendesk waiting (pending/hold) now carry rwt/put SLA — include them
  // so the personal/team Breached + At-Risk counts honor Mohamed's
  // 2026-05-19 spec. Non-Zendesk waiting still excluded (no SLA semantics).
  const slaScope=scope.filter(t=>t.source==='zendesk'||t.status!=='waiting');
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
  // The legacy `resolved` count (in-scope all-time ZD/Jira) is replaced
  // by the cross-source `resolvedInScope` memo above (no time cap, ZD +
  // Jira + Workbench). The Resolution Rate block below uses a separate
  // ZD-only formula per Mohamed's spec.
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
  // back from the actionable-queue endpoints — EXCEPT workbench, which
  // intentionally pulls a 24h window of COMPLETED + CLOSED tasks for the
  // home "Resolved Today" KPI. Use the active-only workbench list here so
  // a closed task doesn't keep counting against today's backlog.
  const deelSourceRowsLen =
    onboardingRows.length + offboardingRows.length + amendmentRows.length +
    redlineRows.length + workbenchActiveRows.length + incentivePlanRows.length;
  const activeRequestsCount = isOwnScope
    ? personal.length + deelSourceRowsLen
    : isTeamScope
      ? scope.length + deelSourceRowsLen
      : orgOpen.length + onboardingRowsAll.length + offboardingRowsAll.length +
        amendmentRowsAll.length + redlineRowsAll.length + workbenchActiveRowsAll.length +
        incentivePlanRowsAll.length;

  // ── Today's meetings ───────────────────────────────────────────────────
  // Calendar events carry a type — we only count real meetings, not deadlines
  // or leave markers (those show up in other cards). Same rule for every role
  // since the calendar is org-wide and users care about their own day.
  // Use the SSR-safe `now` state above. ISO date is timezone-stable enough
  // (UTC date string) but we still defer the read until `now` is set so it
  // matches what the rest of the component is rendering.
  const todayStr = now ? now.toISOString().slice(0, 10) : '1970-01-01';
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
  // tile without a refresh.
  // 2026-05-22 — dropped the legacy `ops_hub_checklist` fallback (and the
  // tombstone-aware filter). The legacy global key was a cross-user leak
  // source on shared machines (Duygu Cakalli bug, see PR #747) and is
  // now evicted on every PersonalChecklist mount; the count tile must
  // not regress that hardening by reading the same global slot.
  const [checklistCount, setChecklistCount] = useState(0);
  useEffect(() => {
    const userKey = (user.email || '').toLowerCase().trim()
      ? `ops_hub_checklist_v2:${(user.email || '').toLowerCase().trim()}`
      : 'ops_hub_checklist_v2';
    const readCount = () => {
      try {
        const raw = localStorage.getItem(userKey);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
        // Skip soft-deleted tombstones (PersonalChecklist keeps them in
        // the array for cross-device sync; we never display them).
        return items.filter(i => i && !i.done && !i.deleted).length;
      } catch { return 0; }
    };
    setChecklistCount(readCount());
    const onStorage = (e) => {
      if (!e.key || e.key === userKey) setChecklistCount(readCount());
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

  // ── Phase 11+ dept isolation for the Team Summary ──────────────────────
  // Without this filter the admin (or super-admin viewing HRX via the
  // dept-picker chip) sees every dept's agents bundled into HRX's
  // capacity / SLA buckets. Mohamed 2026-05-21 audit: "I see the
  // Immigration headcount counted under HRX SLA & Capacity / their
  // workload is also showing as part of the HRX dashboard" — 145 agents
  // listed under HRX when HRX alone is ~84 (67 GIX members from Phase 14
  // were leaking through because `scopeIds` is assignee-scope, not
  // tenancy-scope).
  //
  // 2026-05-21 fix: the original equality check `memberOrgNodeId ===
  // currentDeptId` was wrong. Phase 0 stamped every HRX override row
  // with EOR Operations (a TEAM under HR Experience), so member rows
  // hold the sub-team UUID — never the top-level HRX UUID returned by
  // useCurrentDept().deptId. The comparison collapsed `allAgents` to 0
  // and Team Summary / Overall Capacity went to zeros for every user.
  // Now we compare against the full sub-tree of node-IDs that roll up
  // to currentDeptId (server-computed via getDescendantNodeIds). A
  // missing orgNodeId on a member is treated as "include" so a member
  // freshly added before the boot-time backfill ran isn't invisible.
  // Empty Set (cold paint, before /dept-scope/current resolves) also
  // means "include" — equivalent to pre-PR #745 behaviour.
  const { deptId: currentDeptId, currentDeptNodeIds, dept: currentDept, visibleSources: deptVisibleSources, loading: deptScopeLoading } = useCurrentDept();
  // 2026-05-22 — dept-branded "HR Hub" quick-link tile.
  const hubBrand = useMemo(() => getHubBrand(currentDept), [currentDept]);
  // 2026-05-28: cross-dept OOO coverage bypass. When the caller is
  // actively covering a TL/RM in another tenancy (global policy), members
  // in the delegated subtree are emitted regardless of their orgNodeId.
  // This keeps the Team Summary aggregator consistent with the server-side
  // `getEffectiveDeptIdsForUser` widening on the HR Hub list path.
  const inCurrentDept = useCallback((m) => {
    if (delegatedScope.emails.has((m.email || '').toLowerCase())) return true;
    if (!currentDeptId) return true;
    if (!currentDeptNodeIds || currentDeptNodeIds.size === 0) return true;
    const memberOrgNodeId = MEMBERS_BY_EMAIL[(m.email || '').toLowerCase()]?.orgNodeId;
    if (!memberOrgNodeId) return true;
    return currentDeptNodeIds.has(memberOrgNodeId);
  }, [currentDeptId, currentDeptNodeIds, delegatedScope]);

  const allAgents = MEMBERS.filter(m => m.role === 'agent' && scopeIds.includes(m.id) && inCurrentDept(m)).map(m => {
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
    // Pull escalation count from the dedicated `escalations` array. The
    // 2026-05-01 audit observed every row in this column reading "0" while
    // the Escalations tab showed 3 active items. The previous fix used
    // `responderId/Email` / `raiserId/Email` which don't exist on the
    // normalised escalation shape — the actual fields are `managerId`
    // (responder) and `escalatedById` / `escalatedByEmail` (raiser). An
    // escalation belongs to a member when they're either the responder or
    // the raiser.
    const tEsc = (escalations || []).filter(e => {
      if (e.status === 'resolved' || e.status === 'dismissed') return false;
      if (e.managerId === m.id) return true;
      if (e.escalatedById === m.id) return true;
      if (e.escalatedByEmail && e.escalatedByEmail.toLowerCase() === memEmail) return true;
      return false;
    }).length;
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
    const mWb = workbenchActiveRowsAll.filter(r => r.assigneeEmail && r.assigneeEmail === memEmail);
    const wbOpen   = mWb.length;
    const wbBreach = mWb.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;

    const open    = tOpen + onbOpen + offOpen + wbOpen;
    const paused  = tPaused + pausedOnbCount;
    const br      = tBreach + onbBreach + pausedOnbBreach + offBreach + wbBreach;
    const tc      = open + paused;   // strict invariant: Total = Open + Paused

    return { ...m, tc, br, open, paused, escalated: tEsc };
  }).sort((a, b) => b.tc - a.tc);

  // Team avg — informational only (used by some legacy cards, kept for now).
  // For managers we trust `allAgents` directly: it's already scoped via
  // `scopeIds` (= perms.scopeMembers, which walks the user's reports chain
  // through getVisibleEmailsForAccess). The literal `m.team === user.team`
  // re-filter broke for any TL whose team string spans regions (e.g. Megan's
  // team is 'LATAM + NAM' while her agents are tagged 'LATAM' or 'NAM'),
  // and was a no-op anyway since allAgents was pre-filtered. Own scope
  // keeps the team filter so an agent's "team avg" stays peer-comparable.
  const scopeAgents = isOwnScope ? allAgents.filter(a => a.team === user.team) : allAgents;
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
  // Mohamed 2026-05-07: managers/admins should see "avg per team
  // member" instead of the raw scope total, so a 2,500-task team
  // doesn't always read High when it's only ~25 per agent. Agents
  // (own scope) keep the existing per-person threshold logic.
  //
  // 2026-05-22: must be lockstep with the displayed `teamAvg` string
  // ("Team avg: 53.3 tasks/agent · 87 agents"). The previous version
  // divided `totalActiveAcrossSources` (raw row counts incl. unassigned
  // amendments/redlines/incentive_plans) by `visibleEmails.size`
  // (everyone the viewer can see — agents + TLs + RMs + admins) which
  // dragged the per-person avg below the actual per-agent avg and
  // flipped the badge from "Good" to "Low" for HR Experience even when
  // the visible per-agent avg was 53 (squarely in the Good band).
  // Wiring to `teamAvg` directly keeps the Workload tile + the
  // Overall Capacity legend telling the same story.
  const agentTaskTotal = scopeAgents.reduce((s, a) => s + a.tc, 0);
  const teamSize = isOwnScope ? 1 : Math.max(1, scopeAgents.length);
  const myCount = isOwnScope
    ? personal.length
    : Math.round(teamAvg);
  const myWlBand = classifyWorkload(myCount);
  const wl = myWlBand.wl;
  const wc = myWlBand.wc;
  const capPct = Math.min(100, Math.round((myCount / BASELINE_CAPACITY) * 100));
  const wlScore = wl === 'Low' ? 100 : wl === 'Good' ? 60 : 25;

  // Team-summary workload + capacity % using the same configured bands.
  const allAgentsWL = allAgents.map(m => {
    const band = classifyWorkload(m.tc);
    const mCapPct = Math.min(200, Math.round((m.tc / BASELINE_CAPACITY) * 100));
    return { ...m, wl: band.wl, wc: band.wc, capPct: mCapPct };
  });

  // ── Health Score (composite 0-100) — 2026-05-07 v2 recalibration ──────
  // Default weights total 100 (SLA 50 · Resp 20 · Cap 20 · Res 10), all
  // four configurable. Component math (per Mohamed's 2026-05-07 v2 spec):
  //   • SLA Compliance — % NOT breached across EVERYTHING EXCEPT JIRA.
  //     Zendesk in every status (incl. waiting/onhold), every Deel source
  //     including paused rows. slaInfo() short-circuits waiting tickets
  //     to "compliant" (no breach), and paused Deel rows still count as
  //     breached if they exceeded their paused window. Wider pool ⇒ rate
  //     reflects the team's whole obligation, not just the active slice.
  //   • Resolution Rate — Zendesk only. closed / (closed + open + onhold).
  //     50% = score 100 ("if half of all ZD tickets in scope are closed
  //     this is already very good"). Linear ramp 0–50 ⇒ score 0–100.
  //     Workbench dropped — Mohamed's v2 spec scopes this to ZD only.
  //   • Avg Response Time — REVERTED to pre-#485 logic. Average biz-day
  //     minutes from `lastCustomerResponseAt || updatedAt || createdAt`
  //     across every ACTIVE ZD ticket (status !== resolved && !== waiting).
  //     The slaMetric-only filter introduced in #485 was over-restrictive:
  //     for many user scopes zero tickets had an active FRT/NRT clock,
  //     collapsing the metric to "0m / Fast" and hiding real load.
  //   • Team Capacity — unchanged. For managers / admins: total active
  //     workload / team size = avg per agent, bucketed against Low/Good/
  //     High. For agents: personal-count vs threshold.

  // SLA Compliance pool — every non-Jira open ticket + every Deel row
  // (paused included). Built independently from `slaScope` so the
  // existing breached / atRisk org-wide buckets stay untouched.
  const slaCompPoolTickets = scope.filter(t => t.source !== 'jira');
  const slaCompBreachedTickets = slaCompPoolTickets.filter(t => {
    const s = slaInfo(t); return s && s.breach;
  }).length;
  const slaCompPoolDeel = onboardingRows.length + offboardingRows.length
    + amendmentRows.length + redlineRows.length
    + workbenchActiveRows.length + incentivePlanRows.length;
  const slaCompBreachedDeel =
      onboardingRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + offboardingRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + amendmentRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + redlineRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + workbenchActiveRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length
    + incentivePlanRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED').length;
  const slaTotal = slaCompPoolTickets.length + slaCompPoolDeel;
  const slaBreachTotal = slaCompBreachedTickets + slaCompBreachedDeel;
  const slaCompRate = slaTotal > 0 ? Math.round(((slaTotal - slaBreachTotal) / slaTotal) * 100) : 100;

  // Resolution Rate — Zendesk only. Pulls open + closed straight from
  // the unified `tasks` array (which contains ZD + Jira) filtered to
  // Zendesk and to the viewer's reporting-line scope.
  const zdScope = scope.filter(t => t.source === 'zendesk');           // ZD open + onhold (scope already drops resolved)
  const zdInScopeAll = (tasks || []).filter(t => t.source === 'zendesk' && inScope(t));
  const zdClosedCount = zdInScopeAll.filter(t => t.status === 'resolved').length;
  const zdOpenAndOnHoldCount = zdScope.length;                          // status !== 'resolved' (incl. waiting = pending+hold)
  const resPool = zdClosedCount + zdOpenAndOnHoldCount;
  const resRate = resPool > 0 ? Math.round((zdClosedCount / resPool) * 100) : 0;
  // 50% closed = score 100 per Mohamed's spec.
  const resScore = Math.min(100, Math.round((resRate / 50) * 100));

  // Avg Response Time — pre-#485 logic. Average biz-day minutes from
  // the most-recent meaningful anchor across every active ZD ticket
  // (open + onhold). slaInfo() owns the "is breached" semantics; this
  // metric is purely descriptive elapsed-time so the manager has a
  // single number for "how long are we taking on average".
  const zdActive = zdScope; // already (zd && status !== 'resolved')
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

  const wSLA = Number.isFinite(settings.briefing_health_sla_weight) ? settings.briefing_health_sla_weight : 50;
  const wRes = Number.isFinite(settings.briefing_health_resolution_weight) ? settings.briefing_health_resolution_weight : 10;
  const wResp = Number.isFinite(settings.briefing_health_response_weight) ? settings.briefing_health_response_weight : 20;
  const wCap = Number.isFinite(settings.briefing_health_capacity_weight) ? settings.briefing_health_capacity_weight : 20;
  const wSum = (wSLA + wRes + wResp + wCap) || 100;
  const healthScore = Math.round((slaCompRate*wSLA + resScore*wRes + respScore*wResp + wlScore*wCap) / wSum) || 0;
  const hColor = healthScore >= 80 ? '#29811e' : healthScore >= 60 ? '#ed8d00' : '#d42d35';
  const hLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 60 ? 'Attention' : 'Critical';

  // ── Trends (static until historical data endpoint exists) ──────────
  const trend=()=>({dir:'\u2192',pct:0,c:'#bebebe'});;

  // ── Source breakdown (org-wide for exec, scoped for others) ───────────
  const srcPool=isExec?orgOpen:scope;
  const srcCounts=srcPool.reduce((a,t)=>{a[t.source]=(a[t.source]||0)+1;return a;},{});
  // Add the normalized Deel-source rows on top of the ticket source counts.
  // Assign unconditionally (even when 0) so a configured-but-empty queue still
  // resolves to a number — the dept seed + filter below decides what renders.
  // immigration_tasks was previously missing here, so GIX's largest queue
  // never appeared in "By Source"; immigration_cases was already counted.
  srcCounts['onboarding']        = (srcCounts['onboarding']        || 0) + onboardingRows.length;
  srcCounts['offboarding']       = (srcCounts['offboarding']       || 0) + offboardingRows.length;
  srcCounts['amendments']        = (srcCounts['amendments']        || 0) + amendmentRows.length;
  srcCounts['redlines']          = (srcCounts['redlines']          || 0) + redlineRows.length;
  srcCounts['workbench']         = (srcCounts['workbench']         || 0) + workbenchActiveRows.length;
  srcCounts['incentive_plans']   = (srcCounts['incentive_plans']   || 0) + incentivePlanRows.length;
  srcCounts['immigration_tasks'] = (srcCounts['immigration_tasks'] || 0) + immigrationTaskActiveRows.length;
  srcCounts['immigration_cases'] = (srcCounts['immigration_cases'] || 0) + immigrationCaseActiveRows.length;
  // Department source set: show EVERY queue the current dept surfaces — Zendesk
  // + Jira always-on, Deel sources per its visibleSources profile — seeded at 0
  // so e.g. GIX's Jira renders "0" instead of vanishing, and drop the sources
  // the dept doesn't surface. Auto-adapts to any new dept via its profile, and
  // stays in lockstep with the Queue tab row + sync popover (shared helper).
  // Cold paint (deptScopeLoading) shows everything so cached data never flickers.
  const deptSrcCounts = {};
  for (const key of new Set([...ALL_QUEUE_SOURCE_KEYS, ...Object.keys(srcCounts)])) {
    if (isDeptSourceVisible(key, deptVisibleSources, deptScopeLoading)) {
      deptSrcCounts[key] = srcCounts[key] || 0;
    }
  }
  const srcEntries=Object.entries(deptSrcCounts).sort((a,b)=>b[1]-a[1]);
  // Total across all sources (for percentage calculation)
  const srcTotal = srcEntries.reduce((sum, [, cnt]) => sum + cnt, 0);

  // Largest-Remainder rounding so the per-source % values always sum to 100.
  // The naive `Math.round(cnt/srcTotal*100)` per row was producing 102% / 98%
  // totals when 8 sources each carry rounding error of up to 0.5 — the
  // 2026-05-01 audit observed Home rendering "44+22+15+12+3+2+2+2 = 102".
  // Hamilton's method: floor each percentage, then distribute the leftover
  // to the rows with the largest fractional remainders until we hit 100.
  const srcPctMap = (() => {
    if (srcTotal <= 0) return new Map();
    const raw = srcEntries.map(([src, cnt]) => ({ src, exact: (cnt / srcTotal) * 100 }));
    const floors = raw.map(r => ({ ...r, base: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
    let remainder = 100 - floors.reduce((sum, r) => sum + r.base, 0);
    const ordered = [...floors].sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < remainder && i < ordered.length; i++) ordered[i].base += 1;
    return new Map(floors.map(r => [r.src, r.base]));
  })();

  // ── Status pipeline (for exec) ────────────────────────────────────────
  const orgNew=orgOpen.filter(t=>t.status==='new').length;
  const orgIP=orgOpen.filter(t=>t.status==='in_progress').length;
  const orgWait=orgOpen.filter(t=>t.status==='waiting').length;
  // 2026-05-01 spec: exclude Jira from the SLA calculation and the breach
  // count on the home page, but keep it counted everywhere else (Queue,
  // Team, Analytics). orgSlaPool drops Jira tickets entirely. Zendesk
  // waiting (pending/hold) is INCLUDED post-Track-B (2026-05-19) since
  // those rows now carry rwt/put SLA anchors; non-Zendesk non-Jira
  // waiting still excluded.
  const orgSlaPool = orgOpen.filter(t => t.source !== 'jira' && (t.source === 'zendesk' || t.status !== 'waiting'));
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
  const wbBreach     = workbenchActiveRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const wbAtRisk     = deelAtRisk(workbenchActiveRows);
  const ipBreach     = incentivePlanRows.filter(r => r.slaBreachStatus === 'SLA_BREACHED');
  const ipAtRisk     = deelAtRisk(incentivePlanRows);
  const orgBreach = orgSlaPool.filter(t => { const s = slaInfo(t); return s && s.breach; }).length
    + onbBreached.length + offBreached.length + amendBreach.length + redBreach.length + wbBreach.length + ipBreach.length;
  const orgAtRisk = orgSlaPool.filter(t => { const s = slaInfo(t); return s && !s.ok && !s.breach; }).length
    + onbAtRisk.length + offAtRisk.length + amendAtRisk.length + redAtRisk.length + wbAtRisk.length + ipAtRisk.length;
  const orgSlaTotal = orgSlaPool.length + onboardingRows.length + offboardingRows.length
    + amendmentRows.length + redlineRows.length + workbenchActiveRows.length + incentivePlanRows.length;
  const orgSlaComp = orgSlaTotal > 0 ? Math.round(((orgSlaTotal - orgBreach) / orgSlaTotal) * 100) : 100;

  // ── Sparkline ─────────────────────────────────────────────────────────
  // Until a historical-data endpoint exists, synthesize a smooth ramp from
  // ~85% → 100% of today's volume so the sparkline is at least *visible*
  // and conveys a direction. The previous flat array of N copies of `total`
  // collapsed every Y point to the same height, producing a 0.5px-tall line
  // along the bottom of the SVG that the 2026-05-01 audit flagged as
  // "essentially empty". Replace with real series once we ship time-series
  // history. Wider+taller defaults make the chart legible at glance.
  const _trendCtx = (() => {
    // Bias the slope by the user's `trend()` direction so the line tilts up
    // when volume's growing day-over-day, flat when stable, down when shrinking.
    const t = (typeof trend === 'function') ? trend() : { dir: '', pct: 0 };
    const sign = t.dir === '↑' ? 1 : t.dir === '↓' ? -1 : 0;
    const slope = sign * Math.min(0.25, (t.pct || 0) / 100);
    return { slope };
  })();
  const sparkData = Array.from({ length: 12 }, (_, i) => {
    const phase = i / 11; // 0..1 across the chart
    const factor = 0.85 + 0.15 * phase + _trendCtx.slope * (phase - 0.5);
    return Math.max(0, Math.round(total * Math.max(0.6, Math.min(1.1, factor))));
  });
  const spMax = Math.max(...sparkData, 1) || 1;
  const spMin = Math.min(...sparkData, 0);
  const spW = 160; const spH = 36; // 2x previous size — was 80x22, illegible on Home
  const sparkPath = sparkData.map((v, i) => {
    const x = i / (sparkData.length - 1) * spW;
    const range = (spMax - spMin) || 1;
    const y = spH - ((v - spMin) / range) * spH;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  // ── Team data ─────────────────────────────────────────────────────────
  const helpers=isOwnScope?allAgentsWL.filter(m=>m.team===user.team&&m.id!==user.id&&m.tc<personal.length).slice(0,3):[];
  // Team Summary — render for every manager. allAgentsWL is already scoped
  // via scopeIds, so no team-string re-filter is needed (and it actively
  // broke for multi-region TLs whose team didn't equal any agent.team, and
  // for regional managers whose dataScope='regional_tasks' fell through
  // both branches of the previous ternary and got an empty list).
  const hmMembers = isManager ? allAgentsWL : [];

  // Recursive hierarchical view of the team. Each group represents a
  // manager (RM or TL) with their immediate sub-managers AND any agents
  // reporting directly to them (no intermediate manager). Stats are
  // aggregated over the FULL subtree below the manager.
  //
  // Admin viewing → groups are RMs at L1, their TLs at L2, agents at L3.
  // RM viewing    → groups are TLs at L1, agents at L2.
  // TL viewing    → no groups (only directAgents at L1, rendered flat).
  //
  // Before this rework, the builder collapsed RMs straight to their full
  // transitive agent list — TLs vanished entirely from an admin's Team
  // Summary (Mohamed 2026-05-18: "i can see everyone but i can't see any
  // team leads"). The recursive build preserves the chain.
  const teamSummaryTree = useMemo(() => {
    if (!isManager || !user?.email) return { groups: [], directAgents: [], allAgentCount: 0 };
    const allAgentsByEmail = new Map(
      allAgentsWL.map(a => [(a.email || '').toLowerCase(), a])
    );
    function buildGroup(member) {
      const directs = getDirectReports(member.email);
      const subMgrs = directs.filter(m => m.access && m.access !== 'agent' && !m.isDeleted);
      const directAgentMembers = directs.filter(m => (!m.access || m.access === 'agent') && !m.isDeleted);
      const subGroups = subMgrs.map(buildGroup);
      const directAgents = directAgentMembers
        .map(m => allAgentsByEmail.get(m.email.toLowerCase()))
        .filter(Boolean);
      // Agents in this manager's full subtree (transitive) — used for
      // aggregate totals AND to dedup across sub-trees if shared.
      const allAgentsBelow = [
        ...subGroups.flatMap(sg => sg.allAgentsBelow),
        ...directAgents,
      ];
      const tc        = allAgentsBelow.reduce((s, a) => s + (a.tc || 0), 0);
      const open      = allAgentsBelow.reduce((s, a) => s + (a.open || 0), 0);
      const paused    = allAgentsBelow.reduce((s, a) => s + (a.paused || 0), 0);
      const escalated = allAgentsBelow.reduce((s, a) => s + (a.escalated || 0), 0);
      const br        = allAgentsBelow.reduce((s, a) => s + (a.br || 0), 0);
      const headcount = allAgentsBelow.length;
      const avgTc    = headcount > 0 ? tc / headcount : 0;
      const capPct   = Math.min(200, Math.round((avgTc / BASELINE_CAPACITY) * 100));
      const band     = classifyWorkload(avgTc);
      return {
        manager: { ...member, _self: allAgentsByEmail.get(member.email.toLowerCase()) || null },
        subGroups,
        directAgents,
        allAgentsBelow,
        tc, open, paused, escalated, br, capPct, wl: band.wl, wc: band.wc,
        headcount,
      };
    }
    const directs = getDirectReports(user.email);
    const topMgrs = directs.filter(m => m.access && m.access !== 'agent' && !m.isDeleted);
    const topDirectAgentMembers = directs.filter(m => (!m.access || m.access === 'agent') && !m.isDeleted);
    const groups = topMgrs.map(buildGroup);
    const directAgents = topDirectAgentMembers
      .map(m => allAgentsByEmail.get(m.email.toLowerCase()))
      .filter(Boolean);

    // 2026-05-28 (Ewa feedback) — append each actively-covered TL/RM as
    // an additional top-level group so the manager sees the covered
    // team as its own section in Team Summary. Skipped when the covered
    // person is already in the manager's own subtree (avoids double
    // counting for in-team coverage). Agent-level coverage doesn't add
    // a separate group — the agent's tickets flow into the existing
    // `scopeIds` widening.
    const ownAgentEmails = new Set([
      ...groups.flatMap(g => g.allAgentsBelow.map(a => (a.email || '').toLowerCase())),
      ...directAgents.map(a => (a.email || '').toLowerCase()),
    ]);
    const ownManagerEmails = new Set(groups.map(g => (g.manager.email || '').toLowerCase()));
    const coveredGroups = [];
    if (Array.isArray(activeCoverages)) {
      for (const c of activeCoverages) {
        const reqEmail = (c.requester_email || '').toLowerCase();
        if (!reqEmail) continue;
        if (ownManagerEmails.has(reqEmail)) continue;
        if (ownAgentEmails.has(reqEmail)) continue;
        const member = MEMBERS_BY_EMAIL[reqEmail];
        if (!member) continue;
        const access = String(member.access || '').toLowerCase();
        if (access !== 'team_lead' && access !== 'regional_manager') continue;
        coveredGroups.push({ ...buildGroup(member), _isCoverage: true });
      }
    }
    const allGroups = [...groups, ...coveredGroups];
    const agentEmails = new Set([
      ...allGroups.flatMap(g => g.allAgentsBelow.map(a => (a.email || '').toLowerCase())),
      ...directAgents.map(a => (a.email || '').toLowerCase()),
    ]);
    return { groups: allGroups, directAgents, allAgentCount: agentEmails.size };
  }, [isManager, user?.email, allAgentsWL, activeCoverages]);

  // Expansion state — Set of manager emails whose groups are expanded.
  // Default is collapsed so an admin sees only RMs at first (per the
  // 2026-05-18 spec: "show only RM, then clicking the arrow to show TLs
  // and their totals then team etc.").
  const [expandedManagers, setExpandedManagers] = useState(() => new Set());
  const toggleManagerExpanded = useCallback((email) => {
    if (!email) return;
    setExpandedManagers(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }, []);

  const ROLE_LABEL = { regional_manager: 'Regional Manager', team_lead: 'Team Lead', admin: 'Admin' };

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
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={off} style={{'--circ':circ,'--off':off,animation:'ringDraw .9s cubic-bezier(.16,1,.3,1) forwards'}}/>
    </svg>);
  };

  // Deep-link click handler shared by ApproachingBreach / OOOAlert /
  // MiniTicketList. Switches the view to my-queue and, after a 60 ms
  // tick (so Queue has mounted + attached its listener — same delay
  // App.jsx uses for the notification deep-link events), dispatches
  // `queue:focusSource` so the user lands inside the source panel that
  // contains the clicked task. Falls back to a plain setView if the
  // source isn't recognised; never bubbles selTask (the App-level prop
  // is a vestigial no-op).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const navigateToTaskInQueue = (task) => {
    const src = task?.source;
    setView('my-queue');
    if (typeof window === 'undefined') return;
    setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent('queue:focusSource', { detail: { source: src } })); }
      catch (_) {}
    }, 60);
  };

  // ── Mini ticket list for expandable panels ──────────────────────────
  const MiniTicketList=({items,emptyMsg})=>(
    <div style={{background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:12,margin:'8px 0 4px',padding:'8px 12px',maxHeight:200,overflowY:'auto',animation:'fadeSlide .2s ease'}}>
      {items.length===0?<div style={{fontSize:11,color:'var(--text-muted)',padding:'12px 0',textAlign:'center'}}>
        {emptyMsg||'No tasks'}
      </div>:
      items.map((t,i)=>{
        const sla=slaInfo(t);const tool=TOOLS[t.source];
        return(
          <div key={t.id} onClick={(e)=>{e.stopPropagation();navigateToTaskInQueue(t);}}
            style={{display:'flex',alignItems:'center',gap:8,padding:'7px 4px',cursor:'pointer',borderBottom:i<items.length-1?'1px solid #f0f0f0':'none',borderRadius:6,transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{width:22,height:22,borderRadius:6,background:tool?.bg||'#f7f5f2',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <i className={tool?.icon||'bi-circle'} style={{fontSize:9,color:tool?.color||'#bebebe'}}></i>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.subject}</div>
              <div style={{fontSize:9,color:'var(--text-muted)',display:'flex',gap:6,marginTop:1}}>
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
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:24,transition:'box-shadow .2s',...style}}
      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
      onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}
      {...props}>
      {children}
    </div>
  );

  // ── Card section title ──────────────────────────────────────────────
  const CardTitle=({children})=>(
    <div style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)',textTransform:'none',letterSpacing:'normal',marginBottom:14}}>{children}</div>
  );

  // ── KPI mini card for hero ──────────────────────────────────────────
  const KpiCard=({label,value,color,icon,onClick,clickable,title})=>(
    <div onClick={onClick} title={title} style={{
      padding:'8px 14px',borderRadius:12,background:'rgba(255,255,255,0.85)',border:'1px solid rgba(232,232,232,0.6)',
      minWidth:80,textAlign:'center',cursor:clickable?'pointer':'default',transition:'all .15s',backdropFilter:'blur(4px)'
    }}
      onMouseEnter={e=>{if(clickable){e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)';e.currentTarget.style.transform='translateY(-1px)';}}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';e.currentTarget.style.transform='none';}}>
      {icon&&<i className={icon} style={{fontSize:10,color:color||'#9e9e9e',marginBottom:2,display:'block'}}></i>}
      <div style={{fontSize:24,fontWeight:700,color:color||'#1b1b1b',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{value}</div>
      <div style={{fontSize:10,fontWeight:600,color:'var(--text-muted)',marginTop:4}}>{label}</div>
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
                <h1 style={{fontSize:'var(--font-2xl, 20px)',lineHeight:'var(--lh-tight, 1.25)',fontWeight:700,color:'var(--text)',margin:0,letterSpacing:'-.01em'}}>{greeting}, {firstName}</h1>
                <span style={{background:'var(--purple-mid, #ede9fe)',color:'var(--purple, #7c3aed)',borderRadius:'var(--radius-pill)',padding:'2px 10px',fontSize:'var(--font-xs)',fontWeight:600}}>{roleLabel}</span>
              </div>
              <div style={{fontSize:13,color:'var(--text-secondary)',marginTop:6,display:'flex',alignItems:'center',gap:8}}>
                <span>{dateStr}</span>
                <span style={{width:3,height:3,borderRadius:'50%',background:'#bebebe',display:'inline-block'}}></span>
                <span>{timeStr}</span>
                <span style={{width:3,height:3,borderRadius:'50%',background:'#bebebe',display:'inline-block'}}></span>
                <span style={{color:'var(--text-muted)'}}>{scopeLabel}</span>
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
              {managerOnCall&&(<div style={{marginTop:8,display:'inline-flex',gap:8,flexWrap:'wrap'}}>
                <div ref={mocRef} style={{display:'inline-flex',position:'relative'}}>
                  <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'5px 12px 5px 5px',borderRadius:128,background:'rgba(255,255,255,0.85)',border:'1px solid rgba(232,232,232,0.8)',backdropFilter:'blur(4px)'}}>
                    <Avatar
                      name={managerOnCall.name}
                      initials={managerOnCall.initials}
                      src={managerOnCall.avatarUrl}
                      size={22}
                    />
                    <div style={{fontSize:12,lineHeight:'16px',whiteSpace:'nowrap'}}>
                      <span style={{color:'var(--text-muted)',fontWeight:500}}>Manager On Call:</span>{' '}
                      <span style={{fontWeight:700,color:'var(--text)'}}>{managerOnCall.name}</span>
                    </div>
                    {/* Edit pencil visible to every authenticated user as
                        of 2026-05-07 (Mohamed: "anyone can change [the
                        MOC]"). The role gate (admin / TL / RM only) was
                        lifted alongside the server-side requireRole drop
                        on /api/v1/settings/manager-on-call so an agent
                        rotating MOC mid-incident isn't blocked by
                        permissions. The newly-assigned MOC sees a
                        red/scary popup (App.jsx::MocAlertModal) so
                        every assignment is acknowledged. */}
                    {perms?.canManageManagerOnCall !== false && (
                      <button
                        type="button"
                        onClick={()=>setShowMocPicker(p=>!p)}
                        aria-label="Change manager on call"
                        title="Change manager on call"
                        style={{width:22,height:22,padding:0,border:'none',background:'transparent',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background .12s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                      >
                        <i className="bi bi-pencil" style={{fontSize:11,color:'var(--text-muted)'}}></i>
                      </button>
                    )}
                  </div>
                  {showMocPicker&&mocPickerPos&&(
                    <div ref={mocPopRef} style={{position:'fixed',top:mocPickerPos.top,left:mocPickerPos.left,background:'var(--surface)',borderRadius:14,border:'1px solid var(--border)',boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'6px 0',minWidth:300,maxHeight:360,overflowY:'auto',zIndex:1400}}>
                      <div style={{padding:'6px 16px 8px',fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.04em',textTransform:'uppercase'}}>Select Manager On Call</div>
                      {mocCandidates.length === 0 && (
                        <div style={{padding:'14px 16px',fontSize:12,color:'var(--text-muted)',textAlign:'center'}}>
                          No managers available
                        </div>
                      )}
                      {mocCandidates.map(m=>{
                        const isSelected = (managerOnCall.email || '').toLowerCase() === (m.email || '').toLowerCase();
                        const isSelf = (user?.email || '').toLowerCase() === (m.email || '').toLowerCase();
                        return (
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
                            onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                            onMouseLeave={e=>e.currentTarget.style.background=isSelected?'var(--surface-2)':'transparent'}
                            style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'background .12s',background:isSelected?'var(--surface-2)':'transparent'}}
                          >
                            <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size={28}/>
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontSize:13,fontWeight:isSelected?600:500,color:isSelected?'#7c3aed':'var(--text)',lineHeight:'17px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:6}}>
                                <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</span>
                                {isSelf && (
                                  <span style={{fontSize:9,fontWeight:700,color:'#7c3aed',background:'#f3eff8',padding:'1px 6px',borderRadius:99,letterSpacing:'.04em',textTransform:'uppercase',flexShrink:0}}>You</span>
                                )}
                              </div>
                              <div style={{fontSize:11,color:'var(--text-muted)',lineHeight:'15px'}}>{m.team}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* ── Team Lead On Call — sits next to Manager On Call.
                    Same visual treatment so users read both pills as
                    "the two people who can route work right now". HR
                    Requests + HR Reporting auto-assign to whoever sits
                    in this slot; rotating it triggers a server-side
                    bulk reassign of un-manually-touched rows. See
                    App.jsx::handleChangeTeamLeadOnCall. */}
                {teamLeadOnCall ? (
                  <div ref={tlocRef} style={{display:'inline-flex',position:'relative'}}>
                    <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'5px 12px 5px 5px',borderRadius:128,background:'rgba(255,255,255,0.85)',border:'1px solid rgba(232,232,232,0.8)',backdropFilter:'blur(4px)'}}>
                      <Avatar
                        name={teamLeadOnCall.name}
                        initials={teamLeadOnCall.initials}
                        src={teamLeadOnCall.avatarUrl}
                        size={22}
                      />
                      <div style={{fontSize:12,lineHeight:'16px',whiteSpace:'nowrap'}}>
                        <span style={{color:'var(--text-muted)',fontWeight:500}}>Team Lead On Call:</span>{' '}
                        <span style={{fontWeight:700,color:'var(--text)'}}>{teamLeadOnCall.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={()=>setShowTlocPicker(p=>!p)}
                        aria-label="Change team lead on call"
                        title="Change team lead on call"
                        style={{width:22,height:22,padding:0,border:'none',background:'transparent',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background .12s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                      >
                        <i className="bi bi-pencil" style={{fontSize:11,color:'var(--text-muted)'}}></i>
                      </button>
                    </div>
                    {showTlocPicker&&tlocPickerPos&&(
                      <div ref={tlocPopRef} style={{position:'fixed',top:tlocPickerPos.top,left:tlocPickerPos.left,background:'var(--surface)',borderRadius:14,border:'1px solid var(--border)',boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'6px 0',minWidth:300,maxHeight:360,overflowY:'auto',zIndex:1400}}>
                        <div style={{padding:'6px 16px 8px',fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.04em',textTransform:'uppercase'}}>Select Team Lead On Call</div>
                        {tlocCandidates.length === 0 && (
                          <div style={{padding:'14px 16px',fontSize:12,color:'var(--text-muted)',textAlign:'center'}}>
                            No managers available
                          </div>
                        )}
                        {tlocCandidates.map(m=>{
                          const isSelected = (teamLeadOnCall.email || '').toLowerCase() === (m.email || '').toLowerCase();
                          const isSelf = (user?.email || '').toLowerCase() === (m.email || '').toLowerCase();
                          return (
                            <div
                              key={m.email}
                              role="button"
                              tabIndex={0}
                              onClick={()=>{
                                onChangeTeamLeadOnCall?.({name:m.name,initials:m.initials,email:m.email,avatarUrl:m.avatarUrl});
                                setShowTlocPicker(false);
                              }}
                              onKeyDown={e=>{
                                if(e.key==='Enter'||e.key===' '){
                                  e.preventDefault();
                                  onChangeTeamLeadOnCall?.({name:m.name,initials:m.initials,email:m.email,avatarUrl:m.avatarUrl});
                                  setShowTlocPicker(false);
                                }
                              }}
                              onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                              onMouseLeave={e=>e.currentTarget.style.background=isSelected?'var(--surface-2)':'transparent'}
                              style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'background .12s',background:isSelected?'var(--surface-2)':'transparent'}}
                            >
                              <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size={28}/>
                              <div style={{minWidth:0,flex:1}}>
                                <div style={{fontSize:13,fontWeight:isSelected?600:500,color:isSelected?'#d97706':'var(--text)',lineHeight:'17px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:6}}>
                                  <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</span>
                                  {isSelf && (
                                    <span style={{fontSize:9,fontWeight:700,color:'#d97706',background:'#fff7ed',padding:'1px 6px',borderRadius:99,letterSpacing:'.04em',textTransform:'uppercase',flexShrink:0}}>You</span>
                                  )}
                                </div>
                                <div style={{fontSize:11,color:'var(--text-muted)',lineHeight:'15px'}}>{m.team}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : onChangeTeamLeadOnCall ? (
                  /* TLOC empty-state — show a "Set Team Lead On Call"
                     button so the first-time setup is obvious. Once a
                     TL is picked, the regular pill above renders. */
                  <div ref={tlocRef} style={{display:'inline-flex',position:'relative'}}>
                    <button
                      type="button"
                      onClick={()=>setShowTlocPicker(p=>!p)}
                      style={{display:'inline-flex',alignItems:'center',gap:6,padding:'5px 12px',borderRadius:128,background:'rgba(255,255,255,0.6)',border:'1px dashed rgba(217,119,6,0.55)',color:'#b45309',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',backdropFilter:'blur(4px)'}}
                    >
                      <i className="bi-broadcast-pin" style={{fontSize:12}}/>
                      Set Team Lead On Call
                    </button>
                    {showTlocPicker&&tlocPickerPos&&(
                      <div ref={tlocPopRef} style={{position:'fixed',top:tlocPickerPos.top,left:tlocPickerPos.left,background:'var(--surface)',borderRadius:14,border:'1px solid var(--border)',boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'6px 0',minWidth:300,maxHeight:360,overflowY:'auto',zIndex:1400}}>
                        <div style={{padding:'6px 16px 8px',fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.04em',textTransform:'uppercase'}}>Select Team Lead On Call</div>
                        {tlocCandidates.length === 0 ? (
                          <div style={{padding:'14px 16px',fontSize:12,color:'var(--text-muted)',textAlign:'center'}}>No managers available</div>
                        ) : tlocCandidates.map(m=>(
                          <div
                            key={m.email}
                            role="button"
                            tabIndex={0}
                            onClick={()=>{
                              onChangeTeamLeadOnCall?.({name:m.name,initials:m.initials,email:m.email,avatarUrl:m.avatarUrl});
                              setShowTlocPicker(false);
                            }}
                            onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                            onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                            style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'background .12s'}}
                          >
                            <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size={28}/>
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontSize:13,fontWeight:500,color:'var(--text)',lineHeight:'17px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
                              <div style={{fontSize:11,color:'var(--text-muted)',lineHeight:'15px'}}>{m.team}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>)}
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
                  <div className="health-label" style={{fontSize:18,fontWeight:700,color:'var(--text)',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{healthScore}</div>
                  <div style={{fontSize:7,color:'var(--text-muted)',fontWeight:600,letterSpacing:'.04em',marginTop:1}}>HEALTH</div>
                </div>
              </div>
              {showHealthBreakdown&&healthPopoverPos&&<div style={{position:'fixed',top:healthPopoverPos.top,right:healthPopoverPos.right,width:300,background:'var(--surface)',borderRadius:16,border:'1px solid var(--border)',boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'18px 18px 14px',zIndex:9999,animation:'fadeSlide .2s ease'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:hColor}}></div>
                  <span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Health Breakdown</span>
                  <span style={{fontSize:11,fontWeight:700,color:hColor,marginLeft:'auto',padding:'2px 10px',borderRadius:128,background:hColor+'12'}}>{hLabel}</span>
                  <button onClick={e=>{e.stopPropagation();setShowHealthBreakdown(false);}} style={{background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontSize:12,color:'var(--text-muted)',lineHeight:1,marginLeft:4,borderRadius:4}} title="Close">✕</button>
                </div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:10,lineHeight:1.4}}>
                  How your {scopeLabel.toLowerCase()} is performing right now. Each factor is scored 0-100 and weighted below.
                </div>
                {[
                  {label:'SLA Compliance',weight:wSLA,value:`${slaCompRate}%`,score:slaCompRate,sub:`${Math.max(0, slaTotal - slaBreachTotal)}/${slaTotal} on-time · everything except Jira`,icon:'bi-shield-check'},
                  {label:'Resolution Rate',weight:wRes,value:`${resRate}%`,score:resScore,sub:`${zdClosedCount} closed · ${zdOpenAndOnHoldCount} open + on-hold · Zendesk only · 50% = excellent`,icon:'bi-check2-all'},
                  {label:'Avg Response Time',weight:wResp,value:avgResponseTime>=60?`${Math.round(avgResponseTime/60)}h ${avgResponseTime%60}m`:`${avgResponseTime}m`,score:respScore,sub:`Zendesk biz-day · ${zdActive.length} active ticket(s) · ${respScore>=80?'Fast':respScore>=60?'Normal':respScore>=40?'Slow':'Very slow'}`,icon:'bi-clock-history'},
                  {label:'Team Capacity',weight:wCap,value:wl,score:wlScore,sub: isOwnScope ? `${myCount} tasks · ${Math.round(capPct)}% of ${capHighMin}` : `${myCount} avg / agent · ${agentTaskTotal} tasks ÷ ${teamSize} ${teamSize === 1 ? 'agent' : 'agents'}`,icon:'bi-speedometer2'},
                ].map(row=>{
                  const rc=row.score>=80?'#29811e':row.score>=60?'#ed8d00':'#d42d35';
                  return(
                    <div key={row.label} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid #f5f5f5'}}>
                      <i className={row.icon} style={{fontSize:13,color:rc,width:18,textAlign:'center'}}></i>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                          <span style={{fontSize:12,color:'var(--text)',fontWeight:600}}>{row.label}</span>
                          <span style={{fontSize:9,color:'var(--text-muted)',fontWeight:600,background:'var(--surface-3)',padding:'1px 6px',borderRadius:99}}>{row.weight}%</span>
                        </div>
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>{row.sub}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:14,fontWeight:700,color:rc,fontVariantNumeric:'tabular-nums',lineHeight:1}}>{row.value}</div>
                        <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2,fontVariantNumeric:'tabular-nums'}}>score {row.score}</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{marginTop:10,padding:'8px 10px',borderRadius:10,background:hColor+'08',border:`1px solid ${hColor}15`,textAlign:'center',lineHeight:1.4}}>
                  <div style={{fontSize:10,color:hColor,fontWeight:700,letterSpacing:'.02em'}}>
                    Score = (SLA×{wSLA} + Res×{wRes} + Resp×{wResp} + Cap×{wCap}) ÷ {wSum}
                  </div>
                  <div style={{fontSize:9,color:'var(--text-muted)',marginTop:3}}>
                    Weights are configurable in Settings → Briefing
                  </div>
                </div>
              </div>}
            </div>}

            {/* KPI Summary Cards */}
            {settings.briefing_show_kpi_cards!==false&&<div style={{display:'flex',alignItems:'center',gap:'var(--space-4, 16px)',flexShrink:0}}>
              <KpiCard label="Workload" value={wl} color={wc} icon="bi-speedometer2" clickable onClick={()=>setView('my-queue')}/>
              {/* 2026-05-21 audit U03: bump green threshold to 90% so a
                  visible KPI tile of "88%" doesn't read as Good. ≥90% green,
                  ≥75% orange, <75% red. Matches the org-breach ring below
                  which already used 90/70 cuts. */}
              <KpiCard label="SLA Comp %" value={`${slaCompRate}%`} color={slaCompRate>=90?'#29811e':slaCompRate>=75?'#ed8d00':'#d42d35'} icon="bi-shield-check" clickable onClick={()=>setView('analytics')}/>
              {/* Header KPI: every resolved item currently in the viewer's
                  scope (own / team / region / org). Cross-source — counts
                  Zendesk + Jira tickets + Workbench COMPLETED + CLOSED.
                  No 24h cap (2026-05-07 v2): the previous "Resolved (24h)"
                  tile collapsed to ~50 for an admin while DailySummary
                  showed ~797 off the same FE state because of accumulation
                  in mergeSourceIntoTasks. Other Deel sources don't surface
                  COMPLETED rows yet — they're missing by design until
                  those loaders gain `includeCompleted`. */}
              <KpiCard label="Resolved" value={resolvedInScope.length} color="#29811e" icon="bi-check-circle-fill" clickable onClick={()=>setView('my-queue')} title={`${resolvedInScope.length} resolved in your scope. Counts Zendesk + Jira + Workbench (other Deel sources don't currently expose completed-data).`}/>
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
          const pendingAcks=comms.filter(c=>c.status==='sent'&&targetMatch(c)&&!isAckedByMe(c)&&!(c.author&&c.author.id===user.id)&&!dismissedAckIds.has(c.id));
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
                  <div style={{fontSize:17,fontWeight:700,color:'var(--text)',lineHeight:1.3,marginBottom:6}}>{comm.title}</div>
                  <div style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.5,maxWidth:600,overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{comm.body.slice(0,160)}{comm.body.length>160?'...':''}</div>
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
                  <div style={{width:56,height:56,borderRadius:16,background:'var(--surface)',boxShadow:'0 2px 8px rgba(0,0,0,0.06)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className={bt.icon} style={{fontSize:24,color:bt.iconBg}}></i>
                  </div>
                  <div style={{fontSize:10,fontWeight:600,color:bt.accent,textTransform:'uppercase',letterSpacing:'.04em'}}>
                    {comm.type==='alert'?'Alert':comm.type==='announce'?'Announcement':comm.type==='update'?'Update':comm.type==='guidance'?'Guidance':'Kudos'}
                  </div>
                </div>

                {/* X to dismiss from view (not ack). Hides this announcement
                    from the hero banner — does NOT record an ack server-side.
                    Users can still review + acknowledge from the Announcements
                    tab. Per-user, persisted in localStorage. */}
                {/* 2026-05-21 audit U01: X was nearly invisible (gray glyph
                    on light pastel bg). Stronger background tint + larger
                    glyph + darker default color give it proper discoverability;
                    hover state amps the bg further. */}
                <button
                  aria-label="Dismiss from hero (you can still acknowledge from the Announcements tab)"
                  title="Dismiss from hero (you can still acknowledge from the Announcements tab)"
                  onClick={(e)=>{e.stopPropagation();dismissAck(comm.id);if(total>1)goNext();}}
                  onMouseEnter={(e)=>{e.currentTarget.style.background='rgba(0,0,0,0.16)';}}
                  onMouseLeave={(e)=>{e.currentTarget.style.background='rgba(0,0,0,0.10)';}}
                  style={{position:'absolute',top:10,right:12,width:28,height:28,borderRadius:'50%',background:'rgba(0,0,0,0.10)',border:'none',cursor:'pointer',color:'var(--text)',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',transition:'background .15s'}}>
                  <i className="bi-x-lg" style={{fontSize:12}}></i>
                </button>
              </div>

              {/* Navigation: arrows + dots + counter */}
              {total>1&&(
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'10px 0 2px'}}>
                  {/* Left arrow */}
                  <button onClick={goPrev} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #e0e0e0',background:'var(--surface)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-secondary)',fontSize:13,transition:'all .15s'}}
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
                  <button onClick={goNext} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #e0e0e0',background:'var(--surface)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-secondary)',fontSize:13,transition:'all .15s'}}
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
            // Author's own announcements don't count as "needing my ack" —
            // they already broadcast it; an author re-acking their own
            // post is a noise notification. 2026-05-18: caught when an
            // admin's "1 unacked" badge couldn't be cleared because the
            // unacked item was their own published announcement.
            const inAudExec=(c)=>matchesAudience(c.target,user.team)&&!(c.author&&c.author.id===user.id);
            const execUnackedCount=comms.filter(c=>c.status==='sent'&&(c.type==='announce'||c.type==='alert'||c.type==='guidance')&&!isAckedByMe(c)&&inAudExec(c)).length;
            return(
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginBottom:16}}>
                {[
                  // 2026-05-04 rebrand cleanup (audit F6 + F10): dropped
                  // the dead Meetings / Projects / Escalations / My To-Do
                  // tiles — those features were deleted from the product
                  // and the tiles either showed 0 forever or pointed at
                  // routes that no longer rendered. "Active Requests"
                  // renamed to "Open Tasks" to disambiguate from HR Hub
                  // Requests; the underlying count is unchanged (sum of
                  // open items across every queue source).
                  /* 2026-05-21 audit F07: three "tasks" totals on the
                     Briefing didn't reconcile — Open Tasks (cross-source
                     all-time open), Status Pipeline (open + new + pause +
                     resolved within current scope), DES total ("today only").
                     Inline tooltip clarifies each. */
                  {icon:'bi-inbox-fill',label:'Open Tasks',value:activeRequestsCount,color:'var(--g)',sub:isOwnScope?'mine':isTeamScope?'team':'org-wide',nav:()=>setView('my-queue'),tooltip:'All open items across every queue source (Zendesk, Jira, Workbench, Onboarding, Offboarding, Amendments, Redlines, Incentive Plans), scoped to your current view. Distinct from Status Pipeline (which slices the same set into Open/New/In Progress/Pause/Resolved) and from the Department Executive Summary "today total" (created-today only).'},
                  {icon:'bi-megaphone-fill',label:'Announcements',value:execUnackedCount,color:execUnackedCount>0?'#ed8d00':'#616161',alert:execUnackedCount>0,nav:()=>{setView('announcements');try{window.dispatchEvent(new CustomEvent('announcements:setFilter',{detail:{filter:'needs-ack'}}));}catch(_){}}, accent:execUnackedCount>0?'#fff8e6':null,sub:'unacked'},
                ].map(m=>(
                  <DeelCard key={m.label}
                    onClick={m.nav}
                    title={m.tooltip}
                    style={{padding:'16px 18px',position:'relative',cursor:m.nav?'pointer':'default',background:m.accent||'white',border:m.accent?`1px solid ${m.color}22`:'1px solid #e8e8e8'}}>
                    {m.alert&&m.value>0&&<span className="pulse" style={{position:'absolute',top:10,right:12,width:7,height:7,borderRadius:'50%',background:'#d42d35'}}></span>}
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                      <i className={m.icon} style={{fontSize:12,color:m.color}}></i>
                      <span style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)',textTransform:'none',letterSpacing:'normal'}}>{m.label}</span>
                    </div>
                    <div style={{fontSize:24,fontWeight:700,color:m.nav?'#1f74b3':m.color,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.value}</div>
                    {m.sub&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:6}}>{m.sub}</div>}
                  </DeelCard>
                ))}
              </div>
            );
          })()}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:'var(--font-md)',fontWeight:600,color:'var(--text)',letterSpacing:0}}>Department Executive Summary</div>
            <div style={{fontSize:13,color:'var(--text-secondary)',marginTop:2}} title="Count of items created today (rolling 24h) across every queue source. Distinct from Open Tasks (all open items, not just today) and from Status Pipeline (slices the same created-today set by status).">{orgOpen.length+orgResolved.length} total tasks today</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            {/* Col 1: Status Pipeline */}
            <DeelCard>
              <CardTitle>Status Pipeline</CardTitle>
              {[
                {l:'Open',v:orgOpen.length,c:'var(--g)',iconEl:<i className="bi bi-circle" style={{fontSize:12}}/>},
                {l:'New',v:orgNew,c:'#1f74b3',iconEl:<i className="bi bi-dot" style={{fontSize:16}}/>},
                {l:'In Progress',v:orgIP,c:'#ed8d00',iconEl:<i className="bi bi-arrow-repeat" style={{fontSize:12}}/>},
                {l:'Pause',v:orgWait,c:'var(--text-muted)',iconEl:<i className="bi bi-pause-circle" style={{fontSize:12}}/>},
                {l:'Resolved',v:orgResolved.length,c:'#29811e',iconEl:<i className="bi bi-check-circle-fill" style={{fontSize:12}}/>},
              ].map(s=>(
                <div key={s.l} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border-light)'}}>
                  <span style={{color:s.c,width:16,textAlign:'center',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{s.iconEl}</span>
                  <span style={{fontSize:13,color:'var(--text)',flex:1,fontWeight:500}}>{s.l}</span>
                  <span style={{fontSize:24,fontWeight:700,color:s.c,fontVariantNumeric:'tabular-nums'}}>{s.v}</span>
                </div>
              ))}
            </DeelCard>
            {/* Col 2: Source Breakdown */}
            <DeelCard>
              <CardTitle>By Source</CardTitle>
              {srcTotal === 0 && (
                /* 2026-05-21 audit F23: a brand-new dept (GIX / Payroll /
                   Benefits) with no integrations + no live data renders this
                   card empty. The blank space reads as a broken card; add a
                   helpful zero-state pointing to Settings → Source
                   Integrations so the admin knows where to fix it. */
                <div style={{padding:'18px 8px',textAlign:'center',color:'var(--text-muted)',fontSize:12,lineHeight:1.5}}>
                  <i className="bi bi-cloud-slash" style={{fontSize:22,display:'block',marginBottom:6,opacity:0.6}}></i>
                  <div>No source data yet.</div>
                  <div style={{marginTop:2}}>
                    Configure integrations in{' '}
                    <span onClick={()=>setView('settings')} style={{color:'#7c3aed',cursor:'pointer',fontWeight:600}}>Settings</span>.
                  </div>
                </div>
              )}
              {srcEntries.map(([src,cnt])=>{
                const tl=TOOLS[src];const pct=srcPctMap.get(src) ?? 0;
                const isExpanded=expandedSource===src;
                const deelApiRowsMap={onboarding:onboardingRows,offboarding:offboardingRows,amendments:amendmentRows,redlines:redlineRows,workbench:workbenchActiveRows,incentive_plans:incentivePlanRows,immigration_tasks:immigrationTaskActiveRows,immigration_cases:immigrationCaseActiveRows};
                const srcTasks=[...srcPool.filter(t=>t.source===src),...(deelApiRowsMap[src]||[])];
                const srcBarColor=SOURCE_COLOURS[src]||tl?.color||'#9e9e9e';
                return(
                  <div key={src}>
                    <div onClick={()=>setExpandedSource(isExpanded?null:src)}
                      style={{display:'flex',alignItems:'center',gap:10,padding:'8px 4px',cursor:'pointer',borderRadius:8,transition:'background .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{width:26,height:26,borderRadius:8,background:tl?.bg||'var(--surface-3)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <i className={tl?.icon||'bi-circle'} style={{fontSize:11,color:srcBarColor}}></i>
                      </div>
                      <span style={{fontSize:13,color:'var(--text)',flex:1,fontWeight:500}}>{tl?.label||src}</span>
                      <span style={{fontSize:20,fontWeight:700,color:'#1f74b3',fontVariantNumeric:'tabular-nums',cursor:'pointer'}}>{cnt}</span>
                      <div style={{width:48,height:6,borderRadius:3,background:'var(--surface-3)',marginLeft:4}}>
                        <div style={{width:`${pct}%`,height:6,borderRadius:3,background:srcBarColor,transition:'width .3s'}}></div>
                      </div>
                      <span style={{fontSize:10,color:'var(--text-muted)',width:30,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{pct}%</span>
                      <i className={isExpanded?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:9,color:'var(--text-muted)',marginLeft:2}}></i>
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
                    <div style={{fontSize:15,fontWeight:700,color:'var(--text)',fontVariantNumeric:'tabular-nums'}}>{orgSlaComp}%</div>
                    <div style={{fontSize:7,color:'var(--text-muted)',fontWeight:600}}>SLA</div>
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
                          onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <span style={{fontSize:12,color:'var(--text-secondary)',display:'flex',alignItems:'center',gap:5}}>
                            {row.label}
                            <i className={isExp?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:8,color:'var(--text-muted)'}}></i>
                          </span>
                          <span style={{fontSize:18,fontWeight:700,color:row.color,fontVariantNumeric:'tabular-nums',cursor:'pointer'}}>{row.count}</span>
                        </div>
                        {isExp&&<MiniTicketList items={row.items} emptyMsg={`No ${row.label.toLowerCase()} tasks`}/>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{borderTop:'1px solid var(--border-light)',paddingTop:14}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)',textTransform:'none',letterSpacing:'normal',marginBottom:8}}>Overall Capacity</div>
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
                      <div style={{fontSize:9,color:'var(--text-muted)',marginTop:1}}>{desc}</div>
                    </div>);
                  })}
                </div>
                <div style={{fontSize:10,color:'var(--text-muted)',marginTop:8,textAlign:'center'}}>Team avg: {teamAvg.toFixed(1)} tasks/agent &middot; {allAgents.length} agents</div>
              </div>
            </DeelCard>
          </div>
        </div>}

        {/* ══════════════════════════════════════════════════════════════════
            AGENT METRICS — bigger boxes with clear numbers
        ══════════════════════════════════════════════════════════════════ */}
        {isOwnScope&&<div style={{padding:'12px 24px'}}>
          {/* ── Stat cards ──── */}
          {(()=>{
            // See exec block above for the author-exclusion rationale —
            // mirrored here so the Agent briefing tile has the same
            // semantics.
            const inAudience=(c)=>matchesAudience(c.target,user.team)&&!(c.author&&c.author.id===user.id);
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
            if(workbenchActiveRows.length)   srcMap.workbench   =(srcMap.workbench   ||0)+workbenchActiveRows.length;
            if(incentivePlanRows.length)        srcMap.incentive_plans  =(srcMap.incentive_plans  ||0)+incentivePlanRows.length;
            if(immigrationTaskActiveRows.length) srcMap.immigration_tasks=(srcMap.immigration_tasks||0)+immigrationTaskActiveRows.length;
            if(immigrationCaseActiveRows.length) srcMap.immigration_cases=(srcMap.immigration_cases||0)+immigrationCaseActiveRows.length;
            const srcBreakdown=Object.entries(srcMap).sort((a,b)=>b[1]-a[1]);
            return(<>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
            {[
              // Open Tasks (was "Active Requests") renamed to disambiguate
              // from HR Hub Requests after the 2026-05-03 rebrand. The
              // underlying activeRequestsCount is the cross-queue open
              // count (Pilar's rule). Meetings / Projects / Escalations /
              // My To-Do tiles dropped per audit F6 + F10 — features
              // deleted from the product.
              {icon:'bi-inbox-fill',label:'Open Tasks',value:activeRequestsCount,color:'var(--g)',sub:isOwnScope?'mine':isTeamScope?`team · avg ${teamAvg.toFixed(1)}`:`avg ${teamAvg.toFixed(1)}`,tr:trend(),expandKey:'active-breakdown'},
              {icon:'bi-megaphone-fill',label:'Announcements',value:unackedCount,color:unackedCount>0?'#ed8d00':'#616161',alert:unackedCount>0,nav:()=>{setView('announcements');try{window.dispatchEvent(new CustomEvent('announcements:setFilter',{detail:{filter:'needs-ack'}}));}catch(_){}}, accent:unackedCount>0?'#fff8e6':null,sub:'unacked'},
            ].map((m,i)=>(
              <DeelCard key={m.label}
                onClick={m.expandKey?()=>setExpandedSla(expandedSla===m.expandKey?null:m.expandKey):m.nav?m.nav:undefined}
                style={{padding:'16px 18px',position:'relative',cursor:m.expandKey||m.nav?'pointer':'default',background:m.accent||'white',border:m.accent?`1px solid ${m.color}22`:'1px solid #e8e8e8'}}>
                {m.alert&&m.value>0&&<span className="pulse" style={{position:'absolute',top:10,right:12,width:7,height:7,borderRadius:'50%',background:'#d42d35'}}></span>}
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                  <i className={m.icon} style={{fontSize:12,color:m.color}}></i>
                  <span style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',textTransform:'none',letterSpacing:'normal'}}>{m.label}</span>
                </div>
                <div style={{fontSize:24,fontWeight:700,color:(m.expandKey||m.nav)?'#1f74b3':m.color,lineHeight:1,fontVariantNumeric:'tabular-nums',cursor:(m.expandKey||m.nav)?'pointer':'default'}}>{m.value}</div>
                <div style={{display:'flex',alignItems:'center',gap:4,marginTop:6}}>
                  {m.sub&&<span style={{fontSize:10,color:'var(--text-muted)'}}>{m.sub}</span>}
                  {m.tr&&m.tr.pct>0&&<span style={{fontSize:10,fontWeight:700,color:m.tr.c}}>{m.tr.dir}{m.tr.pct}%</span>}
                </div>
              </DeelCard>
            ))}
          </div>
          {expandedSla==='active-breakdown'&&isOwnScope&&<div style={{marginTop:10}}>
            <div style={{background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 16px',animation:'fadeSlide .2s ease'}}>
              {srcBreakdown.length===0?<div style={{fontSize:11,color:'var(--text-muted)',padding:'12px 0',textAlign:'center'}}>No active tasks</div>:
              srcBreakdown.map(([src,cnt])=>{
                const tl=TOOLS[src];const color=SOURCE_COLOURS[src]||tl?.color||'#bebebe';
                return(
                  <div key={src} onClick={()=>{setView('my-queue');}}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'8px 4px',cursor:'pointer',borderRadius:8,transition:'background .15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{width:24,height:24,borderRadius:6,background:tl?.bg||'#f7f5f2',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <i className={tl?.icon||'bi-circle'} style={{fontSize:10,color}}></i>
                    </div>
                    <span style={{fontSize:13,color:'var(--text)',flex:1,fontWeight:500}}>{tl?.label||src.charAt(0).toUpperCase()+src.slice(1)}</span>
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
            LEAD METRICS — Decisions strip
            Replaces the legacy 6-tile (Active Requests / Meetings / Projects
            / Escalations / Announcements / My To-Do) for any manager. Surfaces
            the four signals a TL/RM/admin actually decides on: hide-task
            approvals, unacked Leader Alerts, Urgent Assist, HR Hub pending.
            Click any tile to land on the relevant view.
        ══════════════════════════════════════════════════════════════════ */}
        {isManager&&<div style={{margin:'12px 24px 0'}}>
          <DecisionsStrip onNavigate={(v)=>setView(v)} user={user} />
        </div>}

        {/* ── MAIN CONTENT ────────────────────────────────────────────────── */}
        <div style={{padding:'12px 24px 20px'}}>

          {/* ── Coverage requests awaiting response (Mohamed 2026-06-04) ──
              Action-needed banner; "Respond" opens the accept/decline popup.
              Self-hides when the caller has no pending invitations. */}
          <PendingCoverageBanner />

          {/* ── Phase 3 CoverageBanner — surfaces active OOO coverages ───
              Renders only when the caller has accepted coverage on a
              currently-active handover (HANDOVERS_PLAN.md §10.3). */}
          <CoverageBanner onOpenOOO={() => setView?.('ooo')} />

          {/* ── TRIAGE STRIP — what's on fire across my team's queue ──────
              4 KPI tiles: Breached / At-Risk / Paused / No-real-owner.
              Reads pre-scoped row sets (onboarding…incentivePlanRows already
              run scopeOnboarding etc., and `scope` is already filterByAssignee
              on ZD/Jira). Counts therefore agree with what the manager sees
              in Workspace, including country-OR-assignee visibility.        */}
          {isManager && (
            <TriageStrip
              sourceRows={[
                ...onboardingRows,
                ...offboardingRows,
                ...amendmentRows,
                ...redlineRows,
                ...workbenchActiveRows,
                ...incentivePlanRows,
              ]}
              tickets={scope}
              onNavigate={(v) => setView(v)}
            />
          )}

          {/* ── TEAM SUMMARY TABLE (managers only) ──────────────────────── */}
          {isManager&&hmMembers.length>0&&<DeelCard style={{padding:0,overflow:'hidden',marginBottom:20}}>
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:12,background:'linear-gradient(135deg,#f3eff8,#EDE9FE)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <i className="bi-people-fill" style={{fontSize:16,color:'#7c3aed'}}></i>
              </div>
              <span style={{fontSize:18,fontWeight:700,color:'var(--text)'}}>Team Summary</span>
              <span style={{fontSize:12,color:'var(--text-muted)',marginLeft:'auto',background:'var(--surface-2)',padding:'3px 12px',borderRadius:128,fontWeight:600,border:'1px solid var(--border)'}}>{hmMembers.length} members</span>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'var(--surface-2)',borderBottom:'1px solid #e8e8e8'}}>
                    <th style={{padding:'12px 24px',textAlign:'left',fontWeight:600,color:'var(--text-muted)',fontSize:12}}>Full Name</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="Country ownership — controls who sees rows for this country in the country-OR-assignee queues. Click to edit.">Countries</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="Total = Open + Paused across Zendesk, Jira, Workbench, Onboarding, Offboarding, Amendments, Redlines">Total</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="Actionable rows across all 7 sources">Open</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="Paused / waiting rows across all 7 sources">Paused</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="Escalated tickets (subset of Open — informational)">Escalated</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="SLA-breached rows across all 7 sources">Breaches</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="Baseline 30 tasks = healthy workload. capacity% = total / 30.">Capacity %</th>
                    <th style={{padding:'12px 16px',textAlign:'center',fontWeight:600,color:'var(--text-muted)',fontSize:12}} title="<20 Low · 20-50 Medium · >50 High">Workload</th>
                    <th style={{padding:'12px 16px',textAlign:'right',fontWeight:600,color:'var(--text-muted)',fontSize:12,whiteSpace:'nowrap'}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Resolve the live roster row (lastSeenAt / countries /
                    // access flags) for an agent or manager. Falls back to the
                    // baked-in MEMBERS_BY_EMAIL when the live fetch hasn't
                    // landed yet so the row never blank-flashes.
                    const liveOf = (email) => {
                      const lc = (email || '').toLowerCase();
                      if (!lc) return null;
                      return (liveMembersByEmail && liveMembersByEmail[lc]) || MEMBERS_BY_EMAIL[lc] || null;
                    };

                    // 24 px base + 32 px per nesting level. Depth 0 = the
                    // user's direct reports; depth 1 = their direct reports;
                    // depth N = N levels below the viewer.
                    const indentFor = (depth) => 24 + depth * 32;

                    // Single source of truth for an agent row.
                    const agentRow = (m, key, depth) => {
                      const live = liveOf(m.email);
                      return (
                      <tr key={key} style={{borderBottom:'1px solid var(--border-light)',transition:'background .15s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <td style={{padding:'14px 24px',paddingLeft: indentFor(depth)}}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <Avatar name={m.name} size={32}/>
                            <div style={{minWidth:0}}>
                              <div style={{fontWeight:600,color:'var(--text)',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                                {m.name}
                                <AccessBadge access={live?.access || m.access || 'agent'} />
                                <LastSeenPill iso={live?.lastSeenAt} loading={!!rosterLoading} />
                                <OOOBadge events={oooEventsByEmail.get((m.email || '').toLowerCase())} />
                              </div>
                              <div style={{fontSize:11,color:'var(--text-muted)'}}>{FLAGS[m.country]} {m.team}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px',verticalAlign:'middle'}}>
                          <CountriesCell
                            member={live || { email: m.email, countries: [] }}
                            setCountries={liveSetCountries}
                            canEdit={canEditMemberCountries(m.email)}
                          />
                        </td>
                        <td style={{padding:'14px 16px',textAlign:'center',fontWeight:700,fontSize:16,color:'var(--text)'}}>{m.tc}</td>
                        <td style={{padding:'14px 16px',textAlign:'center',fontWeight:600,color:'#1f74b3'}}>{m.open}</td>
                        <td style={{padding:'14px 16px',textAlign:'center',fontWeight:600,color:'#ed8d00'}}>{m.paused}</td>
                        <td style={{padding:'14px 16px',textAlign:'center',fontWeight:600,color:'#7c3aed'}}>{m.escalated}</td>
                        <td style={{padding:'14px 16px',textAlign:'center'}}>
                          {m.br > 0
                            ? <span style={{fontWeight:700,color:'#d42d35',background:'#fef2f2',padding:'3px 10px',borderRadius:128}}>{m.br}</span>
                            : <span style={{color:'#29811e',fontWeight:600}}>0</span>}
                        </td>
                        <td style={{padding:'14px 16px',textAlign:'center'}} title={m.capPct > 100 ? `${m.capPct}% — ${m.capPct - 100} percentage points over baseline (${BASELINE_CAPACITY} tasks). Capped to 100% in the bar; overflow shown with the "+X over" badge.` : `${m.capPct}% of baseline (${BASELINE_CAPACITY} tasks).`}>
                          <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
                            <div style={{width:40,height:5,borderRadius:3,background:'var(--surface-3)'}}>
                              <div style={{width:`${Math.min(m.capPct,100)}%`,height:5,borderRadius:3,background:m.wc}}></div>
                            </div>
                            <span style={{fontSize:11,fontWeight:600,color:'var(--text-secondary)'}}>{Math.min(m.capPct, 100)}%</span>
                            {m.capPct > 100 && (
                              <span style={{fontSize:9,fontWeight:700,color:'#d42d35',background:'#fef2f2',padding:'1px 6px',borderRadius:128,letterSpacing:'0.02em'}}>
                                +{m.capPct - 100} over
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{padding:'14px 16px',textAlign:'center'}}>
                          <span style={{fontSize:11,fontWeight:700,color:m.wc,padding:'3px 12px',borderRadius:128,background:m.wc+'15'}}>{m.wl}</span>
                        </td>
                        <td style={{padding:'12px 16px',textAlign:'right',whiteSpace:'nowrap'}}>
                          <LoginAsButton
                            targetEmail={m.email}
                            targetName={m.name}
                            onImpersonate={onImpersonate}
                            canImpersonate={canLoginAs(m.email)}
                          />
                        </td>
                      </tr>
                      );
                    };

                    // Group header — manager (TL or RM) with aggregate stats
                    // for their full subtree. Depth-indented + chevron that
                    // toggles expansion of sub-groups + direct agents.
                    // capPct + workload band are computed off the average
                    // per agent so they stay comparable with the per-agent
                    // rows below.
                    const groupHeader = (g, depth, hasChildren, expanded) => {
                      const live = liveOf(g.manager.email);
                      // Deeper levels get a lighter tint so the L1 RM bar
                      // stays the visually-dominant divider. L0 = #f3eff8
                      // (the original purple), L1 = #faf7ff, L2+ = #fdfcff.
                      const bgByDepth = depth === 0 ? '#f3eff8' : depth === 1 ? '#faf7ff' : '#fdfcff';
                      const onToggle = hasChildren ? () => toggleManagerExpanded(g.manager.email) : undefined;
                      return (
                      <tr key={`grp-${g.manager.email}`}
                        style={{background:bgByDepth,borderTop:'2px solid #e8e8e8',cursor:hasChildren?'pointer':'default'}}
                        onClick={hasChildren ? (e) => {
                          // Don't toggle when the user clicks an interactive
                          // child (Login as / Countries picker / etc.).
                          const t = e.target;
                          if (t && (t.closest('button') || t.closest('input') || t.closest('[role="button"]'))) return;
                          onToggle?.();
                        } : undefined}>
                        <td style={{padding:'12px 24px',paddingLeft: indentFor(depth)}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
                                aria-label={expanded ? 'Collapse' : 'Expand'}
                                aria-expanded={expanded}
                                style={{
                                  width:22,height:22,borderRadius:6,
                                  border:'1px solid var(--border)',background:'var(--surface)',
                                  display:'inline-flex',alignItems:'center',justifyContent:'center',
                                  cursor:'pointer',color:'var(--text-secondary)',flexShrink:0,
                                  transition:'background .12s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f5f2'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                              >
                                <i className={expanded ? 'bi-chevron-down' : 'bi-chevron-right'} style={{fontSize:10}} />
                              </button>
                            ) : (
                              <span style={{width:22,flexShrink:0}} />
                            )}
                            <Avatar name={g.manager.name} size={32}/>
                            <div style={{minWidth:0}}>
                              <div style={{fontWeight:700,color:'var(--text)',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                                {g.manager.name}
                                <AccessBadge access={live?.access || g.manager.access} />
                                <LastSeenPill iso={live?.lastSeenAt} loading={!!rosterLoading} />
                                <OOOBadge events={oooEventsByEmail.get((g.manager.email || '').toLowerCase())} />
                              </div>
                              <div style={{fontSize:11,color:'var(--text-muted)'}}>
                                {g.manager.team} &middot; {g.headcount} {g.headcount === 1 ? 'agent' : 'agents'}
                                {g.subGroups.length > 0 && (
                                  <> &middot; {g.subGroups.length} {g.subGroups.length === 1 ? 'team lead' : 'team leads'}</>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px',verticalAlign:'middle'}}>
                          <CountriesCell
                            member={live || { email: g.manager.email, countries: [] }}
                            setCountries={liveSetCountries}
                            canEdit={canEditMemberCountries(g.manager.email)}
                          />
                        </td>
                        <td style={{padding:'12px 16px',textAlign:'center',fontWeight:700,fontSize:16,color:'var(--text)'}}>{g.tc}</td>
                        <td style={{padding:'12px 16px',textAlign:'center',fontWeight:700,color:'#1f74b3'}}>{g.open}</td>
                        <td style={{padding:'12px 16px',textAlign:'center',fontWeight:700,color:'#ed8d00'}}>{g.paused}</td>
                        <td style={{padding:'12px 16px',textAlign:'center',fontWeight:700,color:'#7c3aed'}}>{g.escalated}</td>
                        <td style={{padding:'12px 16px',textAlign:'center'}}>
                          {g.br > 0
                            ? <span style={{fontWeight:700,color:'#d42d35',background:'#fef2f2',padding:'3px 10px',borderRadius:128}}>{g.br}</span>
                            : <span style={{color:'#29811e',fontWeight:700}}>0</span>}
                        </td>
                        <td style={{padding:'12px 16px',textAlign:'center'}} title={`Average across ${g.headcount} agent${g.headcount === 1 ? '' : 's'}: ${g.capPct}% of baseline.`}>
                          <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
                            <div style={{width:40,height:5,borderRadius:3,background:'#e8e1f3'}}>
                              <div style={{width:`${Math.min(g.capPct,100)}%`,height:5,borderRadius:3,background:g.wc}}></div>
                            </div>
                            <span style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)'}}>{Math.min(g.capPct, 100)}%</span>
                            {g.capPct > 100 && (
                              <span style={{fontSize:9,fontWeight:700,color:'#d42d35',background:'#fef2f2',padding:'1px 6px',borderRadius:128,letterSpacing:'0.02em'}}>
                                +{g.capPct - 100} over
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{padding:'12px 16px',textAlign:'center'}}>
                          <span style={{fontSize:11,fontWeight:700,color:g.wc,padding:'3px 12px',borderRadius:128,background:g.wc+'15'}}>{g.wl}</span>
                        </td>
                        <td style={{padding:'12px 16px',textAlign:'right',whiteSpace:'nowrap'}}>
                          <LoginAsButton
                            targetEmail={g.manager.email}
                            targetName={g.manager.name}
                            onImpersonate={onImpersonate}
                            canImpersonate={canLoginAs(g.manager.email)}
                          />
                        </td>
                      </tr>
                      );
                    };

                    // Banner row used to label the trailing "Direct reports"
                    // section when the user has agents reporting to them
                    // without an intermediate TL.
                    const sectionLabel = (label) => (
                      <tr key={`label-${label}`} style={{background:'var(--surface-2)',borderTop:'2px solid var(--border)'}}>
                        <td colSpan={10} style={{padding:'10px 24px',fontSize:11,fontWeight:700,color:'var(--text-muted)',letterSpacing:'0.04em',textTransform:'uppercase'}}>{label}</td>
                      </tr>
                    );

                    // Recursive group renderer — when expanded, recurses
                    // into sub-groups (deeper indent) and finally into
                    // direct agents (deepest indent).
                    const renderGroup = (g, depth) => {
                      const expanded = expandedManagers.has(g.manager.email);
                      const hasChildren = g.subGroups.length > 0 || g.directAgents.length > 0;
                      return (
                        <Fragment key={`grp-frag-${g.manager.email}`}>
                          {groupHeader(g, depth, hasChildren, expanded)}
                          {expanded && (
                            <>
                              {g.subGroups.map(sg => renderGroup(sg, depth + 1))}
                              {g.directAgents.map(a => agentRow(a, `${g.manager.email}-${a.id}`, depth + 1))}
                            </>
                          )}
                        </Fragment>
                      );
                    };

                    const { groups, directAgents } = teamSummaryTree;
                    // TL with no sub-managers + no direct-agent overrides →
                    // fall back to the flat agent list (preserves the
                    // pre-rework behaviour for that one role).
                    if (groups.length === 0 && directAgents.length === 0) {
                      return hmMembers.map(m => agentRow(m, m.id, 0));
                    }
                    return (
                      <>
                        {groups.map(g => renderGroup(g, 0))}
                        {directAgents.length > 0 && (
                          <Fragment key="direct-reports">
                            {sectionLabel('Direct reports')}
                            {directAgents.map(a => agentRow(a, `direct-${a.id}`, 1))}
                          </Fragment>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            <div style={{padding:'10px 24px 14px',fontSize:11,color:'var(--text-muted)',borderTop:'1px solid var(--border-light)',background:'var(--surface-2)'}}>
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
          {/* Agents have only the Personal Checklist in Col 1 while Col 2
              stacks DailySummary, ApproachingBreach, Team Availability,
              Recent Activity, and Quick Nav. The 2026-05-03 agent audit
              (A-F4) caught the resulting ~600 px of dead whitespace
              under PersonalChecklist on agent home. Switching agents to a
              single-column layout lets the checklist + the context cards
              stack naturally without any blank gap. Managers keep the
              two-column grid because their Col 1 has Team Leads / OOO
              Alert / TeamRequestsToMe / StaleTickets to match Col 2's
              height. */}
          <style>{`
            .briefing-main-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; align-items: start; }
            .briefing-main-grid.is-agent { grid-template-columns: 1fr; }
            @media (max-width: 980px) { .briefing-main-grid { grid-template-columns: 1fr; } }
          `}</style>
          <div className={`briefing-main-grid${isOwnScope ? ' is-agent' : ''}`}>

            {/* ── COL 1: My Tasks (Phase 2, 2026-05-25) ─────────────────────
                Replaces the legacy PersonalChecklist with BriefingMyTasks,
                which reads the same work_tasks backend the Tasks tab + Queue
                Tasks source use. The user's old PersonalChecklist items are
                auto-migrated on first work-tasks API hit (sentinel in
                app_settings) so nothing is lost on the switchover. Quick-
                add stays on Briefing (single-line composer) so the muscle
                memory of "type a todo on home" still works; the list view
                + full management lives in the Tasks tab. */}
            <BriefingMyTasks
              user={user}
              onOpenTasks={() => {
                // 2026-05-25 — Tasks moved under Workspace; route through
                // queue:focusSource so the user lands inside the Tasks tab
                // rather than a now-defunct top-level 'tasks' view.
                setView?.('my-queue');
                try { window.dispatchEvent(new CustomEvent('queue:focusSource', { detail: { source: 'work_tasks' } })); } catch {}
              }}
              onOpenTask={(taskId) => {
                // Deep-link a specific task — URL stamp + my-queue view
                // switch; the ?task=<id> initialiser in App.jsx hydrates
                // focusTaskId, then Queue's effect routes into work_tasks
                // and TasksQueuePanel opens the detail drawer.
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.set('task', taskId);
                  window.history.replaceState({}, '', url.toString());
                } catch {}
                setView?.('my-queue');
                try { window.dispatchEvent(new CustomEvent('queue:focusSource', { detail: { source: 'work_tasks' } })); } catch {}
              }}
            />

            {/* ── COL 2: Context Panel ──────────────────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:16}}>

              {/* ── Phase 3 CoverageCard — live merge counts for active
                  coverages (HANDOVERS_PLAN.md §12.8). Self-hides when
                  the caller has no current coverages, so non-coverers
                  see no extra chrome. */}
              <CoverageCard
                tickets={tasks}
                queueUnified={queueUnified}
                onOpen={() => setView?.('ooo')}
              />

              {/* ── DailySummary — role-adaptive ─────────────────────────────── */}
              {/* `*WithResolved` keep resolved tickets in scope so the
                  Resolved tile + Completion% reflect the same FE state the
                  top KPI strip reads — see the scope/personal defs above. */}
              {isOwnScope && <DailySummary tasks={personalWithResolved} escalations={escalations} scope="personal" />}
              {isTeamScope && <DailySummary tasks={scopeWithResolved} escalations={escalations} scope="team" />}
              {isExec && <DailySummary tasks={allOrgTasks} escalations={escalations} scope="org" />}

              {/* ── ApproachingBreach — all roles ──────────────────────────────
                  2026-05-22 — Pablo Gonzalez "Pressing tasks in the daily
                  summary bring me to as blank page". `setSelTask` is wired
                  as a no-op at the App.jsx boundary (vestigial prop), so the
                  old handler just landed on Queue's WorkspaceHome with no
                  source filter — fine on HRX with lots of data, but on
                  newer dept tenants (GIX / Payroll / Benefits) it reads as
                  blank. Dispatch `queue:focusSource` after the view switch
                  (60ms later — same pattern as the App.jsx notification
                  deep-links) so Queue mounts, attaches its listener, then
                  focuses the source panel the task lives in. */}
              {isOwnScope && <ApproachingBreach tasks={personal} slaInfo={slaInfo} onViewTask={navigateToTaskInQueue} />}
              {isTeamScope && <ApproachingBreach tasks={scope} slaInfo={slaInfo} onViewTask={navigateToTaskInQueue} />}
              {isExec && <ApproachingBreach tasks={orgOpen} slaInfo={slaInfo} onViewTask={navigateToTaskInQueue} />}

              {/* ── OOOAlert in right column — team lead & admin ─────────────── */}
              {isTeamScope && <OOOAlert tasks={scope} onLeaveEmails={onLeaveEmails} members={MEMBERS} onReassign={navigateToTaskInQueue} />}
              {isExec && <OOOAlert tasks={allOrgTasks} onLeaveEmails={onLeaveEmails} members={MEMBERS} onReassign={navigateToTaskInQueue} />}

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
                  <span style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>Team Availability</span>
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
                      <Avatar name={m.name} size={30}/><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{m.name}</div><div style={{fontSize:11,color:'var(--text-muted)'}}>{FLAGS[m.country]} {m.team}</div></div>
                      <span style={{fontSize:16,fontWeight:700,color:m.wc,fontVariantNumeric:'tabular-nums'}}>{m.tc}</span><span style={{fontSize:10,fontWeight:700,color:m.wc,padding:'2px 8px',borderRadius:128,background:m.wc+'10'}}>{m.wl}</span>
                    </div>
                  )):<div style={{padding:'20px 0',textAlign:'center',fontSize:13,color:'var(--text-muted)'}}>{total===0?'Queue clear — help a teammate!':'Team equally loaded'}</div>}
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
                      <span style={{fontSize:15,fontWeight:700,color:'var(--text)',flex:1}}>Start Dates</span>
                      <span style={{fontSize:11,color:'var(--text-muted)',background:'var(--surface-3)',borderRadius:128,padding:'2px 8px',fontWeight:600}}>{upcomingStarts.length+overdueStarts.length}</span>
                      <i className={startDatesExpanded?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:11,color:'#bebebe'}}></i>
                    </div>
                    {startDatesExpanded&&(
                      <div style={{display:'flex',gap:0}}>
                        {/* LEFT: Upcoming */}
                        <div style={{flex:1,padding:'10px 14px',borderRight:'1px solid #f0f0f0'}}>
                          <div style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',textTransform:'none',letterSpacing:'normal',marginBottom:8}}>Upcoming (14 days)</div>
                          {upcomingStarts.map((e,i)=>(
                            <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 0',borderBottom:i<upcomingStarts.length-1?'1px solid #fafafa':'none'}}>
                              <span style={{width:7,height:7,borderRadius:'50%',background:statusDot[e.status],flexShrink:0}}></span>
                              <span style={{fontSize:11,color:'var(--text-secondary)',fontWeight:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</span>
                              <span style={{fontSize:10,color:'var(--text-muted)'}}>{FLAGS[e.country]||''}</span>
                              <span style={{fontSize:10,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{fmtDate(e.date)}</span>
                            </div>
                          ))}
                        </div>
                        {/* RIGHT: Missed/Overdue */}
                        <div style={{flex:1,padding:'10px 14px'}}>
                          <div style={{fontSize:13,fontWeight:600,color:'#d42d35',textTransform:'none',letterSpacing:'normal',marginBottom:8}}>Missed / Overdue</div>
                          {overdueStarts.map((e,i)=>(
                            <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 0',borderBottom:i<overdueStarts.length-1?'1px solid #fafafa':'none'}}>
                              <span style={{width:7,height:7,borderRadius:'50%',background:statusDot[e.status],flexShrink:0}}></span>
                              <span style={{fontSize:11,color:'var(--text-secondary)',fontWeight:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</span>
                              <span style={{fontSize:10,color:'var(--text-muted)'}}>{FLAGS[e.country]||''}</span>
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
                  <span style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>Recent Activity</span>
                </div>
                <div style={{padding:'8px 22px 14px'}}>
                  {recentAct.map((a,i)=>(
                    <div key={a.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 0',borderBottom:i<recentAct.length-1?'1px solid #f5f5f5':'none'}}>
                      <i className={a.evIcon||'bi-circle'} style={{fontSize:13,color:a.evColor||a.color,marginTop:1,flexShrink:0}}></i>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:'var(--text-secondary)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.subject}</div>
                        <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{a.who} &middot; {a.ago} ago</div>
                      </div>
                    </div>
                  ))}
                </div>
              </DeelCard>}

              {/* Quick Nav — gated through the same `RESTRICTED_VIEWS` /
                  `isOwner` policy used by the top nav (App.jsx) AND the
                  route renderers. Pre-2026-05-01-audit, this grid rendered
                  all 5 buttons unconditionally even when the top nav
                  correctly hid Reports / Analytics / Escalations from
                  agents — Trish could click Reports and read all 18
                  org-wide HR sensitive reports. */}
              {(() => {
                const OWNER_EMAIL = 'mohamed.tantawy@deel.com';
                const isOwner = (user?.email || '').toLowerCase() === OWNER_EMAIL;
                // Mirror App.jsx#RESTRICTED_VIEWS — these routes only
                // render for the owner today. Keep this list in sync if
                // App.jsx changes; ideally these constants live in one
                // module long-term.
                const OWNER_ONLY = new Set(['projects', 'analytics', 'escalations', 'calendar', 'knowledge-hub']);
                const canSeeView = (v) => {
                  if (OWNER_ONLY.has(v) && !isOwner) return false;
                  if (perms && typeof perms.canView === 'function' && perms.canView(v) === false) return false;
                  return true;
                };
                const allLinks = [
                  {v:'my-queue',icon:'bi-inbox-fill',l:'Queue',c:'var(--g)',bg:'#e8f0fe'},
                  {v:'escalations',icon:'bi-arrow-up-circle-fill',l:'Escalations',c:'#1f74b3',bg:'#e8f0fe'},
                  // 'Reports' (hr-reports) tile retired 2026-05-02 — replaced by HR Hub.
                  {v:'hr-hub',icon:'bi-broadcast-pin',l:hubBrand.hubLabel,c:'#8b6dca',bg:'#f3eff8'},
                  {v:'team',icon:'bi-people-fill',l:'Team',c:'#ed8d00',bg:'#fff8e6'},
                  {v:'analytics',icon:'bi-bar-chart-line-fill',l:'Analytics',c:'#1f74b3',bg:'#e8f0fe'},
                ];
                const links = allLinks.filter(a => canSeeView(a.v));
                if (links.length === 0) return null;
                return (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(95px,1fr))',gap:10}}>
                    {links.map(a=>(
                      <button key={a.v} onClick={()=>setView(a.v)} style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:'14px 8px',cursor:'pointer',fontSize:12,fontWeight:600,color:'var(--text)',transition:'all .2s',
                        background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=a.c;e.currentTarget.style.color=a.c;e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#e8e8e8';e.currentTarget.style.color='#1b1b1b';e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none';}}>
                        <div style={{width:34,height:34,borderRadius:10,background:a.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <i className={a.icon} style={{fontSize:15,color:a.c}}></i>
                        </div>
                        {a.l}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BriefingView;
