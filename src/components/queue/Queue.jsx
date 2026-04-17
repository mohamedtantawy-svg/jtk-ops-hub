import { useState, useEffect, useRef, useCallback, useMemo, useContext, memo } from 'react';
import { STATUSES, TOOLS, FUNCTIONS, FLAGS, getFlag, getCountryName } from '../../data/constants';
import { MEMBERS, MEMBERS_BY_EMAIL, getDirectReports } from '../../data/members';
import { OWNER_COUNTRIES } from '../../data/countryOwners';
import { slaInfo, rel, getUrl, getVisibleEmails } from '../../utils/helpers';

// ── O(1) member lookups (avoid MEMBERS.find in hot paths) ──
const MEMBERS_BY_ID = new Map(MEMBERS.map(m => [m.id, m]));
const MEMBERS_BY_EMAIL_LC = new Map(MEMBERS.map(m => [m.email.toLowerCase(), m]));
import { SLA_MINS } from '../../data/constants';
import Detail from './Detail';
import { ToolBadge, StatusBadge, SlaBadge } from '../ui/Badges';
import OutboundQueue from './OutboundQueue';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import Avatar from '../ui/Avatar';
import { useOnboardingData } from '../../hooks/useOnboardingData';
import { useOffboardingData } from '../../hooks/useOffboardingData';
import { useChangeRequestData } from '../../hooks/useChangeRequestData';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import { usePausedOnboardingData } from '../../hooks/usePausedOnboardingData';
import SourceTable from './SourceTable';
import ErrorBoundary from '../ui/ErrorBoundary';
import { updateTaskStatus as apiUpdateStatus } from '../../services/tasksApi';
import {
  normalizeOnboarding,
  normalizeOffboarding,
  normalizeAmendments,
  normalizeRedlines,
  normalizeWorkbench,
  normalizePausedOnboarding,
} from '../../utils/normalizeSourceRows';

// ── Shared relTime utility (used by QueueRow + WorkModeOverlay) ──
const relTime=(m)=>{
  if(m<=0)return'now';
  if(m<60)return`${m}m ago`;
  if(m<120){const r=m%60;return r?`1h ${r}m ago`:'1h ago';}
  return`${Math.floor(m/60)}h ago`;
};

// ── Work Source Button config ──
// Item #12: Split "Change Request" into "Amendments" and "Redlines"
const WORK_SOURCES = [
  { id: 'all_sources',     label: 'All',             icon: 'bi-grid',             color: '#1b1b1b', bg: '#f3f3f3' },
  { id: 'onboarding',      label: 'Onboarding',      icon: 'bi-person-plus-fill', color: '#7c3aed', bg: '#f3eff8' },
  { id: 'offboarding',     label: 'Offboarding',     icon: 'bi-person-dash-fill', color: '#d42d35', bg: '#fef2f2' },
  { id: 'amendments',      label: 'Amendments',      icon: 'bi-pencil-square',    color: '#ed8d00', bg: '#fff8e6' },
  { id: 'redlines',        label: 'Redlines',        icon: 'bi-file-earmark-diff',color: '#7c3aed', bg: '#f3eff8' },
  { id: 'workbench',       label: 'Workbench',       icon: 'bi-grid-3x3-gap-fill',color: '#0369a1', bg: '#eff6ff' },
  { id: 'jira',            label: 'Jira',            icon: 'bi-kanban-fill',      color: '#1f74b3', bg: '#e8f0fe' },
  { id: 'zendesk',         label: 'Zendesk',         icon: 'bi-headset',          color: '#29811e', bg: '#e8f5e9' },
];

// Load saved filters from localStorage
const loadFilters = () => {
  try {
    const raw = localStorage.getItem('ops_hub_queue_filters');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// Priority config
const PRIORITY_DOT={critical:'#dc2626',high:'#d97706',medium:'#0369a1',low:'#9b928a'};

const Queue=({user,tasks,setTasks,selTask,setSelTask,notes,setNotes,activity,setActivity,addToast,onEscalMgr,onReassign,onSnooze,onCreateTask,onBulkAction,subFilter,escalations,requests,setRequests,onNewRequest,queueMode,setQueueMode,fUnassigned,setFUnassigned})=>{
  const saved = useMemo(() => loadFilters(), []);
  const [fTool,setFTool]=useState(saved?.fTool||null);
  const [fStatus,setFStatus]=useState(()=>{const s=saved?.fStatus;if(Array.isArray(s))return s;if(s)return[s];return[];});
  const [fCtry,setFCtry]=useState(saved?.fCtry||[]);
  const [showMeetingInvites,setShowMeetingInvites]=useState(false);
  const [search,setSearch]=useState('');
  const [fSla,setFSla]=useState(saved?.fSla||null); // null | 'ok' | 'at_risk' | 'breached'
  const [onboardingSubTab,setOnboardingSubTab]=useState('action'); // 'action' | 'paused'
  const [sort,setSort]=useState(saved?.sort||'sla'); // Item #5: Default SLA sort oldest→newest
  const [checkedIds,setCheckedIds]=useState(new Set());
  const [recentIds,setRecentIds]=useState([]);
  // Work mode state
  const [workMode,setWorkMode]=useState(false);
  const [workIndex,setWorkIndex]=useState(0);
  const [workSkipped,setWorkSkipped]=useState(new Set());
  const pendingCloseRefs=useRef({});
  // Work source — which panel to show (null = normal queue)
  const [workSource,setWorkSource]=useState(null);
  // searchRef removed — search handled by global nav
  const perms = useContext(PermissionsContext);

  // Wire subFilter from parent (BriefingView "View resolved" etc.) to internal filter
  useEffect(() => {
    if (subFilter) {
      const statusMap = { 'Resolved': 'resolved', 'New': 'new', 'In Progress': 'in_progress', 'Waiting': 'waiting' };
      const mapped = statusMap[subFilter] || subFilter.toLowerCase();
      setFStatus([mapped]);
    }
  }, [subFilter]);
  const settings = useContext(SettingsContext);
  const { deelData, jiraData, queueSync } = useContext(IntegrationsContext);
  // Onboarding data from Deel API
  const onboardingData = useOnboardingData(true);
  const offboardingData = useOffboardingData(true);
  const changeRequestData = useChangeRequestData(true);
  const workbenchData = useWorkbenchData(true);
  const pausedOnboardingData = usePausedOnboardingData(true);

  // ── Normalized rows for SourceTable (Item #3) ──
  const onboardingRowsAll = useMemo(() => normalizeOnboarding(onboardingData.items), [onboardingData.items]);
  const pausedOnboardingRowsAll = useMemo(() => normalizePausedOnboarding(pausedOnboardingData.items), [pausedOnboardingData.items]);
  const offboardingRowsAll = useMemo(() => normalizeOffboarding(offboardingData.items), [offboardingData.items]);
  const amendmentRowsAll = useMemo(() => normalizeAmendments(changeRequestData.amendments), [changeRequestData.amendments]);
  const redlineRowsAll = useMemo(() => normalizeRedlines(changeRequestData.redlines), [changeRequestData.redlines]);
  const workbenchRowsAll = useMemo(() => normalizeWorkbench(workbenchData.tasks), [workbenchData.tasks]);

  const isAdmin=perms?.dataScope==='all_tasks'; const isLead=perms?.dataScope==='team_tasks';
  const ns=(tasks||[]).filter(t=>t.source!=='slack'&&t.source!=='calendar');
  // Hierarchical visibility: viewer sees own tickets + all direct/indirect reports
  const visibleEmails = useMemo(
    () => getVisibleEmails(user?.email),
    [user?.email]
  );

  // ── Agent-scoped source rows: filter Deel API rows by assigneeEmail ──
  // Admins see all. Leads/agents see only rows assigned to their visible emails.
  // Rows with no assigneeEmail (amendments, redlines) are hidden from agents.
  const filterSourceRows = useCallback((rows) => {
    if (isAdmin) return rows;
    return rows.filter(r => {
      const email = (r.assigneeEmail || '').toLowerCase();
      return email && visibleEmails.has(email);
    });
  }, [isAdmin, visibleEmails]);

  // ── Country-ownership filter for onboarding ──
  // Admin/regional_manager → see all. Team lead → own countries + direct reports' countries. Agent → own countries only.
  const filterOnboardingRows = useCallback((rows) => {
    if (isAdmin) return rows;
    const email = (user?.email || '').toLowerCase();
    const member = MEMBERS_BY_EMAIL[email];
    const access = member?.access || 'agent';
    if (access === 'regional_manager') return rows;
    // Collect owned country codes for this user (and direct reports for team leads)
    const ownedCodes = new Set(OWNER_COUNTRIES.get(email) || []);
    if (access === 'team_lead') {
      for (const dr of getDirectReports(email)) {
        const drCodes = OWNER_COUNTRIES.get(dr.email.toLowerCase());
        if (drCodes) for (const c of drCodes) ownedCodes.add(c);
      }
    }
    if (ownedCodes.size === 0) return []; // no ownership data → safe default (admins/RMs bypass above)
    return rows.filter(r => {
      const cc = (r.country || '').toUpperCase();
      return cc && ownedCodes.has(cc);
    });
  }, [isAdmin, user?.email]);

  const onboardingRows = useMemo(() => filterOnboardingRows(onboardingRowsAll), [onboardingRowsAll, filterOnboardingRows]);
  const pausedOnboardingRows = useMemo(() => filterOnboardingRows(pausedOnboardingRowsAll), [pausedOnboardingRowsAll, filterOnboardingRows]);
  const offboardingRows = useMemo(() => filterSourceRows(offboardingRowsAll), [offboardingRowsAll, filterSourceRows]);
  const amendmentRows = useMemo(() => filterSourceRows(amendmentRowsAll), [amendmentRowsAll, filterSourceRows]);
  const redlineRows = useMemo(() => filterSourceRows(redlineRowsAll), [redlineRowsAll, filterSourceRows]);
  const workbenchRows = useMemo(() => filterSourceRows(workbenchRowsAll), [workbenchRowsAll, filterSourceRows]);
  // Item #4: "All" view — combine all agent-scoped sources into unified list
  const allSourceRows = useMemo(() => [
    ...onboardingRows, ...offboardingRows, ...amendmentRows, ...redlineRows, ...workbenchRows,
  ], [onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows]);

  // ── Memoized filter chain — only recomputes when inputs change ──
  const { vis, baseVis, visPreSla, active, snoozed, open, done, all } = useMemo(() => {
    let _vis=ns;
    if(!isAdmin) _vis=ns.filter(t=>{
      if(t.assigneeId===user.id) return true;
      if(t.assigneeEmail && visibleEmails.has(t.assigneeEmail.toLowerCase())) return true;
      return false;
    });
    const _baseVis=_vis.filter(t=>!t.isCalendarBooking);
    if(fTool)       _vis=_vis.filter(t=>t.source===fTool);
    if(fStatus.length) _vis=_vis.filter(t=>fStatus.includes(t.status));
    if(fUnassigned) _vis=_vis.filter(t=>!t.assigneeId&&!t.assigneeEmail);
    if(fCtry.length) _vis=_vis.filter(t=>fCtry.includes(t.country));
    const _visPreSla=_vis.filter(t=>!t.isCalendarBooking);
    if(fSla==='ok')       _vis=_vis.filter(t=>{const s=slaInfo(t);return s&&s.ok;});
    if(fSla==='at_risk')  _vis=_vis.filter(t=>{const s=slaInfo(t);return s&&!s.ok&&!s.breach;});
    if(fSla==='breached') _vis=_vis.filter(t=>{const s=slaInfo(t);return s&&s.breach;});
    if(!showMeetingInvites) _vis=_vis.filter(t=>!t.isCalendarBooking);
    if(search) { const sl=search.toLowerCase(); _vis=_vis.filter(t=>t.subject.toLowerCase().includes(sl)||t.id.toLowerCase().includes(sl)||t.type.toLowerCase().includes(sl)); }
    // Sort
    const sortArr=(arr)=>{
      if(sort==='sla'&&settings.sla_enabled!==false)return [...arr].sort((a,b)=>{
        const sa=slaInfo(a),sb=slaInfo(b);
        if(sa?.breach&&!sb?.breach)return -1; if(!sa?.breach&&sb?.breach)return 1;
        if(sa&&!sb)return -1; if(!sa&&sb)return 1;
        if(sa&&sb){ const limA=SLA_MINS[a.type]||1440, limB=SLA_MINS[b.type]||1440; return (limA-(a.minutesSinceLastResponse??a.minutesAgo))-(limB-(b.minutesSinceLastResponse??b.minutesAgo)); }
        return (b.minutesSinceLastResponse??b.minutesAgo)-(a.minutesSinceLastResponse??a.minutesAgo);
      });
      if(sort==='newest')return [...arr].sort((a,b)=>a.minutesAgo-b.minutesAgo);
      if(sort==='oldest')return [...arr].sort((a,b)=>b.minutesAgo-a.minutesAgo);
      if(sort==='assignee')return [...arr].sort((a,b)=>(MEMBERS_BY_ID.get(a.assigneeId)?.name||a.assigneeName||'').localeCompare(MEMBERS_BY_ID.get(b.assigneeId)?.name||b.assigneeName||''));
      return arr;
    };
    const _sorted=sortArr(_vis.filter(t=>t.status!=='resolved'&&t.status!=='waiting'));
    const _snoozed=_vis.filter(t=>t.status==='waiting');
    const _done=_vis.filter(t=>t.status==='resolved');
    const _all=[..._sorted,..._snoozed,..._done];
    return { vis:_vis, baseVis:_baseVis, visPreSla:_visPreSla, active:_sorted, snoozed:_snoozed, open:_sorted, done:_done, all:_all };
  }, [ns, isAdmin, user.id, visibleEmails, fTool, fStatus, fUnassigned, fCtry, fSla, showMeetingInvites, search, sort, settings.sla_enabled]);
  // Item #9: Country filter — stable list from baseVis (unaffected by fTool/fStatus)
  const allCtry=useMemo(()=>{
    const ctrySet = new Set(baseVis.map(t=>t.country).filter(Boolean));
    for(const r of allSourceRows) if(r.country) ctrySet.add(r.country);
    return [...ctrySet];
  },[baseVis,allSourceRows]);
  const hasActiveFilters=useMemo(()=>!!(fTool||fStatus.length>0||fCtry.length>0||fSla||fUnassigned||search),[fTool,fStatus,fCtry,fSla,fUnassigned,search]);

  // Work mode queue — only active tasks (excludes snoozed/waiting)
  const workQueue = useMemo(()=> active.filter(t=>!workSkipped.has(t.id)),[active,workSkipped]);

  const act=useCallback((task,action)=>{
    if(action==='close'){
      // Guard: skip if already resolved or pending close
      if(task.status==='resolved'||pendingCloseRefs.current[task.id])return;
      const taskId=task.id;
      const tid=setTimeout(()=>{
        setTasks(prev=>prev.map(t=>t.id===taskId?{...t,status:'resolved'}:t));
        // Only move selection if user is still viewing this task
        setSelTask(prev=>prev?.id===taskId?null:prev);
        delete pendingCloseRefs.current[taskId];
        // Persist to backend
        apiUpdateStatus(task._beId||taskId,'resolved').catch(err=>{
          console.warn('[Queue] Failed to sync close to backend:',err.message);
        });
      },4000);
      pendingCloseRefs.current[taskId]=tid;
      addToast&&addToast('success',`Closed: ${taskId}`,task.subject.slice(0,46),()=>{
        clearTimeout(pendingCloseRefs.current[taskId]);
        delete pendingCloseRefs.current[taskId];
      });
      return;
    }
    if(action==='escalate') setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'escalated'}:t));
    if(action==='reply'){setSelTask(task);setRecentIds(prev=>[task.id,...prev.filter(id=>id!==task.id)].slice(0,3));}
    if(action==='reassign') onReassign&&onReassign(task);
    if(action==='snooze') onSnooze&&onSnooze(task);
  },[setTasks,setSelTask,setRecentIds,addToast,onReassign,onSnooze]);

  const handleResolve=useCallback((task)=>{
    if(task.status==='resolved')return;
    setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'resolved'}:t));
    setSelTask(prev=>prev?.id===task.id?null:prev);
    addToast&&addToast('success',`Resolved: ${task.id}`,task.subject.slice(0,46));
    // Persist to backend — fire-and-forget (optimistic UI)
    apiUpdateStatus(task._beId||task.id,'resolved').catch(err=>{
      console.warn('[Queue] Failed to sync resolve to backend:',err.message);
    });
  },[setTasks,setSelTask,addToast]);

  const toggleCheck=useCallback(id=>setCheckedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;}),[]);
  const doBulk=(action)=>{ const ids=[...checkedIds]; if(action==='resolve'){ setTasks(prev=>prev.map(t=>checkedIds.has(t.id)?{...t,status:'resolved'}:t)); addToast&&addToast('success',`${ids.length} tasks resolved`,''); setCheckedIds(new Set()); setSelTask(null); return; } if(onBulkAction){ onBulkAction(ids,action); setCheckedIds(new Set()); } };
  const visibleIds=new Set(vis.map(t=>t.id));
  const compact=!!selTask;
  const recentTasks=recentIds.map(id=>tasks.find(t=>t.id===id)).filter(Boolean);
  // SLA pills — always visible across all views (queue, source panels, etc.)
  // For onboarding: age-based (createdAt) — <3d ok, 3-7d at risk, 7d+ breached
  // For paused onboarding: 48h countdown from pausedAt
  // For queue tasks (ZD/Jira): uses slaInfo() with type-specific thresholds
  const {atRiskCount,breachedCount,onTrackCount}=useMemo(()=>{
    // Determine the base set depending on active view
    let slaBase;
    if (workSource === 'onboarding') {
      // Onboarding uses age-based SLA from createdAt
      const rows = onboardingSubTab === 'paused' ? pausedOnboardingRows : onboardingRows;
      const isPaused = onboardingSubTab === 'paused';
      let atRisk = 0, breached = 0;
      for (const r of rows) {
        if (isPaused) {
          // 48h countdown from pausedAt
          let pausedMs = r.pausedAt ? Date.now() - new Date(r.pausedAt).getTime() : 0;
          if (isNaN(pausedMs)) pausedMs = 0;
          const remaining = 48 * 60 * 60 * 1000 - pausedMs;
          if (remaining <= 0) breached++;
          else if (remaining < 24 * 60 * 60 * 1000) atRisk++;
        } else {
          // Age-based: createdAt
          let ageMs = r.createdAt ? Date.now() - new Date(r.createdAt).getTime() : 0;
          if (isNaN(ageMs)) ageMs = 0;
          const days = ageMs / (1000 * 60 * 60 * 24);
          if (days >= 7) breached++;
          else if (days >= 3) atRisk++;
        }
      }
      return { atRiskCount: atRisk, breachedCount: breached, onTrackCount: rows.length - atRisk - breached };
    }
    if (workSource === 'offboarding') slaBase = offboardingRows;
    else if (workSource === 'amendments') slaBase = amendmentRows;
    else if (workSource === 'redlines') slaBase = redlineRows;
    else if (workSource === 'workbench') slaBase = workbenchRows;
    else if (workSource === 'all_sources') slaBase = allSourceRows;
    else if (workSource === 'jira') slaBase = visPreSla.filter(t => t.source === 'jira');
    else if (workSource === 'zendesk') slaBase = visPreSla.filter(t => t.source === 'zendesk');
    else slaBase = visPreSla;
    // Exclude resolved / waiting (snoozed)
    slaBase = slaBase.filter(t => t.status !== 'resolved' && t.status !== 'waiting');
    const atRisk=slaBase.filter(t=>{const s=slaInfo(t);return s&&!s.ok&&!s.breach;}).length;
    const breached=slaBase.filter(t=>{const s=slaInfo(t);return s&&s.breach;}).length;
    return{atRiskCount:atRisk,breachedCount:breached,onTrackCount:slaBase.length-atRisk-breached};
  },[workSource, onboardingSubTab, visPreSla, onboardingRows, pausedOnboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows, allSourceRows]);

  // ── View-aware header counts: reflect active tab (fTool / workSource) ──
  const headerCounts = useMemo(() => {
    if (workSource === 'onboarding') return { open: onboardingSubTab === 'paused' ? pausedOnboardingRows.length : onboardingRows.length, paused: 0, resolved: 0 };
    if (workSource === 'offboarding') return { open: offboardingRows.length, paused: 0, resolved: 0 };
    if (workSource === 'amendments') return { open: amendmentRows.length, paused: 0, resolved: 0 };
    if (workSource === 'redlines') return { open: redlineRows.length, paused: 0, resolved: 0 };
    if (workSource === 'workbench') return { open: workbenchRows.length, paused: 0, resolved: 0 };
    if (workSource === 'all_sources') return { open: allSourceRows.length, paused: 0, resolved: 0 };
    // Queue view (ZD/JR) — use filtered baseVis when fTool is set
    const base = fTool ? baseVis.filter(t => t.source === fTool) : baseVis;
    const srcExtra = fTool ? 0 : allSourceRows.length;
    return {
      open: base.filter(t => t.status !== 'resolved' && t.status !== 'waiting').length + srcExtra,
      paused: base.filter(t => t.status === 'waiting').length,
      resolved: base.filter(t => t.status === 'resolved').length,
    };
  }, [workSource, fTool, baseVis, onboardingRows, offboardingRows, amendmentRows, redlineRows, workbenchRows, allSourceRows]);
  const activeFilterCount=[fTool,fStatus.length>0?true:null,fCtry.length>0?true:null,fSla||null,fUnassigned||null].filter(Boolean).length;

  // Persist filters to localStorage
  useEffect(()=>{
    try {
      localStorage.setItem('ops_hub_queue_filters',JSON.stringify({fTool,fStatus,fCtry,fSla,fUnassigned,sort}));
    } catch {}
  },[fTool,fStatus,fCtry,fSla,fUnassigned,sort]);

  const visIds=useMemo(()=>new Set(vis.map(t=>t.id)),[vis]);
  useEffect(()=>{
    setCheckedIds(prev=>{
      const next=new Set([...prev].filter(id=>visIds.has(id)));
      return next.size===prev.size?prev:next;
    });
  },[visIds]);

  // Tick timer removed — SLA ticking now managed in App.jsx

  // Cleanup pending close timers on unmount (prevent stale state mutations)
  useEffect(()=>{
    const refs=pendingCloseRefs;
    return()=>{
      for(const tid of Object.values(refs.current)){clearTimeout(tid);}
      refs.current={};
    };
  },[]);

  // Keyboard shortcuts
  useEffect(()=>{
    const kd=e=>{
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'||e.target.isContentEditable)return;
      if(workMode)return; // Work mode has its own shortcuts
      const idx=all.findIndex(t=>t.id===selTask?.id);
      if(e.key==='j'){ const n=all[idx+1]||all[0]; if(n){setSelTask(n);setRecentIds(prev=>[n.id,...prev.filter(id=>id!==n.id)].slice(0,3));} }
      if(e.key==='k'){ const n=all[idx>0?idx-1:all.length-1]; if(n){setSelTask(n);setRecentIds(prev=>[n.id,...prev.filter(id=>id!==n.id)].slice(0,3));} }
      if(e.key==='e'&&selTask&&perms?.canDo('can_escalate')!==false) onEscalMgr&&onEscalMgr(selTask);
      if(e.key==='s'&&selTask&&perms?.canDo('can_snooze')!==false) onSnooze&&onSnooze(selTask);
      if(e.key==='r'&&selTask&&perms?.canDo('can_reassign')!==false) onReassign&&onReassign(selTask);
      if(e.key==='x'&&selTask&&perms?.canDo('can_resolve_task')!==false){ handleResolve(selTask); }
      if(e.key==='Escape') setSelTask(null);
    };
    document.addEventListener('keydown',kd);
    return()=>document.removeEventListener('keydown',kd);
  },[all,selTask,onEscalMgr,onSnooze,onReassign,handleResolve,workMode]);

  // Search focus effect removed — search handled by global nav

  // SLA-based row color
  const slaAgeClass=(task)=>{
    if(task.status==='resolved'||task.status==='waiting')return'';
    const lim=SLA_MINS[task.type]||1440;
    const rem=lim-(task.minutesSinceLastResponse??task.minutesAgo);
    if(rem<=0)return'age-urgent';
    const pct=rem/lim;
    if(pct>0.5)return'';
    if(pct>0.1)return'age-warn';
    return'age-hot';
  };

  // ── Work Mode handlers ──
  const startWorkMode=()=>{
    setWorkMode(true);
    setWorkIndex(0);
    setWorkSkipped(new Set());
    setSelTask(null);
  };
  const workTask = workQueue[0] || null;

  const workResolve=useCallback(()=>{
    if(!workTask)return;
    setTasks(prev=>prev.map(t=>t.id===workTask.id?{...t,status:'resolved'}:t));
    addToast&&addToast('success',`Resolved: ${workTask.id}`,workTask.subject.slice(0,46));
  },[workTask,setTasks,addToast]);

  const workEscalate=useCallback(()=>{
    if(!workTask)return;
    onEscalMgr&&onEscalMgr(workTask);
  },[workTask,onEscalMgr]);

  const workReassign=useCallback(()=>{
    if(!workTask)return;
    onReassign&&onReassign(workTask);
  },[workTask,onReassign]);

  const workSnooze=useCallback(()=>{
    if(!workTask)return;
    onSnooze&&onSnooze(workTask);
  },[workTask,onSnooze]);

  const workSkip=useCallback(()=>{
    if(!workTask)return;
    setWorkSkipped(prev=>new Set([...prev,workTask.id]));
  },[workTask]);

  const workSetInProgress=useCallback(()=>{
    if(!workTask)return;
    setTasks(prev=>prev.map(t=>t.id===workTask.id?{...t,status:'in_progress'}:t));
    addToast&&addToast('info','Status updated',`${workTask.id} set to In Progress`);
  },[workTask,setTasks,addToast]);

  // Auto-exit work mode when queue empties
  useEffect(()=>{
    if(workMode && workQueue.length===0){
      setTimeout(()=>{setWorkMode(false);addToast&&addToast('success','Queue complete','All tasks processed');},300);
    }
  },[workMode,workQueue.length]);

  // Work mode keyboard shortcuts
  useEffect(()=>{
    if(!workMode)return;
    const kd=e=>{
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'||e.target.isContentEditable)return;
      if(e.key==='s')workSkip();
      if(e.key==='x')workResolve();
      if(e.key==='e')workEscalate();
      if(e.key==='r')workReassign();
      if(e.key==='Escape'){setWorkMode(false);setWorkSkipped(new Set());}
    };
    document.addEventListener('keydown',kd);
    return()=>document.removeEventListener('keydown',kd);
  },[workMode,workSkip,workResolve,workEscalate,workReassign]);

  // FILTER_TABS removed — replaced by WORK_SOURCES buttons

  // tabBtnStyle kept for potential reuse
  const tabBtnStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 14px', borderRadius: 8,
    border: 'none', background: active ? '#e8f0fe' : 'transparent',
    color: active ? '#1f74b3' : '#616161', fontSize: 13,
    cursor: 'pointer', fontWeight: active ? 600 : 500,
    whiteSpace: 'nowrap', transition: 'all .15s',
  });

  if (queueMode === 'outbound') {
    return (
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {settings.queue_show_inbound_outbound_toggle!==false&&(
        <div style={{padding:'12px 24px',background:'white',borderBottom:'1px solid #f2f2f2',flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
          <div style={{display:'inline-flex',background:'#f7f5f2',borderRadius:128,padding:3,gap:2}}>
            <button onClick={()=>setQueueMode('inbound')} style={{padding:'5px 16px',borderRadius:128,fontSize:13,fontWeight:500,border:'none',background:'transparent',color:'#616161',cursor:'pointer',transition:'all .15s'}}>
              <i className="bi-inbox" style={{marginRight:5,fontSize:12}}/>Inbound
            </button>
            <button style={{padding:'5px 16px',borderRadius:128,fontSize:13,fontWeight:600,border:'none',background:'white',color:'#1b1b1b',cursor:'pointer',boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
              <i className="bi-send" style={{marginRight:5,fontSize:12}}/>Outbound
            </button>
          </div>
          <span style={{fontSize:12,color:'#9e9e9e'}}>Requests raised to other teams</span>
        </div>
        )}
        <OutboundQueue requests={requests} setRequests={setRequests} user={user} onNewRequest={onNewRequest} tasks={tasks}/>
      </div>
    );
  }

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* ── Single Header — matches Announcements ── */}
      <div data-role="queue-header" style={{padding:'8px 32px 12px',background:'white',borderBottom:'1px solid #e8e8e8',flexShrink:0}}>
        {/* Line 1: Title + total counts across ALL queues (Item #7) + Start Working */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
          {(isAdmin||isLead)&&<span style={{fontSize:13,fontWeight:600,color:'#616161'}}>{isAdmin?'All Tasks':`${user.team}`}</span>}
          {/* View-aware totals — change when switching between source tabs */}
          <span style={{fontSize:12,color:'#9e9e9e',display:'flex',alignItems:'center',gap:5}}>
            <i className="bi-layers" style={{fontSize:11}}></i>
            <span style={{fontWeight:600,color:'#1b1b1b'}}>{headerCounts.open}</span> open
            {headerCounts.paused>0&&<span> &middot; <span style={{fontWeight:600,color:'#616161'}}>{headerCounts.paused}</span> paused</span>}
            {headerCounts.resolved>0&&<span> &middot; <span style={{fontWeight:600,color:'#29811e'}}>{headerCounts.resolved}</span> resolved</span>}
          </span>
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            {/* Live sync indicator */}
            {queueSync&&(()=>{
              const hasCachedData = ns.length > 0;
              const syncColor = queueSync.loading ? '#ed8d00' : queueSync.isLive ? '#29811e' : hasCachedData ? '#0369a1' : '#d42d35';
              const syncLabel = queueSync.loading ? 'Syncing...' : queueSync.isLive ? 'Live' : hasCachedData ? 'Cached' : 'Offline';
              return(
              <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:syncColor}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:syncColor,animation:queueSync.loading?'pulse 1s infinite':'none'}}/>
                <span>{syncLabel}</span>
                {queueSync.meta&&<span style={{color:'#bbb'}}>ZD:{queueSync.meta.zendesk?.count||0} JR:{queueSync.meta.jira?.count||0}</span>}
                <button onClick={()=>queueSync.refresh()} title="Force refresh" style={{border:'none',background:'transparent',cursor:'pointer',padding:2,color:'#9e9e9e',fontSize:12,display:'flex'}}><i className="bi-arrow-clockwise"/></button>
              </div>
              );
            })()}
            {/* SLA filter pills — always visible across all views */}
            <div onClick={()=>setFSla(fSla==='ok'?null:'ok')} style={{display:'flex',alignItems:'center',gap:5,background:fSla==='ok'?'#dcfce7':'#f0fdf4',border:`${fSla==='ok'?'2':'1'}px solid ${fSla==='ok'?'#15803d':'#bbf7d0'}`,borderRadius:128,padding:'5px 14px',cursor:'pointer',transition:'all .15s',flexShrink:0,boxShadow:fSla==='ok'?'0 0 0 2px #15803d30':'none'}}>
                <i className="bi-check-circle-fill" style={{color:'#15803d',fontSize:13}}></i>
                <span style={{fontSize:13,fontWeight:700,color:'#166534'}}>{onTrackCount}</span>
                <span style={{fontSize:11,fontWeight:500,color:'#166534'}}>On Track</span>
              </div>
            <div onClick={()=>setFSla(fSla==='at_risk'?null:'at_risk')} style={{display:'flex',alignItems:'center',gap:5,background:fSla==='at_risk'?'#fef3c7':'#fff8e6',border:`${fSla==='at_risk'?'2':'1'}px solid ${fSla==='at_risk'?'#ed8d00':'#ffe27c'}`,borderRadius:128,padding:'5px 14px',cursor:'pointer',transition:'all .15s',flexShrink:0,boxShadow:fSla==='at_risk'?'0 0 0 2px #ed8d0030':'none'}}>
                <i className="bi-exclamation-circle-fill" style={{color:'#ed8d00',fontSize:13}}></i>
                <span style={{fontSize:13,fontWeight:700,color:'#92400E'}}>{atRiskCount}</span>
                <span style={{fontSize:11,fontWeight:500,color:'#92400E'}}>At Risk</span>
              </div>
            <div onClick={()=>setFSla(fSla==='breached'?null:'breached')} style={{display:'flex',alignItems:'center',gap:5,background:fSla==='breached'?'#fecaca':'#ffe2de',border:`${fSla==='breached'?'2':'1'}px solid ${fSla==='breached'?'#d42d35':'#fca5a5'}`,borderRadius:128,padding:'5px 14px',cursor:'pointer',transition:'all .15s',flexShrink:0,boxShadow:fSla==='breached'?'0 0 0 2px #d42d3530':'none'}}>
                <i className="bi-x-circle-fill" style={{color:'#d42d35',fontSize:13}}></i>
                <span style={{fontSize:13,fontWeight:700,color:'#991b1b'}}>{breachedCount}</span>
                <span style={{fontSize:11,fontWeight:500,color:'#991b1b'}}>Breached</span>
              </div>
            {open.length>0&&(
              <button onClick={startWorkMode}
                style={{height:36,padding:'0 18px',borderRadius:128,border:'none',background:'#1f74b3',color:'white',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:7,transition:'all .15s'}}>
                <i className="bi-play-circle-fill" style={{fontSize:14}}></i>
                Start Working ({open.length})
              </button>
            )}
          </div>
        </div>

        {/* Line 2: Work Source buttons */}
        {(()=>{
          // Hoist Jira/Zendesk counts outside .map() — computed from baseVis (stable)
          const jiraCount = baseVis.filter(t=>t.source==='jira'&&t.status!=='resolved').length;
          const zdCount = baseVis.filter(t=>t.source==='zendesk'&&t.status!=='resolved').length;
          return(
        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:workSource&&workSource!=='zendesk'&&workSource!=='jira'?0:10,flexWrap:'nowrap',overflowX:'auto',paddingBottom:2}}>
          {WORK_SOURCES.map(ws=>{
            const isQueueFilter = ws.id === 'zendesk' || ws.id === 'jira';
            const isActive = isQueueFilter ? (fTool === ws.id && !workSource) : workSource === ws.id;
            const count = ws.id === 'all_sources'
              ? (onboardingRows.length + offboardingRows.length + amendmentRows.length + redlineRows.length + workbenchRows.length)
              : ws.id === 'onboarding' ? onboardingRows.length
              : ws.id === 'offboarding' ? offboardingRows.length
              : ws.id === 'amendments' ? amendmentRows.length
              : ws.id === 'redlines' ? redlineRows.length
              : ws.id === 'workbench' ? workbenchRows.length
              : ws.id === 'jira' ? jiraCount
              : ws.id === 'zendesk' ? zdCount
              : 0;
            const handleClick = () => {
              if (isQueueFilter) {
                // Toggle source filter on the queue — clear any active panel
                setWorkSource(null);
                setFTool(fTool === ws.id ? null : ws.id);
              } else {
                // Show dedicated panel (onboarding, offboarding, workbench, amendments, redlines, all)
                setFTool(null);
                setWorkSource(isActive ? null : ws.id);
              }
            };
            return(
              <button key={ws.id} onClick={handleClick}
                style={{
                  height:34,display:'inline-flex',alignItems:'center',gap:6,
                  padding:'0 14px',borderRadius:10,
                  border:isActive?`1.5px solid ${ws.color}`:'1px solid #e8e8e8',
                  background:isActive?ws.bg:'white',
                  color:isActive?ws.color:'#616161',
                  fontSize:12,fontWeight:isActive?700:500,cursor:'pointer',
                  transition:'all .15s',whiteSpace:'nowrap',
                  boxShadow:isActive?`0 1px 4px ${ws.color}18`:'none',
                }}>
                <i className={ws.icon} style={{fontSize:12}}></i>
                {ws.label}
                <span style={{
                  padding:'1px 7px',borderRadius:128,fontSize:10,fontWeight:700,
                  background:isActive?`${ws.color}20`:'#f2f2f2',
                  color:isActive?ws.color:'#9e9e9e',
                }}>{count}</span>
              </button>
            );
          })}
        </div>
          );
        })()}

        {/* Line 3: Filters — visible on ALL tabs (queue + work source panels) */}
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'nowrap'}}>
          {/* Status multi-select */}
          <MultiFilterDropdown
            icon="bi-circle"
            label="Status"
            selected={fStatus}
            options={[
              {value:'new',label:'New',dotColor:'#7c3aed'},
              {value:'in_progress',label:'In Progress',dotColor:'#1d4ed8'},
              {value:'waiting',label:'Pause',dotColor:'#6b6560'},
              {value:'escalated',label:'Escalated',dotColor:'#d42d35'},
              {value:'resolved',label:'Resolved',dotColor:'#15803d'},
            ]}
            onChange={setFStatus}
            activeColor="#7c3aed"
          />
          {/* Country multi-select */}
          <MultiFilterDropdown
            icon="bi-geo-alt"
            label="Country"
            selected={fCtry}
            options={allCtry.sort().map(c=>({value:c,label:`${getFlag(c)} ${getCountryName(c) || c}`}))}
            onChange={setFCtry}
            activeColor="#1f74b3"
          />
          {/* Sort dropdown */}
          <FilterDropdown
            icon="bi-arrow-down-up"
            label="Sort"
            value={sort}
            options={[
              {value:'oldest',label:'Oldest first',icon:'bi-sort-down'},
              {value:'newest',label:'Newest first',icon:'bi-sort-up'},
              {value:'sla',label:'SLA urgency',icon:'bi-shield-exclamation'},
              {value:'assignee',label:'By assignee',icon:'bi-person'},
            ]}
            onChange={setSort}
            isSort
          />
          <div style={{width:1,height:20,background:'#e8e8e8',flexShrink:0,margin:'0 2px'}}></div>
          {/* Unassigned toggle */}
          <button onClick={()=>setFUnassigned(!fUnassigned)} style={{height:32,display:'inline-flex',alignItems:'center',gap:5,padding:'0 12px',borderRadius:8,border:fUnassigned?'1px solid #d42d35':'1px solid #e8e8e8',background:fUnassigned?'#fef2f2':'white',color:fUnassigned?'#d42d35':'#616161',fontSize:12,fontWeight:fUnassigned?600:500,cursor:'pointer',transition:'all .15s',whiteSpace:'nowrap'}}>
            <i className="bi-person-dash" style={{fontSize:11}}></i>Unassigned
          </button>
          {/* Clear all */}
          {hasActiveFilters&&(
            <button onClick={()=>{setFTool(null);setFStatus([]);setFCtry([]);setFSla(null);setFUnassigned(false);setSearch('');}} style={{height:32,display:'inline-flex',alignItems:'center',gap:4,padding:'0 10px',borderRadius:8,border:'none',background:'transparent',color:'#9e9e9e',fontSize:11,cursor:'pointer',whiteSpace:'nowrap',textDecoration:'underline'}}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Work Source Panels — all use standardized SourceTable (Item #3) ── */}
      {/* Apply queue-level country filter to source panels */}
      {workSource==='all_sources'&&(
        <ErrorBoundary>
        <SourceTable
          rows={fCtry.length?allSourceRows.filter(r=>fCtry.includes(r.country)):allSourceRows}
          loading={onboardingData.loading||offboardingData.loading||changeRequestData.loading||workbenchData.loading}
          error={null}
          onRefresh={()=>{onboardingData.refresh();offboardingData.refresh();changeRequestData.refresh();workbenchData.refresh();}}
          showSourceColumn={true}
          emptyLabel="No tasks across any source"
          emptySubLabel="All queues are clear"
          sortDefault="oldest"
          currentUser={user}
        />
        </ErrorBoundary>
      )}
      {workSource==='onboarding'&&(
        <ErrorBoundary>
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
          {/* Sub-tabs: Action Needed / Paused */}
          <div style={{display:'flex',gap:6,padding:'10px 24px 0',background:'white'}}>
            {[
              {id:'action',label:'Action Needed',count:onboardingRows.length,color:'#ed8d00'},
              {id:'paused',label:'Paused',count:pausedOnboardingRows.length,color:'#6b6560'},
            ].map(t=>(
              <button key={t.id} onClick={()=>setOnboardingSubTab(t.id)} style={{
                display:'inline-flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:128,
                border:onboardingSubTab===t.id?`1.5px solid ${t.color}`:'1px solid #e8e8e8',
                background:onboardingSubTab===t.id?`${t.color}10`:'white',
                color:onboardingSubTab===t.id?t.color:'#616161',
                fontSize:12,fontWeight:onboardingSubTab===t.id?700:500,cursor:'pointer',transition:'all .15s',
              }}>
                {t.label}
                <span style={{padding:'1px 7px',borderRadius:128,fontSize:10,fontWeight:700,
                  background:onboardingSubTab===t.id?`${t.color}20`:'#f2f2f2',
                  color:onboardingSubTab===t.id?t.color:'#9e9e9e',
                }}>{t.count}</span>
              </button>
            ))}
          </div>
          {onboardingSubTab==='action'&&(
            <SourceTable
              rows={fCtry.length?onboardingRows.filter(r=>fCtry.includes(r.country)):onboardingRows}
              loading={onboardingData.loading}
              error={onboardingData.error}
              onRefresh={onboardingData.refresh}
              emptyIcon="bi-person-plus"
              emptyLabel="No actionable onboarding tasks"
              emptySubLabel="All onboarding tasks are handled"
              sortDefault="startDate"
              hideStatusPills
              currentUser={user}
            />
          )}
          {onboardingSubTab==='paused'&&(
            <SourceTable
              rows={fCtry.length?pausedOnboardingRows.filter(r=>fCtry.includes(r.country)):pausedOnboardingRows}
              loading={pausedOnboardingData.loading}
              error={pausedOnboardingData.error}
              onRefresh={pausedOnboardingData.refresh}
              emptyIcon="bi-pause-circle"
              emptyLabel="No paused onboarding contracts"
              emptySubLabel="All contracts are progressing"
              sortDefault="oldest"
              showPausedSla
              hideStatusPills
              currentUser={user}
            />
          )}
        </div>
        </ErrorBoundary>
      )}
      {workSource==='offboarding'&&(
        <ErrorBoundary>
        <SourceTable
          rows={fCtry.length?offboardingRows.filter(r=>fCtry.includes(r.country)):offboardingRows}
          loading={offboardingData.loading}
          error={offboardingData.error}
          onRefresh={offboardingData.refresh}
          emptyIcon="bi-person-dash"
          emptyLabel="No active offboarding cases"
          emptySubLabel="All termination cases have been resolved"
          sortDefault="endDate"
          dateField="endDate"
          dateLabel="End Date"
          showClient
          showType
          currentUser={user}
        />
        </ErrorBoundary>
      )}
      {workSource==='amendments'&&(
        <ErrorBoundary>
        <SourceTable
          rows={fCtry.length?amendmentRows.filter(r=>fCtry.includes(r.country)):amendmentRows}
          loading={changeRequestData.loading}
          error={changeRequestData.error}
          onRefresh={changeRequestData.refresh}
          emptyIcon="bi-pencil-square"
          emptyLabel="No actionable amendments"
          emptySubLabel="All amendments are handled"
          sortDefault="oldest"
          currentUser={user}
        />
        </ErrorBoundary>
      )}
      {workSource==='redlines'&&(
        <ErrorBoundary>
        <SourceTable
          rows={fCtry.length?redlineRows.filter(r=>fCtry.includes(r.country)):redlineRows}
          loading={changeRequestData.loading}
          error={changeRequestData.error}
          onRefresh={changeRequestData.refresh}
          emptyIcon="bi-file-earmark-diff"
          emptyLabel="No actionable redlines"
          emptySubLabel="All redlines are handled"
          sortDefault="oldest"
          currentUser={user}
        />
        </ErrorBoundary>
      )}
      {workSource==='workbench'&&(
        <ErrorBoundary>
        <SourceTable
          rows={fCtry.length?workbenchRows.filter(r=>fCtry.includes(r.country)):workbenchRows}
          loading={workbenchData.loading}
          error={workbenchData.error}
          onRefresh={workbenchData.refresh}
          emptyIcon="bi-grid-3x3-gap"
          emptyLabel="No workbench tasks"
          emptySubLabel="All tasks are processed"
          sortDefault="oldest"
          currentUser={user}
        />
        </ErrorBoundary>
      )}
      {/* Zendesk & Jira buttons filter the main queue — no separate panels needed */}

      {/* ── Table (shown when no work source is active) ── */}
      {!workSource&&<div style={{flex:1,overflowY:'auto',background:'#fafaf9'}}>
        {all.length===0?(
          hasActiveFilters
            ? <div style={{textAlign:'center',padding:'60px 20px',color:'var(--text-muted)'}}>
                <i className="bi bi-inbox" style={{fontSize:32,display:'block',marginBottom:12,opacity:0.3}}/>
                <div style={{fontSize:15,fontWeight:600,color:'#616161',marginBottom:4}}>No tasks found</div>
                <div style={{fontSize:13,color:'#9e9e9e'}}>Try adjusting your filters</div>
              </div>
            : <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flex:1,padding:40,textAlign:'center',minHeight:300}}>
                <i className="bi-inbox" style={{fontSize:48,color:'#c0c0c0',display:'block',marginBottom:16}}></i>
                <div style={{fontSize:17,fontWeight:600,color:'#1b1b1b',marginBottom:6}}>Queue is clear</div>
                <div style={{fontSize:14,color:'#9e9e9e'}}>All caught up</div>
              </div>
        ):(
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}} role="grid" aria-label="Task queue">
            <thead>
              <tr style={{background:'#f5f4f2',position:'sticky',top:0,zIndex:2}}>
                <th scope="col" style={{...thStyle,width:36,padding:'10px 8px'}}><input type="checkbox" className="deel-checkbox" aria-label="Select all tasks" checked={checkedIds.size>0&&checkedIds.size===vis.length} onChange={e=>{if(e.target.checked)setCheckedIds(new Set(vis.map(t=>t.id)));else setCheckedIds(new Set());}} style={{accentColor:'#1f74b3',width:16,height:16,cursor:'pointer'}}/></th>
                <th scope="col" style={{...thStyle,width:80}}>Source</th>
                <th scope="col" style={{...thStyle,textAlign:'left',minWidth:200}}>Subject</th>
                <th scope="col" style={{...thStyle,width:90}}>Function</th>
                <th scope="col" style={{...thStyle,width:50}}>Country</th>
                <th scope="col" style={{...thStyle,width:80}}>Assignee</th>
                <th scope="col" style={{...thStyle,width:68}}>Received</th>
                {settings.sla_enabled!==false&&<th scope="col" style={{...thStyle,width:60}}>SLA</th>}
                <th scope="col" style={{...thStyle,width:90}}>Status</th>
                <th scope="col" style={{...thStyle,width:60}}>Link</th>
              </tr>
            </thead>
            <tbody>
              {active.map(task=><QueueRow key={task.id} task={task} selected={selTask?.id===task.id} checked={checkedIds.has(task.id)} compact={compact} onCheck={()=>toggleCheck(task.id)} onClick={()=>{const next=selTask?.id===task.id?null:task;setSelTask(next);if(next)setRecentIds(prev=>[task.id,...prev.filter(id=>id!==task.id)].slice(0,3));}} onAction={act} onEscalMgr={onEscalMgr} currentUser={user} slaAgeClass={slaAgeClass} settings={settings} perms={perms} onSnooze={onSnooze}/>)}
              {snoozed.length>0&&(
                <tr><td colSpan={settings.sla_enabled!==false?11:10} style={{padding:'12px 16px',fontSize:11,fontWeight:700,color:'#6b6560',letterSpacing:'.04em',background:'#faf9f7',borderTop:'1px solid #e8e8e8',borderBottom:'1px solid #e8e8e8'}}><i className="bi-pause-circle-fill" style={{fontSize:11,marginRight:6}}></i>SNOOZED ({snoozed.length})</td></tr>
              )}
              {snoozed.map(task=><QueueRow key={task.id} task={task} selected={selTask?.id===task.id} checked={checkedIds.has(task.id)} compact={compact} onCheck={()=>toggleCheck(task.id)} onClick={()=>{const next=selTask?.id===task.id?null:task;setSelTask(next);if(next)setRecentIds(prev=>[task.id,...prev.filter(id=>id!==task.id)].slice(0,3));}} onAction={act} onEscalMgr={onEscalMgr} currentUser={user} slaAgeClass={slaAgeClass} settings={settings} perms={perms} onSnooze={onSnooze}/>)}
              {done.length>0&&(
                <tr><td colSpan={settings.sla_enabled!==false?11:10} style={{padding:'12px 16px',fontSize:11,fontWeight:700,color:'#29811e',letterSpacing:'.04em',background:'#f9faf8',borderTop:'1px solid #e8e8e8',borderBottom:'1px solid #e8e8e8'}}><i className="bi-check-circle" style={{fontSize:11,marginRight:6}}></i>RESOLVED TODAY ({done.length})</td></tr>
              )}
              {done.map(task=><QueueRow key={task.id} task={task} selected={selTask?.id===task.id} checked={checkedIds.has(task.id)} compact={compact} onCheck={()=>toggleCheck(task.id)} onClick={()=>{const next=selTask?.id===task.id?null:task;setSelTask(next);if(next)setRecentIds(prev=>[task.id,...prev.filter(id=>id!==task.id)].slice(0,3));}} onAction={act} onEscalMgr={onEscalMgr} currentUser={user} slaAgeClass={slaAgeClass} settings={settings} perms={perms} onSnooze={onSnooze}/>)}
            </tbody>
          </table>
        )}
      </div>}

      {/* ── Detail modal ── */}
      {selTask&&(
        <Detail key={selTask.id} task={selTask} onClose={()=>setSelTask(null)} onAction={act} tasks={tasks} setTasks={setTasks} notes={notes} setNotes={setNotes} activity={activity} setActivity={setActivity} currentUser={user} onEscalMgr={onEscalMgr} escalations={escalations} onResolve={handleResolve} addToast={addToast}/>
      )}

      {/* ── Keyboard shortcut strip ── */}
      {selTask&&!workMode&&(
        <div style={{background:'#fafaf9',borderTop:'1px solid #e8e8e8',padding:'6px 20px',display:'flex',alignItems:'center',gap:12,flexShrink:0,flexWrap:'wrap'}}>
          <span style={{fontSize:10.5,color:'#9e9e9e',fontWeight:600,marginRight:4,letterSpacing:'.04em'}}>SHORTCUTS:</span>
          {[['j/k','navigate'],['e','escalate'],['s','snooze'],['r','reassign'],['x','resolve'],['Esc','close']].map(([k,l])=>(
            <span key={k} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#616161'}}>
              <span style={{background:'#f2f2f2',border:'1px solid #e0e0e0',borderRadius:4,padding:'1px 5px',fontSize:10,fontWeight:600,color:'#1b1b1b',fontFamily:'monospace'}}>{k}</span>{l}
            </span>
          ))}
        </div>
      )}

      {/* ── Bulk actions bar ── */}
      {settings.enable_bulk_actions!==false&&checkedIds.size>0&&(
        <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:500,background:'var(--surface, #fff)',color:'#1b1b1b',padding:'12px 24px',borderTop:'1px solid #e8e8e8',display:'flex',alignItems:'center',gap:10,boxShadow:'0 -2px 8px rgba(0,0,0,0.06)'}} role="toolbar">
          <span style={{fontWeight:600,fontSize:13}}>{checkedIds.size} task{checkedIds.size>1?'s':''} selected</span>
          <div style={{flex:1}}/>
          <button onClick={()=>doBulk('reassign')} style={bulkBtnStyle}><i className="bi-person-up" style={{fontSize:12}}></i>Reassign</button>
          <button onClick={()=>doBulk('escalate')} style={bulkBtnStyle}><i className="bi-arrow-up-circle" style={{fontSize:12}}></i>Escalate</button>
          <button onClick={()=>doBulk('snooze')} style={bulkBtnStyle}><i className="bi-pause-circle" style={{fontSize:12}}></i>Snooze</button>
          <button onClick={()=>doBulk('resolve')} style={bulkBtnStyle}><i className="bi-check-circle" style={{fontSize:12}}></i>Resolve</button>
          <button onClick={()=>setCheckedIds(new Set())} style={{...bulkBtnStyle,color:'rgba(0,0,0,0.4)',borderColor:'rgba(0,0,0,0.1)'}}>Clear</button>
        </div>
      )}

      {/* ── Work Mode Overlay ── */}
      {workMode&&(
        <WorkModeOverlay
          task={workTask}
          remaining={workQueue.length}
          totalOpen={open.length}
          skipped={workSkipped.size}
          onResolve={workResolve}
          onEscalate={workEscalate}
          onReassign={workReassign}
          onSnooze={workSnooze}
          onSkip={workSkip}
          onSetInProgress={workSetInProgress}
          onExit={()=>{setWorkMode(false);setWorkSkipped(new Set());}}
          settings={settings}
        />
      )}
    </div>
  );
};

// ── Table row component (replaces TaskRow for table layout) ──
const QueueRow=memo(({task,selected,checked,onCheck,onClick,onAction,onEscalMgr,currentUser,slaAgeClass,settings,perms,compact,onSnooze})=>{
  const [hov,setHov]=useState(false);
  const assignee=MEMBERS_BY_ID.get(task.assigneeId)||(task.assigneeEmail?MEMBERS_BY_EMAIL_LC.get(task.assigneeEmail.toLowerCase()):null)||{name:task.assigneeName||'Unassigned'};
  const sla=slaInfo(task);
  const isActive=task.status!=='resolved'&&task.status!=='waiting';
  const fn=FUNCTIONS[task.type];
  const rowAgeClass=slaAgeClass?slaAgeClass(task):'';
  const priColor=task.priority?PRIORITY_DOT[task.priority]:null;

  return(
    <tr
      className={`${selected?'selected':''} ${rowAgeClass}`}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={onClick}
      style={{borderBottom:'1px solid #f0efed',background:selected?'#e8f0fe':hov?'#fafaf9':'white',cursor:'pointer',transition:'background 0.1s',borderLeft:priColor?`3px solid ${priColor}`:'3px solid transparent'}}
    >
      {/* Checkbox */}
      <td style={{...tdStyle,width:36,padding:'0 8px'}} onClick={e=>{e.stopPropagation();onCheck();}}>
        <div style={{opacity:hov||checked?1:0,transition:'opacity .15s'}}>
          <input type="checkbox" className="deel-checkbox" aria-label={`Select task ${task.id}`} checked={checked||false} onChange={()=>{}} style={{accentColor:'#1f74b3',width:16,height:16,cursor:'pointer'}}/>
        </div>
      </td>
      {/* Source */}
      <td style={tdStyle}><ToolBadge source={task.source}/></td>
      {/* Subject */}
      <td style={{...tdStyle,textAlign:'left',fontWeight:600,color:'#1b1b1b',maxWidth:320}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          {task.isAlert&&<span className="pulse" style={{width:6,height:6,borderRadius:'50%',background:'#ed8d00',flexShrink:0}}></span>}
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{task.subject}</span>
          {task.linkedTickets&&task.linkedTickets.length>0&&(
            <span style={{display:'inline-flex',alignItems:'center',gap:2,padding:'1px 6px',borderRadius:128,background:'#f2f2f2',fontSize:10,color:'#616161',flexShrink:0}}>
              <i className="bi-link-45deg" style={{fontSize:9}}></i>{task.linkedTickets.length}
            </span>
          )}
        </div>
      </td>
      {/* Function */}
      <td style={tdStyle}>
        {fn?<span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 8px',borderRadius:128,background:fn.bg||'#f2f2f2',color:fn.color||'#616161',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>{fn.label}</span>:<span style={{color:'#d5d5d5'}}>--</span>}
      </td>
      {/* Country */}
      <td style={{...tdStyle,fontSize:12}}>
        {task.country&&<span>{getFlag(task.country)} <span style={{color:'#616161',fontWeight:500}}>{task.country}</span></span>}
      </td>
      {/* Assignee */}
      <td style={tdStyle}>
        <div style={{display:'flex',alignItems:'center',gap:4,justifyContent:'center'}}>
          <Avatar name={assignee.name} size="xs"/>
          <span style={{fontSize:12,color:'#1b1b1b',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{assignee.name?.split(' ')[0]||''}</span>
        </div>
      </td>
      {/* Received */}
      <td style={{...tdStyle,fontSize:12,color:'#616161',whiteSpace:'nowrap'}}>{relTime(task.minutesAgo)}</td>
      {/* SLA */}
      {settings.sla_enabled!==false&&<td style={tdStyle}><SlaBadge sla={sla} status={task.status}/></td>}
      {/* Status + hover actions */}
      <td style={tdStyle}>
        {hov&&isActive?(
          <div style={{display:'flex',gap:3,justifyContent:'center'}} onClick={e=>e.stopPropagation()}>
            {perms?.canDo('can_reassign')!==false&&<button title="Reassign" onClick={()=>onAction(task,'reassign')} style={rowActionBtn('#e8f0fe','#1f74b3')}><i className="bi-person-up"></i></button>}
            {perms?.canDo('can_escalate')!==false&&<button title="Escalate" onClick={()=>onEscalMgr&&onEscalMgr(task)} style={rowActionBtn('#fff8e6','#ed8d00')}><i className="bi-arrow-up-circle"></i></button>}
            {perms?.canDo('can_snooze_task')!==false&&<button title="Snooze" onClick={()=>onAction(task,'snooze')} style={rowActionBtn('#f3f3f3','#616161')}><i className="bi-pause-circle"></i></button>}
            {perms?.canDo('can_resolve_task')!==false&&<button title="Resolve" onClick={()=>onAction(task,'close')} style={rowActionBtn('#e8f5e9','#29811e')}><i className="bi-check-circle"></i></button>}
          </div>
        ):(
          <StatusBadge status={task.status}/>
        )}
      </td>
      {/* External link */}
      <td style={tdStyle}>
        <a href={getUrl(task)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
          title={`Open in ${TOOLS[task.source]?.label||task.source}`}
          style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:6,
            background:hov?'#e8f0fe':'#f5f4f2',color:hov?'#1f74b3':'#9e9e9e',
            fontSize:10,fontWeight:600,textDecoration:'none',transition:'all .15s',whiteSpace:'nowrap',
            border:hov?'1px solid #c8d9f0':'1px solid transparent'}}>
          <i className="bi-box-arrow-up-right" style={{fontSize:9}}></i>
          <span style={{fontSize:10}}>{task.id?`${task.id}`:TOOLS[task.source]?.label||'Open'}</span>
        </a>
      </td>
    </tr>
  );
});
QueueRow.displayName='QueueRow';

// ── Work Mode Overlay ──
const WorkModeOverlay=memo(({task,remaining,totalOpen,skipped,onResolve,onEscalate,onReassign,onSnooze,onSkip,onSetInProgress,onExit,settings})=>{
  if(!task){
    return(
      <div style={overlayStyle}>
        <div style={{...cardStyle,textAlign:'center',padding:'60px 40px'}}>
          <i className="bi-check-circle-fill" style={{fontSize:48,color:'#29811e',marginBottom:16}}></i>
          <div style={{fontSize:20,fontWeight:700,color:'#1b1b1b',marginBottom:8}}>All done!</div>
          <div style={{fontSize:14,color:'#9e9e9e',marginBottom:24}}>You've processed all tasks in the queue.</div>
          <button onClick={onExit} style={{height:40,padding:'0 24px',borderRadius:128,border:'none',background:'#1b1b1b',color:'white',fontSize:14,fontWeight:600,cursor:'pointer'}}>Back to Queue</button>
        </div>
      </div>
    );
  }

  const assignee=MEMBERS_BY_ID.get(task.assigneeId)||(task.assigneeEmail?MEMBERS_BY_EMAIL_LC.get(task.assigneeEmail.toLowerCase()):null)||{name:task.assigneeName||'Unassigned',initials:(task.assigneeName||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()};
  const sla=slaInfo(task);
  const fn=FUNCTIONS[task.type];
  const tool=TOOLS[task.source];
  const slaLim=SLA_MINS[task.type]||1440;
  const slaRem=slaLim-(task.minutesSinceLastResponse??task.minutesAgo??0);
  const slaPct=Math.max(0,Math.min(100,(slaRem/slaLim)*100));
  const slaBarColor=slaRem<=0?'#b91c1c':slaPct>50?'#15803d':slaPct>20?'#b45309':'#b91c1c';
  const processed=totalOpen-remaining;
  const progressPct=totalOpen>0?Math.round((processed/totalOpen)*100):0;

  return(
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {/* Card header — progress + close */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:13,fontWeight:700,color:'#1b1b1b'}}>{processed + 1} of {totalOpen}</span>
            <div style={{width:120,background:'#e8e8e8',borderRadius:128,height:4,overflow:'hidden'}}>
              <div style={{height:'100%',borderRadius:128,background:'#1f74b3',width:`${progressPct}%`,transition:'width .3s'}}></div>
            </div>
            <span style={{fontSize:11,color:'#9e9e9e'}}>{remaining} remaining{skipped>0?` (${skipped} skipped)`:''}</span>
          </div>
          <button onClick={onExit} style={{width:32,height:32,borderRadius:'50%',border:'none',background:'#f2f2f2',color:'#616161',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>
            <i className="bi-x-lg"></i>
          </button>
        </div>

        {/* Task ID + Source + Priority */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          {tool&&<span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:4,background:tool.bg,color:tool.color,fontSize:11,fontWeight:600}}><i className={tool.icon} style={{fontSize:10}}></i>{tool.label}</span>}
          <span style={{fontSize:13,color:'#9e9e9e',fontWeight:500}}>{task.id}</span>
          {fn&&<span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 8px',borderRadius:128,background:fn.bg||'#f2f2f2',color:fn.color||'#616161',fontSize:10,fontWeight:600}}>{fn.label}</span>}
          {task.priority&&<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:PRIORITY_DOT[task.priority]||'#9e9e9e',fontWeight:600,textTransform:'capitalize'}}><span style={{width:7,height:7,borderRadius:'50%',background:PRIORITY_DOT[task.priority]}}></span>{task.priority}</span>}
          <StatusBadge status={task.status}/>
        </div>

        {/* Subject */}
        <h2 style={{fontSize:18,fontWeight:700,color:'#1b1b1b',margin:'0 0 12px',lineHeight:1.3}}>{task.subject}</h2>

        {/* Meta grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 24px',marginBottom:16,padding:'12px 16px',background:'#f9f8f6',borderRadius:10,border:'1px solid #f0efed'}}>
          <div><span style={metaLabel}>Country</span><span style={metaValue}>{getFlag(task.country)} {task.country||'—'}</span></div>
          <div><span style={metaLabel}>Assignee</span><span style={metaValue}>{assignee?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><Avatar name={assignee.name} size="xs"/>{assignee.name}</span>:'Unassigned'}</span></div>
          <div><span style={metaLabel}>Received</span><span style={metaValue}>{relTime(task.minutesAgo)}</span></div>
          <div><span style={metaLabel}>Requester</span><span style={metaValue}>{task.requesterName||'—'}</span></div>
          <div><span style={metaLabel}>Function</span><span style={metaValue}>{task.type||'—'}</span></div>
          <div><span style={metaLabel}>SLA</span><span style={metaValue}>{(()=>{const s=slaInfo(task);if(!s)return'—';if(s.breach){const over=s.remain?Math.abs(s.remain):0;const h=Math.floor(over/60),m=over%60;return <span style={{color:'#d42d35',fontWeight:600}}>{h>0?`Breached ${h}h${m?' '+m+'m':''}`:m?`Breached ${m}m`:'Breached'}</span>;}const r=s.remain;const h=Math.floor(r/60),m=r%60;const txt=h>0?`${h}h${m?' '+m+'m':''} left`:`${m}m left`;return <span style={{color:s.ok?'#15803d':'#ed5e2a',fontWeight:500}}>{txt}</span>;})()}</span></div>
          <div><span style={metaLabel}>Link</span><span style={metaValue}>{(()=>{const url=getUrl(task);return url?<a href={url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:'#1f74b3',textDecoration:'none',fontSize:12,display:'inline-flex',alignItems:'center',gap:3}}><i className="bi-box-arrow-up-right" style={{fontSize:10}}></i>{task.id}</a>:'—';})()}</span></div>
        </div>

        {/* SLA bar */}
        {settings.sla_enabled!==false&&(
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:11,fontWeight:600,color:'#616161'}}>SLA</span>
              <SlaBadge sla={sla} status={task.status}/>
            </div>
            <div style={{width:'100%',background:'#e8e8e8',borderRadius:128,height:6,overflow:'hidden'}}>
              <div style={{height:'100%',borderRadius:128,background:slaBarColor,width:`${slaPct}%`,transition:'width .3s'}}></div>
            </div>
          </div>
        )}

        {/* Body / AI Summary */}
        <div style={{flex:1,overflowY:'auto',marginBottom:20}}>
          {task.aiSummary&&(
            <div style={{padding:'10px 14px',background:'#f3eff8',border:'1px solid #e4d8f0',borderRadius:8,marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:700,color:'#6b3fa0',marginBottom:4,letterSpacing:'.04em'}}>AI SUMMARY</div>
              <div style={{fontSize:13,color:'#1b1b1b',lineHeight:1.5}}>{task.aiSummary}</div>
            </div>
          )}
          {task.body&&(
            <div style={{fontSize:13,color:'#444',lineHeight:1.6,maxHeight:160,overflowY:'auto'}}>{task.body}</div>
          )}
          {task.suggestedReply&&(
            <div style={{padding:'10px 14px',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8,marginTop:10}}>
              <div style={{fontSize:10,fontWeight:700,color:'#0369a1',marginBottom:4,letterSpacing:'.04em'}}>SUGGESTED REPLY</div>
              <div style={{fontSize:13,color:'#1b1b1b',lineHeight:1.5}}>{task.suggestedReply}</div>
            </div>
          )}
        </div>

        {/* Linked tickets */}
        {task.linkedTickets&&task.linkedTickets.length>0&&(
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:16}}>
            {task.linkedTickets.map((lt,i)=>(
              <span key={i} style={{display:'inline-flex',alignItems:'center',gap:3,padding:'3px 10px',borderRadius:128,background:'#f2f2f2',fontSize:11,color:'#616161',fontWeight:500}}>
                <i className="bi-link-45deg" style={{fontSize:10}}></i>{lt.id}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',borderTop:'1px solid #f0efed',paddingTop:16}}>
          <button onClick={onResolve} style={workActionBtn('#29811e','white')}><i className="bi-check-circle-fill" style={{fontSize:13}}></i>Resolve</button>
          <button onClick={onSetInProgress} style={workActionBtn('white','#1b1b1b','1px solid #e8e8e8')}><i className="bi-play-fill" style={{fontSize:13}}></i>In Progress</button>
          <button onClick={onEscalate} style={workActionBtn('white','#ed8d00','1px solid #ffe27c')}><i className="bi-arrow-up-circle" style={{fontSize:13}}></i>Escalate</button>
          <button onClick={onReassign} style={workActionBtn('white','#1f74b3','1px solid #bddcf0')}><i className="bi-person-up" style={{fontSize:13}}></i>Reassign</button>
          <button onClick={onSnooze} style={workActionBtn('white','#616161','1px solid #e8e8e8')}><i className="bi-pause-circle" style={{fontSize:13}}></i>Snooze</button>
          <div style={{flex:1}}></div>
          <button onClick={onSkip} style={workActionBtn('#f7f5f2','#9e9e9e')}><i className="bi-chevron-double-right" style={{fontSize:13}}></i>Skip</button>
        </div>

        {/* Keyboard shortcuts */}
        <div style={{display:'flex',gap:10,marginTop:12,flexWrap:'wrap'}}>
          {[['x','resolve'],['e','escalate'],['r','reassign'],['s','skip'],['Esc','exit']].map(([k,l])=>(
            <span key={k} style={{display:'flex',alignItems:'center',gap:3,fontSize:10,color:'#9e9e9e'}}>
              <span style={{background:'#f2f2f2',border:'1px solid #e0e0e0',borderRadius:3,padding:'1px 4px',fontSize:9,fontWeight:600,color:'#616161',fontFamily:'monospace'}}>{k}</span>{l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
WorkModeOverlay.displayName='WorkModeOverlay';

// ── Custom Filter Dropdown ──
const FilterDropdown=memo(({icon,label,value,options,onChange,activeColor='#1f74b3',isSort})=>{
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  const selected=options.find(o=>o.value===value)||options[0];
  const isActive=isSort?false:value!==null;

  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[open]);

  return(
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        height:32,display:'inline-flex',alignItems:'center',gap:6,
        padding:'0 12px',borderRadius:8,
        border:isActive?`1px solid ${activeColor}`:'1px solid #e8e8e8',
        background:isActive?`${activeColor}10`:'white',
        color:isActive?activeColor:'#616161',
        fontSize:12,fontWeight:isActive?600:500,cursor:'pointer',transition:'all .15s',whiteSpace:'nowrap',
      }}>
        <i className={icon} style={{fontSize:11}}></i>
        {isActive?selected.label:label}
        <i className={open?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:8,marginLeft:2,opacity:0.6}}></i>
      </button>
      {open&&(
        <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,background:'white',border:'1px solid #e8e8e8',borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:200,minWidth:180,maxHeight:280,overflowY:'auto',padding:'6px 0'}}>
          {options.map(opt=>{
            const active=opt.value===value||(isSort&&opt.value===value);
            return(
              <div key={opt.value??'_null'} onClick={()=>{onChange(opt.value);setOpen(false);}}
                onMouseEnter={e=>{if(!active)e.currentTarget.style.background='#f9f8f6';}}
                onMouseLeave={e=>{if(!active)e.currentTarget.style.background=active?`${activeColor}08`:'transparent';}}
                style={{padding:'8px 14px',fontSize:13,color:active?activeColor:'#1b1b1b',fontWeight:active?600:400,cursor:'pointer',background:active?`${activeColor}08`:'transparent',display:'flex',alignItems:'center',gap:8,transition:'background .1s'}}>
                {opt.dotColor&&<span style={{width:8,height:8,borderRadius:'50%',background:opt.dotColor,flexShrink:0}}></span>}
                {opt.icon&&!opt.dotColor&&<i className={opt.icon} style={{fontSize:12,opacity:0.6,width:16,textAlign:'center'}}></i>}
                <span style={{flex:1}}>{opt.label}</span>
                {opt.count>0&&<span style={{fontSize:10,fontWeight:600,color:'#9e9e9e',background:'#f2f2f2',borderRadius:128,padding:'1px 6px'}}>{opt.count}</span>}
                {active&&<i className="bi-check2" style={{fontSize:13,color:activeColor,flexShrink:0}}></i>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
FilterDropdown.displayName='FilterDropdown';

// ── Multi-select filter dropdown (Status, Country) ──
const MultiFilterDropdown=memo(({icon,label,selected=[],options,onChange,activeColor='#1f74b3'})=>{
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  const isActive=selected.length>0;

  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[open]);

  const toggle=(value)=>{
    if(selected.includes(value)) onChange(selected.filter(v=>v!==value));
    else onChange([...selected,value]);
  };

  const displayLabel=isActive
    ? selected.length===1
      ? (options.find(o=>o.value===selected[0])?.label||label)
      : `${label} (${selected.length})`
    : label;

  return(
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        height:32,display:'inline-flex',alignItems:'center',gap:6,
        padding:'0 12px',borderRadius:8,
        border:isActive?`1px solid ${activeColor}`:'1px solid #e8e8e8',
        background:isActive?`${activeColor}10`:'white',
        color:isActive?activeColor:'#616161',
        fontSize:12,fontWeight:isActive?600:500,cursor:'pointer',transition:'all .15s',whiteSpace:'nowrap',
      }}>
        <i className={icon} style={{fontSize:11}}></i>
        {displayLabel}
        <i className={open?'bi-chevron-up':'bi-chevron-down'} style={{fontSize:8,marginLeft:2,opacity:0.6}}></i>
      </button>
      {open&&(
        <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,background:'white',border:'1px solid #e8e8e8',borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:200,minWidth:200,maxHeight:320,overflowY:'auto',padding:'6px 0'}}>
          {isActive&&(
            <div onClick={()=>{onChange([]);setOpen(false);}}
              style={{padding:'8px 14px',fontSize:12,color:'#9e9e9e',cursor:'pointer',borderBottom:'1px solid #f2f2f2',display:'flex',alignItems:'center',gap:6}}
              onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <i className="bi-x-circle" style={{fontSize:11}}></i>Clear selection
            </div>
          )}
          {options.map(opt=>{
            const checked=selected.includes(opt.value);
            return(
              <div key={opt.value} onClick={()=>toggle(opt.value)}
                onMouseEnter={e=>{if(!checked)e.currentTarget.style.background='#f9f8f6';}}
                onMouseLeave={e=>{e.currentTarget.style.background=checked?`${activeColor}08`:'transparent';}}
                style={{padding:'8px 14px',fontSize:13,color:checked?activeColor:'#1b1b1b',fontWeight:checked?600:400,cursor:'pointer',background:checked?`${activeColor}08`:'transparent',display:'flex',alignItems:'center',gap:8,transition:'background .1s'}}>
                <span style={{width:16,height:16,borderRadius:4,border:checked?`2px solid ${activeColor}`:'2px solid #d5d5d5',background:checked?activeColor:'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .15s'}}>
                  {checked&&<i className="bi-check2" style={{fontSize:10,color:'white'}}></i>}
                </span>
                {opt.dotColor&&<span style={{width:8,height:8,borderRadius:'50%',background:opt.dotColor,flexShrink:0}}></span>}
                <span style={{flex:1}}>{opt.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
MultiFilterDropdown.displayName='MultiFilterDropdown';

// ── Styles ──
const thStyle={padding:'10px 12px',fontSize:11,fontWeight:600,color:'#9e9e9e',textTransform:'uppercase',letterSpacing:'0.04em',textAlign:'center',whiteSpace:'nowrap',borderBottom:'1px solid #e8e8e8'};
const tdStyle={padding:'10px 12px',textAlign:'center',verticalAlign:'middle'};
const bulkBtnStyle={background:'transparent',color:'#1b1b1b',border:'1px solid rgba(0,0,0,0.15)',borderRadius:128,padding:'6px 16px',fontSize:12.5,cursor:'pointer',fontWeight:500,display:'flex',alignItems:'center',gap:5};
const rowActionBtn=(bg,color)=>({width:24,height:24,borderRadius:6,border:'none',background:bg,color,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,transition:'all .12s'});
const workActionBtn=(bg,color,border)=>({height:36,padding:'0 16px',borderRadius:128,border:border||'none',background:bg,color,fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6,transition:'all .15s'});
const overlayStyle={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',backdropFilter:'blur(4px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:40};
const cardStyle={background:'white',borderRadius:16,padding:'28px 32px',width:'100%',maxWidth:640,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.2)',overflow:'hidden'};
const metaLabel={display:'block',fontSize:10,fontWeight:600,color:'#9e9e9e',letterSpacing:'.04em',textTransform:'uppercase',marginBottom:2};
const metaValue={display:'block',fontSize:13,color:'#1b1b1b',fontWeight:500};

export default Queue;
