import { useState, useContext } from 'react';
import { PermissionsContext, SettingsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import { rel, getUrl } from '../../utils/helpers';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import PageHeader from '../ui/PageHeader';
import { FnBadge } from '../ui/Badges';

// ── Litigation mock data ────────────────────────────────────────────────────
const LITIGATION_CHANNELS=[
  {id:'lit-1',caseRef:'LIT-001',country:'UK',employeeName:'Employee A',issue:'Wrongful termination',status:'active',openedAt:'2026-01-12',slackChannel:'#lit-uk-001',jiraTicket:'LIT-001'},
  {id:'lit-2',caseRef:'LIT-002',country:'DE',employeeName:'Employee B',issue:'Wage dispute',status:'monitoring',openedAt:'2026-01-28',slackChannel:'#lit-de-002',jiraTicket:'LIT-002'},
  {id:'lit-3',caseRef:'LIT-003',country:'FR',employeeName:'Employee C',issue:'Discrimination',status:'active',openedAt:'2026-02-03',slackChannel:'#lit-fr-003',jiraTicket:'LIT-003'},
  {id:'lit-4',caseRef:'LIT-004',country:'SG',employeeName:'Employee D',issue:'Contract breach',status:'resolved',openedAt:'2025-11-15',slackChannel:'#lit-sg-004',jiraTicket:'LIT-004'},
  {id:'lit-5',caseRef:'LIT-005',country:'AU',employeeName:'Employee E',issue:'Wrongful termination',status:'active',openedAt:'2026-02-19',slackChannel:'#lit-au-005',jiraTicket:'LIT-005'},
  {id:'lit-6',caseRef:'LIT-006',country:'NL',employeeName:'Employee F',issue:'Wage dispute',status:'monitoring',openedAt:'2026-03-01',slackChannel:'#lit-nl-006',jiraTicket:'LIT-006'},
  {id:'lit-7',caseRef:'LIT-007',country:'US',employeeName:'Employee G',issue:'Discrimination',status:'resolved',openedAt:'2025-12-10',slackChannel:'#lit-us-007',jiraTicket:'LIT-007'},
  {id:'lit-8',caseRef:'LIT-008',country:'CA',employeeName:'Employee H',issue:'Contract breach',status:'active',openedAt:'2026-03-10',slackChannel:'#lit-ca-008',jiraTicket:'LIT-008'},
];

const LIT_STATUS_COLORS={
  active:{bg:'#ffe2de',color:'#d42d35',label:'Active'},
  monitoring:{bg:'#fff8e6',color:'#ed8d00',label:'Monitoring'},
  resolved:{bg:'#e8f5e3',color:'#29811e',label:'Resolved'},
};

// Consistent action button style for Reply / Addressed / Escalate
const msgActionStyle = {
  fontSize: 'var(--font-xs)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  background: 'var(--surface-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  padding: '3px 10px',
  cursor: 'pointer',
  transition: 'all 0.15s',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 32,
};

const Slack=({tasks,setTasks,onEscalMgr,addToast,user})=>{
  const slk=tasks.filter(t=>t.source==='slack');
  const [openR,setOpenR]=useState(null);
  const [texts,setTexts]=useState({});
  const [sentIds,setSentIds]=useState(new Set());
  const [sendingIds,setSendingIds]=useState(new Set());
  // Internal tab: 'escalations' | 'litigation'
  const [innerTab,setInnerTab]=useState('escalations');

  const send=(task)=>{
    setSendingIds(prev=>new Set([...prev,task.id]));
    setTimeout(()=>{
      setSentIds(prev=>new Set([...prev,task.id]));
      setSendingIds(prev=>{const n=new Set(prev);n.delete(task.id);return n;});
      setTimeout(()=>{ setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'resolved'}:t)); setOpenR(null); },900);
    },600);
  };
  const open=slk.filter(t=>t.status!=='resolved');
  const done=slk.filter(t=>t.status==='resolved');

  const perms=useContext(PermissionsContext);
  const settings=useContext(SettingsContext);
  const isAgent=perms?.dataScope==='own_tasks_only';

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflowY:'hidden'}}>
      <PageHeader icon="bi-chat-dots-fill" iconBg="#f3eff8" iconColor="#c4b1f9" title="Slack Messages" subtitle={`${open.length} open · Review and action each message`}/>
      <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>

      {/* ── Internal pill tabs ─────────────────────────────────────────── */}
      <div style={{display:'flex',background:'#f7f5f2',borderRadius:128,padding:3,gap:2,marginBottom:20,width:'fit-content'}}>
        {[{id:'escalations',label:'Escalations'},{id:'litigation',label:'Litigation'}].filter(tab=>(tab.id!=='escalations'||settings.slack_show_escalations_tab!==false)&&(tab.id!=='litigation'||settings.slack_show_litigation_tab!==false)).map(tab=>{
          const active=innerTab===tab.id;
          return(
            <button key={tab.id} onClick={()=>setInnerTab(tab.id)}
              style={{padding:'5px 16px',borderRadius:128,border:'none',background:active?'white':'transparent',color:active?'#1b1b1b':'#616161',fontSize:12,fontWeight:active?700:500,cursor:'pointer',boxShadow:active?'0 1px 3px rgba(0,0,0,0.08)':undefined,transition:'all .15s'}}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          ESCALATIONS TAB
      ════════════════════════════════════════════════════════════════ */}
      {innerTab==='escalations'&&(
        <>
          {open.length===0&&done.length===0&&<EmptyState icon="bi-chat-dots" title="No Slack messages" subtitle="Incoming @hr-ops mentions and DMs will appear here."/>}
          <div style={{display:'flex',flexDirection:'column',gap:0}}>
            {open.map(task=>{
              const isO=openR===task.id; const isSent=sentIds.has(task.id); const isSending=sendingIds.has(task.id);
              const rt=texts[task.id]??task.suggestedReply;
              return(
                <div key={task.id} style={{background:'white',border:isO?'1.5px solid #1f74b3':'1px solid var(--border-light)',borderRadius:'var(--radius-xl)',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s, border-color .15s',overflow:'hidden',marginBottom:12,borderBottom:'1px solid var(--border-light)'}}
                  onMouseEnter={e=>{if(!isO)e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)';}} onMouseLeave={e=>{if(!isO)e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)';}}>
                  <div style={{padding:'14px 18px 12px',display:'flex',alignItems:'flex-start',gap:12}}>
                    {/* Avatar with dark-mode-safe colours */}
                    <div style={{width:40,height:40,background:'var(--purple-light)',borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-slack" style={{color:'var(--purple)',fontSize:18}}></i></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4,flexWrap:'wrap'}}>
                        <span style={{fontWeight:700,color:'#1b1b1b',fontSize:14}}>{task.sender}</span>
                        <span style={{color:'#9e9e9e',fontSize:12}}>in</span>
                        <span style={{background:'#f3eff8',color:'#7c3aed',padding:'3px 10px',borderRadius:128,fontSize:12,fontWeight:600}}>{task.channel}</span>
                        <span style={{color:'#9e9e9e',fontSize:12}}>· {rel(task.minutesAgo)}</span>
                        <FnBadge type={task.type}/>
                      </div>
                      <div style={{color:'#616161',fontSize:13,lineHeight:1.65}}>{task.body}</div>
                    </div>
                    <a href={getUrl(task)} target="_blank" rel="noreferrer" style={{color:'#9e9e9e',fontSize:13,textDecoration:'none',padding:4,borderRadius:8}}><i className="bi-box-arrow-up-right"></i></a>
                  </div>
                  {!isSent&&<div style={{padding:'10px 18px 12px',borderTop:'1px solid #f2f2f2',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <button onClick={()=>setOpenR(isO?null:task.id)} style={{...msgActionStyle,background:isO?'#e8f0fe':'var(--surface-3)',border:`1px solid ${isO?'#1f74b3':'var(--border)'}`,color:isO?'#1f74b3':'var(--text-secondary)'}}><i className="bi-reply-fill" style={{fontSize:10}}></i>Reply</button>
                    {perms?.canDo('can_resolve_task')!==false&&<button onClick={()=>{const tid=setTimeout(()=>{setTasks(prev=>prev.map(t=>t.id===task.id?{...t,status:'resolved'}:t));},4000);addToast&&addToast('success','Addressed: '+task.id,task.subject.slice(0,46),()=>{clearTimeout(tid);});}} style={{...msgActionStyle,color:'#29811e'}}><i className="bi-check-circle"></i>Addressed</button>}
                    {perms?.canDo('can_escalate')!==false&&<button onClick={()=>onEscalMgr&&onEscalMgr(task)} style={{...msgActionStyle,color:'#d42d35'}}><i className="bi-arrow-up-circle" style={{fontSize:10}}></i>Escalate</button>}
                    {/* Country flag badge — flex aligned, no collapse */}
                    <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:4,flexShrink:0,color:'#9e9e9e',fontSize:12}}>{FLAGS[task.country]} {task.country}</span>
                  </div>}
                  {isO&&!isSent&&<div className="fade-in" style={{margin:'0 18px 14px'}}>
                    {settings.slack_ai_suggested_reply!==false&&<><div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,padding:'8px 12px',background:'#f9f8f6',borderRadius:12}}><div style={{width:18,height:18,background:'linear-gradient(135deg,#29811e,#1f74b3)',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-stars" style={{color:'white',fontSize:9}}></i></div><span style={{fontSize:12,fontWeight:700,color:'#1f74b3'}}>AI Suggested Reply</span><span style={{fontSize:11,color:'#9e9e9e',marginLeft:4}}>— edit freely before sending</span></div>
                    <textarea className="ai-reply-textarea" value={rt} onChange={e=>setTexts(prev=>({...prev,[task.id]:e.target.value}))} rows={4} aria-label={`Reply to ${task.sender} in ${task.channel}`} style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:12,padding:'10px 14px',fontSize:14,color:'#1b1b1b',outline:'none',fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',lineHeight:1.5,transition:'border-color .15s'}} onFocus={e=>e.target.style.borderColor='#1f74b3'} onBlur={e=>e.target.style.borderColor='#e8e8e8'}/></>}
                    <div style={{padding:'8px 0 0',display:'flex',gap:7}}>
                      <button onClick={()=>send(task)} disabled={isSending} style={{height:36,padding:'0 18px',borderRadius:128,border:'none',background:'#1b1b1b',color:'white',fontSize:13,cursor:isSending?'default':'pointer',fontWeight:700,display:'flex',alignItems:'center',gap:6,opacity:isSending?.7:1}}>
                        {isSending?<><i className="bi-arrow-repeat" style={{fontSize:11}}></i>Sending...</>:<><i className="bi-send-fill" style={{fontSize:11}}></i>Send in Slack</>}
                      </button>
                      <button onClick={()=>setOpenR(null)} style={{height:36,padding:'0 14px',borderRadius:128,border:'1px solid #e8e8e8',background:'white',color:'#616161',fontSize:13,cursor:'pointer',fontWeight:500}}>Cancel</button>
                    </div>
                  </div>}
                  {isSent&&<div style={{padding:'10px 18px 12px',borderTop:'1px solid #f2f2f2',display:'flex',alignItems:'center',gap:6,color:'#29811e',fontSize:13,fontWeight:700}}><i className="bi-check-circle-fill"></i> Reply sent · marking as addressed...</div>}
                </div>
              );
            })}
          </div>
          {done.length>0&&(
            <div style={{marginTop:24}}>
              <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none',marginBottom:10}}>Addressed ({done.length})</div>
              {done.map(task=>(
                <div key={task.id} style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'12px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:10,opacity:.45}}>
                  <i className="bi-check-circle-fill" style={{color:'#29811e',fontSize:15,flexShrink:0}}></i>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:'#616161',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{task.subject}</div><div style={{fontSize:11,color:'#9e9e9e'}}>{task.sender} · {task.channel} · {rel(task.minutesAgo)}</div></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════
          LITIGATION TAB
      ════════════════════════════════════════════════════════════════ */}
      {innerTab==='litigation'&&(
        <div>
          {/* Restricted banner for agents */}
          {isAgent&&(
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderRadius:12,background:'#fff8e6',border:'1px solid #fcd34d',marginBottom:16}}>
              <i className="bi-shield-lock-fill" style={{color:'#ed8d00',fontSize:16,flexShrink:0}}></i>
              <span style={{fontSize:13,fontWeight:600,color:'#92400e'}}>This section is restricted — Lead and above only</span>
            </div>
          )}

          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {LITIGATION_CHANNELS.map(lit=>{
              const sc=LIT_STATUS_COLORS[lit.status]||LIT_STATUS_COLORS.monitoring;
              return(
                <div key={lit.id} style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,boxShadow:'0 1px 2px rgba(0,0,0,0.04)',overflow:'hidden',transition:'box-shadow .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{padding:'14px 18px',display:'flex',alignItems:'flex-start',gap:12}}>
                    {/* Icon */}
                    <div style={{width:40,height:40,background:'#ffe2de',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <i className="bi-bank" style={{color:'#d42d35',fontSize:17}}></i>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      {/* Top row: case ref + country + status */}
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                        <span style={{background:'#1b1b1b',color:'white',padding:'3px 10px',borderRadius:128,fontSize:11,fontWeight:700,letterSpacing:'.03em'}}>{lit.caseRef}</span>
                        <span style={{fontSize:13,fontWeight:500,color:'#616161'}}>{FLAGS[lit.country]||'🌐'} {lit.country}</span>
                        <span style={{background:sc.bg,color:sc.color,padding:'3px 10px',borderRadius:128,fontSize:11,fontWeight:700,marginLeft:'auto'}}>{sc.label}</span>
                      </div>
                      {/* Employee + issue */}
                      <div style={{fontSize:14,fontWeight:600,color:'#1b1b1b',marginBottom:2}}>{lit.employeeName}</div>
                      <div style={{fontSize:13,color:'#616161',marginBottom:8}}>{lit.issue}</div>
                      {/* Meta row */}
                      <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
                        <span style={{fontSize:12,color:'#9e9e9e',display:'flex',alignItems:'center',gap:4}}>
                          <i className="bi-calendar3" style={{fontSize:11}}></i>
                          Opened {lit.openedAt}
                        </span>
                        <a href={`https://letsdeel.slack.com/archives`} target="_blank" rel="noreferrer"
                          style={{fontSize:12,color:'#7c3aed',textDecoration:'none',display:'flex',alignItems:'center',gap:4,fontWeight:600}}
                          onMouseEnter={e=>e.currentTarget.style.textDecoration='underline'} onMouseLeave={e=>e.currentTarget.style.textDecoration='none'}>
                          <i className="bi-slack" style={{fontSize:11}}></i>{lit.slackChannel}
                        </a>
                        <a href={`https://jira.example.com/browse/${lit.jiraTicket}`} target="_blank" rel="noreferrer"
                          style={{fontSize:12,color:'#1f74b3',textDecoration:'none',display:'flex',alignItems:'center',gap:4,fontWeight:600}}
                          onMouseEnter={e=>e.currentTarget.style.textDecoration='underline'} onMouseLeave={e=>e.currentTarget.style.textDecoration='none'}>
                          <i className="bi-kanban" style={{fontSize:11}}></i>{lit.jiraTicket}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>
    </div>
  );
};

export default Slack;
