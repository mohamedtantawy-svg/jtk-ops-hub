import { useState, useRef, useMemo } from 'react';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import Avatar from '../ui/Avatar';

const ReassignModal=({task,tasks,bulkCount,onConfirm,onClose})=>{
  const isBulk=bulkCount>0;
  const [selId,setSelId]=useState(task.assigneeId);
  const [note,setNote]=useState('');
  const [search,setSearch]=useState('');
  const [teamFilter,setTeamFilter]=useState('all');
  const noteRef=useRef(null);
  const searchRef=useRef(null);
  const agents=MEMBERS.filter(m=>m.role==='agent'||m.role==='lead');
  const teams=[...new Set(agents.map(m=>m.team).filter(t=>t&&t!=='ALL'))];
  const openCount=(id)=>(tasks||[]).filter(t=>t.assigneeId===id&&t.status!=='resolved').length;
  const maxOpen=Math.max(...agents.map(m=>openCount(m.id)),1);

  const filtered=useMemo(()=>{
    let list=agents;
    if(teamFilter!=='all') list=list.filter(m=>m.team===teamFilter);
    if(search.trim()){
      const q=search.toLowerCase();
      list=list.filter(m=>
        m.name.toLowerCase().includes(q)||
        m.country.toLowerCase().includes(q)||
        m.team.toLowerCase().includes(q)||
        m.role.toLowerCase().includes(q)
      );
    }
    return list;
  },[agents,teamFilter,search]);

  return(
    <div role="dialog" aria-modal="true" aria-label="Reassign Task" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,backdropFilter:'blur(4px)'}} onClick={onClose}>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:520,boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',animation:'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:'var(--space-4)',marginBottom:'var(--space-4)'}}>
          <div><div style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>{isBulk?`Reassign ${bulkCount} Tasks`:'Reassign Task'}</div><div style={{fontSize:12,color:'#9e9e9e',marginTop:1}}>{isBulk?`${bulkCount} tasks selected`:`${task.id} · ${task.subject.slice(0,50)}${task.subject.length>50?'…':''}`}</div></div>
          <button aria-label="Close" onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'#616161',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
        </div>
        <div style={{padding:'0 24px 16px 24px'}}>
          {/* Search */}
          <div style={{position:'relative',marginBottom:10}}>
            <i className="bi-search" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'#9e9e9e',pointerEvents:'none'}}></i>
            <input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={e=>setSearch(e.target.value)}
              placeholder="Search by name, country, or team..."
              style={{width:'100%',padding:'8px 12px 8px 30px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b'}}
            />
            {search&&<button onClick={()=>{setSearch('');searchRef.current?.focus();}} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#9e9e9e',fontSize:12,padding:0}}><i className="bi-x-circle-fill"></i></button>}
          </div>
          {/* Team filter tabs */}
          <div style={{display:'flex',gap:4,marginBottom:10,flexWrap:'wrap'}}>
            {['all',...teams].map(t=>{
              const active=teamFilter===t;
              const label=t==='all'?'All Teams':t;
              const count=t==='all'?agents.length:agents.filter(m=>m.team===t).length;
              return(
                <button key={t} onClick={()=>setTeamFilter(t)} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 10px',borderRadius:128,border:`1px solid ${active?'var(--purple, #6b3fa0)':'#e8e8e8'}`,background:active?'var(--purple-light, #f3eefa)':'white',color:active?'var(--purple, #6b3fa0)':'#616161',fontSize:11,fontWeight:active?600:400,cursor:'pointer',transition:'all .15s'}}>
                  {label} <span style={{fontSize:10,opacity:.7}}>{count}</span>
                </button>
              );
            })}
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontSize:12,fontWeight:600,color:'#616161',letterSpacing:'.05em'}}>SELECT AGENT</span>
            <span style={{fontSize:10,color:'#9e9e9e'}}>{filtered.length} result{filtered.length!==1?'s':''} · bar = workload</span>
          </div>
          <div role="radiogroup" aria-label="Select agent" style={{display:'flex',flexDirection:'column',gap:5,maxHeight:240,overflowY:'auto'}}>
            {filtered.length===0?(
              <div style={{padding:'24px 16px',textAlign:'center',color:'#9e9e9e'}}>
                <i className="bi-search" style={{fontSize:20,display:'block',marginBottom:6,opacity:.4}}></i>
                <div style={{fontSize:12}}>No agents match "{search||teamFilter}"</div>
              </div>
            ):filtered.map(m=>{
              const cnt=openCount(m.id);
              const pct=Math.round((cnt/maxOpen)*100);
              const wlColor=pct>75?'#d42d35':pct>50?'#e65100':'#29811e';
              const isSelected=selId===m.id;
              return(
              <div key={m.id} onClick={()=>setSelId(m.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 11px',borderRadius:8,cursor:'pointer',border:'1px solid #e8e8e8',background:isSelected?'#f7f5f2':'white',transition:'all .15s',outline:isSelected?'2px solid var(--purple)':'none',outlineOffset:isSelected?'-2px':'0'}}>
                <Avatar name={m.name} size={28}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:isSelected?600:500,color:'#1b1b1b'}}>{m.name}{m.id===task.assigneeId?<span style={{marginLeft:5,fontSize:10,color:'#9e9e9e',fontWeight:400}}>current</span>:null}</div>
                  <div style={{fontSize:11,color:'#9e9e9e',marginBottom:4}}>{FLAGS[m.country]} {m.country} · {m.team} · {m.role.charAt(0).toUpperCase()+m.role.slice(1)}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div className="wl-bar-bg" style={{flex:1}}><div className="wl-bar-fg" style={{width:`${pct}%`,background:wlColor}}></div></div>
                    <span style={{fontSize:9.5,color:pct>75?'#d42d35':'#9e9e9e',fontWeight:600,whiteSpace:'nowrap'}}>{cnt} open</span>
                  </div>
                </div>
                {isSelected&&<i className="bi-check-circle-fill" style={{color:'var(--purple)',fontSize:15,flexShrink:0}}></i>}
              </div>
              );
            })}
          </div>
          <div style={{marginTop:12}}><div style={{fontSize:12,fontWeight:600,color:'#616161',letterSpacing:'.05em',marginBottom:5}}>NOTE (OPTIONAL)</div><textarea ref={noteRef} className="note-input" value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="Reason for reassignment…"/></div>
        </div>
        <div style={{padding:'0 24px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)',paddingTop:'var(--space-4)',marginTop:'var(--space-4)'}}>
          <button onClick={onClose} style={{background:'white',border:'1px solid #dedede',color:'#1b1b1b',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:'pointer'}}>Cancel</button>
          <button onClick={()=>onConfirm(task,selId,note)} style={{background:'#1b1b1b',color:'white',border:'none',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}><i className="bi-person-check" style={{fontSize:13}}></i>{isBulk?`Reassign ${bulkCount} Tasks`:'Reassign'}</button>
        </div>
      </div>
    </div>
  );
};

export default ReassignModal;
