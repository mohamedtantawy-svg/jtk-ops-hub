import { useState, useContext } from 'react';
import { PermissionsContext, SettingsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import { COMMS_TYPES, ALL_AGENT_IDS } from '../../data/comms';
import Avatar from '../ui/Avatar';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import ComposeModal from '../modals/ComposeModal';

const COMMS_BADGE = {
  alert:    { bg:'var(--red-light)',    color:'var(--red)' },
  announce: { bg:'var(--purple-light)', color:'var(--purple)' },
  update:   { bg:'var(--blue-light)',   color:'var(--blue)' },
  guidance: { bg:'var(--orange-light)', color:'var(--orange)' },
  kudos:    { bg:'var(--green-light)',  color:'var(--green)' },
  draft:    { bg:'var(--surface-3)',    color:'var(--text-muted)' },
};

const CommsView=({user,comms,setComms,addToast})=>{
  const perms=useContext(PermissionsContext);
  const settings=useContext(SettingsContext);
  const isLA=perms?.canDo('can_compose_comms')||perms?.canDo('can_compose_announcements')||false;
  const canPin=perms?.canDo('can_pin_announcement')||false;
  const [selId,setSelId]=useState(null);
  const [filter,setFilter]=useState('all');
  const [showCompose,setShowCompose]=useState(false);
  const [editDraft,setEditDraft]=useState(null);
  const [reminderSent,setReminderSent]=useState({});

  const selComm=comms.find(c=>c.id===selId)||null;

  // Enabled types from settings
  const enabledTypes=settings.comms_types_enabled||{alert:true,announce:true,update:true,guidance:true,kudos:true};

  const targetMatch=(c)=>{
    if(c.target==='all')return true;
    if(c.target===user.team)return true;
    if(Array.isArray(c.target)&&c.target.includes(user.id))return true;
    return false;
  };

  // Sender always sees their own sent comms + target match for others
  const canSee=(c)=>{
    if(c.author&&c.author.id===user.id) return true;
    if(isLA) return true;
    return targetMatch(c);
  };

  const visible=comms.filter(c=>{
    if(filter==='drafts')return c.status==='draft'&&isLA;
    if(filter==='archived')return c.status==='archived'&&isLA;
    if(filter!=='all'){
      return c.type===filter&&c.status==='sent'&&canSee(c);
    }
    return c.status==='sent'&&canSee(c);
  });

  const pendingForMe=comms.filter(c=>c.status==='sent'&&targetMatch(c)&&!c.acks.includes(user.id));

  const acknowledge=(id)=>setComms(prev=>prev.map(c=>c.id===id&&!c.acks.includes(user.id)?{...c,acks:[...c.acks,user.id]}:c));
  const acknowledgeAll=()=>setComms(prev=>prev.map(c=>c.status==='sent'&&targetMatch(c)&&!c.acks.includes(user.id)?{...c,acks:[...c.acks,user.id]}:c));

  const archiveComm=(id)=>{
    if(!isLA)return;
    setComms(prev=>prev.map(c=>c.id===id?{...c,status:'archived'}:c));
    if(selId===id)setSelId(null);
    if(addToast)addToast('info','Archived','Communication archived');
  };

  const togglePin=(id)=>{
    if(!canPin)return;
    setComms(prev=>prev.map(c=>c.id===id?{...c,isPinned:!c.isPinned}:c));
  };

  const sendReminder=(comm)=>{
    if(!perms?.canDo('can_send_reminder'))return;
    setReminderSent(prev=>({...prev,[comm.id]:true}));
    setTimeout(()=>setReminderSent(prev=>({...prev,[comm.id]:false})),3000);
    if(addToast) addToast('info','Reminder Sent',`Nudge sent for: ${comm.title.slice(0,40)}`);
  };

  const handleSend=({type,title,body,target,priority,status,isPopup,imageUrl,link})=>{
    const now=new Date().toISOString().slice(0,10);
    if(editDraft){
      setComms(prev=>prev.map(c=>c.id===editDraft.id?{...c,type,title,body,target,priority,status,isPopup:isPopup||false,imageUrl:imageUrl||'',link:link||'',sentAt:status==='sent'?now:c.sentAt}:c));
    } else {
      const maxNum=comms.reduce((mx,c)=>{const n=parseInt(c.id.replace('COM-',''));return n>mx?n:mx;},0);
      const id='COM-'+String(maxNum+1).padStart(3,'0');
      setComms(prev=>[{id,type,title,body,target,priority,status,isPopup:isPopup||false,imageUrl:imageUrl||'',link:link||'',sentAt:status==='sent'?now:'',author:{id:user.id,name:user.name},acks:[],isPinned:false},...prev]);
    }
    setEditDraft(null);
  };

  const deleteDraft=(id)=>{
    if(!isLA)return;
    setComms(prev=>prev.filter(c=>c.id!==id));
    if(selId===id)setSelId(null);
  };

  // Build filter list — only show enabled types
  const FILTERS=[
    {id:'all',label:'All',icon:'bi-grid'},
    ...(enabledTypes.alert!==false?[{id:'alert',label:'Alerts',icon:'bi-exclamation-triangle-fill'}]:[]),
    ...(enabledTypes.announce!==false?[{id:'announce',label:'Announcements',icon:'bi-megaphone-fill'}]:[]),
    ...(enabledTypes.update!==false?[{id:'update',label:'Updates',icon:'bi-arrow-up-circle-fill'}]:[]),
    ...(enabledTypes.guidance!==false?[{id:'guidance',label:'Guidance',icon:'bi-book-half'}]:[]),
    ...(enabledTypes.kudos!==false?[{id:'kudos',label:'Kudos',icon:'bi-trophy-fill'}]:[]),
    ...(isLA&&settings.comms_show_drafts_tab!==false?[{id:'drafts',label:'Drafts',icon:'bi-pencil'}]:[]),
    ...(isLA?[{id:'archived',label:'Archived',icon:'bi-archive'}]:[]),
  ];

  const getAckMembers=(comm)=>{
    const targetIds=comm.target==='all'?ALL_AGENT_IDS:
      comm.target==='EMEA'?MEMBERS.filter(m=>m.team==='EMEA'&&m.role==='agent').map(m=>m.id):
      comm.target==='APAC'?MEMBERS.filter(m=>m.team==='APAC'&&m.role==='agent').map(m=>m.id):
      comm.target==='AMER'?MEMBERS.filter(m=>m.team==='AMER'&&m.role==='agent').map(m=>m.id):
      Array.isArray(comm.target)?comm.target:ALL_AGENT_IDS;
    return targetIds.map(id=>({
      member:MEMBERS.find(m=>m.id===id),
      acked:comm.acks.includes(id),
    })).filter(x=>x.member!=null);
  };

  // Ack deadline check
  const ackDeadlineHrs=settings.comms_ack_deadline_hrs||48;
  const isOverdue=(comm)=>{
    if(!comm.sentAt)return false;
    const sent=new Date(comm.sentAt);
    const now=new Date();
    const hrs=(now-sent)/(1000*60*60);
    return hrs>ackDeadlineHrs;
  };

  const PRIO_COLORS={high:'#d42d35',medium:'#ed8d00',low:'#29811e'};
  const PRIO_LABELS={high:'High',medium:'Medium',low:'Low'};

  const selT=selComm?COMMS_TYPES[selComm.type]||COMMS_TYPES.update:null;
  const selAckMembers=selComm?getAckMembers(selComm):[];
  const selAckedIds=selComm?selComm.acks.filter(id=>selAckMembers.find(x=>x.member.id===id)):[];
  const selAckPct=selAckMembers.length?Math.round(selAckedIds.length/selAckMembers.length*100):0;
  const selIAcked=selComm?selComm.acks.includes(user.id):false;

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <PageHeader icon="bi-megaphone-fill" iconBg="#fff8e6" iconColor="#ed8d00"
        title="Communications"
        subtitle={`${comms.filter(c=>c.status==='sent').length} sent · ${pendingForMe.length} need your acknowledgement`}
        right={<div style={{display:'flex',gap:8,alignItems:'center'}}>
          {!isLA&&pendingForMe.length>0&&(
            <button onClick={acknowledgeAll} style={{height:36,padding:'0 16px',borderRadius:128,border:'1px solid #e8e8e8',background:'white',color:'#616161',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <i className="bi-check2-all" style={{fontSize:12}}></i>Mark all read
            </button>
          )}
          {isLA&&(
            <button onClick={()=>{setEditDraft(null);setShowCompose(true);}} style={{height:36,padding:'0 18px',borderRadius:128,border:'none',background:'#1b1b1b',color:'white',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <i className="bi-pencil-square" style={{fontSize:12}}></i>Compose
            </button>
          )}
        </div>}
      />

      {/* Filter tabs */}
      <div style={{background:'white',borderBottom:'1px solid #e8e8e8',padding:'0 20px',display:'flex',gap:2,overflowX:'auto'}}>
        {FILTERS.map(f=>{
          const ct=f.id==='all'?visible.length:f.id==='drafts'?comms.filter(c=>c.status==='draft').length:f.id==='archived'?comms.filter(c=>c.status==='archived').length:comms.filter(c=>c.type===f.id&&c.status==='sent').length;
          return(
            <button key={f.id} aria-pressed={filter===f.id} onClick={()=>{setFilter(f.id);}} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 12px',margin:'4px 2px',borderRadius:8,border:'none',background:filter===f.id?'#f3eff8':'none',color:filter===f.id?'#6b3fa0':'#616161',fontSize:13,cursor:'pointer',fontWeight:filter===f.id?600:500,whiteSpace:'nowrap',transition:'all .15s'}}>
              <i className={f.icon} style={{fontSize:11}}></i>{f.label}
              {ct>0&&<span style={{background:filter===f.id?'rgba(107,63,160,0.15)':'#e8e8e8',color:filter===f.id?'#6b3fa0':'#616161',borderRadius:128,padding:'1px 7px',fontSize:10,fontWeight:700}}>{ct}</span>}
            </button>
          );
        })}
      </div>

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        {/* LEFT: list */}
        <div style={{width:selComm?360:undefined,flex:selComm?undefined:1,borderRight:selComm?'1px solid #e8e8e8':undefined,overflowY:'auto',background:'#fafaf9'}}>

          {!isLA&&pendingForMe.length>0&&filter==='all'&&(
            <div style={{margin:'14px 16px 6px',background:'#fff8e6',border:'1px solid #ffe27c',borderRadius:16,padding:'12px 16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <i className="bi-exclamation-circle-fill" style={{color:'#ed8d00',fontSize:14}}></i>
                <span style={{fontSize:13,fontWeight:700,color:'#92400E'}}>Needs your acknowledgement</span>
                <span style={{marginLeft:'auto',background:'#ed8d00',color:'white',borderRadius:128,padding:'2px 9px',fontSize:10.5,fontWeight:700}}>{pendingForMe.length}</span>
              </div>
              <div style={{fontSize:12,color:'#B45309'}}>Please read and acknowledge the following {pendingForMe.length===1?'item':'items'} below.</div>
            </div>
          )}

          {visible.length===0&&(
            <EmptyState icon="bi-inbox" title="No messages" subtitle="All clear!" />
          )}

          {visible.map(comm=>{
            const t=COMMS_TYPES[comm.type];
            const ackMembers=getAckMembers(comm);
            const ackPct=ackMembers.length?Math.round(comm.acks.filter(id=>ackMembers.find(x=>x.member.id===id)).length/ackMembers.length*100):0;
            const iAcked=comm.acks.includes(user.id);
            const isSelected=selId===comm.id;
            const overdue=!iAcked&&isOverdue(comm);
            return(
              <div key={comm.id} onClick={()=>setSelId(isSelected?null:comm.id)}
                style={{padding:'14px 18px',borderBottom:'1px solid #f2f2f2',cursor:'pointer',background:isSelected?'#f9f8f6':'white',borderLeft:`3px solid ${isSelected?'#1b1b1b':!iAcked&&comm.status==='sent'?'var(--purple)':'transparent'}`,transition:'all .12s'}}
                onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.background='var(--surface-2)';}}
                onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.background='white';}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:16,background:t.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                    <i className={t.icon} style={{color:t.color,fontSize:14}}></i>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:4}}>
                      <span title={comm.title} style={{fontSize:'var(--font-md)',fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{comm.title}</span>
                      {comm.isPopup&&comm.status==='sent'&&<span style={{background:'#f3eff8',color:'#6b3fa0',borderRadius:128,padding:'2px 7px',fontSize:9,fontWeight:700,flexShrink:0}}>POPUP</span>}
                      {comm.isPinned&&<i className="bi-pin-fill" style={{color:'#ed8d00',fontSize:10,flexShrink:0}}></i>}
                      {comm.status==='draft'
                        ?<span style={{...(COMMS_BADGE.draft||{}),borderRadius:128,padding:'2px 8px',fontSize:9.5,fontWeight:700,flexShrink:0}}>DRAFT</span>
                        :comm.status==='archived'
                        ?<span style={{background:'#f2f2f2',color:'#9e9e9e',borderRadius:128,padding:'2px 8px',fontSize:9.5,fontWeight:700,flexShrink:0}}>ARCHIVED</span>
                        :<span style={{...(COMMS_BADGE[comm.type]||{}),borderRadius:128,padding:'2px 8px',fontSize:9.5,fontWeight:700,flexShrink:0,textTransform:'none'}}>{t?.label||comm.type}</span>
                      }
                    </div>
                    <div style={{fontSize:12,color:'#616161',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:6}}>{comm.body.slice(0,85)}{comm.body.length>85?'...':''}</div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,color:'#9e9e9e'}}>{comm.author.name}</span>
                      {comm.sentAt&&<span style={{fontSize:11,color:'#e8e8e8'}}>·</span>}
                      {comm.sentAt&&<span style={{fontSize:11,color:'#9e9e9e'}}>{comm.sentAt}</span>}
                      <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:4}}>
                        {comm.status==='sent'&&!isLA&&(
                          iAcked
                            ?<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:'#29811e',fontWeight:600}}><i className="bi-check-circle-fill" style={{fontSize:10}}></i>Acknowledged</span>
                            :overdue
                            ?<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:'#d42d35',fontWeight:600}}><i className="bi-clock-fill" style={{fontSize:10}}></i>Overdue</span>
                            :<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:'#ed8d00',fontWeight:600}}><i className="bi-clock" style={{fontSize:10}}></i>Pending</span>
                        )}
                        {comm.status==='sent'&&isLA&&ackMembers.length>0&&settings.comms_show_ack_progress!==false&&(
                          <span style={{fontSize:11,color:'var(--text-secondary)',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{ackPct}% acknowledged</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT: detail */}
        {selComm&&(
          <div style={{flex:1,overflowY:'auto',background:'white'}}>
            {/* Header */}
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid #f2f2f2'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <div style={{width:40,height:40,borderRadius:16,background:selT.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <i className={selT.icon} style={{color:selT.color,fontSize:17}}></i>
                </div>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
                    <span style={{fontSize:11,fontWeight:700,color:selT.color,letterSpacing:'normal',textTransform:'none'}}>{selT.label}</span>
                    {selComm.status==='draft'&&<span style={{background:'#f7f5f2',color:'#616161',borderRadius:128,padding:'2px 8px',fontSize:9.5,fontWeight:700}}>DRAFT</span>}
                    {selComm.status==='archived'&&<span style={{background:'#f2f2f2',color:'#9e9e9e',borderRadius:128,padding:'2px 8px',fontSize:9.5,fontWeight:700}}>ARCHIVED</span>}
                    {selComm.isPopup&&<span style={{background:'#f3eff8',color:'#6b3fa0',borderRadius:128,padding:'2px 8px',fontSize:9.5,fontWeight:700}}>POPUP</span>}
                    <span style={{background:PRIO_COLORS[selComm.priority]+'18',color:PRIO_COLORS[selComm.priority],borderRadius:128,padding:'2px 9px',fontSize:10,fontWeight:700}}>{PRIO_LABELS[selComm.priority]} Priority</span>
                  </div>
                  <div style={{fontSize:18,fontWeight:700,color:'#1b1b1b',marginTop:3,lineHeight:1.3}}>{selComm.title}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  {canPin&&selComm.status==='sent'&&(
                    <button onClick={()=>togglePin(selComm.id)} title={selComm.isPinned?'Unpin':'Pin'} style={{width:32,height:32,borderRadius:'50%',background:selComm.isPinned?'#fff8e6':'#f2f2f2',border:selComm.isPinned?'1px solid #FCD34D':'none',cursor:'pointer',color:selComm.isPinned?'#ed8d00':'#9e9e9e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>
                      <i className={selComm.isPinned?'bi-pin-fill':'bi-pin'}></i>
                    </button>
                  )}
                  <button onClick={()=>setSelId(null)} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'#9e9e9e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,fontSize:12,color:'#616161'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:4}}><i className="bi-person-circle"></i>{selComm.author.name}</span>
                {selComm.sentAt&&<><span style={{color:'#e8e8e8'}}>·</span><span style={{display:'inline-flex',alignItems:'center',gap:4}}><i className="bi-calendar3"></i>{selComm.sentAt}</span></>}
                <span style={{color:'#e8e8e8'}}>·</span>
                <span style={{display:'inline-flex',alignItems:'center',gap:4}}><i className="bi-people"></i>{selComm.target==='all'?'All Teams':selComm.target+' Team'}</span>
              </div>
            </div>

            {/* Image */}
            {selComm.imageUrl&&(
              <div style={{padding:'16px 24px 0'}}>
                <img src={selComm.imageUrl} alt="" style={{width:'100%',borderRadius:12,maxHeight:280,objectFit:'cover',display:'block',border:'1px solid #e8e8e8'}} />
              </div>
            )}

            {/* Body */}
            <div style={{padding:'20px 24px',borderBottom:'1px solid #f2f2f2'}}>
              {selComm.body.split('\n').map((line,i)=>(
                line.trim()===''
                  ?<div key={i} style={{height:10}}></div>
                  :line.startsWith('•')
                    ?<div key={i} style={{display:'flex',gap:8,marginBottom:6}}><span style={{color:selT.color,fontWeight:700}}>•</span><span style={{fontSize:14,color:'#616161',lineHeight:1.6}}>{line.slice(1).trim()}</span></div>
                    :<div key={i} style={{fontSize:14,color:'#616161',lineHeight:1.7,marginBottom:4}}>{line}</div>
              ))}
              {selComm.link&&(
                <div style={{marginTop:14}}>
                  <a href={selComm.link} target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:'#1f74b3',fontWeight:600,textDecoration:'none',background:'#e8f0fe',border:'1px solid #c7e2fe',borderRadius:128,padding:'6px 14px'}}>
                    <i className="bi-link-45deg" style={{fontSize:12}}></i>Open Link <i className="bi-box-arrow-up-right" style={{fontSize:9}}></i>
                  </a>
                </div>
              )}
            </div>

            {/* Agent: Acknowledge button */}
            {selComm.status==='sent'&&!isLA&&(
              <div style={{padding:'16px 24px',borderBottom:'1px solid #f2f2f2',background:selIAcked?'#f9f8f6':'#fff8e6'}}>
                {selIAcked?(
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:40,height:40,borderRadius:'50%',background:'#e8f5e3',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <i className="bi-check-circle-fill" style={{color:'#29811e',fontSize:18}}></i>
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:'#29811e'}}>Acknowledged</div>
                      <div style={{fontSize:12,color:'#29811e'}}>You have read and acknowledged this communication.</div>
                    </div>
                  </div>
                ):(
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#92400E',marginBottom:2}}>Action required</div>
                      <div style={{fontSize:12,color:'#B45309'}}>Please read the above and click to confirm you have received and understood this communication.</div>
                    </div>
                    <button onClick={()=>acknowledge(selComm.id)} style={{height:40,padding:'0 22px',borderRadius:128,border:'none',background:'#1b1b1b',color:'white',fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:7,flexShrink:0}}>
                      <i className="bi-check2-circle" style={{fontSize:14}}></i>Acknowledge
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Lead/Admin: Draft actions */}
            {selComm.status==='draft'&&isLA&&(
              <div style={{padding:'14px 24px',borderBottom:'1px solid #f2f2f2',background:'#fafaf9',display:'flex',gap:8}}>
                <button onClick={()=>{setEditDraft(selComm);setShowCompose(true);}} style={{height:36,padding:'0 16px',borderRadius:128,border:'1px solid #e8e8e8',background:'white',color:'#1b1b1b',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>
                  <i className="bi-pencil" style={{fontSize:10}}></i>Edit Draft
                </button>
                <button onClick={()=>{setComms(prev=>prev.map(c=>c.id===selComm.id?{...c,status:'sent',sentAt:new Date().toISOString().slice(0,10)}:c));}} style={{height:36,padding:'0 16px',borderRadius:128,border:'none',background:'#1b1b1b',color:'white',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>
                  <i className="bi-send-fill" style={{fontSize:10}}></i>Send Now
                </button>
                <button onClick={()=>deleteDraft(selComm.id)} style={{height:36,padding:'0 16px',borderRadius:128,border:'1px solid #FCA5A5',background:'#ffe2de',color:'#d42d35',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5,marginLeft:'auto'}}>
                  <i className="bi-trash" style={{fontSize:10}}></i>Delete
                </button>
              </div>
            )}

            {/* Lead/Admin: Sent actions — archive + pin */}
            {selComm.status==='sent'&&isLA&&(
              <div style={{padding:'10px 24px',borderBottom:'1px solid #f2f2f2',background:'#fafaf9',display:'flex',gap:8,alignItems:'center'}}>
                <button onClick={()=>archiveComm(selComm.id)} style={{height:32,padding:'0 14px',borderRadius:128,border:'1px solid #e8e8e8',background:'white',color:'#616161',fontSize:12,cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:5}}>
                  <i className="bi-archive" style={{fontSize:10}}></i>Archive
                </button>
              </div>
            )}

            {/* Lead/Admin: Acknowledgement tracker */}
            {selComm.status==='sent'&&isLA&&selAckMembers.length>0&&(
              <div style={{padding:'20px 24px'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                  <div style={{fontWeight:700,fontSize:14,color:'#1b1b1b'}}>Acknowledgement Tracker</div>
                  {settings.comms_show_ack_progress!==false&&<span style={{marginLeft:'auto',fontSize:12,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{selAckedIds.length}/{selAckMembers.length} acknowledged</span>}
                  <button onClick={()=>sendReminder(selComm)} style={{height:32,padding:'0 14px',borderRadius:128,border:'1px solid #e8e8e8',background:reminderSent[selComm.id]?'#e8f5e3':'white',color:reminderSent[selComm.id]?'#29811e':'#616161',fontSize:12,cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:5,transition:'all .2s'}}>
                    <i className={reminderSent[selComm.id]?'bi-check2':'bi-bell'} style={{fontSize:10}}></i>
                    {reminderSent[selComm.id]?'Reminder sent!':'Send reminder'}
                  </button>
                </div>
                {/* Progress bar */}
                {settings.comms_show_ack_progress!==false&&<div style={{background:'var(--green-light)',borderRadius:128,height:6,marginBottom:16,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:128,background:'var(--green-solid)',width:selAckPct+'%',transition:'width .4s ease'}}></div>
                </div>}
                {/* Members list — controlled by setting */}
                {settings.comms_show_member_ack_list!==false&&(
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    {selAckMembers.slice().sort((a,b)=>b.acked-a.acked).map(({member,acked})=>(
                      <div key={member.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:12,background:acked?'#f9f8f6':'#fff8e6',border:`1px solid ${acked?'#e8e8e8':'#ffe27c'}`}}>
                        <Avatar name={member.name} size={28}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>{member.name}</div>
                          <div style={{fontSize:11,color:'#616161'}}>{member.team} · {member.country}</div>
                        </div>
                        {acked
                          ?<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#29811e',fontWeight:700}}><i className="bi-check-circle-fill"></i>Acknowledged</span>
                          :<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#ed8d00',fontWeight:600}}><i className="bi-clock"></i>Pending</span>
                        }
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {(showCompose)&&<ComposeModal onClose={()=>{setShowCompose(false);setEditDraft(null);}} onSend={handleSend} draft={editDraft} currentUser={user}/>}
    </div>
  );
};

export default CommsView;
