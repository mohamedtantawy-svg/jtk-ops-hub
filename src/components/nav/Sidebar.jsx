import { useState, useContext, useMemo } from 'react';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import { getVisibleEmails } from '../../utils/helpers';
import Avatar from '../ui/Avatar';
import NotifBell from './NotifBell';
import { PermissionsContext } from '../../App';

const Sidebar=({user,view,setView,tasks,setTask,escalCount,onSearch,open,setOpen,notifs,markAllRead,onCreateTask,comms})=>{
  const perms = useContext(PermissionsContext);
  const visibleEmails = useMemo(() => getVisibleEmails(user?.email), [user?.email]);
  const myT=tasks.filter(t=>t.source!=='slack'&&(t.assigneeId===user.id||(t.assigneeEmail&&visibleEmails.has(t.assigneeEmail.toLowerCase())))&&t.status!=='resolved');
  const slkT=tasks.filter(t=>t.source==='slack'&&t.status!=='resolved');
  const alerts=tasks.filter(t=>t.isAlert&&t.status!=='resolved').length;
  const isLA=perms?.dataScope!=='own_tasks_only';

  // Grouped navigation
  const pv=(id)=>perms?.canView(id)!==false;
  const workItems=[
    pv('briefing')&&{id:'briefing',    icon:'bi-sunrise',              label:'Briefing',     badge:null},
    pv('my-queue')&&{id:'my-queue',    icon:'bi-inbox',                label:'My Queue',    badge:myT.filter(t=>t.status==='new').length||null},
    pv('slack')&&{id:'slack',       icon:'bi-chat-dots',            label:'Slack',       badge:slkT.length||null,slack:true},
    pv('alerts')&&{id:'alerts',      icon:'bi-exclamation-triangle', label:'Alerts',      badge:alerts||null,alert:true},
    pv('escalations')&&{id:'escalations', icon:'bi-arrow-up-circle',      label:'Escalations', badge:escalCount||null,esc:true},
  ].filter(Boolean);
  const overviewItems=[
    pv('team')&&isLA?{id:'team',     icon:'bi-people',         label:perms?.dataScope==='all_tasks'?'All Teams':'My Team',badge:null}:null,
    pv('analytics')&&{id:'analytics',     icon:'bi-bar-chart-line',  label:'Analytics',     badge:null},
  ].filter(Boolean);
  const refItems=[
    pv('calendar')&&{id:'calendar',      icon:'bi-calendar3',       label:'Deadlines',     badge:null},
    pv('knowledge-hub')&&{id:'knowledge-hub', icon:'bi-book-half',        label:'Knowledge Hub', badge:null},
  ].filter(Boolean);
  const allNavs=[...workItems,...overviewItems,...refItems,
    ...(perms?.canView('settings')?[{id:'settings',icon:'bi-gear-fill',label:'Settings',badge:null}]:[])
  ];

  const NavItem=({n})=>(
    <div key={n.id} className={`nav-item ${view===n.id?'active':''}`} onClick={()=>{setView(n.id);setTask(null);}}>
      <i className={n.icon} style={{fontSize:15}}></i><span style={{flex:1}}>{n.label}</span>
      {n.badge?<span style={{background:n.alert?'#ed8d00':n.slack?'#c4b1f9':n.esc?'#d42d35':'var(--g)',color:'white',borderRadius:16,padding:'1px 7px',fontSize:11,fontWeight:700}}>{n.badge}</span>:null}
    </div>
  );
  const SectionLabel=({text})=>(
    <div style={{padding:'10px 12px 4px',color:'#9e9e9e',fontSize:9.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase'}}>{text}</div>
  );

  // -- COLLAPSED (icon-only, 56px) ---
  if(!open) return(
    <div style={{width:56,background:'#ffffff',display:'flex',flexDirection:'column',alignItems:'center',padding:'12px 0 8px',flexShrink:0,height:'100%',gap:2}}>
      <div title="Ops Hub" style={{width:32,height:32,background:'var(--g)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:6,flexShrink:0}}>
        <i className="bi-grid-1x2-fill" style={{color:'#1b1b1b',fontSize:14}}></i>
      </div>
      <button onClick={()=>setOpen(true)} className="sb-icon" title="Expand sidebar" style={{marginBottom:6}}>
        <i className="bi-chevron-right" style={{fontSize:12}}></i>
      </button>
      {perms?.canDo('can_create_task')!==false&&<button onClick={onCreateTask} className="sb-icon" title="Create Task" style={{marginBottom:2}}>
        <i className="bi-plus-circle-fill" style={{fontSize:15,color:'var(--g)'}}></i>
      </button>}
      {/* WORK */}
      <div style={{width:28,height:1,background:'rgba(0,0,0,.08)',margin:'5px 0 3px'}}></div>
      {workItems.map(n=>(
        <button key={n.id} onClick={()=>{setView(n.id);setTask(null);}} className={`sb-icon ${view===n.id?'active':''}`} title={n.label}>
          <i className={n.icon} style={{fontSize:15}}></i>
          {n.badge?<span style={{position:'absolute',top:2,right:2,width:18,height:18,background:n.alert?'#ed8d00':n.slack?'#c4b1f9':n.esc?'#d42d35':'var(--g)',borderRadius:'50%',fontSize:7.5,fontWeight:700,color:'white',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>{n.badge>9?'9+':n.badge}</span>:null}
        </button>
      ))}
      {/* OVERVIEW */}
      <div style={{width:28,height:1,background:'rgba(0,0,0,.08)',margin:'5px 0 3px'}}></div>
      {overviewItems.map(n=>(
        <button key={n.id} onClick={()=>{setView(n.id);setTask(null);}} className={`sb-icon ${view===n.id?'active':''}`} title={n.label}>
          <i className={n.icon} style={{fontSize:15}}></i>
        </button>
      ))}
      {/* REFERENCE */}
      <div style={{width:28,height:1,background:'rgba(0,0,0,.08)',margin:'5px 0 3px'}}></div>
      {refItems.map(n=>(
        <button key={n.id} onClick={()=>{setView(n.id);setTask(null);}} className={`sb-icon ${view===n.id?'active':''}`} title={n.label}>
          <i className={n.icon} style={{fontSize:15}}></i>
          {n.badge?<span style={{position:'absolute',top:2,right:2,width:18,height:18,background:'var(--g)',borderRadius:'50%',fontSize:7.5,fontWeight:700,color:'white',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>{n.badge>9?'9+':n.badge}</span>:null}
        </button>
      ))}
      {perms?.canView('settings')&&(
        <button onClick={()=>{setView('settings');setTask(null);}} className={`sb-icon ${view==='settings'?'active':''}`} title="Settings">
          <i className="bi-gear-fill" style={{fontSize:15}}></i>
        </button>
      )}
      <div style={{flex:1}}/>
      <NotifBell notifs={notifs} onMarkAll={markAllRead} collapsed={true}/>
      <div style={{padding:'6px 0'}} title={user.name}><Avatar name={user.name} size={30}/></div>
    </div>
  );

  // -- EXPANDED (224px) --
  return(
    <div style={{width:224,background:'#ffffff',display:'flex',flexDirection:'column',flexShrink:0,height:'100%'}}>
      {/* Brand header */}
      <div style={{padding:'14px 14px 12px',borderBottom:'1px solid #dedede'}}>
        <div style={{display:'flex',alignItems:'center',gap:9}}>
          <div style={{width:30,height:30,background:'var(--g)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-grid-1x2-fill" style={{color:'#1b1b1b',fontSize:14}}></i></div>
          <div style={{flex:1}}><div style={{color:'#1b1b1b',fontWeight:700,fontSize:16,lineHeight:1.2}}>deel.</div><div style={{color:'#9e9e9e',fontSize:9.5,letterSpacing:'.04em'}}>OPS HUB</div></div>
          <button onClick={()=>setOpen(false)} className="sb-icon" title="Collapse sidebar" style={{width:26,height:26,flexShrink:0}}>
            <i className="bi-chevron-left" style={{fontSize:11}}></i>
          </button>
        </div>
      </div>
      {/* Search + Create */}
      <div style={{padding:'8px 10px 4px',display:'flex',gap:5}}>
        <button aria-label="Search Ops Hub" onClick={onSearch} style={{flex:1,display:'flex',alignItems:'center',gap:8,padding:'7px 11px',borderRadius:8,background:'#f7f5f2',border:'1px solid #dedede',color:'#616161',fontSize:12.5,cursor:'pointer',textAlign:'left',transition:'all .15s'}}
          onMouseEnter={e=>{e.currentTarget.style.background='#f2f2f2';e.currentTarget.style.borderColor='#bebebe';}} onMouseLeave={e=>{e.currentTarget.style.background='#f7f5f2';e.currentTarget.style.borderColor='#dedede';}}>
          <i className="bi-search" style={{fontSize:12}}></i><span style={{flex:1}}>Search…</span><span style={{background:'#f2f2f2',borderRadius:4,padding:'1px 5px',fontSize:10,fontFamily:'monospace',color:'#616161',border:'1px solid #dedede'}}>⌘K</span>
        </button>
        {perms?.canDo('can_create_task')!==false&&<button onClick={onCreateTask} title="Create Task" style={{width:34,height:34,borderRadius:8,background:'#ffffff',border:'1px solid #dedede',color:'#1b1b1b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .15s'}}
          onMouseEnter={e=>{e.currentTarget.style.background='#f7f5f2';e.currentTarget.style.borderColor='#bebebe';}} onMouseLeave={e=>{e.currentTarget.style.background='#ffffff';e.currentTarget.style.borderColor='#dedede';}}>
          <i className="bi-plus-lg" style={{fontSize:14}}></i>
        </button>}
      </div>
      {/* Navigation -- grouped */}
      <nav role="navigation" aria-label="Main navigation" style={{padding:'0 10px',flex:1,overflowY:'auto'}}>
        <SectionLabel text="WORK"/>
        {workItems.map(n=><NavItem key={n.id} n={n}/>)}
        <SectionLabel text="OVERVIEW"/>
        {overviewItems.map(n=><NavItem key={n.id} n={n}/>)}
        <SectionLabel text="REFERENCE"/>
        {refItems.map(n=><NavItem key={n.id} n={n}/>)}
        {perms?.canView('settings')&&<>
          <div style={{height:1,background:'rgba(0,0,0,.04)',margin:'8px 0 4px'}}></div>
          <NavItem n={{id:'settings',icon:'bi-gear-fill',label:'Settings',badge:null}}/>
        </>}
      </nav>
      {/* Spacer */}
      <div style={{flex:1}}></div>
      {/* User profile */}
      <div style={{padding:'9px 12px',borderTop:'1px solid rgba(0,0,0,.04)',display:'flex',alignItems:'center',gap:8}}>
        <Avatar name={user.name} size={28}/>
        <div style={{flex:1,minWidth:0}}><div style={{color:'#dedede',fontSize:12.5,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.name}</div><div style={{color:'#1b1b1b',fontSize:11}}>{FLAGS[user.country]} {user.team} · {perms?.accessTypeName||'Agent'}</div></div>
        <NotifBell notifs={notifs} onMarkAll={markAllRead} collapsed={false}/>
      </div>
    </div>
  );
};

export default Sidebar;
