const TOAST_CONF={
  escalation:{color:'#d42d35',icon:'bi-arrow-up-circle-fill'},
  new_task:  {color:'#1565c0',icon:'bi-inbox-fill'},
  alert:     {color:'#ed8d00',icon:'bi-exclamation-triangle-fill'},
  success:   {color:'#29811e',icon:'bi-check-circle-fill'},
  info:      {color:'#1565c0',icon:'bi-bell-fill'},
};
const MAX_TOASTS = 5;

const Toasts=({toasts,dismiss})=>(
  <div role="region" aria-label="Notifications" style={{position:'fixed',bottom:32,right:28,zIndex:9999,display:'flex',flexDirection:'column',gap:8,pointerEvents:'none',width:340}}>
    <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }`}</style>
    {toasts.slice(-MAX_TOASTS).map(t=>{
      const c=TOAST_CONF[t.type]||TOAST_CONF.info;
      return(
        <div key={t.id} role="alert" aria-live="polite" className="toast-enter" style={{background:'#1b1b1b',borderRadius:12,padding:'12px 20px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 4px 16px rgba(0,0,0,0.15)',pointerEvents:'all',color:'white',maxWidth:320,minWidth:260,animation:'toastIn 0.25s cubic-bezier(0.16,1,0.3,1) both'}}>
          <i className={c.icon} style={{color:c.color,fontSize:16,flexShrink:0}}></i>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.title}</div>
            {t.body&&<div style={{fontSize:12,color:'rgba(255,255,255,0.65)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.body}</div>}
          </div>
          {t.onUndo&&<button onClick={()=>{t.onUndo();dismiss(t.id);}} style={{flexShrink:0,background:'rgba(255,255,255,0.15)',border:'none',borderRadius:128,color:'white',fontSize:11.5,fontWeight:600,padding:'4px 12px',cursor:'pointer',whiteSpace:'nowrap'}}>Undo</button>}
          <button aria-label="Dismiss notification" onClick={()=>dismiss(t.id)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.4)',cursor:'pointer',fontSize:14,padding:'2px 3px',flexShrink:0,lineHeight:1,display:'flex',alignItems:'center'}}><i className="bi-x-lg"></i></button>
        </div>
      );
    })}
  </div>
);

export { TOAST_CONF };
export default Toasts;
