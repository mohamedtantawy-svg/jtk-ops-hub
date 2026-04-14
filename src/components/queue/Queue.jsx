import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { STATUSES, TOOLS, FUNCTIONS, FLAGS, QUEUE_SOURCES } from '../../data/constants';
import { MEMBERS, DEFAULT_USER_ACCESS_MAP } from '../../data/members';
import { slaInfo, rel, getUrl, getVisibleEmails } from '../../utils/helpers';
import { SLA_MINS } from '../../data/constants';
import Detail from './Detail';
import { ToolBadge, FnBadge, StatusBadge, SlaBadge } from '../ui/Badges';
import OutboundQueue from './OutboundQueue';
import { PermissionsContext, SettingsContext, IntegrationsContext } from '../../App';
import Avatar from '../ui/Avatar';

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
  const [fStatus,setFStatus]=useState(saved?.fStatus||null);
  const [fCtry,setFCtry]=useState(saved?.fCtry||[]);
  const [showMeetingInvites,setShowMeetingInvites]=useState(false);
  const [search,setSearch]=useState('');
  const [fSla,setFSla]=useState(null); // null | 'ok' | 'at_risk' | 'breached'
  const [sort,setSort]=useState(saved?.sort||'oldest');
  const [checkedIds,setCheckedIds]=useState(new Set());
  const [recentIds,setRecentIds]=useState([]);
  // Work mode state
  const [workMode,setWorkMode]=useState(false);
  const [workIndex,setWorkIndex]=useState(0);
  const [workSkipped,setWorkSkipped]=useState(new Set());
  const pendingCloseRefs=useRef({});
  // searchRef removed — search handled by global nav
  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const { deelData, jiraData, queueSync } = useContext(IntegrationsContext);
  const isAdmin=perms?.dataScope==='all_tasks'; const isLead=perms?.dataScope==='team_tasks';
  const ns=tasks.filter(t=>t.source!=='slack'&&t.source!=='calendar');
  // Hierarchical visibility: viewer sees own tickets + all direct/indirect reports
  const visibleEmails = useMemo(
    () => getVisibleEmails(user?.email, DEFAULT_USER_ACCESS_MAP),
    [user?.email]
  );
  let vis=ns;
  if(!isAdmin) vis=ns.filter(t=>{
    // Match by legacy member ID
    if(t.assigneeId===user.id) return true;
    // Match by email hierarchy (assignee, manager, manager's manager …)
    if(t.assigneeEmail && visibleEmails.has(t.assigneeEmail.toLowerCase())) return true;
    return false;
  });
  if(fTool)       vis=vis.filter(t=>t.source===fTool);
  if(fStatus)     vis=vis.filter(t=>t.status===fStatus);
  if(fUnassigned) vis=vis.filter(t=>!t.assigneeId&&!t.assigneeEmail);
  if(fCtry.length) vis=vis.filter(t=>fCtry.includes(t.country));
  if(fSla==='ok')       vis=vis.filter(t=>{const s=slaInfo(t);return s&&s.ok;});
  if(fSla==='at_risk')  vis=vis.filter(t=>{const s=slaInfo(t);return s&&!s.ok&&!s.breach;});
  if(fSla==='breached') vis=vis.filter(t=>{const s=slaInfo(t);return s&&s.breach;});
  if(!showMeetingInvites) vis=vis.filter(t=>!t.isCalendarBooking);
  if(search) vis=vis.filter(t=>t.subject.toLowerCase().includes(search.toLowerCase())||t.id.toLowerCase().includes(search.toLowerCase())||t.type.toLowerCase().includes(search.toLowerCase()));
  const sortFn=(arr)=>{
    if(sort==='sla'&&settings.sla_enabled!==false)return [...arr].sort((a,b)=>{
      const sa=slaInfo(a),sb=slaInfo(b);
      if(sa?.breach&&!sb?.breach)return -1; if(!sa?.breach&&sb?.breach)return 1;
      if(sa&&!sb)return -1; if(!sa&&sb)return 1;
      if(sa&&sb){
        const limA=SLA_MINS[a.type]||1440, limB=SLA_MINS[b.type]||1440;
        return (limA-a.minutesAgo)-(limB-b.minutesAgo);
      }
      return b.minutesAgo-a.minutesAgo;
    });
    if(sort==='newest')return [...arr].sort((a,b)=>a.minutesAgo-b.minutesAgo);
    if(sort==='oldest')return [...arr].sort((a,b)=>b.minutesAgo-a.minutesAgo);
    if(sort==='assignee')return [...arr].sort((a,b)=>(MEMBERS.find(m=>m.id===a.assigneeId)?.name||a.assigneeName||'').localeCompare(MEMBERS.find(m=>m.id===b.assigneeId)?.name||b.assigneeName||''));
    return arr;
  };
  const sorted=sortFn(vis.filter(t=>t.status!=='resolved'&&t.status!=='waiting'));
  const active=sorted;
  const snoozed=vis.filter(t=>t.status==='waiting');
  const open=active; // "open" = actionable tasks only (excludes waiting)
  const done=vis.filter(t=>t.status==='resolved');
  const filteredTasks=[...active,...snoozed,...done];
  const all=filteredTasks;
  const allCtry=[...new Set(ns.map(t=>t.country))];
  const hasActiveFilters=!!(fTool||fStatus||fCtry.length>0||fSla||fUnassigned||search);

  // Work mode queue — only active tasks (excludes snoozed/waiting)
  const workQueue = useMemo(()=> active.filter(t=>!workSkipped.has(t.id)),[active,workSkipped]);

  const act=(task,action)=>{
    if(action==='close'){
      // Guard: skip if already resolved or pending close
      if(task.status==='resolved'||pendingCloseRefs.current[task.id])return;
      const taskId=task.id;
      const tid=setTimeout(()=>{
        setTasks(prev=>prev.map(t=>t.id===taskId?{...t,status:'resolved'}:t));
        // Only move selection if user is still viewing this task
        setSelTask(prev=>prev?.id===taskId?null:prev);
        delete pendingCloseRefs.current[taskId];
      },4000);
      pendingCloseRefs.current[taskId]=tid;
      addToast&&addToast('success',`Closed: ${taskId}`,task.subject.slice(0,46),()=>{
        clearTimeout(pendingCloseRefs.current[taskId]);
        delete pendingCloseRefs.current[taskId];
      });
      return;
    }
    if(action==='escalate') setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'in_progress'}:t));
    if(action==='reply'){setSelTask(task);setRecentIds(prev=>[task.id,...prev.filter(id=>id!==task.id)].slice(0,3));}
    if(action==='reassign') onReassign&&onReassign(task);
    if(action==='snooze') onSnooze&&onSnooze(task);
  };

  const handleResolve=useCallback((task)=>{
    if(task.status==='resolved')return;
    setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'resolved'}:t));
    setSelTask(prev=>prev?.id===task.id?null:prev);
    addToast&&addToast('success',`Resolved: ${task.id}`,task.subject.slice(0,46));
  },[setTasks,setSelTask,addToast]);

  const toggleCheck=id=>setCheckedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const doBulk=(action)=>{ const ids=[...checkedIds]; if(action==='resolve'){ setTasks(prev=>prev.map(t=>checkedIds.has(t.id)?{...t,status:'resolved'}:t)); addToast&&addToast('success',`${ids.length} tasks resolved`,''); setCheckedIds(new Set()); setSelTask(null); return; } if(onBulkAction){ onBulkAction(ids,action); setCheckedIds(new Set()); } };
  const visibleIds=new Set(vis.map(t=>t.id));
  const compact=!!selTask;
  const recentTasks=recentIds.map(id=>tasks.find(t=>t.id===id)).filter(Boolean);
  const atRiskCount=ns.filter(t=>{const s=slaInfo(t);return s&&!s.ok&&!s.breach;}).length;
  const breachedCount=ns.filter(t=>{const s=slaInfo(t);return s&&s.breach;}).length;
  const onTrackCount=ns.filter(t=>t.status!=='resolved'&&t.status!=='waiting').length-atRiskCount-breachedCount;
  const activeFilterCount=[fTool,fStatus,fCtry.length>0?true:null,fSla||null,fUnassigned||null].filter(Boolean).length;

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

  // Keyboard shortcuts
  useEffect(()=>{
    const kd=e=>{
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'||e.target.isContentEditable)return;
      if(workMode)return; // Work mode has its own shortcuts
      const idx=all.findIndex(t=>t.id===selTask?.id);
      if(e.key==='j'){ const n=all[idx+1]||all[0]; if(n){setSelTask(n);setRecentIds(prev=>[n.id,...prev.filter(id=>id!==n.id)].slice(0,3));} }
      if(e.key==='k'){ const n=all[idx>0?idx-1:all.length-1]; if(n){setSelTask(n);setRecentIds(prev=>[n.id,...prev.filter(id=>id!==n.id)].slice(0,3));} }
      if(e.key==='e'&&selTask) onEscalMgr&&onEscalMgr(selTask);
      if(e.key==='s'&&selTask) onSnooze&&onSnooze(selTask);
      if(e.key==='r'&&selTask) onReassign&&onReassign(selTask);
      if(e.key==='x'&&selTask){ handleResolve(selTask); }
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
    const rem=lim-task.minutesAgo;
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

  // ── Filter tabs (like Announcements) ──
  const FILTER_TABS = useMemo(()=>{
    const baseVis=(isAdmin?ns:ns.filter(tx=>{
      if(tx.assigneeId===user.id) return true;
      if(tx.assigneeEmail && visibleEmails.has(tx.assigneeEmail.toLowerCase())) return true;
      return false;
    })).filter(t=>!t.isCalendarBooking);
    const tabs = [
      {id:'all',label:'All',icon:'bi-grid',count:baseVis.filter(t=>t.status!=='resolved').length},
      ...QUEUE_SOURCES.map(key=>{
        const t=TOOLS[key];if(!t)return null;
        const cnt=baseVis.filter(tx=>tx.source===key&&tx.status!=='resolved').length;
        return {id:key,label:t.label,icon:t.icon,count:cnt};
      }).filter(Boolean),
    ];
    return tabs;
  },[ns,isAdmin,isLead,user]);

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
      <div data-role="queue-header" style={{padding:'16px 32px 12px',background:'white',borderBottom:'1px solid #e8e8e8',flexShrink:0}}>
        {/* Line 1: Title + counts + badge + Start Working */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <i className="bi-inbox-fill" style={{fontSize:18,color:'#1f74b3'}}></i>
            <span style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>{isAdmin?'All Tasks':isLead?`${user.team} Queue`:'My Queue'}</span>
          </div>
          <span style={{fontSize:12,color:'#9e9e9e',display:'flex',alignItems:'center',gap:5}}>
            <i className="bi-layers" style={{fontSize:11}}></i>
            <span style={{fontWeight:600,color:'#1b1b1b'}}>{open.length}</span> open
            {done.length>0&&<span> &middot; {done.length} resolved</span>}
          </span>
          {onTrackCount>0&&(
            <div onClick={()=>setFSla(fSla==='ok'?null:'ok')} style={{display:'flex',alignItems:'center',gap:6,background:fSla==='ok'?'#dcfce7':'#f0fdf4',border:`1px solid ${fSla==='ok'?'#15803d':'#bbf7d0'}`,borderRadius:128,padding:'4px 12px',cursor:'pointer',transition:'all .15s'}}>
              <i className="bi-check-circle-fill" style={{color:'#15803d',fontSize:12}}></i>
              <span style={{fontSize:12,fontWeight:700,color:'#166534'}}>{onTrackCount} on track</span>
            </div>
          )}
          {atRiskCount>0&&(
            <div onClick={()=>setFSla(fSla==='at_risk'?null:'at_risk')} style={{display:'flex',alignItems:'center',gap:6,background:fSla==='at_risk'?'#fef3c7':'#fff8e6',border:`1px solid ${fSla==='at_risk'?'#ed8d00':'#ffe27c'}`,borderRadius:128,padding:'4px 12px',cursor:'pointer',transition:'all .15s'}}>
              <i className="bi-exclamation-circle-fill" style={{color:'#ed8d00',fontSize:12}}></i>
              <span style={{fontSize:12,fontWeight:700,color:'#92400E'}}>{atRiskCount} at risk</span>
            </div>
          )}
          {breachedCount>0&&(
            <div onClick={()=>setFSla(fSla==='breached'?null:'breached')} style={{display:'flex',alignItems:'center',gap:6,background:fSla==='breached'?'#fecaca':'#ffe2de',border:`1px solid ${fSla==='breached'?'#d42d35':'#fca5a5'}`,borderRadius:128,padding:'4px 12px',cursor:'pointer',transition:'all .15s'}}>
              <i className="bi-x-circle-fill" style={{color:'#d42d35',fontSize:12}}></i>
              <span style={{fontSize:12,fontWeight:700,color:'#991b1b'}}>{breachedCount} breached</span>
            </div>
          )}
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            {/* Live sync indicator */}
            {queueSync&&(
              <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:queueSync.isLive?'#29811e':'#9e9e9e'}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:queueSync.loading?'#ed8d00':queueSync.isLive?'#29811e':'#d42d35',animation:queueSync.loading?'pulse 1s infinite':'none'}}/>
                <span>{queueSync.loading?'Syncing...':queueSync.isLive?'Live':'Offline'}</span>
                {queueSync.meta&&<span style={{color:'#bbb'}}>ZD:{queueSync.meta.zendesk?.count||0} JR:{queueSync.meta.jira?.count||0}</span>}
                <button onClick={()=>queueSync.refresh()} title="Force refresh" style={{border:'none',background:'transparent',cursor:'pointer',padding:2,color:'#9e9e9e',fontSize:12,display:'flex'}}><i className="bi-arrow-clockwise"/></button>
              </div>
            )}
            {open.length>0&&(
              <button onClick={startWorkMode}
                style={{height:36,padding:'0 18px',borderRadius:128,border:'none',background:'#1f74b3',color:'white',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:7,transition:'all .15s'}}>
                <i className="bi-play-circle-fill" style={{fontSize:14}}></i>
                Start Working ({open.length})
              </button>
            )}
          </div>
        </div>
        {/* Line 2: Filters — all custom dropdowns + unassigned toggle */}
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'nowrap'}}>
          {/* Source dropdown */}
          <FilterDropdown
            icon="bi-funnel"
            label="Source"
            value={fTool}
            options={[{value:null,label:'All Sources',icon:'bi-grid',count:FILTER_TABS[0]?.count},...FILTER_TABS.slice(1).map(f=>({value:f.id,label:f.label,icon:f.icon,count:f.count}))]}
            onChange={setFTool}
            activeColor="#1f74b3"
          />
          {/* Status dropdown */}
          <FilterDropdown
            icon="bi-circle"
            label="Status"
            value={fStatus}
            options={[
              {value:null,label:'All Status',icon:'bi-grid'},
              {value:'new',label:'New',icon:'bi-circle-fill',dotColor:'#7c3aed'},
              {value:'in_progress',label:'In Progress',icon:'bi-play-circle-fill',dotColor:'#1d4ed8'},
              {value:'waiting',label:'Pause',icon:'bi-pause-circle-fill',dotColor:'#6b6560'},
              {value:'escalated',label:'Escalated',icon:'bi-arrow-up-circle-fill',dotColor:'#d42d35'},
              {value:'resolved',label:'Resolved',icon:'bi-check-circle-fill',dotColor:'#15803d'},
            ]}
            onChange={setFStatus}
            activeColor="#7c3aed"
          />
          {/* Country dropdown */}
          <FilterDropdown
            icon="bi-geo-alt"
            label="Country"
            value={fCtry[0]||null}
            options={[{value:null,label:'All Countries',icon:'bi-globe'},...allCtry.sort().map(c=>({value:c,label:`${FLAGS[c]||''} ${c}`}))]}
            onChange={v=>setFCtry(v?[v]:[])}
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
            <button onClick={()=>{setFTool(null);setFStatus(null);setFCtry([]);setFSla(null);setFUnassigned(false);setSearch('');}} style={{height:32,display:'inline-flex',alignItems:'center',gap:4,padding:'0 10px',borderRadius:8,border:'none',background:'transparent',color:'#9e9e9e',fontSize:11,cursor:'pointer',whiteSpace:'nowrap',textDecoration:'underline'}}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{flex:1,overflowY:'auto',background:'#fafaf9'}}>
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
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'#f5f4f2',position:'sticky',top:0,zIndex:2}}>
                <th style={{...thStyle,width:36,padding:'10px 8px'}}><input type="checkbox" className="deel-checkbox" checked={checkedIds.size>0&&checkedIds.size===vis.length} onChange={e=>{if(e.target.checked)setCheckedIds(new Set(vis.map(t=>t.id)));else setCheckedIds(new Set());}} style={{accentColor:'#1f74b3',width:16,height:16,cursor:'pointer'}}/></th>
                <th style={{...thStyle,width:80}}>Source</th>
                <th style={{...thStyle,textAlign:'left',minWidth:200}}>Subject</th>
                <th style={{...thStyle,width:90}}>Function</th>
                <th style={{...thStyle,width:50}}>Country</th>
                <th style={{...thStyle,width:80}}>Assignee</th>
                <th style={{...thStyle,width:68}}>Received</th>
                {settings.sla_enabled!==false&&<th style={{...thStyle,width:60}}>SLA</th>}
                <th style={{...thStyle,width:90}}>Status</th>
                <th style={{...thStyle,width:60}}>Link</th>
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
      </div>

      {/* ── Detail pane ── */}
      {selTask&&(
        <div style={{position:'fixed',top:0,right:0,bottom:0,width:480,background:'white',borderLeft:'1px solid #e8e8e8',zIndex:100,boxShadow:'-4px 0 24px rgba(0,0,0,0.08)',display:'flex',flexDirection:'column'}}>
          <Detail key={selTask.id} task={selTask} onClose={()=>setSelTask(null)} onAction={act} tasks={tasks} setTasks={setTasks} notes={notes} setNotes={setNotes} activity={activity} setActivity={setActivity} currentUser={user} onEscalMgr={onEscalMgr} escalations={escalations} onResolve={handleResolve} addToast={addToast}/>
        </div>
      )}

      {/* ── Keyboard shortcut strip ── */}
      {selTask&&!workMode&&(
        <div style={{background:'#fafaf9',borderTop:'1px solid #e8e8e8',padding:'6px 20px',display:'flex',alignItems:'center',gap:12,flexShrink:0,flexWrap:'wrap'}}>
          <span style={{fontSize:10.5,color:'#9e9e9e',fontWeight:600,marginRight:4,letterSpacing:'.04em'}}>SHORTCUTS:</span>
          {[['j/k','navigate'],['e','escalate'],['s','snooze'],['r','reassign'],['x','resolve'],['a','assign to me'],['Esc','close']].map(([k,l])=>(
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
const QueueRow=({task,selected,checked,onCheck,onClick,onAction,onEscalMgr,currentUser,slaAgeClass,settings,perms,compact,onSnooze})=>{
  const [hov,setHov]=useState(false);
  const assignee=MEMBERS.find(m=>m.id===task.assigneeId)||(task.assigneeEmail?MEMBERS.find(m=>m.email===task.assigneeEmail):null)||{name:task.assigneeName||'Unassigned'};
  const sla=slaInfo(task);
  const isActive=task.status!=='resolved'&&task.status!=='waiting';
  const fn=FUNCTIONS[task.type];
  const rowAgeClass=slaAgeClass?slaAgeClass(task):'';
  const priColor=task.priority?PRIORITY_DOT[task.priority]:null;

  const relTime=(m)=>{
    if(m<=0)return'now';
    if(m<60)return`${m}m ago`;
    if(m<120){const r=m%60;return r?`1h ${r}m ago`:'1h ago';}
    return`${Math.floor(m/60)}h ago`;
  };

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
          <input type="checkbox" className="deel-checkbox" checked={checked||false} onChange={()=>{}} style={{accentColor:'#1f74b3',width:16,height:16,cursor:'pointer'}}/>
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
        {task.country&&<span>{FLAGS[task.country]||''} <span style={{color:'#616161',fontWeight:500}}>{task.country}</span></span>}
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
};

// ── Work Mode Overlay ──
const WorkModeOverlay=({task,remaining,totalOpen,skipped,onResolve,onEscalate,onReassign,onSnooze,onSkip,onSetInProgress,onExit,settings})=>{
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

  const assignee=MEMBERS.find(m=>m.id===task.assigneeId)||(task.assigneeEmail?MEMBERS.find(m=>m.email===task.assigneeEmail):null)||{name:task.assigneeName||'Unassigned',initials:(task.assigneeName||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()};
  const sla=slaInfo(task);
  const fn=FUNCTIONS[task.type];
  const tool=TOOLS[task.source];
  const slaLim=SLA_MINS[task.type]||1440;
  const slaRem=slaLim-(task.minutesAgo??0);
  const slaPct=Math.max(0,Math.min(100,(slaRem/slaLim)*100));
  const slaBarColor=slaRem<=0?'#b91c1c':slaPct>50?'#15803d':slaPct>20?'#b45309':'#b91c1c';
  const processed=totalOpen-remaining;
  const progressPct=totalOpen>0?Math.round((processed/totalOpen)*100):0;

  const relTime=(m)=>{
    if(m<=0)return'now';
    if(m<60)return`${m}m ago`;
    if(m<120){const r=m%60;return r?`1h ${r}m ago`:'1h ago';}
    return`${Math.floor(m/60)}h ago`;
  };

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
          <div><span style={metaLabel}>Country</span><span style={metaValue}>{FLAGS[task.country]||''} {task.country||'—'}</span></div>
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
};

// ── Custom Filter Dropdown ──
const FilterDropdown=({icon,label,value,options,onChange,activeColor='#1f74b3',isSort})=>{
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
};

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
