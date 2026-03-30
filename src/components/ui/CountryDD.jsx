import { useState, useEffect, useRef } from 'react';
import { FLAGS } from '../../data/constants';

const CountryDD=({all,sel,onChange})=>{
  const [open,setOpen]=useState(false); const ref=useRef(null);
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return()=>document.removeEventListener('mousedown',h); },[]);
  const toggle=c=>onChange(sel.includes(c)?sel.filter(x=>x!==c):[...sel,c]);
  const label=sel.length===0?'All Countries':sel.length<=2?sel.map(c=>`${FLAGS[c]} ${c}`).join(', '):`${sel.length} Countries`;
  return(
    <div ref={ref} style={{position:'relative'}}>
      <button aria-expanded={open} aria-haspopup="listbox" onClick={()=>setOpen(!open)} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 14px',border:`1px solid ${open||sel.length>0?'#1b1b1b':'#e8e8e8'}`,borderRadius:128,background:'white',color:sel.length>0?'#1b1b1b':'#616161',fontSize:12.5,cursor:'pointer',fontWeight:500}}>
        <i className="bi-globe2" style={{fontSize:12}}></i>{label}<i className={`bi-chevron-${open?'up':'down'}`} style={{fontSize:10,marginLeft:2}}></i>
      </button>
      {open&&<div style={{position:'absolute',top:'calc(100% + 4px)',left:0,background:'white',border:'1px solid #e8e8e8',borderRadius:12,boxShadow:'0 4px 24px rgba(0,0,0,0.1)',zIndex:100,minWidth:165,padding:'6px 0',animation:'modalIn .12s cubic-bezier(.34,1.56,.64,1) forwards'}}>
        {sel.length>0&&<div onClick={()=>onChange([])} style={{padding:'6px 14px',fontSize:12,color:'#d42d35',cursor:'pointer',fontWeight:600,borderBottom:'1px solid #e8e8e8',marginBottom:4}}><i className="bi-x" style={{marginRight:4}}></i>Clear all</div>}
        {/* max-height with scroll so long country lists don't overflow */}
        <div role="listbox" aria-label="Country filter" style={{maxHeight:220,overflowY:'auto'}}>
          {all.map(c=><label key={c} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',cursor:'pointer',fontSize:13,transition:'background .1s'}}
            onMouseEnter={e=>e.currentTarget.style.background='#f7f5f2'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <input type="checkbox" checked={sel.includes(c)} onChange={()=>toggle(c)} style={{accentColor:'#1b1b1b',width:16,height:16}}/><span>{FLAGS[c]}</span><span style={{color:'#616161',fontWeight:sel.includes(c)?600:400}}>{c}</span>
          </label>)}
        </div>
      </div>}
    </div>
  );
};

export default CountryDD;
