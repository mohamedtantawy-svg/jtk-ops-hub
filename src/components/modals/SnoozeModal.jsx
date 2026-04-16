import { useState, useEffect, useRef } from 'react';

const SnoozeModal=({task,bulkCount,onConfirm,onClose})=>{
  const isBulk=bulkCount>0;
  const [sel,setSel]=useState('1h');
  const [submitting,setSubmitting]=useState(false);
  const confirmBtnRef=useRef(null);
  useEffect(()=>{ confirmBtnRef.current?.focus(); },[]);
  const now=new Date();
  const fmt=(d)=>d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const add=(m)=>{ const d=new Date(now); d.setMinutes(d.getMinutes()+m); return fmt(d); };
  const opts=[
    {id:'30m',label:'30 minutes',    sub:`Back at ${add(30)}`},
    {id:'1h', label:'1 hour',        sub:`Back at ${add(60)}`},
    {id:'2h', label:'2 hours',       sub:`Back at ${add(120)}`},
    {id:'eod',label:'End of Day',    sub:'Back at 18:00 today'},
    {id:'tmr',label:'Tomorrow 9 AM', sub:'Resumes tomorrow morning'},
  ];
  return(
    <div role="dialog" aria-modal="true" aria-label="Snooze Task" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,backdropFilter:'blur(4px)'}} onClick={onClose}>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:520,boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',animation:'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:'var(--space-4)',marginBottom:'var(--space-4)'}}>
          <div><div style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>{isBulk?`Snooze ${bulkCount} Tasks`:'Snooze Task'}</div><div style={{fontSize:12,color:'#9e9e9e',marginTop:1}}>{isBulk?`${bulkCount} tasks selected`:`${task.id} · ${task.subject.slice(0,46)}${task.subject.length>46?'…':''}`}</div></div>
          <button aria-label="Close" onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'#616161',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
        </div>
        <div style={{padding:'0 24px 16px 24px'}}>
          <div style={{fontSize:12,fontWeight:600,color:'#616161',letterSpacing:'.05em',marginBottom:9}}>SNOOZE UNTIL</div>
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            {opts.map(o=>{
              const isActive=sel===o.id;
              return(
                <div key={o.id} role="radio" aria-checked={isActive} onClick={()=>setSel(o.id)} style={{
                  display:'flex',alignItems:'center',gap:12,padding:'10px 13px',borderRadius:8,cursor:'pointer',transition:'all .15s',
                  background: isActive ? 'var(--purple-light)' : 'var(--surface)',
                  border: isActive ? '1px solid var(--purple-mid)' : '1px solid var(--border)',
                  color: isActive ? 'var(--purple)' : 'var(--text-secondary)',
                }}>
                  <div style={{width:17,height:17,borderRadius:'50%',border:`2px solid ${isActive?'var(--purple)':'#dedede'}`,background:isActive?'var(--purple)':'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {isActive&&<div style={{width:6,height:6,borderRadius:'50%',background:'white'}}></div>}
                  </div>
                  <div style={{flex:1}}><div style={{fontSize:13,fontWeight:isActive?600:500,color:'#1b1b1b'}}>{o.label}</div><div style={{fontSize:11,color:'#9e9e9e',marginTop:1}}>{o.sub}</div></div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{padding:'0 24px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)',paddingTop:'var(--space-4)',marginTop:'var(--space-4)'}}>
          <button onClick={onClose} style={{background:'white',border:'1px solid #dedede',color:'#1b1b1b',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:'pointer'}}>Cancel</button>
          <button ref={confirmBtnRef} disabled={submitting} onClick={()=>{if(submitting)return;setSubmitting(true);onConfirm(task,sel);}} style={{background:submitting?'#dedede':'#1b1b1b',color:'white',border:'none',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:submitting?'not-allowed':'pointer',display:'flex',alignItems:'center',gap:5,opacity:submitting?.6:1}}><i className="bi-alarm" style={{fontSize:13}}></i>{submitting?'Snoozing…':isBulk?`Snooze ${bulkCount} Tasks`:'Snooze Task'}</button>
        </div>
      </div>
    </div>
  );
};

export default SnoozeModal;
