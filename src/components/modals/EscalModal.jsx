import { useState, useRef, useMemo } from 'react';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import Avatar from '../ui/Avatar';

const EscalModal=({task,bulkCount,onConfirm,onClose})=>{
  const isBulk=bulkCount>0;
  const asgn=MEMBERS.find(m=>m.id===task.assigneeId);
  const defaultMgr=asgn?MEMBERS.find(m=>m.id===asgn.lead):null;
  const managers=MEMBERS.filter(m=>m.role==='lead'||m.role==='admin'||m.role==='regional_mgr');
  const [selId,setSelId]=useState(defaultMgr?.id||managers[0]?.id||null);
  const [reason,setReason]=useState('');
  const [search,setSearch]=useState('');
  const [submitted,setSubmitted]=useState(false);
  const [shaking,setShaking]=useState(false);
  const searchRef=useRef(null);

  const truncatedSubject = task.subject.length > 60 ? task.subject.slice(0, 60) + '…' : task.subject;

  const filtered=useMemo(()=>{
    if(!search.trim()) return managers;
    const q=search.toLowerCase();
    return managers.filter(m=>
      m.name.toLowerCase().includes(q)||
      m.team.toLowerCase().includes(q)||
      m.role.toLowerCase().includes(q)||
      m.country.toLowerCase().includes(q)
    );
  },[managers,search]);

  const roleLabel=(r)=>{
    if(r==='admin') return 'Admin';
    if(r==='regional_mgr') return 'Regional Manager';
    return 'Team Lead';
  };

  const handleConfirm=()=>{
    if(!reason.trim()){
      setSubmitted(true);
      setShaking(true);
      setTimeout(()=>setShaking(false),300);
      return;
    }
    onConfirm(task,reason,selId);
  };

  return(
    <div role="dialog" aria-modal="true" aria-label="Escalate to Manager" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}} onClick={onClose}>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:520,boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',animation:'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:'var(--space-4)',marginBottom:'var(--space-4)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:36,height:36,background:'#ffe2de',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-arrow-up-circle-fill" style={{color:'#d42d35',fontSize:17}}></i></div>
            <div><div style={{fontWeight:700,fontSize:18,color:'#1b1b1b'}}>{isBulk?`Escalate ${bulkCount} Tasks`:'Escalate to Manager'}</div><div style={{fontSize:12,color:'#9e9e9e',marginTop:1}}>{isBulk?`${bulkCount} tasks selected`:truncatedSubject}</div></div>
          </div>
          <button aria-label="Close escalation modal" onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'#616161',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
        </div>
        <div style={{padding:'0 24px 16px 24px'}}>
          {!isBulk&&<div style={{background:'#f7f5f2',borderRadius:8,padding:'10px 12px',marginBottom:12,border:'1px solid #e8e8e8'}}>
            <div style={{fontSize:11,color:'#9e9e9e',fontWeight:600,marginBottom:2}}>TICKET</div>
            <div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>{truncatedSubject}</div>
            <div style={{fontSize:11,color:'#9e9e9e',marginTop:2}}>{task.id} · {task.type}</div>
          </div>}
          {/* Manager selection */}
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <span style={{fontSize:12,fontWeight:600,color:'#616161',letterSpacing:'.05em'}}>ESCALATE TO</span>
              <span style={{fontSize:10,color:'#9e9e9e'}}>{filtered.length} manager{filtered.length!==1?'s':''}</span>
            </div>
            {managers.length>5&&<div style={{position:'relative',marginBottom:8}}>
              <i className="bi-search" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'#9e9e9e',pointerEvents:'none'}}></i>
              <input
                ref={searchRef}
                value={search}
                onChange={e=>setSearch(e.target.value)}
                placeholder="Search managers..."
                style={{width:'100%',padding:'7px 12px 7px 30px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b'}}
              />
              {search&&<button onClick={()=>{setSearch('');searchRef.current?.focus();}} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#9e9e9e',fontSize:12,padding:0}}><i className="bi-x-circle-fill"></i></button>}
            </div>}
            <div role="radiogroup" aria-label="Select manager" style={{display:'flex',flexDirection:'column',gap:5,maxHeight:200,overflowY:'auto'}}>
              {filtered.length===0?(
                <div style={{padding:'16px',textAlign:'center',color:'#9e9e9e'}}>
                  <i className="bi-search" style={{fontSize:18,display:'block',marginBottom:4,opacity:.4}}></i>
                  <div style={{fontSize:12}}>No managers match "{search}"</div>
                </div>
              ):filtered.map(m=>{
                const isSelected=selId===m.id;
                const isDefault=defaultMgr&&m.id===defaultMgr.id;
                return(
                <div key={m.id} onClick={()=>setSelId(m.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 11px',borderRadius:8,cursor:'pointer',border:'1px solid #e8e8e8',background:isSelected?'#fff8e6':'white',transition:'all .15s',outline:isSelected?'2px solid #ed8d00':'none',outlineOffset:isSelected?'-2px':'0'}}>
                  <Avatar name={m.name} size={28}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12.5,fontWeight:isSelected?600:500,color:'#1b1b1b'}}>
                      {m.name}
                      {isDefault&&<span style={{marginLeft:5,fontSize:10,color:'#9e9e9e',fontWeight:400}}>direct manager</span>}
                    </div>
                    <div style={{fontSize:11,color:'#9e9e9e'}}>{FLAGS[m.country]} {m.country} · {m.team} · {roleLabel(m.role)}</div>
                  </div>
                  {isSelected&&<i className="bi-check-circle-fill" style={{color:'#ed8d00',fontSize:15,flexShrink:0}}></i>}
                </div>
                );
              })}
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:'#616161',marginBottom:5}}>Reason for escalation <span style={{color:'#d42d35'}}>*</span></div>
            <textarea
              autoFocus
              className={`note-input${submitted && !reason.trim() ? ' input-error' : ''}`}
              value={reason}
              onChange={e=>setReason(e.target.value)}
              rows={3}
              placeholder="Describe why this needs manager attention…"
              style={{borderRadius:8}}
            />
            {submitted && !reason.trim() && (
              <div className="error-msg"><i className="bi bi-exclamation-circle"/><span>This field is required</span></div>
            )}
          </div>
        </div>
        <div style={{padding:'0 24px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid var(--border)',paddingTop:'var(--space-4)',marginTop:'var(--space-4)'}}>
          <button onClick={onClose} style={{background:'white',border:'1px solid #dedede',color:'#1b1b1b',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:'pointer'}}>Cancel</button>
          <button
            className={shaking ? 'shake' : ''}
            style={{background:'#1b1b1b',color:'white',border:'none',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}
            onClick={handleConfirm}
          >
            <i className="bi-arrow-up-circle-fill" style={{fontSize:13}}></i>{isBulk?`Escalate ${bulkCount} Tasks`:'Confirm Escalation'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EscalModal;
