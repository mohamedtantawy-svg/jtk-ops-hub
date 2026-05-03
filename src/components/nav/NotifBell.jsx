import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

const NCONF={escalation:{color:'#d42d35',icon:'bi-arrow-up-circle-fill'},new_task:{color:'#0a5a99',icon:'bi-inbox-fill'},alert:{color:'#ed8d00',icon:'bi-exclamation-triangle-fill'},success:{color:'#1f74b3',icon:'bi-check-circle-fill'},info:{color:'#1f74b3',icon:'bi-bell-fill'}};
const NotifBell=({notifs,onMarkAll,collapsed,setView,setSelTask,tasks=[]})=>{
  const [open,setOpen]=useState(false); const btnRef=useRef(null); const panelRef=useRef(null);
  const [pos,setPos]=useState({bottom:0,left:0});
  useEffect(()=>{ const h=e=>{ if(panelRef.current&&panelRef.current.contains(e.target))return; if(btnRef.current&&btnRef.current.contains(e.target))return; setOpen(false); }; document.addEventListener('mousedown',h); return()=>document.removeEventListener('mousedown',h); },[]);
  const unread=notifs.filter(n=>!n.read).length;
  const toggleOpen=()=>{
    if(!open&&btnRef.current){
      const r=btnRef.current.getBoundingClientRect();
      setPos({bottom:window.innerHeight-r.top+8,left:Math.max(8,r.left-148)});
    }
    setOpen(!open);
  };
  return(
    <div style={{position:'relative'}}>
      <button ref={btnRef} onClick={toggleOpen} className="sb-icon" style={{width:collapsed?36:34,height:collapsed?36:34,position:'relative'}} title={`Notifications${unread>0?` (${unread} unread)`:''}`}>
        <i className={unread>0?'bi-bell-fill':'bi-bell'} style={{fontSize:15,color:unread>0?'#ed8d00':'#616161'}}></i>
        {unread>0&&<span style={{position:'absolute',top:1,right:1,minWidth:16,height:16,background:'#d42d35',borderRadius:8,fontSize:9,fontWeight:700,color:'white',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1,padding:'0 3px'}}>{unread>9?'9+':unread}</span>}
      </button>
      {open&&ReactDOM.createPortal(
        <div className="fade-in" role="dialog" aria-label="Notifications" ref={panelRef} style={{position:'fixed',bottom:pos.bottom,left:pos.left,background:'var(--surface)',borderRadius:16,boxShadow:'0 4px 16px rgba(0,0,0,.12)',width:330,zIndex:1100,border:'1px solid #dedede',overflow:'hidden',maxHeight:'min(400px, calc(100vh - 80px))'}}>
          <div style={{padding:'12px 15px 10px',borderBottom:'1px solid #f7f5f2',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:13.5,fontWeight:700,color:'#1b1b1b'}}>Notifications</span>
              {unread>0&&<span style={{background:'#d42d35',color:'white',borderRadius:16,padding:'1px 7px',fontSize:10,fontWeight:700}}>{unread} new</span>}
            </div>
            {unread>0&&<button onClick={()=>{onMarkAll();}} style={{fontSize:11.5,color:'var(--g)',background:'none',border:'none',cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:3}}><i className="bi-check2-all"></i>All read</button>}
          </div>
          <div style={{maxHeight:320,overflowY:'auto'}}>
            {notifs.length===0
              ?<div style={{padding:'32px',textAlign:'center',color:'#bebebe'}}><i className="bi-bell" style={{fontSize:32,display:'block',marginBottom:8,opacity:.35}}></i><div style={{fontSize:13}}>No notifications yet</div></div>
              :notifs.map((n,idx)=>{ const c=NCONF[n.type]||NCONF.info;
              const handleClick=()=>{
                setOpen(false);
                if(onMarkAll)onMarkAll();
                if(!setView)return;
                const navType=n.navType||n.type;
                if(navType==='task'||navType==='new_task'||navType==='sla'){
                  if(n.taskId&&setSelTask&&tasks){const t=tasks.find(tk=>tk.id===n.taskId);if(t)setSelTask(t);}
                  setView('my-queue');
                }else if(navType==='escalation'){
                  setView('escalations');
                }else{
                  setView('briefing');
                }
              };
              return(
                <div key={n.id}>
                  {idx===0&&<div style={{padding:'5px 14px 3px',fontSize:10,fontWeight:700,color:'#bebebe',letterSpacing:'.06em',background:'#f7f5f2'}}>TODAY</div>}
                  <div onClick={handleClick} style={{padding:'9px 14px',borderBottom:'1px solid #f7f5f2',display:'flex',gap:10,alignItems:'flex-start',background:n.read?'white':'rgba(0,200,150,.03)',transition:'background .1s',cursor:'pointer'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg,#f7f5f2)'} onMouseLeave={e=>e.currentTarget.style.background=n.read?'white':'rgba(0,200,150,.03)'}>
                    <div style={{width:30,height:30,borderRadius:9,background:`${c.color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}><i className={c.icon} style={{color:c.color,fontSize:13}}></i></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12.5,fontWeight:n.read?500:600,color:'#1b1b1b',lineHeight:1.4}}>{n.title}</div>
                      {n.body&&<div title={n.body} style={{fontSize:11.5,color:'#616161',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{n.body}</div>}
                      <div style={{fontSize:10.5,color:'#bebebe',marginTop:2}}>{n.time}</div>
                    </div>
                    {!n.read&&<div style={{width:7,height:7,borderRadius:'50%',background:'var(--g)',flexShrink:0,marginTop:8}}></div>}
                  </div>
                </div>
              );})}
          </div>
          {notifs.length>5&&<div style={{padding:'8px 14px',borderTop:'1px solid #f7f5f2',textAlign:'center',fontSize:11.5,color:'#616161'}}>{notifs.length} notifications today</div>}
        </div>,
        document.body
      )}
    </div>
  );
};

export { NCONF };
export default NotifBell;
