import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { PermissionsContext, SettingsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { TOOLS, STATUSES, FLAGS, SLA_MINS, getFlag } from '../../data/constants';
import { slaInfo, rel, getUrl } from '../../utils/helpers';
import { ToolBadge, FnBadge, StatusBadge } from '../ui/Badges';
import Avatar from '../ui/Avatar';
import NotesTab from './NotesTab';
import TimelineTab from './TimelineTab';
import { fetchTicketComments, postTicketAction } from '../../services/integrationsApi';

// ZD status tooltip descriptions
const STATUS_TOOLTIPS={
  new:'Just received, not yet opened by an agent.',
  in_progress:'ZD Open / Jira In Progress — actively being worked.',
  waiting:'ZD Pending (waiting on requester) / ZD On-Hold.',
  resolved:'ZD Solved / Jira Done — issue has been closed.',
};

// Supported translation languages
const TRANSLATE_LANGS=['Japanese','French','German','Spanish','Portuguese'];

// Mock translation — prepend language tag
const mockTranslate=(text,lang)=>`[Translated to ${lang}]: ${text||''}`;

// Quick reply templates keyed by task type
const REPLY_TEMPLATES={
  default:'Thank you for reaching out. I\'m reviewing your request and will follow up within [SLA time].',
  'Payment Issue':'I can see there\'s a discrepancy in your payslip. I\'ve raised this with the payroll team and expect a correction within 2 business days.',
  'Immigration':'Your immigration case has been received. Please allow 5-10 business days for processing.',
  'Onboarding':'Welcome! Your onboarding request has been received. Your manager will be in touch shortly.',
  'Benefits':'Your benefits query has been logged. Our benefits team will respond within 24 hours.',
  'Leave Request':'Your leave request has been reviewed. Please check your leave balance in the HR portal.',
  'Leave Query':'Your leave request has been reviewed. Please check your leave balance in the HR portal.',
};

const Detail=({task,onClose,onAction,tasks,setTasks,notes,setNotes,activity,setActivity,currentUser,onEscalMgr,escalations=[],onResolve,addToast})=>{
  const perms=useContext(PermissionsContext);
  const settings=useContext(SettingsContext);
  const [tab,setTab]=useState('overview');
  const [showTemplates,setShowTemplates]=useState(false);
  const [replyText,setReplyText]=useState('');
  const [aiGenerating,setAiGenerating]=useState(false);
  const [showTranslateDD,setShowTranslateDD]=useState(false);
  const [activeLang,setActiveLang]=useState(null);
  const [originalReplyText,setOriginalReplyText]=useState(null);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Default to INTERNAL — public replies go to the requester (often the
  // affected employee), so making "public" an explicit affirmative click
  // prevents an agent from accidentally publishing internal notes. Jira
  // ignores this flag (its comments aren't split public/internal here).
  const [replyPublic, setReplyPublic] = useState(false);

  // Track mount state so async handlers (reply send, comment refresh) don't
  // setState on an unmounted component if the user closes the modal mid-flight.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Reset tab, reply, public toggle, and error state when task changes
  useEffect(()=>{
    setTab('overview'); setReplyText(''); setReplyPublic(false);
    setCommentsError(null); setComments([]);
  },[task.id]);
  // Fetch comments when Messages tab is opened (supports Zendesk + Jira).
  // Dedup via inflightRef so rapid tab-toggles don't fire parallel fetches.
  // Surfaces a distinct error state so users can tell 403/500 from empty.
  const commentsFetchRef = useRef(null);
  const loadComments = useCallback(() => {
    if (!task.id) return;
    if (task.source !== 'zendesk' && task.source !== 'jira') return;
    if (commentsFetchRef.current === task.id) return;
    commentsFetchRef.current = task.id;
    let cancelled = false;
    setCommentsLoading(true);
    setCommentsError(null);
    fetchTicketComments(task.id)
      .then(data => { if (!cancelled && mountedRef.current) {
        // Render the full comment list returned by /queue/[ticketId]/comments
        // (server already caps at 5 via per_page=5). Previously sliced to the
        // most recent 2, which silently hid 60% of the conversation context
        // an agent needs before replying.
        setComments(data.comments || []);
      }})
      .catch(err => { if (!cancelled && mountedRef.current) {
        setCommentsError(err?.message || 'Failed to load messages');
      }})
      .finally(() => {
        if (!cancelled && mountedRef.current) setCommentsLoading(false);
        if (commentsFetchRef.current === task.id) commentsFetchRef.current = null;
      });
    return () => { cancelled = true; };
  }, [task.id, task.source]);
  useEffect(() => {
    if (tab !== 'messages') return;
    const cleanup = loadComments();
    return cleanup;
  }, [tab, loadComments]);

  // Translate dropdown close on outside click
  const translateRef = useRef(null);
  useEffect(() => {
    if (!showTranslateDD) return;
    const h = (e) => { if (translateRef.current && !translateRef.current.contains(e.target)) setShowTranslateDD(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showTranslateDD]);

  // ── Focus trap ─────────────────────────────────────────────────────────
  // Keeps keyboard focus inside the modal while it's open so screen-reader
  // and keyboard-only users can't accidentally tab out to background content.
  // Sets initial focus to the first interactive element. Tab cycles forward
  // from last → first; Shift+Tab cycles backward from first → last.
  const modalRef = useRef(null);
  useEffect(() => {
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    // Focus the first focusable after paint so it respects the rendered DOM
    const t = setTimeout(() => {
      const first = modalRef.current?.querySelector(FOCUSABLE);
      if (first && !modalRef.current.contains(document.activeElement)) first.focus();
    }, 0);
    const handleTab = (e) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const nodes = modalRef.current.querySelectorAll(FOCUSABLE);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', handleTab);
    };
  }, []);

  const assignee=MEMBERS.find(m=>m.id===task.assigneeId)||(task.assigneeEmail?MEMBERS.find(m=>m.email.toLowerCase()===task.assigneeEmail.toLowerCase()):null)||{id:null,name:task.assigneeName||'Unassigned',initials:(task.assigneeName||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),email:task.assigneeEmail};
  const taskEscalation=escalations.find(e=>e.taskId===task.id);
  const sla=slaInfo(task);

  // SLA progress bar data — honour the per-task slaMinsOverride first
  // (set in queue/route.js for ZD/Jira from app_settings.queue_sla_thresholds)
  // before falling back to the static type-based SLA_MINS map. Without
  // this, the Detail panel would show a different SLA window than the row
  // pill / Briefing aggregate for ZD and Jira tickets after the spec
  // values diverged from per-type defaults.
  const slaLim = (Number.isFinite(task.slaMinsOverride) && task.slaMinsOverride > 0)
    ? task.slaMinsOverride
    : (SLA_MINS[task.type] || 1440);
  const slaRem=slaLim-((task.minutesSinceLastResponse??task.minutesAgo)??0);
  const slaPct=Math.max(0,Math.min(100,(slaRem/slaLim)*100));
  const slaBarColor = slaRem<=0
    ? 'var(--red, #b91c1c)'
    : slaPct>50
    ? 'var(--green, #15803d)'
    : slaPct>20
    ? 'var(--orange, #b45309)'
    : 'var(--red, #b91c1c)';
  const slaBarText=slaRem<=0?`Breached ${Math.abs(slaRem)}m ago`:`${slaRem>=60?Math.floor(slaRem/60)+'h '+(slaRem%60?slaRem%60+'m':''):slaRem+'m'} remaining`;

  // Template list for this task type
  const templateKeys=['default',...Object.keys(REPLY_TEMPLATES).filter(k=>k!=='default')];
  const getTemplate=(type)=>REPLY_TEMPLATES[type]||REPLY_TEMPLATES.default;

  const tabItems=['overview','messages','notes','timeline','attachments','related'];

  // Modal overlay + centered popup style
  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
    animation: 'fadeInOverlay 0.2s ease both',
  };
  const modalStyle = {
    width: '90vw',
    height: '90vh',
    background: 'white',
    borderRadius: 16,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
    animation: 'scaleInModal 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
  };

  return(
    <div style={overlayStyle} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div ref={modalRef} className="detail-modal" style={modalStyle} role="dialog" aria-modal="true" aria-label={`Task details: ${task.subject}`}>
      <style>{`
        @keyframes fadeInOverlay { from { opacity:0; } to { opacity:1; } }
        @keyframes scaleInModal { from { opacity:0; transform:scale(0.97) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
      `}</style>
      {/* Header */}
      <div style={{padding:'16px 20px',borderBottom:'1px solid #e8e8e8',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8,alignItems:'center'}}>
              <ToolBadge source={task.source}/>
              {/* D: Status badge with info tooltip */}
              <div className="tooltip-wrap" style={{display:'inline-flex',alignItems:'center',gap:4,position:'relative'}}>
                <StatusBadge status={task.status}/>
                <i className="bi-info-circle" style={{fontSize:11,color:'#bebebe',cursor:'default'}}></i>
                <span className="tooltip-text" style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:200,background:'#1b1b1b',color:'white',fontSize:11,padding:'6px 10px',borderRadius:8,whiteSpace:'nowrap',pointerEvents:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.2)',minWidth:220,lineHeight:1.6}}>
                  {STATUS_TOOLTIPS[task.status]||'Status unknown'}
                </span>
              </div>
              {task.isAlert&&<span style={{background:'#fff8e6',color:'#ed8d00',borderRadius:128,padding:'2px 10px',fontSize:11,fontWeight:600}}>Alert</span>}
            </div>
            <div title={task.subject} style={{color:'#1b1b1b',fontWeight:700,fontSize:16,lineHeight:1.35,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',wordBreak:'break-word'}}>{task.subject}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
              <span style={{color:'#9e9e9e',fontSize:12}}>{task.id}</span>
              {/* E: Open in Source button — guarded */}
              {task.externalUrl&&(
                <button onClick={()=>window.open(task.externalUrl,'_blank')} style={{display:'inline-flex',alignItems:'center',gap:4,height:22,padding:'0 8px',borderRadius:128,border:'1px solid var(--border,#e8e4df)',background:'white',color:'#616161',fontSize:11,fontWeight:500,cursor:'pointer',transition:'all .12s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='#f2f2f2';e.currentTarget.style.borderColor='#c0c0c0';}}
                  onMouseLeave={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='var(--border,#e8e4df)';}}>
                  <i className="bi-box-arrow-up-right" style={{fontSize:9}}></i>
                  Open in {TOOLS[task.source]?.label||'Source'}
                </button>
              )}
            </div>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
            <a href={getUrl(task)} target="_blank" rel="noreferrer" title={`Open in ${TOOLS[task.source]?.label||'source'}`} style={{display:'flex',alignItems:'center',justifyContent:'center',width:32,height:32,borderRadius:8,border:'1px solid #e8e8e8',color:'#616161',textDecoration:'none',fontSize:14,transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor='#1f74b3';e.currentTarget.style.color='#1f74b3';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#e8e8e8';e.currentTarget.style.color='#616161';}}><i className="bi-box-arrow-up-right"></i></a>
            <button aria-label="Close detail panel" onClick={onClose} style={{display:'flex',alignItems:'center',justifyContent:'center',width:32,height:32,background:'none',border:'none',color:'#9e9e9e',cursor:'pointer',borderRadius:8,transition:'all .15s',fontSize:18}} onMouseEnter={e=>{e.currentTarget.style.background='#f2f2f2';e.currentTarget.style.color='#1b1b1b';}} onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='#9e9e9e';}}><i className="bi-x-lg"></i></button>
          </div>
        </div>
        {/* Tabs — Title Case labels */}
        <div role="tablist" aria-label="Task detail sections" style={{display:'flex',marginTop:14,gap:0,borderBottom:'1px solid #e8e8e8',marginLeft:-20,marginRight:-20,paddingLeft:20,paddingRight:20}}>
          {tabItems.map(t=>{
            const active=tab===t;
            const label={overview:'Overview',messages:'Messages',notes:'Notes',timeline:'Timeline',attachments:'Attachments',related:'Related'}[t]||t;
            const noteCount=t==='notes'?(notes[task.id]||[]).length:0;
            return(
              <div
                key={t}
                role="tab"
                tabIndex={active?0:-1}
                aria-selected={active}
                aria-label={`${label} tab${noteCount>0?` (${noteCount} notes)`:''}`}
                onClick={()=>setTab(t)}
                onKeyDown={(e)=>{ if (e.key==='Enter'||e.key===' '){ e.preventDefault(); setTab(t); } }}
                style={{padding:'10px 8px',marginRight:16,fontSize:14,fontWeight:active?700:400,color:active?'#1b1b1b':'#9e9e9e',borderBottom:active?'2px solid #1b1b1b':'2px solid transparent',cursor:'pointer',transition:'all .15s',display:'flex',alignItems:'center',gap:4,marginBottom:-1}}>
                {label}
                {noteCount>0&&<span aria-hidden="true" style={{background:active?'#1b1b1b':'#f2f2f2',color:active?'white':'#616161',borderRadius:10,padding:'0 6px',fontSize:10,fontWeight:700,lineHeight:'18px'}}>{noteCount}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {/* Body */}
      <div role="tabpanel" style={{flex:1,overflowY:'auto'}}>
        {/* ═══ OVERVIEW TAB — compact meta, SLA, escalation, linked systems ═══ */}
        {tab==='overview'&&(
          <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>
            {/* Meta — compact horizontal strip */}
            <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',padding:'10px 14px',background:'#fafaf9',borderRadius:10,border:'1px solid #f2f2f2'}}>
              {[
                {l:'Assignee',v:<span style={{display:'inline-flex',alignItems:'center',gap:4}}><Avatar name={assignee?.name||'Unassigned'} size={18}/>{assignee?.name||'Unassigned'}</span>},
                {l:'Country',v:`${getFlag(task.country)} ${task.country||'--'}`},
                {l:'Received',v:task.receivedAt||'--'},
                {l:'Updated',v:task.updatedMinsAgo!=null?rel(task.updatedMinsAgo):'--'},
                ...(task.requesterName?[{l:'Requester',v:task.requesterName}]:[])
              ].map((m,i,arr)=>(
                <span key={m.l} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12,color:'#1b1b1b',whiteSpace:'nowrap'}}>
                  <span style={{fontWeight:600,color:'#9e9e9e',fontSize:11,textTransform:'uppercase',letterSpacing:'0.03em'}}>{m.l}:</span>
                  {m.v}
                  {i<arr.length-1&&<span style={{color:'#e0e0e0',margin:'0 4px'}}>|</span>}
                </span>
              ))}
            </div>
            {/* SLA Remaining bar */}
            {settings.sla_enabled!==false&&task.status!=='resolved'&&task.status!=='waiting'&&(
              <div aria-live="polite" aria-atomic="true">
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>SLA</span>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(slaPct)}
                    aria-valuetext={`${Math.round(slaPct)}% SLA remaining — ${slaBarText}`}
                    aria-label="SLA remaining"
                    style={{flex:1,background:'#f2f2f2',borderRadius:4,height:5,overflow:'hidden'}}
                  >
                    <div style={{height:'100%',width:`${slaPct}%`,background:slaBarColor,borderRadius:4,transition:'width .3s'}}></div>
                  </div>
                  <span style={{fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{slaBarText}</span>
                  {!task.status?.includes('resolved')&&(
                    <span style={{fontSize:11,color:slaPct<20?'var(--red)':'var(--text-muted)',whiteSpace:'nowrap'}}>
                      ({Math.round(slaPct)}%)
                    </span>
                  )}
                </div>
              </div>
            )}
            {/* SLA Info banner */}
            {settings.sla_enabled!==false&&sla&&(
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderRadius:10,background:sla.bg,border:`1px solid ${sla.color}22`}}>
                <i className={sla.breach?'bi-exclamation-triangle-fill':'bi-clock'} style={{fontSize:12,color:sla.color}}></i>
                <span style={{fontSize:12,fontWeight:600,color:sla.color}}>{sla.label}</span>
              </div>
            )}
            {/* C: Offboarding Processing Time */}
            {(task.source==='workbench'||/offboard|termination/i.test(task.subject))&&task.status!=='resolved'&&(()=>{
              const dayNum=Math.round(task.minutesAgo/60/24)||1;
              const ptColor=dayNum<=4?'#29811e':dayNum===5?'#ed8d00':'#d42d35';
              const ptPct=Math.min(100,(dayNum/6)*100);
              return(
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>Processing</span>
                  <div style={{flex:1,background:'#f2f2f2',borderRadius:4,height:5,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${ptPct}%`,background:ptColor,borderRadius:4,transition:'width .3s'}}></div>
                  </div>
                  <span style={{fontSize:11,color:ptColor,fontWeight:600,whiteSpace:'nowrap'}}>Day {dayNum}/6</span>
                </div>
              );
            })()}
            {/* Escalation Status */}
            {taskEscalation&&(
              <div style={{background:taskEscalation.managerResponseStatus==='responded'?'#F0FDF9':'#fff8e6',border:`1px solid ${taskEscalation.managerResponseStatus==='responded'?'#A7F3D0':'#ffe27c'}`,borderRadius:10,padding:'10px 14px'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:taskEscalation.managerResponseStatus==='responded'?'#29811e':'#ed8d00',display:'inline-block',flexShrink:0}}></span>
                  <span style={{fontSize:12,fontWeight:700,color:taskEscalation.managerResponseStatus==='responded'?'#29811e':'#92400E'}}>
                    <i className="bi-arrow-up-circle-fill" style={{marginRight:4,fontSize:11}}></i>
                    Escalated to {taskEscalation.managerName}
                    <span style={{fontWeight:400,marginLeft:6,color:'#616161'}}>
                      {taskEscalation.managerResponseStatus==='responded'?'Responded':'Pending Response'}
                    </span>
                  </span>
                </div>
                <div style={{fontSize:12,color:'#616161'}}><span style={{fontWeight:600}}>Reason:</span> {taskEscalation.reason}</div>
              </div>
            )}
            {/* Open in source link */}
            <a href={getUrl(task)} target="_blank" rel="noreferrer" style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 16px',borderRadius:128,border:'1px solid #e8e8e8',background:'white',color:'#1f74b3',fontSize:13,fontWeight:600,textDecoration:'none',transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.background='#e8f0fe';}} onMouseLeave={e=>{e.currentTarget.style.background='white';}}>
              <i className={TOOLS[task.source]?.icon||'bi-box-arrow-up-right'} style={{fontSize:12}}></i>
              Open in {TOOLS[task.source]?.label||'Source'}
              <i className="bi-box-arrow-up-right" style={{fontSize:10,marginLeft:2}}></i>
            </a>
            {/* Mark Resolved button — gated by can_resolve_task */}
            {task.status!=='resolved'&&onResolve&&perms?.canDo('can_resolve_task')!==false&&(
              <button onClick={()=>onResolve(task)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 16px',borderRadius:128,border:'1px solid #29811e',background:'#e8f5e9',color:'#29811e',fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s',width:'100%'}}
                onMouseEnter={e=>{e.currentTarget.style.background='#29811e';e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='#e8f5e9';e.currentTarget.style.color='#29811e';}}>
                <i className="bi-check-circle-fill" style={{fontSize:13}}></i>Mark Resolved
              </button>
            )}
          </div>
        )}
        {/* ═══ MESSAGES TAB — AI summary, message body, quick reply ═══ */}
        {tab==='messages'&&(
          <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:16,height:'100%'}}>
            {/* G: AI Summary card */}
            {task.aiSummary&&(
              <div style={{background:'#f5f3ff',border:'1px solid #c4b1f9',borderRadius:12,padding:'12px 14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <i className="bi-stars" style={{fontSize:12,color:'#7c3aed'}}></i>
                    <span style={{fontSize:11,fontWeight:700,color:'#7c3aed',letterSpacing:'.05em',textTransform:'uppercase'}}>AI Summary</span>
                  </div>
                  <button onClick={()=>{setAiGenerating(true);setTimeout(()=>setAiGenerating(false),1500);}} style={{display:'inline-flex',alignItems:'center',gap:3,height:22,padding:'0 8px',borderRadius:128,border:'1px solid #c4b1f9',background:'white',color:'#7c3aed',fontSize:11,fontWeight:500,cursor:'pointer',transition:'all .12s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='#ede9fe';}} onMouseLeave={e=>{e.currentTarget.style.background='white';}}>
                    <i className="bi-arrow-clockwise" style={{fontSize:9}}></i>
                    {aiGenerating?'Generating...':'Regenerate'}
                  </button>
                </div>
                {aiGenerating?(
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',color:'var(--text-muted)',fontSize:'var(--font-sm)'}}>
                    <span className="skeleton" style={{width:120,height:12}}/>
                    <span className="skeleton" style={{width:80,height:12}}/>
                    <span className="skeleton" style={{width:100,height:12}}/>
                  </div>
                ):(
                  <p style={{fontSize:13,color:'#4b5563',lineHeight:1.6,margin:0}}>{task.aiSummary}</p>
                )}
              </div>
            )}
            {/* Recent Messages — supports Zendesk + Jira */}
            {(task.source === 'zendesk' || task.source === 'jira') && (
              <div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Recent Messages</div>
                  {commentsError && !commentsLoading && (
                    <button onClick={loadComments} title="Retry loading messages" style={{padding:'2px 10px',borderRadius:128,border:'1px solid #fca5a5',background:'white',color:'#991b1b',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                      <i className="bi-arrow-clockwise" style={{fontSize:10,marginRight:4}}/>Retry
                    </button>
                  )}
                </div>
                {commentsLoading ? (
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {[1,2].map(i=><div key={i} className="skeleton" style={{height:60,borderRadius:8}}/>)}
                  </div>
                ) : commentsError ? (
                  <div style={{padding:'12px 14px',background:'#fef2f2',borderRadius:10,border:'1px solid #fca5a5',color:'#991b1b',fontSize:12}}>
                    <i className="bi-exclamation-triangle-fill" style={{fontSize:11,marginRight:6}}/>
                    Couldn't load messages: {commentsError}
                  </div>
                ) : comments.length === 0 ? (
                  <div style={{padding:'12px 14px',background:'#fafaf9',borderRadius:10,border:'1px solid #f2f2f2',color:'#9e9e9e',fontSize:12,textAlign:'center'}}>
                    No recent messages from {task.source === 'zendesk' ? 'Zendesk' : 'Jira'}
                  </div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {comments.map(c => (
                      <div key={c.id} style={{padding:'10px 14px',borderRadius:10,background:c.public?'#fafaf9':'#fffbeb',border:`1px solid ${c.public?'#f2f2f2':'#fde68a'}`,position:'relative'}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:11,fontWeight:600,color:'#616161'}}>#{c.author||'Unknown'}</span>
                            {!c.public && <span style={{fontSize:9,fontWeight:700,color:'#92400E',background:'#fef3c7',padding:'1px 6px',borderRadius:128}}>INTERNAL</span>}
                          </div>
                          <span style={{fontSize:10,color:'#9e9e9e'}}>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}</span>
                        </div>
                        <div style={{fontSize:12,color:'#4b5563',lineHeight:1.5,whiteSpace:'pre-wrap',maxHeight:80,overflowY:'auto'}}>{c.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {task.source !== 'zendesk' && task.source !== 'jira' && (
              <div style={{padding:'12px 14px',background:'#f7f5f2',borderRadius:10,border:'1px solid #e8e8e8',color:'#616161',fontSize:12,display:'flex',alignItems:'center',gap:8}}>
                <i className="bi-info-circle" style={{fontSize:13}}/>
                Messages are only available for Zendesk and Jira tickets.
              </div>
            )}
            {/* Message Body — expanded */}
            {task.body&&(
              <div style={{flex:'1 1 auto',minHeight:0,display:'flex',flexDirection:'column'}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Message</div>
                <div style={{flex:1,background:'#fafaf9',borderRadius:10,padding:'14px 16px',color:'#4b5563',fontSize:13,lineHeight:1.7,border:'1px solid #f2f2f2',overflowY:'auto'}}>{task.body}</div>
              </div>
            )}
            {!task.body&&!task.aiSummary&&(
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#9e9e9e',fontSize:14}}>
                <div style={{textAlign:'center'}}>
                  <i className="bi-chat-left-text" style={{fontSize:28,display:'block',marginBottom:8,color:'#d0d0d0'}}></i>
                  No messages yet
                </div>
              </div>
            )}
            {/* Quick reply templates + textarea — larger and more prominent */}
            {settings.ai_replies_enabled!==false&&<div style={{flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Quick Reply</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {/* H: Translate button */}
                  <div ref={translateRef} style={{position:'relative'}}>
                    <button onClick={()=>setShowTranslateDD(v=>!v)} aria-haspopup="menu" aria-expanded={showTranslateDD} aria-label={activeLang?`Translate reply (currently ${activeLang})`:'Translate reply'} style={{display:'inline-flex',alignItems:'center',gap:4,height:26,padding:'0 10px',borderRadius:6,border:'1px solid #e8e8e8',background:showTranslateDD?'#e8f0fe':'white',color:showTranslateDD?'#1f74b3':'#616161',fontSize:11,fontWeight:500,cursor:'pointer',transition:'all .12s'}}>
                      Translate
                    </button>
                    {showTranslateDD&&(
                      <div role="menu" aria-label="Translate to language" style={{position:'absolute',right:0,top:30,width:160,background:'white',border:'1px solid #e8e8e8',borderRadius:10,boxShadow:'0 4px 16px rgba(0,0,0,0.1)',zIndex:110,overflow:'hidden'}}>
                        {TRANSLATE_LANGS.map(lang=>(
                          <button key={lang} role="menuitem" onClick={()=>{
                            const orig=activeLang?originalReplyText:replyText;
                            setOriginalReplyText(orig);
                            setReplyText(mockTranslate(orig,lang));
                            setActiveLang(lang);
                            setShowTranslateDD(false);
                          }} style={{display:'block',width:'100%',textAlign:'left',padding:'8px 14px',border:'none',borderBottom:'1px solid #f2f2f2',background:'white',cursor:'pointer',fontSize:12,color:'#1b1b1b',transition:'background .1s'}}
                            onMouseEnter={e=>e.currentTarget.style.background='#f7f5f2'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            {lang}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{position:'relative'}}>
                    <button onClick={()=>setShowTemplates(t=>!t)} aria-haspopup="menu" aria-expanded={showTemplates} aria-label="Choose reply template" style={{display:'inline-flex',alignItems:'center',gap:4,height:26,padding:'0 10px',borderRadius:6,border:'1px solid #e8e8e8',background:showTemplates?'#e8f0fe':'white',color:showTemplates?'#1f74b3':'#616161',fontSize:11,fontWeight:500,cursor:'pointer',transition:'all .12s'}}>
                      <i className="bi-file-text" aria-hidden="true" style={{fontSize:10}}></i>Templates
                    </button>
                    {showTemplates&&(
                      <div style={{position:'absolute',right:0,top:30,width:280,background:'white',border:'1px solid #e8e8e8',borderRadius:10,boxShadow:'0 4px 16px rgba(0,0,0,0.1)',zIndex:100,overflow:'hidden'}}>
                        {templateKeys.map(key=>{
                          const tpl=REPLY_TEMPLATES[key];
                          const tplLabel=key==='default'?'General':key;
                          return(
                            <button key={key} onClick={()=>{setReplyText(tpl);setShowTemplates(false);}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 14px',border:'none',borderBottom:'1px solid #f2f2f2',background:'white',cursor:'pointer',fontSize:12,color:'#1b1b1b',transition:'background .1s'}}
                              onMouseEnter={e=>e.currentTarget.style.background='#f7f5f2'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                              <div style={{fontWeight:600,marginBottom:2,fontSize:12}}>{tplLabel}</div>
                              <div style={{color:'#9e9e9e',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tpl.slice(0,60)}...</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <textarea value={replyText} onChange={e=>setReplyText(e.target.value)} aria-label="Quick reply message" className="note-input" rows={6} placeholder="Type a reply or select a template above..." style={{width:'100%',boxSizing:'border-box',minHeight:120,fontSize:13,lineHeight:1.6}}/>
              {/* H: Active translation badge */}
              {activeLang&&(
                <div style={{display:'inline-flex',alignItems:'center',gap:6,marginTop:6,padding:'4px 12px',borderRadius:128,background:'#e8f0fe',border:'1px solid #93c5fd',fontSize:11,color:'#1f74b3',fontWeight:500}}>
                  Translated to: {activeLang}
                  <button onClick={()=>{if(originalReplyText!=null)setReplyText(originalReplyText);setActiveLang(null);setOriginalReplyText(null);}} style={{background:'none',border:'none',cursor:'pointer',color:'#1f74b3',fontSize:12,padding:0,lineHeight:1,display:'flex',alignItems:'center'}} title="Revert translation">x</button>
                </div>
              )}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {task.source === 'zendesk' && (
                    <label
                      title={replyPublic
                        ? 'This reply will be sent to the requester.'
                        : 'Internal notes are only visible to your team in Zendesk.'}
                      style={{display:'inline-flex',alignItems:'center',gap:6,padding:'3px 10px',borderRadius:128,fontSize:11,fontWeight:600,cursor:'pointer',
                        background:replyPublic?'#fef2f2':'#fef3c7',
                        color:replyPublic?'#991b1b':'#92400E',
                        border:`1px solid ${replyPublic?'#fca5a5':'#fde68a'}`,
                      }}>
                      <input type="checkbox" checked={replyPublic} onChange={e=>setReplyPublic(e.target.checked)} style={{accentColor:replyPublic?'#d42d35':'#92400E'}}/>
                      {replyPublic ? 'Public — visible to requester' : 'Internal note'}
                    </label>
                  )}
                </div>
                <button
                  disabled={!replyText.trim() || actionLoading}
                  onClick={async()=>{
                    if(!replyText.trim())return;
                    setActionLoading(true);
                    try{
                      // Route reply to correct backend (Zendesk or Jira)
                      await postTicketAction(task.id,{action:'reply',message:replyText,public:replyPublic});
                      if (!mountedRef.current) return;
                      const sentMode = task.source === 'zendesk'
                        ? (replyPublic ? 'Public reply sent' : 'Internal note added')
                        : 'Reply sent';
                      const sentDetail = task.source === 'zendesk' && replyPublic
                        ? 'Visible to the requester in Zendesk.'
                        : task.source === 'zendesk'
                          ? 'Only visible to your team in Zendesk.'
                          : 'Your reply has been posted to the ticket.';
                      addToast&&addToast('success',sentMode,sentDetail);
                      setReplyText('');
                      // Refresh comments — guard against unmount + re-dedup via ref
                      commentsFetchRef.current = null;
                      loadComments();
                    }catch(err){
                      if (mountedRef.current) addToast&&addToast('error','Reply failed',err.message||'Could not send reply.');
                    }finally{
                      if (mountedRef.current) setActionLoading(false);
                    }
                  }}
                  style={{display:'inline-flex',alignItems:'center',gap:5,height:34,padding:'0 20px',borderRadius:128,border:'none',
                    background:!replyText.trim()||actionLoading?'#e0e0e0':(task.source==='zendesk'&&replyPublic?'#b91c1c':'#1b1b1b'),
                    color:replyText.trim()&&!actionLoading?'white':'#9e9e9e',fontSize:12,fontWeight:700,
                    cursor:replyText.trim()&&!actionLoading?'pointer':'not-allowed',transition:'all .15s'}}
                >
                  {actionLoading
                    ? <><i className="bi-hourglass-split" style={{fontSize:11}}></i>Sending...</>
                    : task.source !== 'zendesk'
                      ? <><i className="bi-send" style={{fontSize:11}}></i>Send Reply</>
                      : replyPublic
                        ? <><i className="bi-send-fill" style={{fontSize:11}}></i>Send Public Reply</>
                        : <><i className="bi-journal-text" style={{fontSize:11}}></i>Add Internal Note</>}
                </button>
              </div>
            </div>}
          </div>
        )}
        {/* ═══ NOTES TAB ═══ */}
        {tab==='notes'&&<NotesTab taskId={task.id} notes={notes} setNotes={setNotes} currentUser={currentUser} setActivity={setActivity}/>}
        {/* ═══ TIMELINE TAB ═══ */}
        {tab==='timeline'&&<TimelineTab taskId={task.id} task={task} activity={activity} escalation={taskEscalation}/>}
        {/* ═══ ATTACHMENTS TAB — placeholder ═══ */}
        {tab==='attachments'&&(
          <div style={{padding:'40px 20px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#9e9e9e',textAlign:'center',minHeight:200}}>
            <i className="bi-paperclip" style={{fontSize:32,color:'#d0d0d0',marginBottom:12}}></i>
            <div style={{fontSize:15,fontWeight:600,color:'#616161',marginBottom:4}}>No Attachments</div>
            <div style={{fontSize:13,color:'#9e9e9e',maxWidth:280}}>Attachments from this ticket will appear here. This feature is coming soon.</div>
          </div>
        )}
        {/* ═══ RELATED TAB — placeholder ═══ */}
        {tab==='related'&&(
          <div style={{padding:'40px 20px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#9e9e9e',textAlign:'center',minHeight:200}}>
            <i className="bi-diagram-3" style={{fontSize:32,color:'#d0d0d0',marginBottom:12}}></i>
            <div style={{fontSize:15,fontWeight:600,color:'#616161',marginBottom:4}}>No Related Tickets</div>
            <div style={{fontSize:13,color:'#9e9e9e',maxWidth:280}}>Related and duplicate tickets will be shown here. This feature is coming soon.</div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default Detail;
