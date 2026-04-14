import React, { useState, useEffect, useRef, useCallback, createContext } from 'react';

import { TOOLS, STATUSES, FUNCTIONS, FLAGS } from './data/constants';
import { INITIAL_PROJECTS } from './data/projects';
import { INITIAL_REQUESTS } from './data/requests';
import { MEMBERS, MEMBERS_BY_EMAIL, DEFAULT_USER_ACCESS_MAP, TEAM_MEMBERS, getAllReports } from './data/members';
import { INITIAL_ACTIVITY, INITIAL_NOTES } from './data/tasks';
import { FEED_EVENTS } from './data/feed';
import { ALL_AGENT_IDS } from './data/comms';
import { useAnnouncements } from './hooks/useAnnouncements';
import { useQueueSync } from './hooks/useQueueSync';
import { DEFAULT_SETTINGS } from './data/settings';
import { DEFAULT_ACCESS_TYPES } from './data/accessControl';
import { ADMIN_LIST_VERSION } from './data/adminEmails';
import { usePermissions } from './hooks/usePermissions';
import { slaInfo } from './utils/helpers';
import { useIntegrations } from './hooks/useIntegrations';
import { useDeelData } from './hooks/useDeelData';
import { useJiraData } from './hooks/useJiraData';
import { useSlackData } from './hooks/useSlackData';

// ── API services + normalizers ──────────────────────────────────────────────
import { login as apiLogin, fetchMe as apiFetchMe } from './services/authApi';
import { fetchTasks as apiFetchTasks, createTask as apiCreateTask, updateTaskStatus as apiUpdateStatus, assignTask as apiAssignTask, escalateTask as apiEscalateTask, snoozeTask as apiSnoozeTask } from './services/tasksApi';
import { fetchMembers as apiFetchMembers } from './services/membersApi';
import { fetchEscalations as apiFetchEscalations, createEscalation as apiCreateEscalation, respondToEscalation as apiRespondEscalation, resolveEscalation as apiResolveEscalation } from './services/escalationsApi';
import { fetchProjects as apiFetchProjects, createProject as apiCreateProject, updateProject as apiUpdateProject } from './services/projectsApi';
import { fetchRequests as apiFetchRequests, createRequest as apiCreateRequest, updateRequest as apiUpdateRequest } from './services/requestsApi';
import { createNote as apiCreateNote } from './services/notesApi';
import { reassignQueueTicket } from './services/integrationsApi';
import { normalizeTask, normalizeEscalation, normalizeProject, normalizeRequest, normalizeMember, denormalizeTaskForCreate, feStatusToBe } from './services/normalize';

import DeelTopNav from './components/nav/DeelTopNav';
import DeelSubNav from './components/nav/DeelSubNav';
import BriefingView from './components/views/BriefingView';
import Queue from './components/queue/Queue';
import Team from './components/views/Team';
import Analytics from './components/views/Analytics';
import EscalationsView from './components/views/EscalationsView';
import AnnouncementsView from './components/views/AnnouncementsView';
import CalendarView from './components/views/CalendarView';
import KnowledgeHub from './components/views/KnowledgeHub';
import GMReportingView from './components/views/GMReportingView';
import SettingsView from './components/views/SettingsView';
import ProjectsView from './components/views/ProjectsView';
import CreateProjectModal from './components/modals/CreateProjectModal';
import CreateRequestModal from './components/modals/CreateRequestModal';
import CreateEscalationModal from './components/modals/CreateEscalationModal';
import EscalModal from './components/modals/EscalModal';
import ReassignModal from './components/modals/ReassignModal';
import SnoozeModal from './components/modals/SnoozeModal';
import CreateTaskModal from './components/modals/CreateTaskModal';
import GlobalSearch from './components/modals/GlobalSearch';
import Onboarding from './components/modals/Onboarding';
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
    // Restore user from stored email — check MEMBERS first, then JWT token
    if(loggedInEmail){
      const m=MEMBERS.find(mm=>mm.email===loggedInEmail);
      if(m) return m;
      // User not in hardcoded MEMBERS but has a stored session — create placeholder
      // Session revalidation useEffect will replace this with server data
      const token = typeof window !== 'undefined' ? localStorage.getItem('ops_hub_token') : null;
      if(token){
        try{
          const payload = JSON.parse(atob(token.split('.')[1]));
          return { id: payload.sub||0, email: payload.email||loggedInEmail, name: payload.name||loggedInEmail.split('@')[0], role: payload.role||'member', team:'JTK', initials:(payload.name||loggedInEmail.split('@')[0]).split(' ').map(w=>w[0]?.toUpperCase()).slice(0,2).join('') };
        }catch(e){}
      }
    }
    return null;
  });
  // ── Impersonation — TLs/RMs/Admin can "login as" their reports ──────────
  const [impersonating, setImpersonating] = useState(null);
  const effectiveUser = React.useMemo(() => {
    if (!impersonating || !user) return user;
    return MEMBERS.find(mm => mm.email === impersonating) || user;
  }, [impersonating, user]);
  const [view,setView]=useState('briefing');
  const [selTask,setSelTask]=useState(null);
  // ── Live queue sync (Zendesk + Jira) ─────────────────────────────────────
  const queueSync = useQueueSync(!!user);
  const tasks = queueSync.tasks;
  const setTasks = queueSync.setTasks;
  const [feed,setFeed]=useState(FEED_EVENTS);
  const [notes,setNotes]=useState(INITIAL_NOTES);
  const [escalations,setEscalations]=useState([
    {id:'ESC-SEED-001',task:null,taskId:null,reason:'Agent unable to process visa documentation update due to missing Deel Admin permissions',subject:'Visa doc update — missing permissions',escalatedBy:'Sarah Chen',escalatedAt:'09:15',managerId:3,managerName:'Omar Khalil',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'slack',slackChannel:'#escalations',slackUser:'@sarah.chen',slackMessageUrl:null},
    {id:'ESC-SEED-002',task:null,taskId:null,reason:'Client reporting incorrect salary calculation for March payroll — urgent correction needed before end of day',subject:'Payroll discrepancy — March salary',escalatedBy:'James Okafor',escalatedAt:'11:42',managerId:3,managerName:'Omar Khalil',status:'resolved',managerResponseStatus:'responded',managerResponse:'Payroll team notified, correction processing.',managerRespondedAt:'12:10',managerRespondedBy:'Omar Khalil',escalationSource:'slack',slackChannel:'#hr-urgent',slackUser:'@james.okafor',slackMessageUrl:null},
    {id:'ESC-SEED-003',task:null,taskId:null,reason:'Worker contract termination requires legal sign-off but legal team unresponsive for 48h',subject:'Contract termination — legal sign-off',escalatedBy:'Priya Nair',escalatedAt:'14:05',managerId:3,managerName:'Omar Khalil',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'manual',slackChannel:null,slackUser:null,slackMessageUrl:null},
  ]);
  const { comms, setComms, acknowledge: apiAcknowledge, create: apiCreate, send: apiSend, update: apiUpdate, archive: apiArchive, remove: apiRemove, togglePin: apiTogglePin, isOnline: apiOnline, unarchive: apiUnarchive, comments: apiComments, setComments: apiSetComments, loadComments: apiLoadComments, addComment: apiAddCommentFn, deleteComment: apiDeleteCommentFn, links: apiLinks, loadLinks: apiLoadLinks, linkAnnouncement: apiLinkAnnouncementFn, unlinkAnnouncement: apiUnlinkAnnouncementFn, react: apiReactFn } = useAnnouncements();
  const [dismissedPopups,setDismissedPopups]=useState(()=>{try{const d=localStorage.getItem('ops_hub_dismissed_popups');return d?JSON.parse(d):[];}catch(e){return[];}});
  const [settings,setSettings]=useState(()=>{try{const s=localStorage.getItem('ops_hub_settings');return s?{...DEFAULT_SETTINGS,...JSON.parse(s)}:DEFAULT_SETTINGS;}catch(e){return DEFAULT_SETTINGS;}});
  const [accessTypes,setAccessTypes]=useState(()=>{try{const s=localStorage.getItem('ops_hub_access_types');return s?JSON.parse(s):DEFAULT_ACCESS_TYPES;}catch(e){return DEFAULT_ACCESS_TYPES;}});
  const [userAccessMap,setUserAccessMap]=useState(()=>{try{const ver=localStorage.getItem('ops_hub_uam_ver');if(ver!==ADMIN_LIST_VERSION){localStorage.removeItem('ops_hub_user_access_map');localStorage.setItem('ops_hub_uam_ver',ADMIN_LIST_VERSION);return{...DEFAULT_USER_ACCESS_MAP};}const s=localStorage.getItem('ops_hub_user_access_map');return s?JSON.parse(s):{...DEFAULT_USER_ACCESS_MAP};}catch(e){return DEFAULT_USER_ACCESS_MAP;}});
  // ── Session revalidation on page load ─────────────────────────────────────
  useEffect(() => {
    if (!loggedInEmail) return;
    const token = localStorage.getItem('ops_hub_token');
    if (!token) {
      // No token but have stored email — clear stale session
      setUser(null);
      setLoggedInEmail(null);
      return;
    }
    // Validate session with backend
    apiFetchMe()
      .then((serverUser) => {
        if (serverUser?.email) {
          const member = MEMBERS.find(m => m.email === serverUser.email) || serverUser;
          setUser(member);
        }
      })
      .catch((err) => {
        if (err?.status === 401) {
          // Token expired or invalid — log out
          setUser(null);
          setLoggedInEmail(null);
          try { localStorage.removeItem('ops_hub_logged_in_email'); localStorage.removeItem('ops_hub_token'); } catch(e) {}
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login / Logout handlers ────────────────────────────────────────────────
  const handleLogin = useCallback(async (email, remember) => {
    // Backend authentication required — no local fallback
    const res = await apiLogin(email);
    if (!res?.token) {
      throw new Error('Authentication failed');
    }
    localStorage.setItem('ops_hub_token', res.token);
    const userEmail = res.user?.email || email;
    const member = MEMBERS.find(m => m.email === userEmail) || res.user;
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
    try { localStorage.removeItem('ops_hub_logged_in_email'); localStorage.removeItem('ops_hub_token'); } catch(e) {}
  }, []);

  // ── Impersonation handler ──────────────────────────────────────────────────
  const handleImpersonate = useCallback((email) => {
    if (!email) { setImpersonating(null); return; }
    if (!user) return;
    const me = MEMBERS_BY_EMAIL[user.email];
    if (!me || me.access === 'agent') return; // agents can't impersonate
    if (me.access === 'admin') { if (!MEMBERS_BY_EMAIL[email]) return; setImpersonating(email); setView('briefing'); return; }
    // TL/RM: verify target is in their reports chain
    const myReports = getAllReports(user.email);
    if (myReports.includes(email)) { setImpersonating(email); setView('briefing'); }
  }, [user]);

  const [announceCompose,setAnnounceCompose]=useState(false);
  const [escalModal,setEscalModal]=useState(null);
  const [toasts,setToasts]=useState([]);
  const [showSearch,setShowSearch]=useState(false);
  const [showOnboard,setShowOnboard]=useState(()=>{ try{ return !localStorage.getItem('ops_hub_onboarded'); }catch(e){ return true; } });
  // Onboard overlay shows once; dismissible with Escape or click
  const [sidebarOpen,setSidebarOpen]=useState(true);
  const [subFilter,setSubFilter]=useState(null);
  // queueCountry/queueSlaPriority removed — Queue manages its own filters
  const [reassignModal,setReassignModal]=useState(null);
  const [snoozeModal,setSnoozeModal]=useState(null);
  const [bulkIds,setBulkIds]=useState(null);
  const [createModal,setCreateModal]=useState(false);
  const [notifs,setNotifs]=useState([]);
  const [activity,setActivity]=useState(INITIAL_ACTIVITY);
  const [projects,setProjects]=useState(INITIAL_PROJECTS);
  const [projectModal,setProjectModal]=useState(null);
  const [requests,setRequests]=useState(INITIAL_REQUESTS);
  const [requestModal,setRequestModal]=useState(false);
  const [createEscalModal,setCreateEscalModal]=useState(false);
  const [queueMode,setQueueMode]=useState('inbound');
  // fAtRisk/fBreaching removed — Queue uses fSla dropdown internally
  const [fUnassigned,setFUnassigned]=useState(false);
  const [backendOnline,setBackendOnline]=useState(false);
  const [managerOnCall, setManagerOnCall] = useState(() => {
    try { const m = localStorage.getItem('ops_hub_manager_on_call'); return m ? JSON.parse(m) : { name: 'Omar Khalil', initials: 'OK', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Omar%20Khalil&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40' }; } catch(e) { return { name: 'Omar Khalil', initials: 'OK', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Omar%20Khalil&backgroundColor=6b3fa0&textColor=ffffff&fontSize=40' }; }
  });
  const [createReportModal, setCreateReportModal] = useState(false);

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
        if(projRes?.items) setProjects(projRes.items.map(normalizeProject).filter(Boolean));
        if(reqRes?.items) setRequests(reqRes.items.map(normalizeRequest).filter(Boolean));
      }catch(e){
        // Backend unreachable — keep using local data
        if(!cancelled) setBackendOnline(false);
      }
    })();
    return()=>{cancelled=true;};
  },[user]);

  // ── Notification helpers ───────────────────────────────────────────────────
  const addNotif=useCallback((type,title,body)=>{
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    setNotifs(prev=>[{id:Date.now()+(Math.random()*10|0),type,title,body,time:now,read:false},...prev.slice(0,49)]);
  },[]);
  const markAllRead=useCallback(()=>setNotifs(prev=>prev.map(n=>({...n,read:true}))),[]);

  const perms = usePermissions(effectiveUser, accessTypes, userAccessMap);

  // ── Live integrations (Deel, Jira, Slack) ─────────────────────────────────
  const integrations = useIntegrations();
  const deelData = useDeelData(integrations.isConfigured('deel'));
  const jiraData = useJiraData(integrations.isConfigured('jira'));
  const slackData = useSlackData(integrations.isConfigured('slack'));
  const integrationsCtx = { integrations, deelData, jiraData, slackData, queueSync };

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast=useCallback((type,title,body,onUndo)=>{
    const id=Date.now();
    setToasts(prev=>[...prev.slice(-4),{id,type,title,body,onUndo}].slice(-5));
    setTimeout(()=>setToasts(prev=>prev.filter(t=>t.id!==id)),4800);
    addNotif(type,title,body);
  },[addNotif]);
  const dismissToast=useCallback(id=>setToasts(prev=>prev.filter(t=>t.id!==id)),[]);

  // ── Escalation handlers ────────────────────────────────────────────────────
  const openEscalModal=useCallback(task=>{
    if(!perms?.canDo('can_escalate')){addToast('error','Access Denied','You do not have permission to escalate');return;}
    setEscalModal(task);
  },[perms,addToast]);
  const confirmEscal=useCallback((task,reason,mgrId)=>{
    const mgr=mgrId?MEMBERS.find(m=>m.id===mgrId):null;
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    if(bulkIds&&bulkIds.length>0){
      const newEscals=bulkIds.map(id=>{const t=tasks.find(tt=>tt.id===id);return t?{id:`ESC-${Date.now()}-${id}`,task:t,taskId:id,reason,escalatedBy:user.name,escalatedAt:now,managerId:mgr?.id||null,managerName:mgr?.name||'Team Lead',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'ticket',slackChannel:null,slackUser:null,slackMessageUrl:null}:null;}).filter(Boolean);
      setEscalations(prev=>[...newEscals,...prev]);
      const idSet=new Set(bulkIds);
      setTasks(prev=>prev.map(t=>idSet.has(t.id)?{...t,status:'in_progress'}:t));
      addToast('escalation','Bulk Escalation',`${bulkIds.length} tasks → ${mgr?.name||'Team Lead'}`);
    } else {
      setEscalations(prev=>[{id:`ESC-${Date.now()}-${task.id}`,task,taskId:task.id,reason,escalatedBy:user.name,escalatedAt:now,managerId:mgr?.id||null,managerName:mgr?.name||'Team Lead',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'ticket',slackChannel:null,slackUser:null,slackMessageUrl:null},...prev]);
      setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'in_progress'}:t));
      addToast('escalation','Escalated to Manager',`${mgr?.name||'Team Lead'} · ${task.id}`);
      // BE sync
      apiCreateEscalation({taskId:task._beId||task.id,subject:task.subject,reason,managerId:mgrId?String(mgrId):undefined}).catch(()=>{});
      apiUpdateStatus(task._beId||task.id,'escalated').catch(()=>{});
    }
    setEscalModal(null);
    setBulkIds(null);
  },[user,addToast,perms,bulkIds,tasks]);

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
    },...prev]);
    setCreateEscalModal(false);
    addToast('escalation','Escalation Created',form.subject.slice(0,50));
    // BE sync
    apiCreateEscalation({taskId:form.taskId||undefined,subject:form.subject,reason:form.reason,managerId:form.managerId?String(form.managerId):undefined}).catch(()=>{});
  },[user,addToast,perms]);

  // ── Reassign handler (email-based — pushes to Zendesk/Jira) ────────────────
  const confirmReassign=useCallback((task,newEmail,note)=>{
    if(!perms?.canDo('can_reassign'))return;
    const member=MEMBERS_BY_EMAIL[newEmail];
    const newName=member?.name||newEmail;
    const newMemberId=member?MEMBERS.findIndex(m=>m.email===newEmail)+1:null;
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    if(bulkIds&&bulkIds.length>0){
      const idSet=new Set(bulkIds);
      setTasks(prev=>prev.map(t=>idSet.has(t.id)?{...t,assigneeId:newMemberId,assigneeEmail:newEmail,assigneeName:newName}:t));
      setActivity(prev=>{const next={...prev};bulkIds.forEach(id=>{next[id]=[...(next[id]||[]),{type:'assigned',text:`Bulk reassigned to ${newName}${note?` — ${note}`:''}`,user:user.name,time:now}];});return next;});
      addToast('success','Bulk Reassign',`${bulkIds.length} tasks → ${newName.split(' ')[0]}`);
      // Push each ticket to Zendesk/Jira in background
      bulkIds.forEach(id=>{
        reassignQueueTicket(id,newEmail).catch(err=>console.warn(`[reassign] ${id} failed:`,err.message));
      });
    } else {
      setTasks(prev=>prev.map(t=>t.id===task.id?{...t,assigneeId:newMemberId,assigneeEmail:newEmail,assigneeName:newName}:t));
      setActivity(prev=>({...prev,[task.id]:[...(prev[task.id]||[]),{type:'assigned',text:`Reassigned to ${newName}${note?` — ${note}`:''}`,user:user.name,time:now}]}));
      addToast('success','Task Reassigned',`→ ${newName.split(' ')[0]} · ${task.id}`);
      // Push to Zendesk/Jira (real reassignment)
      reassignQueueTicket(task.id,newEmail).catch(err=>{
        console.warn('[reassign] Push to source failed:',err.message);
        addToast('warning','Sync Warning',`Local reassign ok, but source system update failed for ${task.id}`);
      });
      // Legacy BE sync
      apiAssignTask(task._beId||task.id,String(newMemberId||'')).catch(()=>{});
    }
    setReassignModal(null);
    setBulkIds(null);
  },[addToast,user,perms,bulkIds]);

  // ── SLA real-time ticking — increment minutesAgo every 60s ────────────────
  useEffect(()=>{
    const iv=setInterval(()=>{
      setTasks(prev=>prev.map(t=>{
        if(t.status==='resolved'||t.status==='waiting')return t;
        return {...t, minutesAgo:t.minutesAgo+1, updatedMinsAgo:t.updatedMinsAgo+1};
      }));
    },60000);
    return()=>clearInterval(iv);
  },[]);

  // ── Snooze handler (gated by can_snooze_task) ─────────────────────────────
  const confirmSnooze=useCallback((task,duration)=>{
    if(!perms?.canDo('can_snooze_task'))return;
    const labels={'30m':'30 min','1h':'1 hour','2h':'2 hours','eod':'end of day','tmr':'tomorrow 9 AM'};
    const durations={'30m':30,'1h':60,'2h':120,'eod':null,'tmr':null};
    const label=labels[duration]||duration;
    const mins=durations[duration];
    let snoozedUntil;
    if(duration==='eod'){
      const eod=new Date();eod.setHours(17,0,0,0);
      if(eod<=new Date())eod.setDate(eod.getDate()+1);
      snoozedUntil=eod.getTime();
    } else if(duration==='tmr'){
      const tmr=new Date();tmr.setDate(tmr.getDate()+1);tmr.setHours(9,0,0,0);
      snoozedUntil=tmr.getTime();
    } else if(mins){
      snoozedUntil=Date.now()+mins*60000;
    } else {
      snoozedUntil=Date.now()+60*60000;
    }
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    if(bulkIds&&bulkIds.length>0){
      const idSet=new Set(bulkIds);
      setTasks(prev=>prev.map(t=>{
        if(!idSet.has(t.id))return t;
        const prevStatus=t.status==='waiting'?t.prevStatus||'new':t.status;
        return {...t,status:'waiting',snoozeLabel:label,snoozedUntil,prevStatus};
      }));
      setActivity(prev=>{const next={...prev};bulkIds.forEach(id=>{next[id]=[...(next[id]||[]),{type:'status',text:`Bulk snoozed until ${label}`,user:user.name,time:now}];});return next;});
      addToast('info','Bulk Snooze',`${bulkIds.length} tasks · until ${label}`);
    } else {
      const prevStatus=task.status==='waiting'?task.prevStatus||'new':task.status;
      setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'waiting',snoozeLabel:label,snoozedUntil,prevStatus}:t));
      setActivity(prev=>({...prev,[task.id]:[...(prev[task.id]||[]),{type:'status',text:`Snoozed until ${label}`,user:user.name,time:now}]}));
      addToast('info','Task Snoozed',`${task.id} · until ${label}`);
      // BE sync
      apiSnoozeTask(task._beId||task.id,new Date(snoozedUntil).toISOString()).catch(()=>{});
    }
    setSnoozeModal(null);
    setBulkIds(null);
  },[addToast,user,perms,bulkIds]);

  // ── Auto-unsnooze — check every 30s for expired snoozes ─────────────────
  useEffect(()=>{
    const iv=setInterval(()=>{
      const now=Date.now();
      setTasks(prev=>{
        let changed=false;
        const next=prev.map(t=>{
          if(t.status==='waiting'&&t.snoozedUntil&&t.snoozedUntil<=now){
            changed=true;
            return {...t, status:t.prevStatus||'new', snoozeLabel:null, snoozedUntil:null, prevStatus:null};
          }
          return t;
        });
        return changed?next:prev;
      });
    },30000);
    return()=>clearInterval(iv);
  },[]);

  // ── Bulk escalate handler (gated by can_bulk_action) ──────────────────────
  const bulkEscalateHandler=useCallback((ids)=>{
    if(!perms?.canDo('can_bulk_action'))return;
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    ids.forEach(taskId=>{
      const task=tasks.find(t=>t.id===taskId);
      if(!task)return;
      const asgn=MEMBERS.find(m=>m.id===task.assigneeId);
      const mgr=MEMBERS.find(m=>m.id===asgn?.lead);
      setEscalations(prev=>[{id:`ESC-${Date.now()}-${taskId}`,task,taskId,reason:'Bulk escalation',escalatedBy:user.name,escalatedAt:now,managerId:mgr?.id??null,managerName:mgr?.name||'Team Lead',status:'pending',managerResponseStatus:'pending_response',managerResponse:null,managerRespondedAt:null,managerRespondedBy:null,escalationSource:'ticket',slackChannel:null,slackUser:null,slackMessageUrl:null},...prev]);
    });
    addToast('escalation','Bulk Escalation',`${ids.length} task${ids.length>1?'s':''} escalated to managers`);
  },[tasks,user,addToast,perms]);

  // ── Create task handler (gated by can_create_task) ────────────────────────
  const confirmCreate=useCallback((form)=>{
    if(!perms?.canDo('can_create_task'))return;
    const now=new Date();
    const t=`${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
    const pfx={zendesk:'ZD',jira:'JR',gmail:'GM',workbench:'WB',calendar:'CAL',looker:'LK'};
    // Use base36 suffix for unique IDs
    const newId=`${pfx[form.source]||'MN'}-${(now.getTime()+Math.floor(Math.random()*999)).toString(36).slice(-4).toUpperCase()}`;
    const agentName=MEMBERS.find(m=>m.id===form.assigneeId)?.name;
    setTasks(prev=>[{id:newId,source:form.source,subject:form.subject,body:form.body||'',assigneeId:form.assigneeId,country:form.country,receivedAt:t,minutesAgo:0,updatedMinsAgo:0,status:'new',type:form.type,isAlert:false,suggestedReply:''},...prev]);
    setActivity(prev=>({...prev,[newId]:[{type:'created',text:'Task created manually',user:user.name,time:t},{type:'assigned',text:`Assigned to ${agentName}`,user:user.name,time:t}]}));
    setCreateModal(false);
    addToast('success','Task Created',`${newId} → ${agentName?.split(' ')[0]}`);
    // BE sync
    apiCreateTask(denormalizeTaskForCreate({...form,id:newId})).catch(()=>{});
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
      apiUpdateProject(projectModal.id,{title:form.name,priority:form.priority,description:form.description}).catch(()=>{});
    } else {
      apiCreateProject({title:form.name,priority:form.priority||'medium',description:form.description}).catch(()=>{});
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
    apiCreateRequest({subject:form.subject,description:form.description,toTeam:form.toTeam,priority:form.priority,taskId:form.linkedTaskId||undefined}).catch(()=>{});
  },[requests.length,addToast,perms]);

  // ── Global keyboard shortcuts (⌘K for search) ─────────────────────────────
  useEffect(()=>{
    const h=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setShowSearch(s=>!s);}
      if(e.key==='Escape'&&!escalModal&&!reassignModal&&!snoozeModal&&!createModal){setShowSearch(false);}
    };
    document.addEventListener('keydown',h);
    return()=>document.removeEventListener('keydown',h);
  },[escalModal,reassignModal,snoozeModal,createModal]);

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
  useEffect(() => { try { localStorage.setItem('ops_hub_manager_on_call', JSON.stringify(managerOnCall)); } catch(e) {} }, [managerOnCall]);

  // ── Popup queue — derived from comms, minus dismissed ones ──────────────
  const popupQueue=React.useMemo(()=>{
    if(!user)return [];
    const targetMatch=(c)=>{
      if(c.target==='all')return true;
      if(c.target===user.team)return true;
      if(Array.isArray(c.target)&&c.target.includes(user.id))return true;
      return false;
    };
    return comms.filter(c=>
      c.isPopup&&c.status==='sent'&&targetMatch(c)&&!c.acks.includes(user.id)&&!dismissedPopups.includes(c.id)&&!(c.author&&c.author.id===user.id)
    );
  },[comms,user,dismissedPopups]);

  const handlePopupAcknowledge=useCallback((commId)=>{
    // Immediately dismiss from popup queue + acknowledge in state/API
    setDismissedPopups(prev=>[...prev,commId]);
    apiAcknowledge(commId, user.id);
  },[user, apiAcknowledge]);

  useEffect(()=>{setSubFilter(null);},[view]);

  // ── View permission guard — redirect to first allowed view ──────────────
  useEffect(()=>{
    if(!perms)return;
    if(view&&!perms.canView(view)){
      // Find first allowed view
      const fallback=['briefing','my-queue','calendar','projects','escalations','hr-reports','knowledge-hub','analytics','announcements','slack','team','settings'].find(v=>perms.canView(v));
      setView(fallback||'briefing');
    }
  },[view,perms]);

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

  const pendingEscal=escalations.filter(e=>e.status==='pending').length;
  // Always derive the LIVE task from tasks[] to avoid stale state in Detail
  const liveSelTask=React.useMemo(()=>selTask?tasks.find(t=>t.id===selTask.id)||null:null,[selTask,tasks]);

  // ── If not logged in, show login screen ────────────────────────────────────
  if(!user) return(
    <LoginScreen
      onLogin={handleLogin}
    />
  );

  return(
    <PermissionsContext.Provider value={perms}>
    <IntegrationsContext.Provider value={integrationsCtx}>
    <SettingsContext.Provider value={settings}>
    <div style={{minHeight:'100vh',background:'var(--bg)',color:'var(--text)',display:'flex',flexDirection:'column'}} role="application" aria-label="Ops Hub Dashboard">
      {impersonating && effectiveUser && (
        <div style={{position:'fixed',top:0,left:0,right:0,zIndex:101,background:'linear-gradient(90deg,#7c3aed,#6d28d9)',color:'white',padding:'8px 24px',display:'flex',alignItems:'center',justifyContent:'center',gap:12,fontSize:13,fontWeight:600,boxShadow:'0 2px 8px rgba(124,58,237,0.3)',height:36}}>
          <i className="bi-eye-fill" style={{fontSize:14}}></i>
          <span>Viewing as <strong>{effectiveUser.name}</strong></span>
          <span style={{opacity:0.5}}>·</span>
          <span style={{opacity:0.8,fontWeight:400,fontSize:12}}>{MEMBERS_BY_EMAIL[impersonating]?.title || ''} · {MEMBERS_BY_EMAIL[impersonating]?.team || ''}</span>
          <button onClick={()=>setImpersonating(null)} style={{marginLeft:8,padding:'4px 14px',borderRadius:128,border:'1px solid rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.15)',color:'white',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4,transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.25)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.15)'}>
            <i className="bi-box-arrow-left" style={{fontSize:11}}></i>Exit
          </button>
        </div>
      )}
      {impersonating && <style>{`.deel-topnav{top:36px!important;}`}</style>}
      <DeelTopNav
        view={view} setView={setView} user={effectiveUser} setUser={setUser}
        onSearch={()=>setShowSearch(true)} notifs={notifs} markAllRead={markAllRead}
        escalCount={pendingEscal||0} onLogout={handleLogout}
        onCreateTask={()=>setCreateModal(true)}
        onCreateEscalation={()=>setCreateEscalModal(true)}
        onCreateProject={()=>setProjectModal('create')}
        onCreateAnnouncement={()=>{setView('announcements');setAnnounceCompose(true);}}
        onCreateRequest={()=>setRequestModal(true)}
        onCreateReport={()=>{setView('hr-reports');setCreateReportModal(true);}}
        setSelTask={setSelTask} tasks={tasks}
        managerOnCall={managerOnCall} onChangeManagerOnCall={setManagerOnCall}
      />
      <div style={{height:impersonating?104:68,flexShrink:0}}/>
      <DeelSubNav view={view} subFilter={subFilter} setSubFilter={setSubFilter} tasks={tasks} user={effectiveUser}/>
      <div className="deel-content" data-region="main-content" aria-label="Main content" style={{display:'flex',overflowX:'hidden',overflowY:'auto',position:'relative',flex:1}}>
          {view==='briefing'      &&perms?.canView('briefing')!==false     &&<div className="page-enter"><BriefingView user={effectiveUser} tasks={tasks} setView={setView} setSelTask={setSelTask} comms={comms} escalations={escalations} setSubFilter={setSubFilter}/></div>}
          {view==='my-queue'      &&perms?.canView('my-queue')!==false     &&<div className="page-enter"><Queue user={effectiveUser} tasks={tasks} setTasks={setTasks} selTask={liveSelTask} setSelTask={setSelTask} notes={notes} setNotes={setNotes} activity={activity} setActivity={setActivity} addToast={addToast} onEscalMgr={openEscalModal} onReassign={setReassignModal} onSnooze={setSnoozeModal} onCreateTask={()=>setCreateModal(true)} onBulkAction={(ids,action)=>{setBulkIds(ids);if(action==='reassign'){setReassignModal(tasks.find(t=>t.id===ids[0])||{id:'bulk'});}else if(action==='snooze'){setSnoozeModal(tasks.find(t=>t.id===ids[0])||{id:'bulk'});}else if(action==='escalate'){setEscalModal(tasks.find(t=>t.id===ids[0])||{id:'bulk'});}}} subFilter={subFilter} escalations={escalations} requests={requests} setRequests={setRequests} onNewRequest={()=>setRequestModal(true)} queueMode={queueMode} setQueueMode={setQueueMode} fUnassigned={fUnassigned} setFUnassigned={setFUnassigned}/></div>}
          {view==='team'          &&perms?.canView('team')!==false         &&<div className="page-enter"><Team user={effectiveUser} tasks={tasks} setTask={setSelTask} setView={setView} realUser={user} onImpersonate={handleImpersonate} impersonating={impersonating}/></div>}
          {view==='analytics'     &&perms?.canView('analytics')!==false    &&<div className="page-enter"><Analytics tasks={tasks} currentUser={effectiveUser} subFilter={subFilter} escalations={escalations}/></div>}
          {view==='escalations'   &&perms?.canView('escalations')!==false  &&<div className="page-enter"><EscalationsView escalations={escalations} setEscalations={setEscalations} currentUser={effectiveUser} onNewEscalation={()=>setCreateEscalModal(true)}/></div>}
          {view==='announcements' &&perms?.canView('announcements')!==false&&<div className="page-enter"><AnnouncementsView user={effectiveUser} comms={comms} setComms={setComms} addToast={addToast} tasks={tasks} apiAcknowledge={apiAcknowledge} apiCreate={apiCreate} apiSend={apiSend} apiUpdate={apiUpdate} apiArchive={apiArchive} apiRemove={apiRemove} apiTogglePin={apiTogglePin} openCompose={announceCompose} onComposeOpened={()=>setAnnounceCompose(false)} apiUnarchive={apiUnarchive} apiComments={apiComments} apiSetComments={apiSetComments} apiLoadComments={apiLoadComments} apiAddComment={apiAddCommentFn} apiDeleteComment={apiDeleteCommentFn} apiLinks={apiLinks} apiLoadLinks={apiLoadLinks} apiLinkAnnouncement={apiLinkAnnouncementFn} apiUnlinkAnnouncement={apiUnlinkAnnouncementFn} apiReact={apiReactFn}/></div>}
          {view==='calendar'      &&perms?.canView('calendar')!==false     &&<div className="page-enter"><CalendarView tasks={tasks}/></div>}
          {view==='knowledge-hub' &&perms?.canView('knowledge-hub')!==false&&<div className="page-enter"><KnowledgeHub subFilter={subFilter} user={effectiveUser}/></div>}
          {view==='hr-reports'    &&perms?.canView('hr-reports')!==false   &&<div className="page-enter"><GMReportingView user={effectiveUser} addToast={addToast} createReportModal={createReportModal} setCreateReportModal={setCreateReportModal}/></div>}
          {view==='settings'      &&perms?.canView('settings')!==false     &&<div className="page-enter"><SettingsView settings={settings} setSettings={setSettings} user={user} addToast={addToast} tasks={tasks} setTasks={setTasks} subFilter={subFilter} accessTypes={accessTypes} setAccessTypes={setAccessTypes} userAccessMap={userAccessMap} setUserAccessMap={setUserAccessMap} perms={perms}/></div>}
          {view==='projects'      &&perms?.canView('projects')!==false     &&<div className="page-enter"><ProjectsView projects={projects} setProjects={setProjects} user={user} onNewProject={()=>setProjectModal('create')} onEditProject={(p)=>setProjectModal(p)}/></div>}
      </div>
      {escalModal    &&<EscalModal task={escalModal} bulkCount={bulkIds?.length||0} onConfirm={confirmEscal} onClose={()=>{setEscalModal(null);setBulkIds(null);}}/>}
      {reassignModal &&<ReassignModal task={reassignModal} tasks={tasks} bulkCount={bulkIds?.length||0} onConfirm={confirmReassign} onClose={()=>{setReassignModal(null);setBulkIds(null);}}/>}
      {snoozeModal   &&<SnoozeModal task={snoozeModal} bulkCount={bulkIds?.length||0} onConfirm={confirmSnooze} onClose={()=>{setSnoozeModal(null);setBulkIds(null);}}/>}
      {createModal   &&<CreateTaskModal onConfirm={confirmCreate} onClose={()=>setCreateModal(false)} currentUser={effectiveUser}/>}
      {projectModal  &&<CreateProjectModal onConfirm={confirmProject} onClose={()=>setProjectModal(null)} project={typeof projectModal==='object'?projectModal:null} currentUser={effectiveUser}/>}
      {requestModal  &&<CreateRequestModal onConfirm={confirmRequest} onClose={()=>setRequestModal(false)} currentUser={effectiveUser} tasks={tasks}/>}
      {createEscalModal&&<CreateEscalationModal onConfirm={confirmManualEscal} onClose={()=>setCreateEscalModal(false)} currentUser={effectiveUser} tasks={tasks}/>}
      {showSearch    &&<GlobalSearch tasks={tasks} setView={setView} setSelTask={setSelTask} onClose={()=>setShowSearch(false)}/>}
      {showOnboard   &&<Onboarding onDismiss={(dontShow)=>{setShowOnboard(false);if(dontShow){try{localStorage.setItem('ops_hub_onboarded','1');}catch(e){}}}}/>}
      {popupQueue.length>0&&<AnnouncementPopup key={popupQueue[0].id} comm={popupQueue[0]} onAcknowledge={handlePopupAcknowledge}/>}
      <Toasts toasts={toasts} dismiss={dismissToast}/>
    </div>
    </SettingsContext.Provider>
    </IntegrationsContext.Provider>
    </PermissionsContext.Provider>
  );
};

export default App;
