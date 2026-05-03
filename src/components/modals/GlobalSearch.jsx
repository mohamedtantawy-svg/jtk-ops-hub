import { useState, useEffect, useRef } from 'react';
import { MEMBERS } from '../../data/members';
import { KB_SEARCH_INDEX } from '../../data/knowledge';
import { FLAGS } from '../../data/constants';
import { ToolBadge, StatusBadge } from '../ui/Badges';

const GlobalSearch=({tasks,setView,setSelTask,onClose})=>{
  const [q,setQ]=useState('');
  const [hlIdx,setHlIdx]=useState(-1);
  const iRef=useRef(null);
  useEffect(()=>{ iRef.current?.focus(); },[]);
  useEffect(()=>{setHlIdx(-1);},[q]);
  // Search filtering — debounce input recommended for production
  const ql=q.trim().toLowerCase();
  const show=q.trim().length>1;
  const qTasks =show?tasks.filter(t=>t.source!=='slack'&&(t.subject.toLowerCase().includes(ql)||t.id.toLowerCase().includes(ql)||t.type.toLowerCase().includes(ql))).slice(0,5):[];
  const qSlack =show?tasks.filter(t=>t.source==='slack'&&(t.subject.toLowerCase().includes(ql)||t.body.toLowerCase().includes(ql)||t.sender?.toLowerCase().includes(ql))).slice(0,3):[];
  const qKB    =show?KB_SEARCH_INDEX.filter(k=>k.name.toLowerCase().includes(ql)).slice(0,4):[];
  const hasRes =qTasks.length>0||qSlack.length>0||qKB.length>0;
  const allResults=[];
  qTasks.forEach(t=>allResults.push({type:'task',item:t}));
  qSlack.forEach(t=>allResults.push({type:'slack',item:t}));
  qKB.forEach(k=>allResults.push({type:'kb',item:k}));

  const handleSelect=(r)=>{
    if(!r)return;
    if(r.type==='task'){setSelTask(r.item);setView('my-queue');onClose();}
    if(r.type==='slack'){setSelTask(r.item);setView('my-queue');onClose();}
    if(r.type==='kb'){setView('knowledge-hub');onClose();}
  };

  const handleResultClick=(idx)=>{
    const r=allResults[idx];
    handleSelect(r);
  };
  const handleSearchKey=(e)=>{
    if(e.key==='ArrowDown'){e.preventDefault();setHlIdx(prev=>Math.min(prev+1,allResults.length-1));}
    if(e.key==='ArrowUp'){e.preventDefault();setHlIdx(prev=>Math.max(prev-1,-1));}
    if(e.key==='Enter'&&hlIdx>=0&&allResults[hlIdx]){e.preventDefault();handleSelect(allResults[hlIdx]);}
    if(e.key==='Escape'){onClose();}
  };
  let globalIdx=-1;

  const sectionHeaderStyle={
    padding:'8px 16px 4px',
    fontSize:'var(--font-xs)',
    letterSpacing:'0.06em',
    fontWeight:600,
    color:'var(--text-muted)',
    textTransform:'uppercase',
  };

  const Row=({children,onClick,isHighlighted})=>(
    <div onClick={onClick} style={{
      padding:'10px 20px',display:'flex',alignItems:'center',gap:12,cursor:'pointer',transition:'background .1s',
      background:isHighlighted?'var(--purple-light)':'transparent',
      borderLeft:isHighlighted?'2px solid var(--purple)':'2px solid transparent',
    }}
      onMouseEnter={e=>{if(!isHighlighted)e.currentTarget.style.background='var(--surface-2)';}} onMouseLeave={e=>{if(!isHighlighted)e.currentTarget.style.background='transparent';}}>
      {children}
    </div>
  );
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:800,display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:'15vh',backdropFilter:'blur(4px)'}} role="dialog" aria-modal="true" aria-label="Global search" onClick={onClose}>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{background:'var(--surface)',borderRadius:'var(--radius-2xl)',width:'100%',maxWidth:560,boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',display:'flex',flexDirection:'column',maxHeight:'60vh',animation:'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'16px 20px',borderBottom:'1px solid #e8e8e8',flexShrink:0}}>
          <i className="bi-search" style={{color:'#9e9e9e',fontSize:16,flexShrink:0}}></i>
          <input
            ref={iRef}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded={hasRes}
            aria-autocomplete="list"
            value={q}
            onChange={e=>setQ(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Search tasks, Slack, knowledge hub…"
            style={{flex:1,border:'none',outline:'none',fontSize:'var(--font-lg, 16px)',color:'var(--text)',background:'transparent'}}
          />
          {q&&<button aria-label="Clear search" onClick={()=>setQ('')} style={{background:'none',border:'none',color:'#616161',cursor:'pointer',fontSize:17,display:'flex'}}><i className="bi-x"></i></button>}
          <span style={{background:'#f2f2f2',color:'#616161',borderRadius:5,padding:'2px 7px',fontSize:11,fontFamily:'monospace',flexShrink:0}}>ESC</span>
        </div>
        <div style={{overflowY:'auto',flex:1}}>
          {!q&&<div style={{padding:'32px 24px',textAlign:'center',color:'#9e9e9e'}}><i className="bi-search" style={{fontSize:32,display:'block',marginBottom:16,opacity:.35}}></i><div style={{fontSize:14}}>Search across tasks, Slack messages, and the knowledge hub</div></div>}
          {show&&!hasRes&&<div style={{padding:'32px 24px',textAlign:'center',color:'#9e9e9e'}}><div style={{fontSize:14}}>No results for "<strong style={{color:'#1b1b1b'}}>{q}</strong>"</div></div>}
          {qTasks.length>0&&<>
            <div style={sectionHeaderStyle}>QUEUE TASKS</div>
            {qTasks.map(t=>{globalIdx++;const gi=globalIdx;return(
              <Row key={t.id} isHighlighted={hlIdx===gi} onClick={()=>{setSelTask(t);setView('my-queue');onClose();}}>
                <ToolBadge source={t.source}/>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:'#1b1b1b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.subject}</div><div style={{fontSize:11,color:'#9e9e9e'}}>{t.id} · {FLAGS[t.country]} {t.country}</div></div>
                <StatusBadge status={t.status}/>
              </Row>
            );})}
          </>}
          {qSlack.length>0&&<>
            <div style={sectionHeaderStyle}>SLACK</div>
            {qSlack.map(t=>{globalIdx++;const gi=globalIdx;return(
              <Row key={t.id} isHighlighted={hlIdx===gi} onClick={()=>{setSelTask(t);setView('my-queue');onClose();}}>
                <div style={{width:28,height:28,background:'#f3eff8',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-slack" style={{color:'#c4b1f9',fontSize:13}}></i></div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:'#1b1b1b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.subject}</div><div style={{fontSize:11,color:'#9e9e9e'}}>{t.sender} · {t.channel}</div></div>
              </Row>
            );})}
          </>}
          {qKB.length>0&&<>
            <div style={sectionHeaderStyle}>KNOWLEDGE HUB</div>
            {qKB.map(k=>{globalIdx++;const gi=globalIdx;return(
              <Row key={k.name} isHighlighted={hlIdx===gi} onClick={()=>{setView('knowledge-hub');onClose();}}>
                <div style={{width:28,height:28,background:'#f3eff8',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={k.type==='report'?'bi-graph-up':k.type==='policy'?'bi-shield-check':k.type==='channel'?'bi-hash':'bi-tools'} style={{color:'#1565c0',fontSize:12}}></i></div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:'#1b1b1b'}}>{k.name}</div><div style={{fontSize:11,color:'#9e9e9e',textTransform:'capitalize'}}>{k.type} · Knowledge Hub</div></div>
                <i className="bi-arrow-right" style={{color:'#dedede',fontSize:11}}></i>
              </Row>
            );})}
          </>}
        </div>
        {hasRes&&<div style={{padding:'8px 20px',borderTop:'1px solid #e8e8e8',display:'flex',gap:12,flexShrink:0}}>
          {[['↑↓','Navigate'],['↵','Open'],['ESC','Close']].map(([k,l])=><span key={k} style={{fontSize:11,color:'#9e9e9e',display:'flex',alignItems:'center',gap:4}}><span className="kbd">{k}</span>{l}</span>)}
        </div>}
      </div>
    </div>
  );
};

export default GlobalSearch;
