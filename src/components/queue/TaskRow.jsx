import { useState, useContext } from 'react';
import { PermissionsContext, SettingsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { TOOLS, FLAGS } from '../../data/constants';
import { ageDot, ageClass, slaInfo, rel, getUrl } from '../../utils/helpers';
import { ToolBadge, FnBadge, StatusBadge, SlaBadge } from '../ui/Badges';
import Avatar from '../ui/Avatar';

// Better time display helper
const relTime=(m)=>{
  if(m<=0)return'now';
  if(m<60)return`${m}m ago`;
  if(m<120){const r=m%60;return r?`1h ${r}m ago`:'1h ago';}
  return`${Math.floor(m/60)}h ago`;
};

// Priority border colors using CSS variables
const PRIORITY_BORDER={
  critical:'var(--red-solid, #dc2626)',
  high:'var(--orange-solid, #d97706)',
  medium:'var(--priority-medium, #0369a1)',
  low:'var(--text-muted, #9b928a)',
};

const TaskRow=({task,index,selected,onClick,onAction,onEscalMgr,compact,checked,onCheck,currentUser,slaAgeClass})=>{
  const perms=useContext(PermissionsContext);
  const settings=useContext(SettingsContext);
  const [hov,setHov]=useState(false);
  const assignee=MEMBERS.find(m=>m.id===task.assigneeId)||(task.assigneeEmail?MEMBERS.find(m=>m.email===task.assigneeEmail):null)||{name:task.assigneeName||'Unassigned',country:'',team:''};
  const dot=ageDot(task.minutesAgo,task.status);
  const sla=slaInfo(task);
  const hasUpdate=task.updatedMinsAgo!==task.minutesAgo;
  const isActive=task.status!=='resolved'&&task.status!=='waiting';
  // Use SLA-based age class if provided, fall back to minutesAgo-based
  const rowAgeClass=slaAgeClass?slaAgeClass(task):ageClass(task.minutesAgo,task.status);
  const priorityColor=task.priority?PRIORITY_BORDER[task.priority]:null;
  const borderLeft=priorityColor?`3px solid ${priorityColor}`:'3px solid transparent';
  // "From: System" → "Auto-created"
  const requesterDisplay=(task.requesterName==='System'||(!task.assigneeId&&task.requesterName==='System'))?'Auto-created':task.requesterName;
  return(
    <div role="row" aria-selected={selected} className={`task-row ${selected?'selected':''} ${rowAgeClass}`}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} onClick={onClick}
      style={{display:'grid',gridTemplateColumns:compact
        ?'36px 84px 1fr 56px 80px 68px 60px 96px 28px'
        :'36px 84px 1fr 56px 80px 68px 68px 60px 96px 28px',
        alignItems:'center',padding:'0 16px',borderBottom:'1px solid #f5f5f5',minHeight:48,gap:'0 8px',
        background:selected?'#e8f0fe':hov?'#f9f8f6':'transparent',
        cursor:'pointer',transition:'background 0.1s',
        borderLeft}}>
      {/* 1. Checkbox */}
      <div onClick={e=>{e.stopPropagation();onCheck();}} style={{display:'flex',alignItems:'center',justifyContent:'center',opacity:hov||checked?1:0,transition:'opacity .15s'}}>
        <input type="checkbox" className="deel-checkbox" checked={checked||false} onChange={()=>{}} aria-label={`Select task ${task.id}`} style={{accentColor:'#1f74b3',width:16,height:16,cursor:'pointer'}}/>
      </div>
      {/* 2. Source */}
      <div>
        <ToolBadge source={task.source} title={`${TOOLS[task.source]?.label||task.source}${task.id?' #'+task.id:''}`}/>
      </div>
      {/* 3. Subject — main content */}
      <div style={{minWidth:0,display:'flex',flexDirection:'column',justifyContent:'center',gap:2}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          {task.isAlert&&<span className="pulse" style={{width:6,height:6,borderRadius:'50%',background:'#ed8d00',flexShrink:0}}></span>}
          <span title={task.subject} style={{color:'#1b1b1b',fontSize:14,lineHeight:'var(--lh-snug, 1.375)',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1,minWidth:60}}>{task.subject}</span>
          {isActive&&task.minutesAgo>=120&&<span className="urgency-pill" style={{background:'#ffe2de',color:'#d42d35',flexShrink:0}}><i className="bi-exclamation-circle" style={{fontSize:8}}></i></span>}
          {isActive&&task.minutesAgo>=60&&task.minutesAgo<120&&<span className="urgency-pill" style={{background:'#fff3ee',color:'#ed5e2a',flexShrink:0}}><i className="bi-fire" style={{fontSize:8}}></i></span>}
          {isActive&&task.minutesAgo>=30&&task.minutesAgo<60&&<span className="urgency-pill" style={{background:'#fff8e6',color:'#ed8d00',flexShrink:0}}><i className="bi-clock" style={{fontSize:8}}></i></span>}
          {task.snoozeLabel&&<span className="snooze-pill" style={{flexShrink:0}}><i className="bi-alarm" style={{fontSize:8}}></i></span>}
        </div>
        {/* Linked ticket badges */}
        {task.linkedTickets&&task.linkedTickets.length>0&&(
          <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:1}}>
            {task.linkedTickets.map((lt,i)=>(
              <span key={i} style={{display:'inline-flex',alignItems:'center',gap:2,padding:'1px 6px',borderRadius:128,background:'var(--border,#e8e4df)',fontSize:11,color:'#616161',fontWeight:500,lineHeight:1.5}}>
                <i className="bi-link-45deg" style={{fontSize:10}}></i>
                {lt.id}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* 4. Country */}
      <div style={{display:'flex',alignItems:'center',gap:4,justifyContent:'center'}}>
        {task.country&&<span>{FLAGS[task.country]||''}</span>}
        <span style={{fontSize:11,color:'#616161',fontWeight:500}}>{task.country||''}</span>
      </div>
      {/* 5. Assignee */}
      <div style={{display:'flex',alignItems:'center',gap:4,minWidth:0}}>
        <Avatar name={assignee.name} size="xs"/>
        <span style={{fontSize:13,color:'#1b1b1b',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{assignee.name?.split(' ')[0]||''}</span>
      </div>
      {/* 6. Received */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:3}}>
        {dot&&<span style={{width:5,height:5,borderRadius:'50%',background:dot,flexShrink:0}}></span>}
        <span style={{color:task.status==='resolved'?'#9e9e9e':dot?dot:task.minutesAgo<=15?'#0a5a99':'#616161',fontSize:12,fontWeight:dot?600:400,whiteSpace:'nowrap'}}>{relTime(task.minutesAgo)}</span>
      </div>
      {/* 6. Updated (hidden in compact) */}
      {!compact&&<div style={{textAlign:'center'}}>
        <span style={{color:'#9e9e9e',fontSize:12,whiteSpace:'nowrap'}}>{hasUpdate?relTime(task.updatedMinsAgo):'--'}</span>
      </div>}
      {/* 7. SLA */}
      {settings.sla_enabled!==false&&<div style={{textAlign:'center'}}>
        <SlaBadge sla={sla} status={task.status}/>
      </div>}
      {/* 8. Status + Actions on hover */}
      <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:2}}>
        {hov&&task.status!=='resolved'?(
          <div style={{display:'flex',gap:2}} onClick={e=>e.stopPropagation()}>
            {perms?.canDo('can_reassign')!==false&&<button title="Reassign" onClick={()=>onAction(task,'reassign')} style={{width:24,height:24,borderRadius:6,border:'none',background:'#e8f0fe',color:'#1f74b3',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,transition:'all .12s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='#1f74b3';e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='#e8f0fe';e.currentTarget.style.color='#1f74b3';}}><i className="bi-person-up"></i></button>}
            {perms?.canDo('can_escalate')!==false&&<button title="Escalate" onClick={()=>onEscalMgr&&onEscalMgr(task)} style={{width:24,height:24,borderRadius:6,border:'none',background:'#fff8e6',color:'#ed8d00',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,transition:'all .12s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='#ed8d00';e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='#fff8e6';e.currentTarget.style.color='#ed8d00';}}><i className="bi-arrow-up-circle"></i></button>}
            {perms?.canDo('can_snooze_task')!==false&&<button title="Pause" onClick={()=>onAction(task,'snooze')} style={{width:24,height:24,borderRadius:6,border:'none',background:'#f3f3f3',color:'#616161',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,transition:'all .12s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='#616161';e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='#f3f3f3';e.currentTarget.style.color='#616161';}}><i className="bi-pause-circle"></i></button>}
            {perms?.canDo('can_resolve_task')!==false&&<button title="Resolve" onClick={()=>onAction(task,'close')} style={{width:24,height:24,borderRadius:6,border:'none',background:'#e8f5e9',color:'#29811e',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,transition:'all .12s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='#29811e';e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='#e8f5e9';e.currentTarget.style.color='#29811e';}}><i className="bi-check-circle"></i></button>}
          </div>
        ):(
          <StatusBadge status={task.status}/>
        )}
      </div>
      {/* 9. External link */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
        <a href={getUrl(task)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} aria-label={`Open ${task.id} in ${TOOLS[task.source]?.label}`} title={`Open in ${TOOLS[task.source]?.label}`}
          style={{display:'flex',alignItems:'center',justifyContent:'center',color:hov?'#1f74b3':'#d0d0d0',transition:'color .15s',textDecoration:'none'}}>
          <i className="bi-box-arrow-up-right" style={{fontSize:11}}></i>
        </a>
      </div>
    </div>
  );
};

export default TaskRow;
