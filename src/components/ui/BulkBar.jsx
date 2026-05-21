const BulkBar=({count,onClose,onEscalate,onResolve,onClear})=>(
  <div style={{position:'fixed',bottom:80,left:0,right:0,background:'var(--surface, #fff)',color:'var(--text)',padding:'12px 24px',borderRadius:'12px 12px 0 0',display:'flex',alignItems:'center',gap:10,zIndex:500,boxShadow:'var(--shadow-xl, 0 8px 32px rgba(0,0,0,0.16))'}} role="toolbar" aria-label={`${count} tasks selected`}>
    <span style={{fontWeight:600,fontSize:13}}>{count} task{count>1?'s':''} selected</span>
    <div style={{flex:1}}/>
    <button onClick={onEscalate} style={{background:'transparent',color:'var(--text)',border:'1px solid rgba(0,0,0,0.15)',borderRadius:128,padding:'6px 16px',fontSize:12.5,cursor:'pointer',fontWeight:500,display:'flex',alignItems:'center',gap:5}}><i className="bi-arrow-up-circle" style={{fontSize:12}}></i>Escalate All</button>
    <button onClick={onResolve}  style={{background:'transparent',color:'var(--text)',border:'1px solid rgba(0,0,0,0.15)',borderRadius:128,padding:'6px 16px',fontSize:12.5,cursor:'pointer',fontWeight:500,display:'flex',alignItems:'center',gap:5}}><i className="bi-check-circle" style={{fontSize:12}}></i>Close All</button>
    <button onClick={onClear}    style={{background:'transparent',color:'rgba(0,0,0,0.4)',border:'1px solid rgba(0,0,0,0.1)',borderRadius:128,padding:'6px 16px',fontSize:12.5,cursor:'pointer',fontWeight:500}}>Clear</button>
  </div>
);

export default BulkBar;
