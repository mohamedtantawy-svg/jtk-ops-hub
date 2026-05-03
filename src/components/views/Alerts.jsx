import { useState } from 'react';
import { TOOLS, FLAGS } from '../../data/constants';
import { MEMBERS } from '../../data/members';
import { getUrl } from '../../utils/helpers';
import { ToolBadge, FnBadge } from '../ui/Badges';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';

const PRIORITY_ORDER={critical:0,high:1,medium:2,low:3};

const Alerts=({tasks,setTasks})=>{
  const [dismissed,setDismissed]=useState([]);
  const alerts=tasks
    .filter(t=>t.isAlert&&!dismissed.includes(t.id))
    .sort((a,b)=>(PRIORITY_ORDER[a.priority]??4)-(PRIORITY_ORDER[b.priority]??4));

  const dismissAll=()=>{
    const alertIds=tasks.filter(t=>t.isAlert).map(t=>t.id);
    setDismissed(prev=>[...new Set([...prev,...alertIds])]);
  };

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflowY:'auto'}}>
      <PageHeader icon="bi-exclamation-triangle-fill" iconBg="#fff8e6" iconColor="#ed8d00" title="Anomaly Alerts" subtitle={`${alerts.filter(a=>a.status!=='resolved').length} active · from Looker & connected data sources`}
        right={alerts.length>0&&(
          <button onClick={dismissAll} className="deel-btn deel-btn-secondary deel-btn-sm" style={{height:34,padding:'0 16px',borderRadius:128,border:'1px solid var(--border, #e8e8e8)',background:'var(--surface, white)',color:'var(--text-secondary, #616161)',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5,transition:'all .15s'}}
            onMouseEnter={e=>{e.currentTarget.style.background='var(--surface-2, #f7f5f2)';}} onMouseLeave={e=>{e.currentTarget.style.background='var(--surface, white)';}}>
            <i className="bi-x-circle" style={{fontSize:11}}></i>Dismiss All
          </button>
        )}
      />
      <div style={{padding:'16px 24px',flex:1,overflowY:'auto'}}>
      {alerts.length===0?(
        <div style={{textAlign:'center', padding:'60px 20px', color:'var(--text-muted)'}}>
          <i className="bi bi-shield-check" style={{fontSize:32, display:'block', marginBottom:12, opacity:0.4}}/>
          <div style={{fontSize:'var(--font-md)', fontWeight:600, color:'var(--text-secondary)', marginBottom:4}}>All clear</div>
          <div style={{fontSize:'var(--font-base)'}}>No active alerts right now</div>
        </div>
      ):(
        <div style={{background:'var(--surface)',border:'1px solid #e8e8e8',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
        {alerts.map((a,idx)=>{
          const SEVERITY_STYLE={
            critical:{color:'var(--red, #d42d35)',icon:'bi-exclamation-octagon-fill'},
            high:{color:'var(--orange, #b45309)',icon:'bi-exclamation-triangle-fill'},
            medium:{color:'var(--blue, #1f74b3)',icon:'bi-info-circle-fill'},
            low:{color:'var(--text-muted, #9e9e9e)',icon:'bi-info-circle'},
          };
          const sev=SEVERITY_STYLE[a.priority]||SEVERITY_STYLE.medium;
          return(
          <div key={a.id} role="alert" style={{borderBottom:idx<alerts.length-1?'1px solid var(--border-light, #f0f0f0)':'none',padding:'16px 18px',transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='#fafaf9'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
            <div style={{display:'flex',gap:12}}>
              <div style={{width:40,height:40,borderRadius:16,background:a.status==='resolved'?'#e8f5e3':'#fff8e6',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <i className={a.status==='resolved'?'bi-check-circle-fill':sev.icon} style={{color:a.status==='resolved'?'#29811e':sev.color,fontSize:18}}></i>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14,color:'#1b1b1b',marginBottom:6}}>{a.subject}</div>
                <div style={{fontSize:13,color:'#616161',lineHeight:1.6,wordBreak:'break-word'}}>{a.body.slice(0,180)}{a.body.length>180?'...':''}</div>
                <div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  <ToolBadge source={a.source}/>
                  <span style={{color:'#616161',fontSize:12}}>{FLAGS[a.country]} {a.country} · {a.receivedAt}</span>
                  <a href={getUrl(a)} target="_blank" rel="noreferrer" style={{color:'#1f74b3',fontSize:12,textDecoration:'none',fontWeight:600,display:'flex',alignItems:'center',gap:4,background:'#e8f0fe',padding:'4px 12px',borderRadius:128}}>
                    <i className="bi-box-arrow-up-right" style={{fontSize:10}}></i>Open in {TOOLS[a.source]?.label}
                  </a>
                </div>
              </div>
            </div>
          </div>
          );
        })}
        </div>
      )}
      </div>
    </div>
  );
};

export default Alerts;
