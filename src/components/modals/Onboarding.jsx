import { useState, useEffect } from 'react';

const Onboarding=({onDismiss})=>{
  const [dontShow,setDontShow]=useState(false);
  const handleDismiss=()=>onDismiss(dontShow);
  useEffect(()=>{const h=e=>{if(e.key==='Escape')handleDismiss();};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h);},[]);
  return(
  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:800,display:'flex',alignItems:'center',justifyContent:'center'}} role="dialog" aria-modal="true" aria-label="Welcome to Ops Hub" onClick={handleDismiss}>
    <div style={{background:'var(--surface)',borderRadius:16,width:'100%',maxWidth:520,overflow:'hidden',boxShadow:'0 4px 24px rgba(0,0,0,0.15)',position:'relative',animation:'modalIn .18s cubic-bezier(.34,1.56,.64,1) forwards'}} onClick={e=>e.stopPropagation()}>
      {/* Close button */}
      <button onClick={handleDismiss} style={{position:'absolute',top:16,right:16,width:32,height:32,borderRadius:'50%',background:'rgba(0,0,0,.08)',border:'none',color:'rgba(255,255,255,.7)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,zIndex:10,transition:'all .15s'}}
        onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.22)'}
        onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.08)'}>
        <i className="bi-x-lg"></i>
      </button>
      <div style={{background:'linear-gradient(135deg,#1b1b1b 0%,#2d2d2d 100%)',padding:'24px 24px 24px'}}>
        <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:16}}>
          <div style={{width:40,height:40,background:'var(--g)',borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center'}}><i className="bi-grid-1x2-fill" style={{color:'#1b1b1b',fontSize:18}}></i></div>
          <div><div style={{color:'white',fontWeight:700,fontSize:18,lineHeight:1.2}}>Welcome to Ops Hub</div><div style={{color:'#9e9e9e',fontSize:12.5,marginTop:2}}>HR Operations Command Center · Deel</div></div>
        </div>
        <p style={{color:'#9e9e9e',fontSize:13,lineHeight:1.65,margin:0}}>Everything your team needs to manage tickets, escalations, deadlines, and team knowledge — unified in one place.</p>
      </div>
      <div style={{padding:'16px 24px 24px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
          {[
            {icon:'bi-inbox',              color:'#1565c0',title:'Smart Queue',       desc:'FIFO task queue with aging alerts, bulk actions, and AI-suggested replies'},
            {icon:'bi-book-half',           color:'#1565c0',title:'Knowledge Hub',    desc:'Real Looker reports, Workbench processes, SLAs, and team channels — all searchable'},
            {icon:'bi-arrow-up-circle-fill',color:'#d42d35',title:'Escalations',      desc:'Route any ticket to the manager pipeline with one click, tracked end-to-end'},
            {icon:'bi-calendar3',           color:'#1565c0',title:'Deadlines & Reviews',desc:'Probation reviews, permit renewals, payroll cutoffs — never miss a deadline'},
          ].map(f=>(
            <div key={f.title} style={{background:'#f7f5f2',borderRadius:12,padding:'13px 14px',border:'1px solid #e8e8e8'}}>
              <div style={{width:32,height:32,background:`${f.color}15`,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:9}}><i className={f.icon} style={{color:f.color,fontSize:15}}></i></div>
              <div style={{fontWeight:600,fontSize:13,color:'#1b1b1b',marginBottom:3}}>{f.title}</div>
              <div style={{fontSize:12,color:'#616161',lineHeight:1.55}}>{f.desc}</div>
            </div>
          ))}
        </div>
        {/* Don't show again checkbox */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
          <input type="checkbox" id="dont-show" checked={dontShow} onChange={e=>setDontShow(e.target.checked)} style={{width:18,height:18,accentColor:'#1b1b1b',cursor:'pointer'}}/>
          <label htmlFor="dont-show" style={{fontSize:12.5,color:'#616161',cursor:'pointer',userSelect:'none'}}>Don't show again on next visit</label>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={handleDismiss} style={{flex:1,background:'#1b1b1b',color:'white',border:'none',borderRadius:128,padding:'10px 24px',fontSize:14,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>
            <i className="bi-arrow-right-circle-fill" style={{fontSize:15}}></i>Open Ops Hub
          </button>
          <div style={{fontSize:11.5,color:'#9e9e9e',textAlign:'right',lineHeight:1.5}}>Press <span style={{background:'#f2f2f2',borderRadius:4,padding:'1px 6px',fontFamily:'monospace',fontSize:11,color:'#1b1b1b'}}>⌘K</span><br/>to search anywhere</div>
        </div>
      </div>
    </div>
  </div>
  );
};

export default Onboarding;
