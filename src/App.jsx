import React, { useState, useEffect, useRef, useCallback, createContext } from 'react';

import { TOOLS, STATUSES, FUNCTIONS, FLAGS } from './data/constants';
import { INITIAL_PROJECTS } from './data/projects';
import { INITIAL_REQUESTS } from './data/requests';
import { MEMBERS, MEMBERS_BY_EMAIL, DEFAULT_USER_ACCESS_MAP, TEAM_MEMBERS, getAllReports, subscribeRoster, getRosterVersion, getLiveRosterFetched } from './data/members';
import { useTeamMembers } from './hooks/useTeamMembers';
import { useCurrentDeptId, getCurrentDeptIdSync } from './lib/current-dept-storage';
import { INITIAL_ACTIVITY, INITIAL_NOTES } from './data/tasks';
import { FEED_EVENTS } from './data/feed';
import { ALL_AGENT_IDS, matchesAudience } from './data/comms';
import { useAnnouncements } from './hooks/useAnnouncements';
import { useNotifications } from './hooks/useNotifications';
import { useNotificationSound } from './hooks/useNotificationSound';
import { useVersionCheck } from './hooks/useVersionCheck';
import UpdateBanner from './components/ui/UpdateBanner';
import { AnnouncementRequestsProvider } from './hooks/useAnnouncementRequests';
import { useQueueSync } from './hooks/useQueueSync';
import { useQueueUnifiedSync } from './hooks/useQueueUnifiedSync';
import { useHiddenTasks } from './hooks/useHiddenTasks';
import { useSlaExtensions } from './hooks/useSlaExtensions';
import { useUrgentAssistBadge } from './hooks/useUrgentAssistBadge';
import { useHrHubBadge } from './hooks/useHrHubBadge';
import { DEFAULT_SETTINGS } from './data/settings';
import { DEFAULT_ACCESS_TYPES, ALL_VIEWS } from './data/accessControl';
import { ADMIN_LIST_VERSION } from './data/adminEmails';
import { usePermissions } from './hooks/usePermissions';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { slaInfo } from './utils/helpers';
import { attachSlaExtensionToTickets } from './utils/applySlaExtensions';
import { useIntegrations } from './hooks/useIntegrations';
// useDeelData removed 2026-05-13 — REST-v2 endpoints retired (see
// src/lib/deel-api.js for the deprecation rationale).
import { useJiraData } from './hooks/useJiraData';
import { useSlackData } from './hooks/useSlackData';
import { useMeetingAlerts } from './hooks/useMeetingAlerts';
import { useActivityHeartbeat } from './hooks/useActivityHeartbeat';

// ── API services + normalizers ──────────────────────────────────────────────
import { login as apiLogin, fetchMe as apiFetchMe } from './services/authApi';
import { fetchTasks as apiFetchTasks, createTask as apiCreateTask } from './services/tasksApi';
import { fetchMembers as apiFetchMembers } from './services/membersApi';
import { fetchEscalations as apiFetchEscalations, createEscalation as apiCreateEscalation, respondToEscalation as apiRespondEscalation, resolveEscalation as apiResolveEscalation } from './services/escalationsApi';
import { fetchProjects as apiFetchProjects, createProject as apiCreateProject, updateProject as apiUpdateProject } from './services/projectsApi';
import { fetchRequests as apiFetchRequests, createRequest as apiCreateRequest, updateRequest as apiUpdateRequest } from './services/requestsApi';
import { createNote as apiCreateNote } from './services/notesApi';
import { apiFetch } from './services/api';
import { normalizeTask, normalizeEscalation, normalizeProject, normalizeRequest, normalizeMember, denormalizeTaskForCreate, feStatusToBe } from './services/normalize';

// ── Keys we clear on logout so the next user on this browser starts fresh ──
// Auth tokens are handled alongside; this list is everything queue-related.
const QUEUE_STORAGE_KEYS = [
  'ops_hub_queue_zendesk',
  'ops_hub_queue_jira',
  'ops_hub_onboarding_cache',
  'ops_hub_onboarding_paused_cache',
  'ops_hub_offboarding_cache',
  'ops_hub_amendments_cache',
  'ops_hub_redlines_cache',
  'ops_hub_workbench_cache',
  'ops_hub_incentive_plans_cache',
  'ops_hub_queue_filters',
  // Legacy v2 leftovers — harmless once v2 is gone, but no reason to keep them.
  'ops_hub_queuev2_filters',
  'ops_hub_queuev2_views',
  'ops_hub_queuev2_rules',
  'ops_hub_queuev2_templates',
];

// Friendly URL aliases for view slugs. The canonical view IDs (used by
// permission checks + view-gating in ALL_VIEWS) are often less intuitive
// than what users type when deep-linking — `leaders-hub` for the Leaders
// Hub, `oo-o` typos, etc. Map common aliases to their canonical form
// before any other view logic runs so a stale shortcut doesn't bounce
// to briefing.
const _VIEW_ALIASES = {
  'leaders-hub': 'leader-alerts',
  'leadership': 'leader-alerts',
  'workspace': 'my-queue',
  'queue': 'my-queue',
  'home': 'briefing',
  // Phase 3 (2026-05-20) — the Team sub-tab inside Leaders Hub moved to
  // the dedicated Org tab. Any saved deep-link `?view=team` resolves to
  // `?view=org` so admins don't bounce to briefing.
  'team': 'org',
};
function _resolveViewAlias(v) {
  if (!v) return v;
  return _VIEW_ALIASES[String(v).toLowerCase()] || v;
}

function clearQueueCaches() {
  try {
    for (const k of QUEUE_STORAGE_KEYS) localStorage.removeItem(k);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('ops_hub_queuev2_ooo_') || k.startsWith('ops_hub_queue_mutations:') || k.startsWith('ops_hub_original_assignees:')) {
        toRemove.push(k);
        continue;
      }
      for (const base of QUEUE_STORAGE_KEYS) {
        if (k.startsWith(`${base}:`)) {
          toRemove.push(k);
          break;
        }
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

import DeelTopNav from './components/nav/DeelTopNav';
import DeelSubNav from './components/nav/DeelSubNav';
import BriefingView from './components/views/BriefingView';
import TeamLeadHome from './components/views/TeamLeadHome';
import AgentHome from './components/briefing/AgentHome';
import Queue from './components/queue/Queue';
import Team from './components/views/Team';
import Analytics from './components/views/Analytics';
import EscalationsView from './components/views/EscalationsView';
import AnnouncementsView from './components/views/AnnouncementsView';
import ApprovalQueueView from './components/views/ApprovalQueueView';
import CalendarView from './components/views/CalendarView';
import KnowledgeHub from './components/views/KnowledgeHub';
// GMReportingView retired 2026-05-02 — superseded by HR Hub's
// hr_reporting flow. The component file + src/data/reports.js have
// been deleted; the route view hr-reports is no longer mounted.
import SettingsView from './components/views/SettingsView';
import ProjectsView from './components/views/ProjectsView';
import Slack from './components/views/Slack';
import Alerts from './components/views/Alerts';
import FeedbackView from './components/views/FeedbackView';
import HrHubView from './components/views/HrHubView';
import OrgView from './components/views/OrgView';
import NotificationsView from './components/views/NotificationsView';
import LeaderAlertsView from './components/views/LeaderAlertsView';
import LeadersHubView from './components/views/LeadersHubView';
import OOOView from './components/views/OOOView';
import UrgentAssistView from './components/views/UrgentAssistView';
import UrgentAssistScheduleView from './components/views/UrgentAssistScheduleView';
import CreateHrHubRequestModal from './components/modals/CreateHrHubRequestModal';
import ManageMentionGroupsModal from './components/modals/ManageMentionGroupsModal';
import MocAlertModal from './components/modals/MocAlertModal';
import TlocAlertModal from './components/modals/TlocAlertModal';
import CreateLeaderAlertModal from './components/modals/CreateLeaderAlertModal';
import CreateUrgentAssistModal from './components/modals/CreateUrgentAssistModal';
import { getLeaderAlertsUnackedCount } from './services/leaderAlertsApi';
import CreateProjectModal from './components/modals/CreateProjectModal';
import CreateRequestModal from './components/modals/CreateRequestModal';
import CreateEscalationModal from './components/modals/CreateEscalationModal';
import CreateTaskModal from './components/modals/CreateTaskModal';
import GlobalSearch from './components/modals/GlobalSearch';
import Onboarding from './components/modals/Onboarding';
import WhatsNewTour, { WHATS_NEW_KEY } from './components/modals/WhatsNewTour';
import ManagerTour, { MANAGER_TOUR_KEY } from './components/modals/ManagerTour';
import AnnouncementPopup from './components/modals/AnnouncementPopup';
import Toasts from './components/ui/Toasts';
import LoginScreen from './components/LoginScreen';

export const PermissionsContext = createContext(null);
export const SettingsContext = createContext({});
export const IntegrationsContext = createContext({});

const App=()=>{
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [loggedInEmail,setLoggedInEmail]=useState(()=>{
    try{ return localStorage.getItem('ops_hub_logged_in_email')||null; }catch(e){ return null; }
  });

  const [user,setUser]=useState(()=>{
    // Restore user from stored email — check MEMBERS first, then JWT token.
    //
    // IMPORTANT: the JWT's `sub` claim carries the DB `members.id`, which is
    // what the server uses as the canonical user id on every authenticated
    // endpoint (incl. announcement_acks.user_id). The static MEMBERS array is
    // indexed by array position (id = i + 1), which *usually* matches the DB
    // but can drift if the DB was seeded with a different roster ordering or
    // members were added/removed via the API. When that drift happens, `acks`
    // stored server-side never match the id the frontend compares against, so
    // popups re-appear forever and the ack tracker shows the user as pending
    // even after they clicked acknowledge. Fix: always prefer the JWT-derived
    // id over the static array id.
    if(loggedInEmail){
      let tokenId = null;
      const token = typeof window !== 'undefined' ? localStorage.getItem('ops_hub_token') : null;
      if(token){
        try{
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload?.sub) tokenId = Number(payload.sub);
        }catch(e){ /* token unparseable — will fall through */ }
      }
      // Per-user permission flags (e.g. isAnnouncementsAdmin, isAccessAdmin)
      // live ONLY on the team_member_overrides row, not in static MEMBERS.
      // Read them from the localStorage snapshot (which /auth/callback writes
      // from the login response, and /me revalidation refreshes) so the
      // user state hydrates with the correct flags on the very first paint.
      let snapshotPerms = {};
      try {
        const storedRaw = localStorage.getItem('ops_hub_user');
        if (storedRaw) {
          const stored = JSON.parse(storedRaw);
          if (stored?.email?.toLowerCase() === loggedInEmail.toLowerCase()) {
            snapshotPerms = {
              isAnnouncementsAdmin: stored.isAnnouncementsAdmin === true,
              isAccessAdmin: stored.isAccessAdmin === true,
              isHrHubAdmin: stored.isHrHubAdmin === true,
              isLeaderAlertsAdmin: stored.isLeaderAlertsAdmin === true,
            };
          }
        }
      } catch {}
      const m=MEMBERS.find(mm=>mm.email.toLowerCase()===loggedInEmail.toLowerCase());
      if(m) return tokenId ? { ...m, ...snapshotPerms, id: tokenId } : { ...m, ...snapshotPerms };
      // User not in hardcoded MEMBERS but has a stored session. Prefer the
      // `ops_hub_user` snapshot (persisted by /auth/callback and refreshed on
      // every /me revalidation — it carries the real DB `team`, `role`, etc.)
      // and fall back to JWT claims only if that snapshot is missing. Hardcoded
      // defaults like `team:'JTK'` caused the announcement routing to mis-deliver
      // popups for any user outside the static MEMBERS roster.
      try {
        const storedRaw = localStorage.getItem('ops_hub_user');
        if (storedRaw) {
          const stored = JSON.parse(storedRaw);
          if (stored?.email?.toLowerCase() === loggedInEmail.toLowerCase()) {
            return tokenId ? { ...stored, id: tokenId } : stored;
          }
        }
      } catch(e) { /* fall through to JWT-derived placeholder */ }
      if(token){
        try{
          const payload = JSON.parse(atob(token.split('.')[1]));
          // No team hardcode — leave null so matchesAudience defaults to
          // "no audience match" rather than silently routing as JTK. The
          // session-revalidation /me call will populate the real team.
          return { id: Number(payload.sub)||0, email: payload.email||loggedInEmail, name: payload.name||loggedInEmail.split('@')[0], role: payload.role||'member', team: payload.team||null, initials:(payload.name||loggedInEmail.split('@')[0]).split(' ').map(w=>w[0]?.toUpperCase()).slice(0,2).join('') };
        }catch(e){}
      }
    }
    return null;
  });
  // ── Impersonation — TLs/RMs/Admin can "login as" their reports ──────────
  // Live team roster (baseline × team_member_overrides). We use this instead
  // of the static MEMBERS/MEMBERS_BY_EMAIL so that newly-added users (Olga
  // et al — created via the Team tab, not in the frozen baseline) can be
  // impersonated AND see the right Home view when impersonated. Previously
  // this code short-circuited on `MEMBERS_BY_EMAIL[email]` which only knew
  // about the 104-person baseline → "Login as Olga" silently did nothing.
  const { membersByEmail: liveMembersByEmail, getAllReports: liveGetAllReports } = useTeamMembers();

  // Shape-adapter: the useTeamMembers hook returns entries with `access`
  // (team-tab vocabulary), but the rest of the app reads `role` off the
  // user object. This returns a MEMBERS-compatible shape so BriefingView /
  // permissions / queue scoping keep working under impersonation.
  const resolveEffectiveMember = React.useCallback((email) => {
    if (!email) return null;
    const emailLc = email.toLowerCase();
    const live = liveMembersByEmail?.[emailLc];
    if (live) {
      return {
        id: 0,
        name: live.name,
        initials: live.initials,
        avatarUrl: live.avatarUrl,
        role: live.access,
        team: live.team,
        region: live.region || live.team,
        country: live.country || null,
        lead: null,
        email: live.email,
      };
    }
    return MEMBERS.find(mm => mm.email.toLowerCase() === emailLc) || null;
  }, [liveMembersByEmail]);

  // Impersonation survives reloads (e.g. from the version-update banner or a
  // refresh after Login-as) by keying off sessionStorage — which lives for the
  // lifetime of the tab so closing the browser still drops it, matching the
  // "session" semantics users expect.
  //
  // Stored as { actor, target } so a session token handoff (user A logs out →
  // user B logs in on the same tab without closing it) can't carry user A's
  // impersonation into user B's session. On mount we start with null and only
  // restore once `user` is known AND the stored actor matches — anything else
  // is treated as stale and dropped.
  const [impersonating, setImpersonatingRaw] = useState(null);
  const setImpersonating = useCallback((next) => {
    setImpersonatingRaw(next);
    try {
      if (next && user?.email) {
        sessionStorage.setItem('ops_hub_impersonating', JSON.stringify({
          actor: String(user.email).toLowerCase(),
          target: String(next).toLowerCase(),
        }));
      } else {
        sessionStorage.removeItem('ops_hub_impersonating');
      }
    } catch (e) {}
  }, [user]);
  useEffect(() => {
    if (!user?.email) return;
    const actorEmail = String(user.email).toLowerCase();
    try {
      const stored = sessionStorage.getItem('ops_hub_impersonating');
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (
        parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && parsed.actor === actorEmail
        && typeof parsed.target === 'string'
        && parsed.target
      ) {
        setImpersonatingRaw(parsed.target);
      } else {
        // Actor mismatch, malformed, or legacy string-only format — drop it.
        sessionStorage.removeItem('ops_hub_impersonating');
      }
    } catch (e) {
      try { sessionStorage.removeItem('ops_hub_impersonating'); } catch (e2) {}
    }
  }, [user?.email]);
  const effectiveUser = React.useMemo(() => {
    if (!impersonating || !user) return user;
    return resolveEffectiveMember(impersonating) || user;
  }, [impersonating, user, resolveEffectiveMember]);
  // Initial view honours `?view=<name>` on hard refresh so deep-links from
  // server-pushed notifications + shared URLs (e.g. /?view=hr-hub&req=<uuid>)
  // restore both the view AND the per-view drawer state. If `?req=` is
  // present without an explicit `?view=`, fall back to hr-hub since that's
  // currently the only route that uses `?req=`. Any unknown view name is
  // ignored — the per-route gating below still reroutes to a permitted
  // default if the user can't access the requested view.
  const [view,setView]=useState(()=>{
    if (typeof window === 'undefined') return 'briefing';
    try {
      const sp = new URL(window.location.href).searchParams;
      const v = sp.get('view');
      if (v && /^[a-z][a-z0-9-]{0,30}$/i.test(v)) return _resolveViewAlias(v);
      if (sp.get('req')) return 'hr-hub';
      // `?announcement=<id>` shared from the Copy link button —
      // land on Announcements so the deep-link opens the detail.
      if (sp.get('announcement')) return 'announcements';
    } catch {}
    return 'briefing';
  });
  // When the user opens a notification from the full Notifications page,
  // remember it so we can offer a "← Back to Notifications" affordance on
  // the destination view. Cleared as soon as the user navigates away by
  // any other means (tab click, search, etc.).
  const [returnToNotifications, setReturnToNotifications] = useState(false);
  // Set true by handleNotifClick before it changes view; consumed by the
  // view-change effect to suppress its clear-on-navigate behaviour. Without
  // this, the same view change that arms the pill would also clear it.
  const justFromNotifClickRef = useRef(false);
  useEffect(() => {
    if (view === 'notifications') {
      setReturnToNotifications(false);
      justFromNotifClickRef.current = false;
      return;
    }
    if (!justFromNotifClickRef.current) {
      // User navigated away by any other path (tab click, search, deep-link)
      // — drop the pill.
      setReturnToNotifications(false);
    }
    justFromNotifClickRef.current = false;
  }, [view]);
  // Temporary: gate unready features behind the owner's email. Nav tabs are
  // also filtered in DeelTopNav.jsx; this guards deep-link / programmatic
  // navigation (e.g. BriefingView KPI tiles that call setView('announcements')).
  // Remove this + the `restrictToEmail` props in DeelTopNav when the app ships.
  const OWNER_EMAIL = 'mohamed.tantawy@deel.com';
  const RESTRICTED_VIEWS = React.useMemo(() => new Set([
    'projects',
    'calendar', 'knowledge-hub', 'analytics',
    'escalations',
  ]), []);
  const isOwner = (user?.email || '').toLowerCase() === OWNER_EMAIL;
  // Silently redirect non-owners off restricted views (e.g. if a Briefing tile
  // tried to navigate them there, or a stored localStorage view is stale).
  React.useEffect(() => {
    if (!isOwner && RESTRICTED_VIEWS.has(view)) setView('briefing');
  }, [isOwner, view, RESTRICTED_VIEWS]);
  // Mirror the active view into ?view=... so browser refresh lands the user
  // back on the same tab. replaceState (not pushState) keeps tab clicks out
  // of the back/forward history, which is what users expect for a SPA tab
  // bar — nobody wants ten history entries from clicking around the nav.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !view) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('view') !== view) {
        url.searchParams.set('view', view);
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
  }, [view]);
  // ── Live queue sync (Zendesk + Jira) ─────────────────────────────────────
  const queueSync = useQueueSync({ enabled: !!user, userEmail: user?.email || null });
  const tasks = queueSync.tasks;
  const setTasks = queueSync.setTasks;
  // ── Pre-warm every Deel queue at the auth boundary ───────────────────────
  // Mounting useQueueUnifiedSync at App.jsx (instead of inside Queue.jsx)
  // means all 7 Deel queues start fetching the moment the user is signed
  // in, regardless of where they land first (Briefing, Team, Analytics).
  // By the time they click any tab, IDB is already warm + the in-memory
  // arrays are populated. The previous arrangement mounted the same hooks
  // 4× across Queue/Briefing/Analytics/Team, firing 4× the network
  // requests; now there's a single shared instance threaded through
  // IntegrationsContext. Per Mohamed's 2026-05-01 spec: "load everything"
  // on login.
  //
  // Deferred via requestIdleCallback so the view the user actually landed
  // on (Feedback, HR Hub, Announcements, etc.) doesn't share bandwidth
  // with 6 parallel Deel-API calls that can each take 10–15 s. The
  // 2026-05-11 prod audit caught Feedback first-paint at ~8 s solely
  // because of this pre-warm — the page's own /api/v1/feedback call is
  // fast, but it was queued behind /integrations/deel/offboarding (15 s)
  // and friends. With the defer in place: same eventual warm, first paint
  // returns to the user's view almost immediately. The 1.5 s `timeout`
  // forces the callback through even on a backgrounded tab or busy main
  // thread, so the "load everything on login" guarantee still holds —
  // worst case the pre-warm starts ~1.5 s later than before.
  const [prewarmReady, setPrewarmReady] = useState(false);
  useEffect(() => {
    if (!user) { setPrewarmReady(false); return; }
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const flip = () => { if (!cancelled) setPrewarmReady(true); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(flip, { timeout: 1500 });
      return () => {
        cancelled = true;
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
      };
    }
    // Safari <16.4 + any other UA without rIC — short setTimeout keeps
    // the same "after first paint" intent without the idle wait.
    const id = setTimeout(flip, 600);
    return () => { cancelled = true; clearTimeout(id); };
  }, [user]);
  const queueUnified = useQueueUnifiedSync({
    queueSync,
    enabled: !!user && prewarmReady,
    userEmail: user?.email || null,
  });
  // Pre-warm the global hide list on auth so every queue render starts
  // with the right Set<source:id> in memory. The hook polls every 30s and
  // a manual refresh fires after Approve/Deny in HR Hub.
  const hiddenTasks = useHiddenTasks(!!user);
  // Phase 3 of SLA Extensions — global active-extension list, polled
  // every 30s and shared via IntegrationsContext so Queue.jsx can apply
  // the override at the row level. Cache survives sync cycles via the
  // server cache + LS hydration; the FE rebuilds the Map only when the
  // list array changes (useMemo in useSlaExtensions).
  const slaExtensions = useSlaExtensions(!!user);
  // Tickets (Zendesk + Jira) carry their SLA extension as a row-level
  // `slaExtension` field that `slaInfo()` short-circuits on. Attach it at
  // App.jsx so every downstream consumer that reads from `tasks` —
  // BriefingView (org-breach %, health score), TeamLeadHome, AgentHome,
  // LeadersHubView (Team + Analytics), Alerts — sees the override too.
  // Without this, only Queue.jsx (which did its own inline attach) reflected
  // an approved extension; the aggregate surfaces showed the row as
  // breached even though the extension was active. Returns the SAME array
  // reference when nothing matches an active extension so the useMemo is
  // a no-op for tickets without extensions.
  const tasksWithSlaExt = React.useMemo(
    () => attachSlaExtensionToTickets(tasks, slaExtensions?.map || null, slaExtensions?.pendingMap || null),
    [tasks, slaExtensions?.map, slaExtensions?.pendingMap],
  );
  // Top-nav badge for Urgent Assist — counts unresolved items where
  // assignee = effectiveUser (covers impersonation correctly). Sources
  // both manual rows (via the API) and workbench-sourced rows from the
  // already-pre-warmed queueUnified data, so no extra network round-trip
  // for the workbench side.
  const urgentAssistBadge = useUrgentAssistBadge({
    enabled: !!user,
    userEmail: user?.email || '',
    workbenchTasks: queueUnified?.workbenchData?.tasks || [],
  });
  // Top-nav badge for HR Hub — same shape as Urgent Assist / Leaders Hub.
  // Counts hr_hub_request rows where assignee_email = effectiveUser AND
  // status != resolved.
  const hrHubBadge = useHrHubBadge({
    enabled: !!user,
    userEmail: user?.email || '',
  });
  const [feed,setFeed]=useState(FEED_EVENTS);
  const [notes,setNotes]=useState(INITIAL_NOTES);
  const [escalations,setEscalations]=useState([
    {id:'ESC-SEED-001',task:null,taskId:null,reason:'Agent unable to process visa documentation update due to missing Deel Admin permissions',subject:'Visa doc update — missing permissions',escalatedBy:'Sarah Chen',escalatedAt:'09:15',managerId:3,managerName:'Omar Khalil',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'slack',slackChannel:'#escalations',slackUser:'@sarah.chen',slackMessageUrl:null},
    {id:'ESC-SEED-002',task:null,taskId:null,reason:'Client reporting incorrect salary calculation for March payroll — urgent correction needed before end of day',subject:'Payroll discrepancy — March salary',escalatedBy:'James Okafor',escalatedAt:'11:42',managerId:3,managerName:'Omar Khalil',status:'resolved',managerResponseStatus:'responded',managerResponse:'Payroll team notified, correction processing.',managerRespondedAt:'12:10',managerRespondedBy:'Omar Khalil',escalationSource:'slack',slackChannel:'#hr-urgent',slackUser:'@james.okafor',slackMessageUrl:null},
    {id:'ESC-SEED-003',task:null,taskId:null,reason:'Worker contract termination requires legal sign-off but legal team unresponsive for 48h',subject:'Contract termination — legal sign-off',escalatedBy:'Priya Nair',escalatedAt:'14:05',managerId:3,managerName:'Omar Khalil',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'manual',slackChannel:null,slackUser:null,slackMessageUrl:null},
  ]);
  // Ref-based toast bridge: useAnnouncements() fires before addToast is declared
  // (JS temporal dead zone on line ~496), so we can't pass addToast directly
  // into the hook here. Instead we hand the hook a ref and patch it with the
  // real addToast in a useEffect once it's available.
  const toastRef = React.useRef(null);
  const { comms, setComms, refresh: apiRefreshAnnouncements, acknowledge: apiAcknowledge, create: apiCreate, send: apiSend, update: apiUpdate, archive: apiArchive, remove: apiRemove, togglePin: apiTogglePin, isOnline: apiOnline, serverUserId: apiServerUserId, serverUserEmail: apiServerUserEmail, unarchive: apiUnarchive, comments: apiComments, setComments: apiSetComments, loadComments: apiLoadComments, addComment: apiAddCommentFn, deleteComment: apiDeleteCommentFn, links: apiLinks, loadLinks: apiLoadLinks, linkAnnouncement: apiLinkAnnouncementFn, unlinkAnnouncement: apiUnlinkAnnouncementFn, react: apiReactFn } = useAnnouncements({ toastRef });
  // Detect when the server has rolled to a new deploy so we can prompt the
  // user to reload — otherwise long-lived tabs sit on stale code until the
  // user manually clears their cache. Fires at the app root so the banner
  // is visible on both the login screen and the main app.
  const { hasUpdate: versionHasUpdate, reload: versionReload, latestVersion: versionLatest } = useVersionCheck();
  // Approval-queue pending counts are now surfaced inside AnnouncementsView
  // (the pending-approval filter tab in that view displays the count). We no
  // longer need a top-nav badge, so App.jsx doesn't consume the requests
  // provider directly — AnnouncementsView reads it via useAnnouncementRequests().
  // Hydration-safe pattern: useState initialisers must not read localStorage
  // directly, or the SSR pass returns the default while the client first
  // render returns the user's saved value → React error #418 ("Hydration
  // failed because the server rendered HTML didn't match the client").
  // 2026-05-11 prod console caught this firing across Feedback / HR Hub /
  // other views (Next.js 16 + React 19 strict-hydrates more aggressively
  // than the prior version, surfacing what used to be a silent fall-back-
  // to-CSR). All seven localStorage-derived initialisers below default
  // to their SSR-safe value, then a single useEffect after mount hydrates
  // the real state in one batch. Cost: a one-frame flash where the user
  // briefly sees default settings before their stored prefs apply.
  const [dismissedPopups,setDismissedPopups]=useState([]);
  // Per-popup snooze map: { [commId]: snoozeUntilEpochMs }. The popup is
  // hidden from the queue while `Date.now() < snoozeUntilEpochMs`. After
  // expiry the minute-tick re-evaluates the memo and the popup comes
  // back automatically — the announcement is NOT lost (Carolina's
  // 2026-05-12 ask: "make sure the announcement is not lost and must
  // be acknowledged"). Persisted in localStorage so a tab close mid-
  // snooze still suppresses the popup until the window expires.
  const [snoozedPopups,setSnoozedPopups]=useState({});
  // `popupTick` re-renders the popup memo every minute so a snooze that
  // expires while the tab is open re-surfaces the popup without
  // requiring a manual refresh. Cheap (one Date.now() comparison) and
  // capped to once-per-minute so it costs ~nothing.
  const [popupTick,setPopupTick]=useState(0);
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  // Forward-compat merge of the cached `ops_hub_access_types` snapshot.
  // Without this, when a new view / action / admin power is shipped (most
  // recently 'feedback' on 2026-04-28), every user with a stale localStorage
  // entry from before the deploy keeps the OLD `views` list — so
  // canView('feedback') returns false, the nav tab is hidden, and the
  // route guard in App.jsx silently redirects them to /briefing whenever
  // they try to land on the new view. Union-merge each canonical access
  // type's lists with the latest defaults so newly-added entries
  // propagate automatically. Custom (non-default) access types are left
  // untouched so admin-defined tiers don't get overwritten.
  const [accessTypes,setAccessTypes]=useState(DEFAULT_ACCESS_TYPES);
  const [userAccessMap,setUserAccessMap]=useState(DEFAULT_USER_ACCESS_MAP);
  // Hydrate every localStorage-derived state in one batch after mount. See
  // the "Hydration-safe pattern" comment above the useState declarations.
  // The original initialiser logic (forward-compat union merges, version-
  // pinned wipes, etc.) is preserved here verbatim — only the timing
  // changes from "during initial render" to "during the first useEffect
  // tick".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const d = localStorage.getItem('ops_hub_dismissed_popups');
      if (d) setDismissedPopups(JSON.parse(d));
    } catch {}
    try {
      const s = localStorage.getItem('ops_hub_snoozed_popups');
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Prune already-expired entries on hydration so the localStorage
          // map doesn't grow forever across browser sessions.
          const now = Date.now();
          const fresh = {};
          for (const [id, until] of Object.entries(parsed)) {
            if (Number.isFinite(until) && until > now) fresh[id] = until;
          }
          setSnoozedPopups(fresh);
          if (Object.keys(fresh).length !== Object.keys(parsed).length) {
            try { localStorage.setItem('ops_hub_snoozed_popups', JSON.stringify(fresh)); } catch {}
          }
        }
      }
    } catch {}
    try {
      const s = localStorage.getItem('ops_hub_settings');
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
    } catch {}
    try {
      const s = localStorage.getItem('ops_hub_access_types');
      if (s) {
        const stored = JSON.parse(s);
        if (Array.isArray(stored)) {
          const union = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
          const enriched = stored.map(at => {
            const def = DEFAULT_ACCESS_TYPES.find(d => d.id === at.id);
            if (!def) return at;
            return {
              ...at,
              views: union(at.views, def.views),
              actions: union(at.actions, def.actions),
              adminPowers: union(at.adminPowers, def.adminPowers),
            };
          });
          // Append any new default access types that aren't yet in the
          // stored list — without this, types added in a later release
          // (e.g. at_hr_hub_admin, at_leader_alerts_admin) never surface
          // in the Settings → Access Types editor and Directors can't
          // assign them. Caught in the Leaders Alerts live audit (M1).
          const storedIds = new Set(stored.map(at => at.id));
          const missing = DEFAULT_ACCESS_TYPES.filter(d => !storedIds.has(d.id));
          setAccessTypes([...enriched, ...missing]);
        }
      }
    } catch {}
    try {
      const ver = localStorage.getItem('ops_hub_uam_ver');
      if (ver !== ADMIN_LIST_VERSION) {
        localStorage.removeItem('ops_hub_user_access_map');
        localStorage.setItem('ops_hub_uam_ver', ADMIN_LIST_VERSION);
      } else {
        const s = localStorage.getItem('ops_hub_user_access_map');
        if (s) setUserAccessMap(JSON.parse(s));
      }
    } catch {}
    try { setShowOnboard(!localStorage.getItem('ops_hub_onboarded')); } catch {}
    try { setShowWhatsNew(!localStorage.getItem(WHATS_NEW_KEY)); } catch {}
    try { setShowMgrTour(!localStorage.getItem(MANAGER_TOUR_KEY)); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Roster-version bridge ────────────────────────────────────────────────
  // The module-level roster in src/data/members.js is hydrated by
  // useTeamMembers when the /api/v1/team-members fetch completes. React has
  // no built-in way to know the module rebuilt its derived exports, so we
  // subscribe to hydrations and bump a counter that every dependent memo
  // (userAccessMap reconcile, PermissionsContext consumers) can key off of.
  const [rosterVersion,setRosterVersion]=useState(()=>getRosterVersion());
  // Companion signal to rosterVersion — true once the live /team-members
  // fetch has completed at least once (success or fail). Needed because
  // hydrateRoster no-ops when the incoming data is structurally equal to
  // the baseline, which can keep rosterVersion stuck at 0 for fresh
  // agents whose live roster happens to match the seed shape. See the
  // routing effect below for why both signals are checked.
  const [rosterFetched,setRosterFetched]=useState(()=>getLiveRosterFetched());
  useEffect(() => {
    const unsub = subscribeRoster((v) => {
      setRosterVersion(v);
      setRosterFetched(getLiveRosterFetched());
    });
    return unsub;
  }, []);

  // ── userAccessMap reconciliation after roster hydration ─────────────────
  // DEFAULT_USER_ACCESS_MAP is derived from the CURRENT roster (thanks to ES
  // live bindings), so every time hydrateRoster runs it reflects the latest
  // overrides. We merge it into userAccessMap on every version bump:
  //   • preserve custom accessTypeIds (admin may have assigned a non-canonical
  //     at_* id via Settings — don't clobber)
  //   • for every other field (managerEmail, team, region, service, country,
  //     title, name, startDate, status), re-sync from the baseline-derived
  //     map so a Team-tab edit takes effect without a page refresh.
  // New emails are added outright; soft-deleted ones are marked inactive.
  useEffect(() => {
    setUserAccessMap((prev) => {
      const next = { ...prev };
      let changed = false;
      const canonicalIds = new Set(['at_admin', 'at_regional_mgr', 'at_lead', 'at_agent']);

      // Merge baseline-derived data into existing entries + add new emails.
      for (const [email, baseEntry] of Object.entries(DEFAULT_USER_ACCESS_MAP)) {
        const current = prev[email];
        if (!current) {
          next[email] = { ...baseEntry };
          changed = true;
          continue;
        }
        // Keep admin-assigned custom accessTypeIds (anything outside the
        // 4 canonical ones). For canonical ones, keep the baseline-derived
        // value so Team-tab access-type changes propagate.
        const preserveAccessTypeId = current.accessTypeId && !canonicalIds.has(current.accessTypeId);
        const merged = {
          ...current,
          ...baseEntry,
          accessTypeId: preserveAccessTypeId ? current.accessTypeId : baseEntry.accessTypeId,
        };
        // Only overwrite if something actually differs (avoid re-render churn).
        for (const key of Object.keys(merged)) {
          if (merged[key] !== current[key]) { changed = true; break; }
        }
        next[email] = merged;
      }
      return changed ? next : prev;
    });
  }, [rosterVersion]);

  // ── Session revalidation on page load ─────────────────────────────────────
  // The JWT is valid for 24 hours. We only hit /me when the token is older than
  // 1 hour — this prevents noisy logouts on every page refresh while still
  // catching genuinely expired tokens.  The locally-decoded JWT payload is
  // trusted for the first hour (it's signed, so it can't be tampered with).
  useEffect(() => {
    if (!loggedInEmail) return;
    const token = localStorage.getItem('ops_hub_token');
    if (!token) {
      // No token but have stored email — clear stale session
      setUser(null);
      setLoggedInEmail(null);
      return;
    }

    // Decode the JWT payload to check expiry locally (no network call)
    let payload = null;
    try {
      payload = JSON.parse(atob(token.split('.')[1]));
    } catch {
      // Malformed token — clear session
      setUser(null);
      setLoggedInEmail(null);
      try { localStorage.removeItem('ops_hub_token'); localStorage.removeItem('ops_hub_token_ts'); localStorage.removeItem('ops_hub_logged_in_email'); } catch {}
      return;
    }

    // Check if the token is expired locally (no server call needed)
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      // Token is expired — clear session
      setUser(null);
      setLoggedInEmail(null);
      try { localStorage.removeItem('ops_hub_token'); localStorage.removeItem('ops_hub_token_ts'); localStorage.removeItem('ops_hub_logged_in_email'); } catch {}
      return;
    }

    // Background revalidation (non-blocking, no logout on failure). Always
    // run — the previous 1-hour skip prevented per-user permission grants
    // (isAnnouncementsAdmin etc.) from reaching the FE state until the
    // token aged, so a fresh grant didn't take effect until at least an
    // hour later. The /me call is cheap (one DB read), already non-
    // blocking, and only triggers a logout when the token is locally
    // verifiable as expired — so running it on every mount is safe.
    const timer = setTimeout(() => {
      apiFetchMe()
        .then((serverUser) => {
          if (serverUser?.email) {
            // Prefer the server's authoritative id (from members table) so the
            // frontend's user.id always matches what's stored in
            // announcement_acks.user_id. See the user-init comment above.
            // ALSO carry per-user permission flags (isAnnouncementsAdmin and
            // any future grants) from the server response — those live on
            // team_member_overrides and aren't in the static MEMBERS array,
            // so without this they'd be dropped on every revalidation.
            const staticMember = MEMBERS.find(m => m.email.toLowerCase() === serverUser.email.toLowerCase());
            const member = staticMember
              ? {
                  ...staticMember,
                  id: serverUser.id || staticMember.id,
                  isAnnouncementsAdmin: serverUser.isAnnouncementsAdmin === true,
                  isAccessAdmin: serverUser.isAccessAdmin === true,
                  isHrHubAdmin: serverUser.isHrHubAdmin === true,
                  isLeaderAlertsAdmin: serverUser.isLeaderAlertsAdmin === true,
                }
              : serverUser;
            // Persist the freshest snapshot so the next mount's useState
            // init paints with the right permissions instantly.
            try { localStorage.setItem('ops_hub_user', JSON.stringify(member)); } catch {}
            // If the server promoted or demoted us since the cache was
            // written, any cached queue tasks were scoped to the old role.
            // mergeSourceIntoTasks would otherwise see the newly-scoped
            // server response missing some tasks and mark them 'resolved'
            // locally — which is wrong (they're just out of scope, not
            // closed). Purge the cache so the next sync rebuilds cleanly.
            const prevAccess = String(user?.access || user?.role || '').toLowerCase();
            const nextAccess = String(member?.access || member?.role || '').toLowerCase();
            if (prevAccess && nextAccess && prevAccess !== nextAccess) {
              try { clearQueueCaches(); } catch (e) {}
            }
            setUser(member);
          }
        })
        .catch((err) => {
          if (err?.status === 401) {
            // Verify locally one more time — only log out if truly expired
            try {
              const currentPayload = JSON.parse(atob((localStorage.getItem('ops_hub_token') || '').split('.')[1]));
              const now = Math.floor(Date.now() / 1000);
              if (currentPayload.exp && currentPayload.exp < now) {
                setUser(null);
                setLoggedInEmail(null);
                try { localStorage.removeItem('ops_hub_logged_in_email'); localStorage.removeItem('ops_hub_token'); localStorage.removeItem('ops_hub_token_ts'); } catch {}
              }
              // If token isn't expired locally, the 401 was likely transient — keep session
            } catch {
              // Can't decode token — clear session
              setUser(null);
              setLoggedInEmail(null);
              try { localStorage.removeItem('ops_hub_logged_in_email'); localStorage.removeItem('ops_hub_token'); localStorage.removeItem('ops_hub_token_ts'); } catch {}
            }
          }
        });
    }, 3000); // 3s delay to let the page settle
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login / Logout handlers ────────────────────────────────────────────────
  const handleLogin = useCallback(async (email, remember) => {
    // Backend authentication required — no local fallback
    const res = await apiLogin(email);
    if (!res?.token) {
      throw new Error('Authentication failed');
    }
    localStorage.setItem('ops_hub_token', res.token);
    localStorage.setItem('ops_hub_token_ts', String(Date.now()));
    const userEmail = res.user?.email || email;
    // Always take the DB id from the login response — the JWT is signed with
    // this same id (sub claim), and every server-side endpoint uses it as the
    // canonical user reference (announcement_acks, author_id, escalated_by…).
    // Falling back to MEMBERS.id silently breaks popup acks when the two drift.
    const staticMember = MEMBERS.find(m => m.email.toLowerCase() === userEmail.toLowerCase());
    const member = staticMember
      ? { ...staticMember, id: res.user?.id || staticMember.id }
      : res.user;
    if (member) {
      setUser(member);
      setLoggedInEmail(userEmail);
      setView('briefing');
      if (remember) {
        try { localStorage.setItem('ops_hub_logged_in_email', userEmail); } catch(e) {}
      }
    }
  }, []);

  // Google OAuth now uses full-page redirect via platform proxy.
  // The /auth/callback page handles token storage and redirects back here.

  const handleLogout = useCallback(() => {
    setImpersonating(null);
    setUser(null);
    setLoggedInEmail(null);
    try {
      localStorage.removeItem('ops_hub_logged_in_email');
      localStorage.removeItem('ops_hub_token');
      localStorage.removeItem('ops_hub_token_ts');
      localStorage.removeItem('ops_hub_user');
      // Also clear the workspace pick from the pre-SSO picker (set by
      // src/workspaces/_shared/WorkspacePicker.jsx). Without this, the next
      // person to sign in on this browser would see a "LAST USED" badge on
      // the previous user's workspace — a small but real session leak.
      localStorage.removeItem('ops_hub_selected_workspace');
    } catch(e) {}
    // Clear every queue-related cache so the next user doesn't inherit prior
    // session data on the same browser.
    clearQueueCaches();
  }, []);

  // ── Impersonation handler ──────────────────────────────────────────────────
  // Resolves everything against the LIVE team roster so newly-added users
  // (team_member_overrides rows not in the static baseline) can both
  // impersonate and be impersonated. Falls back to the static baseline
  // only when live data hasn't loaded yet (first paint after login).
  const handleImpersonate = useCallback((email) => {
    if (!email) { setImpersonating(null); return; }
    if (!user) return;
    const emailLc = email.toLowerCase();
    const myEmailLc = user.email.toLowerCase();

    // Resolve the actor (the admin/TL/RM doing the impersonation)
    const meLive = liveMembersByEmail?.[myEmailLc];
    const me = meLive
      ? { access: meLive.access, email: meLive.email }
      : MEMBERS_BY_EMAIL[user.email];
    if (!me || me.access === 'agent') return; // agents can't impersonate

    // Resolve the target — must exist in live roster OR baseline
    const targetExists = Boolean(liveMembersByEmail?.[emailLc] || MEMBERS_BY_EMAIL[email]);
    if (!targetExists) return;

    if (me.access === 'admin') {
      setImpersonating(email);
      setView('briefing');
      return;
    }
    // RM: in addition to their reports chain (handled below), RMs may also
    // impersonate any admin via the dedicated "Login as Admin" affordance
    // in the user menu. The feature was requested by the system owner to
    // give RMs the full admin layout + data access on demand. Reports-chain
    // check still applies for impersonating non-admin targets.
    const targetIsAdmin = (liveMembersByEmail?.[emailLc]?.access || liveMembersByEmail?.[emailLc]?.role || MEMBERS_BY_EMAIL[email]?.access || '').toLowerCase() === 'admin';
    if (me.access === 'regional_manager' && targetIsAdmin) {
      setImpersonating(email);
      setView('briefing');
      return;
    }
    // TL/RM: verify target is in their reports chain (live data first, then baseline)
    const reports = liveGetAllReports
      ? liveGetAllReports(user.email)
      : getAllReports(user.email);
    const reportsLc = (reports || []).map(e => typeof e === 'string' ? e.toLowerCase() : (e?.email || '').toLowerCase());
    if (reportsLc.includes(emailLc)) {
      setImpersonating(email);
      setView('briefing');
    }
  }, [user, liveMembersByEmail, liveGetAllReports]);

  // "Login as Admin" — for regional managers. Picks the canonical owner
  // admin (mohamed.tantawy@deel.com) if they exist in the roster, else the
  // first 'admin' access user found in live members, else the static
  // baseline. Routes through handleImpersonate so the existing
  // impersonation banner + sessionStorage + audit propagation all just work.
  const handleLoginAsAdmin = useCallback(() => {
    if (!user) return;
    const myAccess = (
      liveMembersByEmail?.[user.email?.toLowerCase()]?.access
      || liveMembersByEmail?.[user.email?.toLowerCase()]?.role
      || MEMBERS_BY_EMAIL[user.email]?.access
      || ''
    ).toLowerCase();
    if (myAccess !== 'regional_manager') return;
    // Prefer the owner — there's always exactly one and they're guaranteed
    // to have admin access in production.
    const ownerLc = 'mohamed.tantawy@deel.com';
    let target = null;
    if (liveMembersByEmail?.[ownerLc] || MEMBERS_BY_EMAIL[ownerLc]) {
      target = ownerLc;
    } else {
      // Fallback: scan live roster for any admin.
      const live = liveMembersByEmail ? Object.values(liveMembersByEmail) : [];
      const liveAdmin = live.find(m => (m?.access || m?.role || '').toLowerCase() === 'admin');
      if (liveAdmin?.email) target = String(liveAdmin.email).toLowerCase();
      else {
        const baselineAdmin = MEMBERS.find(m => String(m.access || m.role || '').toLowerCase() === 'admin');
        if (baselineAdmin?.email) target = String(baselineAdmin.email).toLowerCase();
      }
    }
    if (target) handleImpersonate(target);
  }, [user, liveMembersByEmail, handleImpersonate]);

  const [announceCompose,setAnnounceCompose]=useState(false);
  const [feedbackCompose,setFeedbackCompose]=useState(false);
  // 2026-05-21 Submit Feedback picker — opened via the TopNav Quick
  // Create "Submit Feedback" entry. FeedbackView consumes this prop and
  // surfaces the 2-card picker (Ops Hub Feedback vs Escalation Zero).
  const [feedbackPickerOpen,setFeedbackPickerOpen]=useState(false);
  const [toasts,setToasts]=useState([]);
  const [showSearch,setShowSearch]=useState(false);
  // SSR-safe default: don't render any onboarding modal during the SSR
  // pass / first client render. The post-mount hydration effect (above)
  // flips this to its real value once it's safe to read localStorage,
  // which keeps React #418 quiet without losing the show-once behaviour.
  const [showOnboard,setShowOnboard]=useState(false);
  // Onboard overlay shows once; dismissible with Escape or click
  // May 2026 release tour — multi-step walkthrough of HR Hub, Workspace,
  // Hide Task, Escalate, Urgent Assist, Quick Create. Shows once per
  // browser (localStorage `ops_hub_whats_new_v1`); future releases bump
  // the version key to re-prompt without invalidating this run's flags.
  // We defer-show until AFTER the welcome Onboarding modal so first-time
  // users don't get two stacked dialogs.
  const [showWhatsNew,setShowWhatsNew]=useState(false);
  // Manager-only release tour. Same show-once contract (key
  // `ops_hub_whats_new_mgr_v1`), gated below on `perms.dataScope` so agents
  // never see it. Renders AFTER both the welcome Onboarding and the general
  // WhatsNewTour finish, so a brand-new manager gets the full sequence on
  // first refresh, in order.
  const [showMgrTour,setShowMgrTour]=useState(false);
  const [sidebarOpen,setSidebarOpen]=useState(true);
  const [subFilter,setSubFilter]=useState(null);
  const [createModal,setCreateModal]=useState(false);
  // HR Hub create modal — when null the modal is closed; otherwise an
  // object { initialFlow: string|null } shows the modal. The picker
  // (initialFlow=null) lets the user choose; deep-links from queue rows
  // (Stage 7) will preselect a flow.
  const [hrHubCreate,setHrHubCreate]=useState(null);
  const [mentionGroupsOpen,setMentionGroupsOpen]=useState(false);
  const [leaderAlertCreate,setLeaderAlertCreate]=useState(false);
  // Urgent Assist create modal — boolean toggle. When true the modal is
  // open; the form posts directly to /api/v1/urgent-assist and bumps the
  // refresh nonce on success so UrgentAssistView reloads without a remount.
  // 2026-05-22 — `urgentAssistCreate` is now a small descriptor instead
  // of a plain boolean so the same modal can open in either mode
  // (urgent_assist | case_monitoring). null = closed; { kind } = open.
  const [urgentAssistCreate,setUrgentAssistCreate]=useState(null);
  const [urgentAssistRefreshNonce,setUrgentAssistRefreshNonce]=useState(0);
  const [leaderAlertsBadge,setLeaderAlertsBadge]=useState(0);
  // Bumped after a successful POST so LeaderAlertsView's fetch effect
  // re-fires and the new alert appears without a manual reload (audit H1).
  const [leaderAlertsRefreshNonce,setLeaderAlertsRefreshNonce]=useState(0);
  const [notifs,setNotifs]=useState([]);
  const [activity,setActivity]=useState(INITIAL_ACTIVITY);
  const [projects,setProjects]=useState(INITIAL_PROJECTS);
  const [projectsLoaded,setProjectsLoaded]=useState(false);
  const [projectModal,setProjectModal]=useState(null);
  const [requests,setRequests]=useState(INITIAL_REQUESTS);
  const [requestModal,setRequestModal]=useState(false);
  const [createEscalModal,setCreateEscalModal]=useState(false);
  const [backendOnline,setBackendOnline]=useState(false);
  // MOC + TLOC are now per-dept (Phase 11f — `urgent_assist_schedule` per
  // org_node_id). Storage keys carry the current dept suffix so super-admin
  // dept switches don't bleed HRX's MOC into GIX's briefing pill. The 2026-05-21
  // audit (F22) caught Beatriz Charry persisting as MOC across an HRX → GIX
  // switch because the legacy key was a single global slot. Initial reads use
  // `getCurrentDeptIdSync()` for instant paint; the dept-switch effect below
  // re-hydrates on every dept change before the 15s poll catches up.
  const mocCacheKey = useCallback((deptId) => `ops_hub_manager_on_call${deptId ? `:${deptId}` : ''}`, []);
  const tlocCacheKey = useCallback((deptId) => `ops_hub_team_lead_on_call${deptId ? `:${deptId}` : ''}`, []);
  const DEFAULT_MOC = { name: 'Omar Khalil', initials: 'OK', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Omar%20Khalil&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40' };
  const [managerOnCall, setManagerOnCall] = useState(() => {
    try {
      const deptId = getCurrentDeptIdSync();
      const m = localStorage.getItem(`ops_hub_manager_on_call${deptId ? `:${deptId}` : ''}`);
      if (m) return JSON.parse(m);
      // Fall back to the legacy unkeyed slot ONCE so existing users don't
      // see a default-MOC flash on first load after this change ships.
      const legacy = localStorage.getItem('ops_hub_manager_on_call');
      return legacy ? JSON.parse(legacy) : DEFAULT_MOC;
    } catch(e) { return DEFAULT_MOC; }
  });
  // Team Lead On Call — second rotating role (Mohamed 2026-05-14). No
  // baked-in default; the pill renders only when set. Hydrates from
  // localStorage for instant paint, then the 15s poll below confirms
  // against the server.
  const [teamLeadOnCall, setTeamLeadOnCall] = useState(() => {
    try {
      const deptId = getCurrentDeptIdSync();
      const t = localStorage.getItem(`ops_hub_team_lead_on_call${deptId ? `:${deptId}` : ''}`);
      if (t) return JSON.parse(t);
      const legacy = localStorage.getItem('ops_hub_team_lead_on_call');
      return legacy ? JSON.parse(legacy) : null;
    } catch(e) { return null; }
  });
  // createReportModal removed 2026-05-02 with the GMReportingView retirement.

  // ── Fetch supplementary data from BE on mount (escalations, projects, requests) ──
  // Tasks are now handled by useQueueSync (live from Zendesk + Jira)
  useEffect(()=>{
    if(!user) return;
    let cancelled=false;
    (async()=>{
      try{
        const [escalRes, projRes, reqRes]=await Promise.all([
          apiFetchEscalations({limit:100}).catch(()=>null),
          apiFetchProjects({limit:100}).catch(()=>null),
          apiFetchRequests({}).catch(()=>null),
        ]);
        if(cancelled) return;
        setBackendOnline(true);
        if(escalRes?.items) setEscalations(escalRes.items.map(normalizeEscalation).filter(Boolean));
        // Only replace projects when the API response is well-formed AND
        // contains rows. The 2026-05-01 audit observed the Home Projects
        // KPI flipping `5 → 0 → 5` on every page load — root cause was a
        // transient empty {items: []} response stomping over INITIAL_PROJECTS
        // before the real fetch settled. Holding onto the previous value
        // until a non-empty payload arrives eliminates the flicker.
        if (projRes?.items) {
          const next = projRes.items.map(normalizeProject).filter(Boolean);
          if (next.length > 0) setProjects(next);
          setProjectsLoaded(true);
        }
        if(reqRes?.items) setRequests(reqRes.items.map(normalizeRequest).filter(Boolean));
      }catch(e){
        // Backend unreachable — keep using local data
        if(!cancelled) setBackendOnline(false);
      }
    })();
    return()=>{cancelled=true;};
  },[user]);

  // ── Cross-user escalations sync (20 s poll) ───────────────────────────────
  // The server already enforces role-based scope on GET /escalations, so
  // the response only contains items the caller is allowed to see. Polling
  // keeps every user's view of raised / assigned escalations current within
  // about 20 seconds of another user's action.
  useEffect(()=>{
    if(!user) return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const res=await apiFetchEscalations({limit:100});
        if(cancelled||!res?.items) return;
        setEscalations(res.items.map(normalizeEscalation).filter(Boolean));
      }catch(e){/* silent — next tick will retry */}
    };
    const iv=setInterval(poll,20000);
    return()=>{cancelled=true;clearInterval(iv);};
  },[user]);

  // ── Hydrate escalations' `.task` field from the live tasks array ─────────
  // The backend GET only returns `taskId`; we look it up in the current
  // tasks list so the detail pane and filters can inspect the underlying ticket.
  useEffect(()=>{
    if(!tasks||tasks.length===0) return;
    setEscalations(prev=>prev.map(e=>{
      if(e.task||!e.taskId) return e;
      const matched=tasks.find(t=>t._beId===e.taskId||t.id===e.taskId);
      return matched?{...e,task:matched}:e;
    }));
  },[tasks]);

  // ── Notification helpers ───────────────────────────────────────────────────
  const addNotif=useCallback((type,title,body)=>{
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    setNotifs(prev=>[{id:Date.now()+(Math.random()*10|0),type,title,body,time:now,read:false},...prev.slice(0,49)]);
  },[]);

  // Server-persisted feed (mentions, etc). The hook polls every 30s and
  // hydrates from a user-scoped localStorage cache for instant paint.
  const serverNotifs = useNotifications(user?.email || null);

  // Real-activity heartbeat for the Team-tab "Last seen" badge. Posts to
  // /api/v1/auth/heartbeat at most once per minute, only when the user
  // has interacted (mouse/keyboard/scroll/touch) in the last 90 s AND
  // the tab is visible. Idle background tabs never bump last_seen_at.
  useActivityHeartbeat(user?.email || null);

  // Combine the in-memory popup feed (announcements arrival, toasts) with
  // the server feed for a single bell. Server rows go first so a fresh
  // mention is at the top of the list. Capped at 50 to match addNotif().
  const mergedNotifs = React.useMemo(() => {
    const fromServer = (serverNotifs.items || []).map(n => {
      const ts = n.createdAt ? new Date(n.createdAt) : null;
      const tsMs = ts && !Number.isNaN(ts.getTime()) ? ts.getTime() : Date.now();
      const time = ts && !Number.isNaN(ts.getTime())
        ? ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : '';
      return {
        id: `srv-${n.id}`,
        _source: 'server',
        serverId: n.id,
        type: n.type || 'mention',
        title: n.title,
        body: n.body || '',
        time,
        // Numeric ms-since-epoch — used by NotificationPanel to group + sort
        // and by `timeAgo` for "5m / 2h / 3d" labels. Falls back to the
        // string time if `createdAt` was unparseable.
        timestamp: tsMs,
        createdAt: n.createdAt,
        read: !!n.readAt,
        linkView: n.linkView,
        linkId: n.linkId,
        sourceType: n.sourceType,
        sourceId: n.sourceId,
        actorEmail: n.actorEmail,
        actorName: n.actorName,
      };
    });
    return [...fromServer, ...notifs].slice(0, 50);
  }, [serverNotifs.items, notifs]);

  // Per-user "play a chime on new notification" preference. Drives off the
  // merged-unread count so both the server feed and the in-memory toasts
  // can trigger a chime — and lives on the bell dropdown so every role
  // (agents included) can flip it, no Settings access required.
  const mergedUnreadCount = React.useMemo(
    () => mergedNotifs.filter(n => !n.read).length,
    [mergedNotifs],
  );
  const notifSound = useNotificationSound({
    unreadCount: mergedUnreadCount,
    userEmail: user?.email || null,
  });

  const markAllRead = useCallback(() => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    serverNotifs.markAllRead();
  }, [serverNotifs]);

  // Click handler for the bell. Server rows route to their linked surface
  // and open the relevant detail (with the originating comment scrolled
  // into view via the announcements:openDetail event). In-memory rows keep
  // the legacy "mark all + go to my-queue/escalations/briefing" behaviour
  // since they don't carry link metadata.
  const handleNotifClick = useCallback((n) => {
    // Track "came from Notifications page" so the destination view can
    // surface a back-to-notifications pill. Bell-dropdown clicks leave
    // `view !== 'notifications'`, so the flag stays false and no pill
    // shows — the user was never on the notifications page to begin with.
    const fromNotif = view === 'notifications';
    setReturnToNotifications(fromNotif);
    justFromNotifClickRef.current = fromNotif;
    if (n && n._source === 'server') {
      if (n.serverId && !n.read) serverNotifs.markRead(n.serverId);
      if (n.linkView === 'announcements' && n.linkId) {
        setView('announcements');
        const detail = {
          id: n.linkId,
          commentId: n.sourceType === 'announcement_comment' ? n.sourceId : null,
        };
        // Defer one tick so the announcements view has mounted before the
        // openDetail listener fires.
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('announcements:openDetail', { detail })); }
          catch {}
        }, 60);
      } else if (n.linkView === 'hr_hub' && n.linkId) {
        // HR Hub deep-link: route to the HR Hub view and open the detail
        // drawer for this request id. URL is updated for share/F5 deep-link
        // restore; the openDetail event covers the case where the user is
        // already on hr-hub (setView is a no-op then, so HrHubView wouldn't
        // re-read the URL on its own).
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('req', n.linkId);
          window.history.replaceState({}, '', url.toString());
        } catch {}
        setView('hr-hub');
        const detail = {
          id: n.linkId,
          commentId: (n.sourceType || '').endsWith('comment') ? n.sourceId : null,
        };
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('hr-hub:openDetail', { detail })); }
          catch {}
        }, 60);
      } else if ((n.linkView === 'leader-alerts' || n.linkView === 'leader_alerts') && n.linkId) {
        // Leaders Hub deep-link: flip the view + dispatch an open event
        // that LeaderAlertsView listens for to slide the detail panel in
        // and scroll the originating comment / status change into view.
        setView('leader-alerts');
        const detail = {
          id: n.linkId,
          commentId: (n.sourceType || '').endsWith('comment') ? n.sourceId : null,
        };
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('leader-alerts:openDetail', { detail })); }
          catch {}
        }, 60);
      } else if (n.linkView === 'ooo' && n.linkId) {
        // OOO / Handover deep-link: handover-server.js writes
        // link_view='ooo' + link_id=handoverId on every handover
        // notification (assignment / approval / accept / decline /
        // reminder). Without this branch the bell click silently
        // no-op'd, so users had to navigate to OOO and click on
        // the calendar to find the row — Sarah Suge 2026-05-13
        // feedback "OOO Link to Accept Handover not Working".
        //
        // The detail slide-out is keyed on `time_off_event_id`, not
        // the handover id. OOOView listens for this event and
        // resolves the mapping by scanning the loaded events for
        // event.handover?.id === handoverId. We defer the dispatch
        // one tick so the view has mounted, and OOOView's listener
        // also retries when its events list updates so a deep-link
        // from a fresh login still resolves once the events fetch
        // returns.
        setView('ooo');
        const detail = { handoverId: n.linkId };
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('ooo:openDetail', { detail })); }
          catch {}
        }, 60);
      } else if (n.linkView === 'feedback' && n.linkId) {
        // Feedback board deep-link: flip the view + ask FeedbackView to
        // expand the row + scroll its comment thread into view.
        //
        // We also stamp ?fb=<id> on the URL so:
        //   (1) FeedbackView's useState initialiser reads it on first paint
        //       and avoids the setView → mount → useEffect race (Carolina
        //       Ferreira 2026-05-11 feedback "Accessing requests through
        //       notifications" — landing on the Feedback board but the
        //       row never expanded).
        //   (2) the link survives F5 / share-the-URL so support can hand
        //       a deep-link to another agent.
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('fb', n.linkId);
          window.history.replaceState({}, '', url.toString());
        } catch {}
        setView('feedback');
        const detail = {
          id: n.linkId,
          commentId: (n.sourceType || '').endsWith('comment') ? n.sourceId : null,
        };
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('feedback:openDetail', { detail })); }
          catch {}
        }, 60);
      }
      return;
    }
    // Legacy in-memory notif: existing nav-type routing handled by DeelTopNav
    // when no onNotifClick is provided. We mark the local row read so it
    // doesn't keep highlighting after acknowledgement.
    if (n && n.id) setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    markAllRead();
  }, [serverNotifs, markAllRead, view]);

  // ── Cross-user announcement sync (15 s poll) ───────────────────────────────
  // Keeps the Home banner, top-nav notification list, popup queue, and the
  // sender's ack counts current within ~15 seconds of another user's action.
  // New announcements (first-seen & targeted to this user) fire a notification;
  // popup ones automatically appear via the popupQueue memo.
  const seenAnnounceIdsRef=React.useRef(new Set());
  useEffect(()=>{
    if(!user||!apiRefreshAnnouncements) return;
    // Seed the "seen" set with whatever's already in comms at mount so we
    // don't flood notifications on first login.
    seenAnnounceIdsRef.current=new Set(comms.map(c=>c.id));
    let cancelled=false;
    const poll=async()=>{
      try{
        await apiRefreshAnnouncements();
      }catch(e){/* silent — next tick */}
      if(cancelled) return;
    };
    const iv=setInterval(poll,15000);
    return()=>{cancelled=true;clearInterval(iv);};
  // `comms` intentionally excluded — we only want this to re-mount when the user changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user,apiRefreshAnnouncements]);

  // Fire a notification whenever a sent-and-targeted announcement arrives
  // that we haven't seen before in this session.
  useEffect(()=>{
    if(!user) return;
    const seen=seenAnnounceIdsRef.current;
    for(const c of comms){
      if(seen.has(c.id)) continue;
      seen.add(c.id);
      if(c.status!=='sent') continue;
      if(c.author&&c.author.id===user.id) continue;
      const inAudience=(Array.isArray(c.target)&&c.target.includes(user.id))||matchesAudience(c.target,user);
      if(!inAudience) continue;
      // Skip notifying on already-acked comms. Email-only suppression when
      // the server has the email axis — see popupQueue comment for why the
      // id-axis fallback is unsafe (MEMBERS.id / DB members.id collisions).
      const myEmailForNotif = (user.email || '').toLowerCase();
      if (Array.isArray(c.ackEmails)) {
        if (myEmailForNotif && c.ackEmails.includes(myEmailForNotif)) continue;
      } else if (c.acks && c.acks.includes(user.id)) {
        continue; // legacy payload (no ackEmails) — id fallback
      }
      addNotif(c.type||'announce', c.title, c.body||'');
    }
  },[comms,user,addNotif]);

  const perms = usePermissions(effectiveUser, accessTypes, userAccessMap);

  // ── URL-gating for views the user can't access ───────────────────────────
  // The view useState reads `?view=...` from the URL on mount (skill
  // mistake #31 — read URL params in the initialiser, not a useEffect, so
  // the first paint is correct). That respects valid deep-links but also
  // happily takes a route id like `analytics` / `escalations` / `projects`
  // / `team` / `leader-alerts` from someone who's not allowed there. The
  // 2026-05-03 agent audit (A-F2 / A-F31 / A-F32 / A-F33) caught Will
  // (Agent) reaching Leaders Hub via the Home quick-tile and Analytics /
  // Escalations / Projects via direct URL — the page shells rendered, even
  // though no real data leaked, because nothing redirected the agent off
  // a forbidden route.
  //
  // This effect closes the gap: the moment `view` lands on a route
  // `perms.canView()` rejects, snap back to `briefing`. Runs on every
  // view change including the initial mount, so the first non-permitted
  // paint flips back to home before the user notices. Light enough that
  // it doesn't replace the existing `RESTRICTED_VIEWS` owner gate (that
  // one is for not-yet-shipped views; this one is for role-based access).
  React.useEffect(() => {
    if (!perms || typeof perms.canView !== 'function') return;
    if (perms.canView(view) === false) setView('briefing');
  }, [view, perms]);

  // Agents land on the dedicated AgentHome — not the manager-style
  // BriefingView. Catches every path that ends up at 'briefing' (Home
  // tab click, ?view=briefing deep-link, programmatic setView from
  // another component) and canonicalises the URL via the existing
  // ?view= mirror so F5 returns the same surface. The render-site
  // guard on the BriefingView line below blocks the one-frame paint
  // before this effect commits. agent-home is open in
  // accessControl.js so canView passes for the agent tier.
  //
  // Routing key: `perms.raw.dataScope` (NOT the raw `effectiveUser.access`
  // string). dataScope is computed by usePermissions through the access-
  // type resolver so it's the canonical agent signal regardless of how
  // the user object stores `access` (custom role string, stackable
  // admin grant on an agent base, override-only roster member, stale
  // /me payload, etc.). The previous string-equality on `access` was
  // too narrow — any account whose FE `access` value didn't land on the
  // exact lowercase literal `'agent'` slipped past the redirect and
  // ended up rendering BriefingView. Treat anything outside the three
  // managerial scopes as agent-tier so all agent-shape users land here.
  React.useEffect(() => {
    if (!effectiveUser) return;
    // 2026-05-21 fix: wait for the live roster to hydrate before deciding
    // which home to render. Pre-hydration, every user looks like an
    // at_agent because DEFAULT_USER_ACCESS_MAP is built from the STATIC
    // TEAM_MEMBERS baseline (where many managers — Insiya, Sarah, Kerri,
    // etc. — are tagged `access: 'agent'` from before the override table
    // existed). Flipping to agent-home on that stale read and then
    // having to flip BACK to briefing once the real role arrives shows
    // the manager a brief AgentHome paint, which they correctly read as
    // "the cards don't show any tasks". For managers with a populated
    // localStorage cache (legacy or per-dept) hydration is synchronous on
    // the very first render, so the briefing view paints with no flicker.
    //
    // Two signals are checked because they aren't redundant:
    //   • rosterVersion > 0 — the module-level roster differs from the
    //     baseline (hydrateRoster fired with actual change).
    //   • rosterFetched     — the live /team-members fetch returned, even
    //     if its payload was structurally identical to the baseline (in
    //     which case hydrateRoster no-ops and rosterVersion stays at 0).
    // Without the second signal, agents whose live roster happens to
    // match the static seed get stuck: rosterVersion === 0 forever,
    // routing deferred forever, view stays at 'briefing' but the
    // BriefingView render gate rejects them (dataScope is own_tasks_only)
    // → blank page (Abe Elkholi, 2026-05-21).
    if (!rosterFetched && rosterVersion === 0) return;
    const dataScope = perms?.raw?.dataScope;
    if (!dataScope) return; // wait for accessType to resolve
    const isManagerial = dataScope === 'all_tasks' || dataScope === 'regional_tasks' || dataScope === 'team_tasks';
    // Forward: agent-tier user landing on briefing → flip to agent-home.
    if (!isManagerial && view === 'briefing') setView('agent-home');
    // Reverse: managerial user stuck on agent-home (e.g. admin who was
    // impersonating an agent and just clicked "Stop impersonating" — view
    // stays at 'agent-home' from the impersonation, but effectiveUser is
    // now the admin again so they should be on BriefingView). Without
    // this, the admin sees AgentHome rendered with their own data until
    // they manually click the Home tab.
    if (isManagerial && view === 'agent-home') setView('briefing');
  }, [effectiveUser, perms?.raw?.dataScope, view, rosterVersion, rosterFetched]);

  // ── Live integrations (Jira, Slack) ───────────────────────────────────────
  // Deel REST-v2 wrapper (useDeelData) retired 2026-05-13 — endpoints had
  // been 401/404 for weeks and only fed two diagnostic tiles. Admin-API
  // queue data flows through useQueueUnifiedSync / useOnboardingData /
  // useWorkbenchData etc., which remain wired separately.
  const integrations = useIntegrations();
  const jiraData = useJiraData(integrations.isConfigured('jira'));
  const slackData = useSlackData(integrations.isConfigured('slack'));
  const integrationsCtx = { integrations, jiraData, slackData, queueSync, queueUnified, hiddenTasks, slaExtensions };

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast=useCallback((type,title,body,onUndo)=>{
    const id=Date.now();
    setToasts(prev=>[...prev.slice(-4),{id,type,title,body,onUndo}].slice(-5));
    setTimeout(()=>setToasts(prev=>prev.filter(t=>t.id!==id)),4800);
    addNotif(type,title,body);
  },[addNotif]);
  const dismissToast=useCallback(id=>setToasts(prev=>prev.filter(t=>t.id!==id)),[]);
  // Patch the toast bridge used by useAnnouncements (declared earlier in the
  // render). The hook reads `toastRef.current` on every error path, so keeping
  // this in sync means latest-addToast is always used.
  useEffect(()=>{ toastRef.current = addToast; },[addToast]);

  // ── Leaders Alerts: sidebar unacked badge ──────────────────────────────
  // Polls the unacked-count endpoint on the same 30 s cadence as the
  // notification bell. Only enabled for managerial users (the tab is
  // hidden for agents anyway). Quiet failure mode — a 401/500 just keeps
  // the previous count; the badge isn't a critical signal.
  useEffect(() => {
    if (!user || !perms?.canView?.('leader-alerts')) {
      setLeaderAlertsBadge(0);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await getLeaderAlertsUnackedCount();
        if (!cancelled && typeof d?.count === 'number') setLeaderAlertsBadge(d.count);
      } catch { /* keep prior count */ }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, perms]);

  // ── Meeting alerts ──────────────────────────────────────────────────────
  // Runs globally (not just on the Calendar tab) so the 5-minute reminder
  // toast fires no matter where the user is in the app. Gated to the
  // Calendar-integration owner — the same soft-launch cohort that sees
  // the tab and can reach the /api/v1/calendar/* endpoints.
  useMeetingAlerts({
    enabled: isOwner && !!user?.email,
    addToast,
    setView,
  });

  // ── Manual / Slack escalation handler (gated by can_create_escalation) ────
  const confirmManualEscal=useCallback((form)=>{
    if(!perms?.canDo('can_create_escalation'))return;
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const linkedTask=form.task??null;
    setEscalations(prev=>[{
      id:`ESC-${Date.now()}`,
      task:linkedTask,
      taskId:form.taskId??null,
      reason:form.reason,
      subject:form.subject,
      escalatedBy:user.name,
      escalatedByEmail:(user.email||'').toLowerCase(),
      escalatedById:user.id||null,
      escalatedAt:now,
      managerId:form.managerId??null,
      managerName:form.managerName??'Team Lead',
      status:'pending',
      managerResponseStatus:'pending_response',
      managerResponse:null,
      managerRespondedAt:null,
      managerRespondedBy:null,
      escalationSource:form.escalationSource??'manual',
      slackChannel:form.slackChannel??null,
      slackUser:form.slackUser??null,
      slackMessageUrl:form.slackMessageUrl??null,
      severity:form.severity||'medium',
    },...prev]);
    setCreateEscalModal(false);
    addToast('escalation','Escalation Created',form.subject.slice(0,50));
    // BE sync — forward source + Slack fields + severity so the row stores
    // the full context (previously these were silently dropped).
    apiCreateEscalation({
      taskId:form.taskId||undefined,
      subject:form.subject,
      reason:form.reason,
      managerId:form.managerId?String(form.managerId):undefined,
      escalationSource:form.escalationSource||'manual',
      slackChannel:form.slackChannel||null,
      slackUser:form.slackUser||null,
      slackMessageUrl:form.slackMessageUrl||null,
      severity:form.severity||'medium',
    }).catch(err=>{
      console.warn('[manualEscalation] BE sync failed:',err.message);
      addToast('warning','Sync Warning','Escalation saved locally but backend sync failed');
    });
  },[user,addToast,perms]);

  // ── SLA real-time ticking — increment minutesAgo every 60s ────────────────
  // Skipped while the tab is hidden (no one's looking — don't re-render every
  // task). When the tab becomes visible again, we bump once to catch up, then
  // the interval resumes its 60s cadence.
  useEffect(()=>{
    const bump=(mins)=>{
      setTasks(prev=>prev.map(t=>{
        if(t.status==='resolved'||t.status==='waiting')return t;
        return {...t, minutesAgo:(t.minutesAgo||0)+mins, updatedMinsAgo:(t.updatedMinsAgo||0)+mins, minutesSinceLastResponse:(t.minutesSinceLastResponse||0)+mins};
      }));
    };
    let lastTick=Date.now();
    const iv=setInterval(()=>{
      if(typeof document!=='undefined'&&document.hidden)return;
      lastTick=Date.now();
      bump(1);
    },60000);
    const onVis=()=>{
      if(typeof document==='undefined'||document.hidden)return;
      const elapsedMins=Math.floor((Date.now()-lastTick)/60000);
      if(elapsedMins>0){lastTick=Date.now();bump(elapsedMins);}
    };
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',onVis);
    return()=>{
      clearInterval(iv);
      if(typeof document!=='undefined')document.removeEventListener('visibilitychange',onVis);
    };
  },[]);

  // ── Create task handler (gated by can_create_task) ────────────────────────
  const confirmCreate=useCallback((form)=>{
    if(!perms?.canDo('can_create_task'))return;
    const now=new Date();
    const t=`${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
    const pfx={zendesk:'ZD',jira:'JR',gmail:'GM',workbench:'WB',calendar:'CAL',looker:'LK'};
    // Use base36 suffix for unique IDs
    const newId=`${pfx[form.source]||'MN'}-${(now.getTime()+Math.floor(Math.random()*999)).toString(36).slice(-4).toUpperCase()}`;
    const agentName=MEMBERS.find(m=>m.id===form.assigneeId)?.name;
    const newTask={id:newId,source:form.source,subject:form.subject,body:form.body||'',assigneeId:form.assigneeId,country:form.country,receivedAt:t,minutesAgo:0,updatedMinsAgo:0,minutesSinceLastResponse:0,status:'new',type:form.type,isAlert:false,suggestedReply:'',_locallyCreated:true,_createdAt:now.toISOString()};
    setTasks(prev=>[newTask,...prev]);
    setActivity(prev=>({...prev,[newId]:[{type:'created',text:'Task created manually',user:user.name,time:t},{type:'assigned',text:`Assigned to ${agentName}`,user:user.name,time:t}]}));
    setCreateModal(false);
    addToast('success','Task Created',`${newId} → ${agentName?.split(' ')[0]}`);
    // BE sync
    apiCreateTask(denormalizeTaskForCreate({...form,id:newId})).catch(err=>{
      console.warn('[createTask] BE sync failed:',err.message);
      addToast('warning','Sync Warning','Task created locally but backend sync failed');
    });
  },[addToast,user,perms]);

  // ── Project handlers (gated by can_create_project / can_edit_project) ──────
  const confirmProject=useCallback((form)=>{
    if(projectModal && typeof projectModal === 'object') {
      if(!perms?.canDo('can_edit_project'))return;
      // Edit
      setProjects(prev=>prev.map(p=>p.id===projectModal.id?{...p,...form,updatedAt:new Date().toISOString().split('T')[0]}:p));
    } else {
      if(!perms?.canDo('can_create_project'))return;
      // Create
      const newId=`PRJ-${String(projects.length+1).padStart(3,'0')}`;
      setProjects(prev=>[...prev,{id:newId,...form,progress:0,createdBy:user?.id,createdAt:new Date().toISOString().split('T')[0],updatedAt:new Date().toISOString().split('T')[0]}]);
    }
    setProjectModal(null);
    addToast('success', projectModal && typeof projectModal==='object' ? 'Project Updated' : 'Project Created', form.name);
    // BE sync
    if(projectModal && typeof projectModal==='object'){
      apiUpdateProject(projectModal.id,{title:form.name,priority:form.priority,description:form.description}).catch(err=>{
        console.warn('[project] Update sync failed:',err.message);
        addToast('warning','Sync Warning','Project updated locally but backend sync failed');
      });
    } else {
      apiCreateProject({title:form.name,priority:form.priority||'medium',description:form.description}).catch(err=>{
        console.warn('[project] Create sync failed:',err.message);
        addToast('warning','Sync Warning','Project created locally but backend sync failed');
      });
    }
  },[projectModal,projects.length,user,addToast,perms]);

  // ── Outbound request handler (gated by can_create_request) ────────────────
  const confirmRequest=useCallback((form)=>{
    if(!perms?.canDo('can_create_request'))return;
    const newId=`REQ-${String(requests.length+1).padStart(3,'0')}`;
    setRequests(prev=>[{id:newId,...form,status:'open',notes:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),resolvedAt:null},...prev]);
    setRequestModal(false);
    addToast('success','Request Raised',form.subject.slice(0,50));
    // BE sync
    apiCreateRequest({subject:form.subject,description:form.description,toTeam:form.toTeam,priority:form.priority,taskId:form.linkedTaskId||undefined}).catch(err=>{
      console.warn('[request] Create sync failed:',err.message);
      addToast('warning','Sync Warning','Request created locally but backend sync failed');
    });
  },[requests.length,addToast,perms]);

  // ── Global keyboard shortcuts (⌘K for search) ─────────────────────────────
  useEffect(()=>{
    const h=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setShowSearch(s=>!s);}
      if(e.key==='Escape'&&!createModal){setShowSearch(false);}
    };
    document.addEventListener('keydown',h);
    return()=>document.removeEventListener('keydown',h);
  },[createModal]);

  // ── Session expiry listener — triggers when api.js gets 401 ─────────
  useEffect(()=>{
    const handler=()=>{
      setUser(null);
      setLoggedInEmail(null);
      setImpersonating(null);
      try { localStorage.removeItem('ops_hub_logged_in_email'); localStorage.removeItem('ops_hub_token_ts'); localStorage.removeItem('ops_hub_user'); } catch(e) {}
      clearQueueCaches();
      addToast('error','Session Expired','Please log in again.');
    };
    window.addEventListener('ops-hub-session-expired',handler);
    return()=>window.removeEventListener('ops-hub-session-expired',handler);
  },[addToast]);

  // ── Dark mode: apply saved theme on mount ──────────────────────────────
  useEffect(()=>{
    try{
      const savedTheme=localStorage.getItem('ops_hub_theme');
      if(savedTheme){document.documentElement.setAttribute('data-theme',savedTheme);}
    }catch(e){}
  },[]);

  // ── Settings persistence ────────────────────────────────────────────────
  useEffect(()=>{
    try{localStorage.setItem('ops_hub_settings',JSON.stringify(settings));}catch(e){}
  },[settings]);
  useEffect(()=>{try{localStorage.setItem('ops_hub_access_types',JSON.stringify(accessTypes));}catch(e){}},[accessTypes]);
  useEffect(()=>{try{localStorage.setItem('ops_hub_user_access_map',JSON.stringify(userAccessMap));}catch(e){}},[userAccessMap]);
  useEffect(()=>{try{localStorage.setItem('ops_hub_dismissed_popups',JSON.stringify(dismissedPopups));}catch(e){}},[dismissedPopups]);
  // Track current dept so MOC + TLOC re-hydrate on switch. 2026-05-21 audit F22.
  const _currentDeptIdForMoc = useCurrentDeptId();
  useEffect(() => { try { localStorage.setItem(mocCacheKey(_currentDeptIdForMoc), JSON.stringify(managerOnCall)); } catch(e) {} }, [managerOnCall, _currentDeptIdForMoc, mocCacheKey]);
  useEffect(() => { try { localStorage.setItem(tlocCacheKey(_currentDeptIdForMoc), JSON.stringify(teamLeadOnCall)); } catch(e) {} }, [teamLeadOnCall, _currentDeptIdForMoc, tlocCacheKey]);

  // On dept switch, immediately swap the displayed MOC + TLOC to the new dept's
  // cached value (instant UX, no 15s lag). Tracks the previous dept so the
  // initial null → real-dept resolution at mount doesn't fire a spurious reset.
  const prevDeptIdForMocRef = useRef(_currentDeptIdForMoc);
  useEffect(() => {
    const prev = prevDeptIdForMocRef.current;
    prevDeptIdForMocRef.current = _currentDeptIdForMoc;
    // First effect or null → real-dept (initial resolve) — leave state as-is.
    if (prev === _currentDeptIdForMoc) return;
    if (!prev && _currentDeptIdForMoc) return;
    // Real dept switch: pull the target dept's cached values; defaults if absent.
    try {
      const m = localStorage.getItem(mocCacheKey(_currentDeptIdForMoc));
      setManagerOnCall(m ? JSON.parse(m) : DEFAULT_MOC);
    } catch { setManagerOnCall(DEFAULT_MOC); }
    try {
      const t = localStorage.getItem(tlocCacheKey(_currentDeptIdForMoc));
      setTeamLeadOnCall(t ? JSON.parse(t) : null);
    } catch { setTeamLeadOnCall(null); }
    // Server fetch below picks up the new dept via apiFetch's dept cookie /
    // header on the next tick.
  }, [_currentDeptIdForMoc, mocCacheKey, tlocCacheKey]);

  // ── Manager on Call: fetch from backend + poll every 15s for cross-user sync
  // Re-fires immediately on dept switch (the dept cookie is part of apiFetch,
  // so the server route returns the new dept's schedule). Without the
  // currentDeptId dep, super-admin dept switches would keep showing the
  // previous dept's MOC for up to 15 s.
  useEffect(() => {
    if (!user) return;
    let active = true;
    const fetchMoc = () => {
      apiFetch('/settings/manager-on-call')
        .then(data => {
          if (active && data?.name) {
            setManagerOnCall(prev => {
              // Compare ALL load-bearing fields, including updatedAt — the
              // MOC alert popup useEffect (below) keys on `updatedAt` to
              // detect a fresh assignment, so a name+email-only equality
              // check would suppress re-assignments to the same person and
              // the new MOC would never see the popup. Confirmed bug
              // 2026-05-08: re-rotating MOC to the same person never
              // re-fired the alert.
              const sameName = prev?.name === data.name;
              const sameEmail = (prev?.email || '') === (data.email || '');
              const sameUpdatedAt = (prev?.updatedAt || null) === (data.updatedAt || null);
              if (sameName && sameEmail && sameUpdatedAt) return prev;
              return data;
            });
          }
        })
        .catch(() => {}); // silently fail — keep localStorage value
    };
    fetchMoc();
    const interval = setInterval(fetchMoc, 15000);
    return () => { active = false; clearInterval(interval); };
  }, [user, _currentDeptIdForMoc]);

  // ── Handler to change Manager on Call — saves to backend for cross-user sync
  const handleChangeManagerOnCall = useCallback((newMoc) => {
    setManagerOnCall(newMoc);
    apiFetch('/settings/manager-on-call', {
      method: 'PUT',
      body: JSON.stringify(newMoc),
    }).catch(err => console.warn('[managerOnCall] Failed to save:', err.message));
  }, []);

  // ── Team Lead On Call — fetch + 15s poll, identical cadence to MOC.
  // Re-fires on dept switch (see MOC effect for rationale).
  useEffect(() => {
    if (!user) return;
    let active = true;
    const fetchTloc = () => {
      apiFetch('/settings/team-lead-on-call')
        .then(data => {
          if (!active) return;
          // Server may return `null` when TLOC has never been set —
          // we honour that as "no TLOC" and clear the pill.
          if (data && data.name) {
            setTeamLeadOnCall(prev => {
              const sameName = prev?.name === data.name;
              const sameEmail = (prev?.email || '') === (data.email || '');
              const sameUpdatedAt = (prev?.updatedAt || null) === (data.updatedAt || null);
              if (sameName && sameEmail && sameUpdatedAt) return prev;
              return data;
            });
          } else {
            setTeamLeadOnCall(prev => (prev == null ? prev : null));
          }
        })
        .catch(() => {}); // silently fail — keep localStorage value
    };
    fetchTloc();
    const interval = setInterval(fetchTloc, 15000);
    return () => { active = false; clearInterval(interval); };
  }, [user, _currentDeptIdForMoc]);

  // ── Handler to change Team Lead On Call — saves to backend; server
  // side bulk-reassigns auto-assigned HR-Hub rows from the previous TL
  // to the new one in the same transaction.
  const handleChangeTeamLeadOnCall = useCallback((newTloc) => {
    setTeamLeadOnCall(newTloc);
    apiFetch('/settings/team-lead-on-call', {
      method: 'PUT',
      body: JSON.stringify(newTloc),
    }).catch(err => console.warn('[teamLeadOnCall] Failed to save:', err.message));
  }, []);

  // ── MOC assignment alert (Mohamed 2026-05-07) ────────────────────────────
  // When the current user becomes the Manager on Call — either via this
  // tab or another teammate flipping the assignment — fire a
  // red/scary popup with a CTA to open the All: Manager on Call View.
  // De-dupe via lastAcknowledgedMocAt in localStorage so the same
  // assignment doesn't flash on every 15s poll. The acknowledgement
  // key is per-email so two teammates sharing a browser don't suppress
  // each other's alerts.
  const [mocAlert, setMocAlert] = useState(null); // null | { mocUpdatedAt, mocName }
  useEffect(() => {
    if (!user?.email || !managerOnCall) return;
    const myEmail = String(user.email || '').toLowerCase();
    const mocEmail = String(managerOnCall.email || '').toLowerCase();
    const updatedAt = managerOnCall.updatedAt || null;
    if (!updatedAt || mocEmail !== myEmail) return;
    let lastAck = null;
    try {
      lastAck = localStorage.getItem(`ops_hub_moc_ack:${myEmail}`);
    } catch {}
    if (lastAck === updatedAt) return;
    setMocAlert({ mocUpdatedAt: updatedAt, mocName: managerOnCall.name || myEmail });
  }, [user?.email, managerOnCall]);
  const dismissMocAlert = useCallback(() => {
    if (!mocAlert) return;
    try {
      localStorage.setItem(`ops_hub_moc_ack:${(user?.email || '').toLowerCase()}`, mocAlert.mocUpdatedAt);
    } catch {}
    setMocAlert(null);
  }, [mocAlert, user?.email]);
  const openMocView = useCallback(() => {
    dismissMocAlert();
    setView('urgent-assist');
    // UrgentAssistView listens for this and flips its scope to 'all'.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ops-hub:urgent-assist-open-all'));
    }
  }, [dismissMocAlert, setView]);

  // ── TLOC assignment alert — mirror of the MOC alert. Same per-email
  // ack key pattern + popup + sound (see MocAlertModal). Triggered when
  // the current user becomes the new Team Lead On Call.
  const [tlocAlert, setTlocAlert] = useState(null); // null | { tlocUpdatedAt, tlocName }
  useEffect(() => {
    if (!user?.email || !teamLeadOnCall) return;
    const myEmail = String(user.email || '').toLowerCase();
    const tlocEmail = String(teamLeadOnCall.email || '').toLowerCase();
    const updatedAt = teamLeadOnCall.updatedAt || null;
    if (!updatedAt || tlocEmail !== myEmail) return;
    let lastAck = null;
    try { lastAck = localStorage.getItem(`ops_hub_tloc_ack:${myEmail}`); } catch {}
    if (lastAck === updatedAt) return;
    setTlocAlert({ tlocUpdatedAt: updatedAt, tlocName: teamLeadOnCall.name || myEmail });
  }, [user?.email, teamLeadOnCall]);
  const dismissTlocAlert = useCallback(() => {
    if (!tlocAlert) return;
    try { localStorage.setItem(`ops_hub_tloc_ack:${(user?.email || '').toLowerCase()}`, tlocAlert.tlocUpdatedAt); } catch {}
    setTlocAlert(null);
  }, [tlocAlert, user?.email]);
  const openTlocView = useCallback(() => {
    dismissTlocAlert();
    setView('hr-hub');
  }, [dismissTlocAlert, setView]);

  // ── Clean up dismissed popups — only on login, not on every comms change ──
  // Removes IDs for announcements that no longer exist. Runs once when user
  // logs in (not on every comms update — that caused popups to flash back).
  const dismissCleanedRef=React.useRef(false);
  useEffect(()=>{
    if(!user||dismissCleanedRef.current)return;
    dismissCleanedRef.current=true;
    const commsById=new Map(comms.map(c=>[c.id,c]));
    setDismissedPopups(prev=>{
      // Only remove IDs for announcements that don't exist at all anymore
      const cleaned=prev.filter(id=>commsById.has(id));
      return cleaned.length===prev.length?prev:cleaned;
    });
  },[user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Popup queue — derived from comms, minus dismissed ones ──────────────
  // Uses the canonical audience matcher so NAM/LATAM/AMERICAS/global and
  // dual-region members resolve correctly.
  //
  // Ack matching (EMAIL-ONLY when the server provides `ackEmails`):
  //   Emails are the durable, drift-proof identifier. We intentionally do NOT
  //   OR in any id-axis fallback when email data is present — MEMBERS.id is
  //   an array-position index that collides with DB members.id values. Such
  //   a collision would falsely mark the viewer as acked whenever a real
  //   acker's DB id happens to equal the viewer's MEMBERS-array index,
  //   suppressing the popup for team members who never clicked it.
  //   Id matching is only used when `ackEmails` is missing entirely.
  const popupQueue=React.useMemo(()=>{
    if(!user)return [];
    const localUid=Number(user.id);
    const serverUid=apiServerUserId?Number(apiServerUserId):null;
    const myEmail=(user.email||'').toLowerCase()||null;
    const serverEmail=apiServerUserEmail?String(apiServerUserEmail).toLowerCase():null;
    const isAckedByMe=(c)=>{
      if (Array.isArray(c.ackEmails)) {
        if (myEmail && c.ackEmails.includes(myEmail)) return true;
        if (serverEmail && c.ackEmails.includes(serverEmail)) return true;
        return false; // email axis available → trust it exclusively
      }
      if (Array.isArray(c.acks)) {
        if (localUid && c.acks.includes(localUid)) return true;
        if (serverUid && c.acks.includes(serverUid)) return true;
      }
      return false;
    };
    const targetMatch=(c)=>{
      if(Array.isArray(c.target)&&c.target.includes(user.id))return true;
      return matchesAudience(c.target, user);
    };
    // Snooze gate — eslint-disable for popupTick because it intentionally
    // forces re-evaluation every minute so an expired snooze brings the
    // popup back without a page refresh, even though `popupTick` isn't
    // read inside the filter body.
    void popupTick; // eslint-disable-line no-unused-expressions
    const now = Date.now();
    const isSnoozed = (id) => {
      const until = snoozedPopups?.[id];
      return Number.isFinite(until) && until > now;
    };
    // Authors don't need to acknowledge their own broadcast — popping
    // an announcement back at the person who just sent it is noise.
    // 2026-05-18: caught when Mohamed's own POPUP fired at him, he
    // snoozed it, and the briefing tile kept counting it as unacked
    // forever because the unacked count had the same author-OR bug.
    // Removed `|| (c.author && c.author.id === user.id)` and re-applied
    // the author exclusion as an explicit AND.
    const isAuthor = (c) => c.author && c.author.id === user.id;
    return comms.filter(c=>
      c.isPopup&&c.status==='sent'&&!isAckedByMe(c)&&!dismissedPopups.includes(c.id)&&!isSnoozed(c.id)&&targetMatch(c)&&!isAuthor(c)
    );
  },[comms,user,dismissedPopups,snoozedPopups,popupTick,apiServerUserId,apiServerUserEmail]);

  // Minute-tick used as a dependency of `popupQueue` above. Cheap — just
  // increments a counter so the memo re-runs and re-checks snooze
  // expiries. visibilitychange also nudges it so a tab that was hidden
  // for hours catches up the moment it comes back into focus.
  //
  // On every tick we ALSO prune expired snooze entries from state +
  // localStorage. The popup memo already handles expiry via the
  // `until > now` check, but pruning state-side means: (a) the map
  // doesn't grow without bound on a long-running tab; (b) any
  // downstream consumer reading `snoozedPopups` sees a clean view of
  // "what's actually still snoozed".
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => {
      setPopupTick((t) => (t + 1) % 1000000);
      setSnoozedPopups((prev) => {
        if (!prev || typeof prev !== 'object') return prev;
        const now = Date.now();
        let mutated = false;
        const next = {};
        for (const [id, until] of Object.entries(prev)) {
          if (Number.isFinite(until) && until > now) next[id] = until;
          else mutated = true;
        }
        if (!mutated) return prev;
        try { localStorage.setItem('ops_hub_snoozed_popups', JSON.stringify(next)); } catch (e) {}
        return next;
      });
    };
    const id = setInterval(bump, 60_000);
    const onVis = () => { if (!document.hidden) bump(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const handlePopupAcknowledge=useCallback((commId)=>{
    // Immediately dismiss from popup queue + acknowledge in state/API.
    // Also persist to localStorage so even if the server call fails silently
    // the popup doesn't reappear after refresh (apiAcknowledge itself queues
    // retries — this is belt-and-braces for the UX). We pass the email too
    // so the hook can record it in ackEmails even before the server round-trip
    // completes, killing the last race window for the popup bug.
    setDismissedPopups(prev=>{
      if (prev.includes(commId)) return prev;
      const next = [...prev, commId];
      try { localStorage.setItem('ops_hub_dismissed_popups', JSON.stringify(next)); } catch(e){}
      return next;
    });
    // Acking also clears any pending snooze so the localStorage map
    // doesn't carry a dead entry around (acked → never popup again).
    setSnoozedPopups(prev=>{
      if (!prev || !(commId in prev)) return prev;
      const next = { ...prev };
      delete next[commId];
      try { localStorage.setItem('ops_hub_snoozed_popups', JSON.stringify(next)); } catch(e){}
      return next;
    });
    apiAcknowledge(commId, user.id, user.email);
  },[user, apiAcknowledge]);

  const SNOOZE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours
  const handlePopupSnooze = useCallback((commId) => {
    // Hide the popup for SNOOZE_DURATION_MS. The minute-tick re-evaluates
    // the popupQueue memo so the popup reappears the moment the window
    // expires — even if the tab stays open. We DO NOT add the id to
    // dismissedPopups: snooze is temporary, dismiss is permanent.
    setSnoozedPopups(prev => {
      const next = { ...(prev || {}), [commId]: Date.now() + SNOOZE_DURATION_MS };
      try { localStorage.setItem('ops_hub_snoozed_popups', JSON.stringify(next)); } catch (e) {}
      return next;
    });
    // Surface a confirmation so the user knows it's not lost.
    if (addToast) addToast('info', 'Snoozed for 4 hours', 'The announcement will pop up again — it still needs your acknowledgement.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToast]);

  useEffect(()=>{setSubFilter(null);},[view]);

  // ── View permission guard — redirect to first allowed view ──────────────
  // Wait for the user to hydrate before evaluating canView. Otherwise the
  // role-fallback inside resolveUserPermissions defaults to `at_agent`,
  // which redirects deep-link URLs (`?view=leader-alerts`) to briefing
  // before the actual access type is known. Bug surfaced 2026-05-02 when
  // managerial-only views landed; the latent issue dates back to the
  // first version of this guard.
  useEffect(()=>{
    if(!perms||!user)return;
    // Two reasons we redirect away from the current view:
    //   1. The view is a real route the caller doesn't have access to
    //      (e.g. agent landing on ?view=leader-alerts via a stale link).
    //   2. The view is one of the deleted route ids — projects /
    //      escalations / calendar / knowledge-hub / analytics / hr-reports.
    //      `perms.canView` returns truthy for unknown ids by default, so
    //      we explicitly check membership in ALL_VIEWS too. Without this
    //      block, deep-links to deleted views landed on a blank content
    //      area (Audit 2026-05-04 finding F5).
    const isKnownView = ALL_VIEWS.includes(view);
    if (view && (!isKnownView || !perms.canView(view))) {
      const fallback=['briefing','my-queue','hr-hub','leader-alerts','urgent-assist','feedback','announcements','slack','settings'].find(v=>perms.canView(v));
      setView(fallback||'briefing');
    }
  },[view,perms,user]);

  // ── Live feed + occasional toast ──────────────────────────────────────────
  useEffect(()=>{
    const evts=[
      {tool:'slack',    text:'New mention @hr-ops: PTO carry-over — NL',       type:'new_task', toast:'New Slack mention',     body:'PTO carry-over query — NL'},
      {tool:'zendesk',  text:'New ticket: Equipment return issue — CA',         type:'new_task', toast:'New Zendesk ticket',    body:'Equipment return — CA'},
      {tool:'gmail',    text:'Incoming: Salary review request — SG',            type:'new_task', toast:'New email received',    body:'Salary review request — SG'},
      {tool:'jira',     text:'Ticket reopened: Onboarding blocker',             type:'alert',    toast:'Jira ticket reopened',  body:'Onboarding checklist blocker'},
      {tool:'looker',   text:'Report ready: Monthly headcount',                 type:'info',     toast:'Looker report ready',   body:'Monthly headcount report'},
      {tool:'workbench',text:'Record update queued — DE',                       type:'success',  toast:'Record update queued',  body:'Workbench — DE entity'},
      {tool:'calendar', text:'Scheduling: Exit interview — FR',                 type:'info',     toast:'Calendar reminder',     body:'Exit interview — FR entity'},
    ];
    let i=0;
    const iv=setInterval(()=>{
      const now=new Date(); const t=`${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
      const ev=evts[i%evts.length];
      setFeed(prev=>[{...ev,time:t},...prev.slice(0,20)]);
      // toast notifications removed — too distracting
      i++;
    },7000);
    return()=>clearInterval(iv);
  },[]);

  // Scope escalations the same way the server filters them on GET — every
  // count/list downstream uses `scopedEscalations` so the badge, the Home
  // "Needs Your Attention" feed, and the Escalations page all agree.
  const scopedEscalations=React.useMemo(
    ()=>perms?.scopeEscalations?.(escalations,MEMBERS)||escalations,
    [escalations,perms]
  );
  const pendingEscal=scopedEscalations.filter(e=>e.status==='pending').length;
  // ── Local dev: auto-login bypass (never deployed — checked at runtime) ─────
  const isLocalDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if(!user && isLocalDev) {
    const devUser = MEMBERS.find(m => m.email === 'mohamed.tantawy@deel.com');
    if(devUser) {
      // Auto-login on next tick to avoid setState during render
      setTimeout(() => { setUser(devUser); setLoggedInEmail(devUser.email); }, 0);
      return null;
    }
  }

  // ── If not logged in, show login screen ────────────────────────────────────
  if(!user) return(
    <>
      <UpdateBanner hasUpdate={versionHasUpdate} reload={versionReload} latestVersion={versionLatest} />
      <LoginScreen
        onLogin={handleLogin}
      />
    </>
  );

  return(
    <ErrorBoundary>
    <PermissionsContext.Provider value={{ ...perms, rosterVersion }}>
    <IntegrationsContext.Provider value={integrationsCtx}>
    <SettingsContext.Provider value={settings}>
    <div style={{minHeight:'100vh',background:'var(--bg)',color:'var(--text)',display:'flex',flexDirection:'column'}} role="application" aria-label="Ops Hub Dashboard">
      <UpdateBanner hasUpdate={versionHasUpdate} reload={versionReload} latestVersion={versionLatest} />
      {/* When the update banner is visible, push every other fixed-position bar
          down by its height so nothing is obscured. 44px matches UpdateBanner's
          minHeight. */}
      {versionHasUpdate && <style>{`.deel-topnav{top:${impersonating?80:44}px!important;} .deel-impersonation-bar{top:44px!important;}`}</style>}
      {impersonating && effectiveUser && (
        <div className="deel-impersonation-bar" style={{position:'fixed',top:0,left:0,right:0,zIndex:101,background:'linear-gradient(90deg,#7c3aed,#6d28d9)',color:'white',padding:'8px 24px',display:'flex',alignItems:'center',justifyContent:'center',gap:12,fontSize:13,fontWeight:600,boxShadow:'0 2px 8px rgba(124,58,237,0.3)',height:36}}>
          <i className="bi-eye-fill" style={{fontSize:14}}></i>
          <span>Viewing as <strong>{effectiveUser.name}</strong></span>
          <span style={{opacity:0.5}}>·</span>
          <span style={{opacity:0.8,fontWeight:400,fontSize:12}}>{(liveMembersByEmail?.[String(impersonating).toLowerCase()]?.title || MEMBERS_BY_EMAIL[impersonating]?.title || '')} · {(liveMembersByEmail?.[String(impersonating).toLowerCase()]?.team || effectiveUser?.team || MEMBERS_BY_EMAIL[impersonating]?.team || '')}</span>
          <button onClick={()=>setImpersonating(null)} style={{marginLeft:8,padding:'4px 14px',borderRadius:128,border:'1px solid rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.15)',color:'white',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4,transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.25)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.15)'}>
            <i className="bi-box-arrow-left" style={{fontSize:11}}></i>Exit
          </button>
        </div>
      )}
      {impersonating && <style>{`.deel-topnav{top:36px!important;}`}</style>}
      <DeelTopNav
        view={view} setView={setView} user={effectiveUser} setUser={setUser}
        realUser={user}
        onSearch={()=>setShowSearch(true)} notifs={mergedNotifs} markAllRead={markAllRead} markRead={(serverId)=>serverNotifs.markRead(serverId)} markUnread={(serverId)=>serverNotifs.markUnread(serverId)} onNotifClick={handleNotifClick}
        notifSound={notifSound}
        onViewAllNotifications={()=>setView('notifications')}
        onLogout={handleLogout}
        onLoginAsAdmin={handleLoginAsAdmin}
        onCreateAnnouncement={()=>{setView('announcements');setAnnounceCompose(true);}}
        onCreateFeedback={()=>{setView('feedback');setFeedbackCompose(true);}}
        onSubmitFeedback={()=>{setView('feedback');setFeedbackPickerOpen(true);}}
        onCreateHrHub={()=>setHrHubCreate({initialFlow:null})}
        onCreateLeaderAlert={()=>setLeaderAlertCreate(true)}
        onCreateUrgentAssist={()=>setUrgentAssistCreate({kind:'urgent_assist'})}
        onCreateCaseMonitoring={()=>setUrgentAssistCreate({kind:'case_monitoring'})}
        onManageMentionGroups={()=>setMentionGroupsOpen(true)}
        leaderAlertsBadge={leaderAlertsBadge}
        urgentAssistBadge={urgentAssistBadge}
        hrHubBadge={hrHubBadge}
        setSelTask={()=>{}} tasks={tasks}
      />
      <div style={{height:(impersonating?104:68)+(versionHasUpdate?44:0),flexShrink:0}}/>
      <DeelSubNav view={view} subFilter={subFilter} setSubFilter={setSubFilter} tasks={tasks} user={effectiveUser}/>
      {returnToNotifications && view !== 'notifications' && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '8px 24px 0', background: 'var(--bg)', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setView('notifications'); setReturnToNotifications(false); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 128,
              background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
            }}
            aria-label="Back to Notifications"
          >
            <i className="bi-arrow-left" style={{ fontSize: 12 }} />
            Back to Notifications
          </button>
        </div>
      )}
      <div className="deel-content" data-region="main-content" aria-label="Main content" style={{display:'flex',overflowX:'hidden',overflowY:'auto',position:'relative',flex:1}}>
          {view==='briefing'      &&perms?.canView('briefing')!==false &&(perms?.raw?.dataScope==='all_tasks'||perms?.raw?.dataScope==='regional_tasks'||perms?.raw?.dataScope==='team_tasks') &&<div className="page-enter"><BriefingView user={effectiveUser} tasks={perms?.scopeTasks?.(tasksWithSlaExt,MEMBERS)||tasksWithSlaExt} setView={setView} setSelTask={()=>{}} comms={comms} escalations={[]} setSubFilter={setSubFilter} requests={[]} projects={[]} managerOnCall={managerOnCall} onChangeManagerOnCall={handleChangeManagerOnCall} teamLeadOnCall={teamLeadOnCall} onChangeTeamLeadOnCall={handleChangeTeamLeadOnCall} realUser={user} onImpersonate={handleImpersonate} impersonating={impersonating}/></div>}
          {view==='lead-home' &&<div className="page-enter"><TeamLeadHome user={effectiveUser} tasks={tasksWithSlaExt} setView={setView} managerOnCall={managerOnCall}/></div>}
          {view==='agent-home' &&<div className="page-enter"><AgentHome user={effectiveUser} tasks={tasksWithSlaExt} setView={setView} comms={comms}/></div>}
          {view==='my-queue'      &&perms?.canView('my-queue')!==false     &&<div className="page-enter"><Queue user={effectiveUser} tasks={tasksWithSlaExt} subFilter={subFilter}/></div>}
          {view==='announcements' &&perms?.canView('announcements')!==false&&<div className="page-enter"><AnnouncementsView user={effectiveUser} serverUserId={apiServerUserId} serverUserEmail={apiServerUserEmail} comms={comms} setComms={setComms} addToast={addToast} tasks={tasks} apiAcknowledge={apiAcknowledge} apiCreate={apiCreate} apiSend={apiSend} apiUpdate={apiUpdate} apiArchive={apiArchive} apiRemove={apiRemove} apiTogglePin={apiTogglePin} openCompose={announceCompose} onComposeOpened={()=>setAnnounceCompose(false)} apiUnarchive={apiUnarchive} apiComments={apiComments} apiSetComments={apiSetComments} apiLoadComments={apiLoadComments} apiAddComment={apiAddCommentFn} apiDeleteComment={apiDeleteCommentFn} apiLinks={apiLinks} apiLoadLinks={apiLoadLinks} apiLinkAnnouncement={apiLinkAnnouncementFn} apiUnlinkAnnouncement={apiUnlinkAnnouncementFn} apiReact={apiReactFn}/></div>}
          {view==='approval-queue' &&<div className="page-enter"><ApprovalQueueView user={effectiveUser} addToast={addToast}/></div>}
          {view==='settings'      &&perms?.canView('settings')!==false     &&<div className="page-enter"><SettingsView settings={settings} setSettings={setSettings} user={user} addToast={addToast} tasks={tasks} setTasks={setTasks} subFilter={subFilter} accessTypes={accessTypes} setAccessTypes={setAccessTypes} userAccessMap={userAccessMap} setUserAccessMap={setUserAccessMap} perms={perms}/></div>}
          {view==='slack'         &&perms?.canView('slack')!==false        &&<div className="page-enter"><Slack tasks={tasks.filter(t=>t.source==='slack')} setTasks={setTasks} onEscalMgr={()=>{}} addToast={addToast} user={effectiveUser}/></div>}
          {view==='alerts'        &&perms?.canView('alerts')!==false       &&<div className="page-enter"><Alerts tasks={perms?.scopeTasks?.(tasksWithSlaExt,MEMBERS)||tasksWithSlaExt} setTasks={setTasks}/></div>}
          {view==='feedback'      &&perms?.canView('feedback')!==false     &&<div className="page-enter"><FeedbackView user={effectiveUser} addToast={addToast} openCompose={feedbackCompose} onComposeOpened={()=>setFeedbackCompose(false)} openPicker={feedbackPickerOpen} onPickerOpened={()=>setFeedbackPickerOpen(false)}/></div>}
          {view==='hr-hub'        &&perms?.canView('hr-hub')!==false       &&<div className="page-enter"><HrHubView user={effectiveUser} onCreateHrHub={()=>setHrHubCreate({initialFlow:null})}/></div>}
          {view==='org'           &&perms?.canView('org')!==false          &&<div className="page-enter"><OrgView user={effectiveUser} realUser={user} onImpersonate={handleImpersonate}/></div>}
          {view==='notifications' &&<div className="page-enter"><NotificationsView notifs={mergedNotifs} unreadCount={mergedNotifs.filter(n=>!n.read).length} markAllRead={markAllRead} markRead={(serverId)=>serverNotifs.markRead(serverId)} markUnread={(serverId)=>serverNotifs.markUnread(serverId)} onNotifClick={handleNotifClick}/></div>}
          {view==='urgent-assist' &&perms?.canView('urgent-assist')!==false&&<div className="page-enter" key={urgentAssistRefreshNonce}><UrgentAssistView user={effectiveUser} onCreate={()=>setUrgentAssistCreate({kind:'urgent_assist'})} onCreateCaseMonitoring={()=>setUrgentAssistCreate({kind:'case_monitoring'})} managerOnCall={managerOnCall} onChangeManagerOnCall={handleChangeManagerOnCall} onOpenSchedule={() => setView('urgent-assist-schedule')}/></div>}
          {view==='urgent-assist-schedule' &&perms?.canView('urgent-assist-schedule')!==false&&<div className="page-enter"><UrgentAssistScheduleView/></div>}
          {/* Leaders Hub — wraps the alerts view + the team admin surface
              behind a single sub-toggle. Default sub-tab is alerts. The
              `=== true` strict gate complements the route-level fallback
              effect — agents whose perms.canView('leader-alerts')
              evaluates to undefined / null (e.g. mid-impersonation
              hand-off) get an empty render instead of leaking the view
              while perms re-hydrate (audit 2026-05-04 hardening). */}
          {view==='leader-alerts' && perms?.canView('leader-alerts') === true &&<div className="page-enter"><LeadersHubView user={effectiveUser} perms={perms} refreshNonce={leaderAlertsRefreshNonce} tasks={perms?.scopeTasks?.(tasksWithSlaExt,MEMBERS)||tasksWithSlaExt} setView={setView} realUser={user} onImpersonate={handleImpersonate} impersonating={impersonating}/></div>}
          {view==='ooo' && perms?.canView('ooo')!==false &&<div className="page-enter"><OOOView user={effectiveUser} setView={setView} addToast={addToast}/></div>}
          {/* Legacy direct route — keeps deep-links to ?view=team working
              by sending the user to Leaders Hub (which contains the Team
              sub-view). Avoids 404s on bookmarks/notifications from the
              pre-2026-05-03 nav. Same strict canView gate as Leaders Hub
              above; agents never get past this even via legacy URL. */}
          {view==='team'          && perms?.canView('team') === true       &&<div className="page-enter"><LeadersHubView user={effectiveUser} perms={perms} refreshNonce={leaderAlertsRefreshNonce} tasks={perms?.scopeTasks?.(tasksWithSlaExt,MEMBERS)||tasksWithSlaExt} setView={setView} realUser={user} onImpersonate={handleImpersonate} impersonating={impersonating}/></div>}
      </div>
      {createModal   &&<CreateTaskModal onConfirm={confirmCreate} onClose={()=>setCreateModal(false)} currentUser={effectiveUser}/>}
      {hrHubCreate   &&<CreateHrHubRequestModal initialFlow={hrHubCreate.initialFlow||null} onClose={()=>setHrHubCreate(null)} onCreated={(id,flow)=>{setHrHubCreate(null);setView('hr-hub');addToast?.({kind:'success',message:`Submitted to HR Hub${flow?` (${flow.replace('_',' ')})`:''}.`});}}/>}
      {mentionGroupsOpen&&<ManageMentionGroupsModal onClose={()=>setMentionGroupsOpen(false)}/>}
      {mocAlert && <MocAlertModal mocName={mocAlert.mocName} onDismiss={dismissMocAlert} onOpenView={openMocView} />}
      {tlocAlert && <TlocAlertModal tlocName={tlocAlert.tlocName} onDismiss={dismissTlocAlert} onOpenView={openTlocView} />}
      {leaderAlertCreate&&<CreateLeaderAlertModal onClose={()=>setLeaderAlertCreate(false)} onCreated={(alert)=>{setLeaderAlertCreate(false);setView('leader-alerts');setLeaderAlertsRefreshNonce(n=>n+1);addToast?.({kind:'success',message:`Posted${alert?.title?`: "${alert.title.slice(0,60)}${alert.title.length>60?'…':''}"`:' alert'}.`});}}/>}
      {urgentAssistCreate&&<CreateUrgentAssistModal currentUser={effectiveUser} initialKind={urgentAssistCreate.kind} onClose={()=>setUrgentAssistCreate(null)} onCreated={(row)=>{const isMon=urgentAssistCreate.kind==='case_monitoring';setUrgentAssistCreate(null);setView('urgent-assist');setUrgentAssistRefreshNonce(n=>n+1);addToast?.({kind:'success',message:`${isMon?'Case Monitoring':'Urgent Assist'} created${row?.subject?`: "${row.subject.slice(0,60)}${row.subject.length>60?'…':''}"`:''}.`});}}/>}
      {projectModal  &&<CreateProjectModal onConfirm={confirmProject} onClose={()=>setProjectModal(null)} project={typeof projectModal==='object'?projectModal:null} currentUser={effectiveUser}/>}
      {requestModal  &&<CreateRequestModal onConfirm={confirmRequest} onClose={()=>setRequestModal(false)} currentUser={effectiveUser} tasks={perms?.scopeTasks?.(tasks,MEMBERS)||tasks}/>}
      {createEscalModal&&<CreateEscalationModal onConfirm={confirmManualEscal} onClose={()=>setCreateEscalModal(false)} currentUser={effectiveUser} tasks={perms?.scopeTasks?.(tasks,MEMBERS)||tasks}/>}
      {showSearch    &&<GlobalSearch tasks={perms?.scopeTasks?.(tasks,MEMBERS)||tasks} setView={setView} setSelTask={()=>{}} onClose={()=>setShowSearch(false)}/>}
      {showOnboard   &&<Onboarding onDismiss={(dontShow)=>{setShowOnboard(false);if(dontShow){try{localStorage.setItem('ops_hub_onboarded','1');}catch(e){}}}}/>}
      {/* What's-new tour — only renders once Onboarding is dismissed so
          we never stack two modals. The tour itself writes its seen-flag
          on finish/skip so it never re-prompts. */}
      {!showOnboard && showWhatsNew &&<WhatsNewTour onDismiss={()=>setShowWhatsNew(false)}/>}
      {/* Manager-only tour — chains after WhatsNewTour and the welcome
          Onboarding so we never stack dialogs. Gated on `perms.dataScope`
          (anything other than 'own_tasks_only' is a TL/RM/Admin); agents
          never see it. */}
      {!showOnboard && !showWhatsNew && showMgrTour && perms?.dataScope && perms.dataScope !== 'own_tasks_only' &&<ManagerTour onDismiss={()=>setShowMgrTour(false)}/>}
      {popupQueue.length>0&&<AnnouncementPopup key={popupQueue[0].id} comm={popupQueue[0]} onAcknowledge={handlePopupAcknowledge} onSnooze={handlePopupSnooze}/>}
      <Toasts toasts={toasts} dismiss={dismissToast}/>
    </div>
    </SettingsContext.Provider>
    </IntegrationsContext.Provider>
    </PermissionsContext.Provider>
    </ErrorBoundary>
  );
};

// Top-level wrapper — keeps the approval-queue hook's polling timer & state
// shared across every view that mounts a consumer. Previously each of App,
// AnnouncementsView and ApprovalQueueView instantiated the hook independently,
// triggering 3x polling and noticeable lag after an approve/reject action
// while the other views re-fetched. One provider = one source of truth.
const AppRoot = () => (
  <AnnouncementRequestsProvider>
    <App />
  </AnnouncementRequestsProvider>
);

export default AppRoot;
