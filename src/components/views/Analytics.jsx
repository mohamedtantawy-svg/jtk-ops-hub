import { useState, useMemo, useContext } from 'react';
import { TOOLS, FUNCTIONS, FLAGS } from '../../data/constants';
import { MEMBERS } from '../../data/members';
import { HOURLY_VOLUME } from '../../data/feed';
import { SettingsContext } from '../../App';
import Avatar from '../ui/Avatar';

const DATE_RANGES = [
  { id:'7d',  label:'7 Days',  days:7  },
  { id:'30d', label:'30 Days', days:30 },
  { id:'90d', label:'90 Days', days:90 },
];

const REGIONS = [
  { id:'all',  label:'All Regions' },
  { id:'EMEA', label:'EMEA' },
  { id:'APAC', label:'APAC' },
  { id:'AMER', label:'AMER' },
];

const Analytics=({tasks,currentUser,subFilter,escalations=[]})=>{
  const settings=useContext(SettingsContext);
  const [sortCol,setSortCol]=useState('slaComp');
  const [sortDir,setSortDir]=useState('desc');
  const [dateRange,setDateRange]=useState('7d');
  const [regionFilter,setRegionFilter]=useState('all');

  // Apply date range filter: tasks created within the last N days based on minutesAgo
  const rangeDays = DATE_RANGES.find(r=>r.id===dateRange)?.days || 7;
  const rangeMins = rangeDays * 24 * 60;
  const allTasks=tasks.filter(t=>t.source!=='slack');
  // Apply region filter — match task's assigned member region
  const regionFiltered = regionFilter === 'all'
    ? allTasks
    : allTasks.filter(t => {
        const member = MEMBERS.find(m => m.id === t.assigneeId);
        return member?.region === regionFilter || t.region === regionFilter;
      });
  // Apply date range — tasks with minutesAgo within the range window
  const all = regionFiltered.filter(t => (t.minutesAgo ?? 0) <= rangeMins);
  const resolved=all.filter(t=>t.status==='resolved');
  const open=all.filter(t=>t.status!=='resolved');
  // Guard against NaN: filter tasks with resolvedMins set, default to 0 if missing
  const resolvedWithTime = resolved.filter(t => t.resolvedMins != null && !isNaN(t.resolvedMins));
  const avgRes=resolvedWithTime.length>0?Math.round(resolvedWithTime.reduce((a,t)=>a+(t.resolvedMins||0),0)/resolvedWithTime.length):'-';
  const maxHV=Math.max(...HOURLY_VOLUME.map(h=>h.v));
  const bySrc=Object.entries(TOOLS).map(([k,v])=>({key:k,label:v.label,color:v.dot,count:all.filter(t=>t.source===k).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  const byFn=Object.entries(FUNCTIONS).map(([k,v])=>({key:k,label:v.label,color:v.color,count:all.filter(t=>t.type===k).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,6);
  const cKeys=[...new Set(all.map(t=>t.country))];
  const byCtry=cKeys.map(c=>({c,count:all.filter(t=>t.country===c).length})).sort((a,b)=>b.count-a.count);
  const agents=MEMBERS.filter(m=>m.role==='agent');

  // Escalation rate KPI — guard division by zero with || 1
  const escalCount = escalations.length > 0 ? escalations.length : 3;
  const escalRate = ((escalCount / (all.length || 1)) * 100).toFixed(1);
  const escalRateDelta = 0.3; // positive = increase = bad
  const rateColor = escalRateDelta > 0 ? 'var(--red)' : 'var(--green)';
  const rateIcon = escalRateDelta > 0 ? 'bi-arrow-up' : 'bi-arrow-down';

  // Agent performance with extra cols — base list is ALL agents, not just those with tasks
  const agentStats=useMemo(()=>MEMBERS.filter(m=>m.role==='agent').map(a=>({
    a, assigned:all.filter(t=>t.assigneeId===a.id).length,
    resolved:all.filter(t=>t.assigneeId===a.id&&t.status==='resolved').length,
    open:all.filter(t=>t.assigneeId===a.id&&t.status!=='resolved').length,
    avgT:28+((a.id*7)%22),
    escalRate: ((a.id * 3) % 8) + 1,           // mock 1-8%
    avgFirstResp: `${1 + (a.id % 3)}h ${(a.id * 7) % 60}m`, // mock
    slaComp: 85 + ((a.id * 3) % 16),            // mock 85-100%
  })),[all]);

  const sortedAgents=[...agentStats].sort((a,b)=>{
    const v=sortDir==='asc'?1:-1;
    if(sortCol==='resolved')  return v*(a.resolved-b.resolved);
    if(sortCol==='open')      return v*(a.open-b.open);
    if(sortCol==='assigned')  return v*(a.assigned-b.assigned);
    if(sortCol==='avgT')      return v*(a.avgT-b.avgT);
    if(sortCol==='escalRate') return v*(a.escalRate-b.escalRate);
    if(sortCol==='slaComp')   return v*(a.slaComp-b.slaComp);
    return 0;
  });
  const toggleSort=col=>{if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('desc');}};
  const SortIcon=({col})=>sortCol===col?<i className={`bi-caret-${sortDir==='asc'?'up':'down'}-fill`} style={{fontSize:9,marginLeft:3,color:'#1b1b1b'}} aria-label={sortDir==='asc'?'sorted ascending':'sorted descending'}></i>:<i className="bi-chevron-expand" style={{fontSize:9,marginLeft:3,color:'#dedede'}} aria-label="sortable"></i>;
  const maxSrc=Math.max(...bySrc.map(x=>x.count),1)||1;
  const maxFn=Math.max(...byFn.map(x=>x.count),1)||1;
  const maxCtry=Math.max(...byCtry.map(x=>x.count),1)||1;
  const todayStr=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  const selectedRange = DATE_RANGES.find(r=>r.id===dateRange) || DATE_RANGES[0];
  const selectedRegion = REGIONS.find(r=>r.id===regionFilter) || REGIONS[0];
  const subtitleText = regionFilter === 'all'
    ? `Showing data for last ${selectedRange.days} days`
    : `${selectedRegion.label} Performance — last ${selectedRange.days} days`;

  const Bar=({pct,color,height=8,value})=>{
    const [hov,setHov]=useState(false);
    return(
      <div style={{position:'relative',background:'#f2f2f2',borderRadius:128,height,flex:1,overflow:'visible',cursor:'default'}}
        onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
        <div title={value} style={{width:`${Math.max(0,Math.min(100,pct))}%`,height:'100%',background:color,borderRadius:128,transition:'width .7s ease'}}></div>
        {hov&&value!==undefined&&<div style={{position:'absolute',top:'-28px',left:`${Math.min(pct,80)}%`,transform:'translateX(-50%)',background:'#1b1b1b',color:'white',borderRadius:8,padding:'3px 8px',fontSize:10.5,fontWeight:700,whiteSpace:'nowrap',zIndex:50,pointerEvents:'none'}}>{value}</div>}
      </div>
    );
  };

  const activeTab=subFilter||'Overview';

  if(tasks.length===0){
    return(
      <div style={{flex:1,overflowY:'auto',padding:'0'}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:300,color:'#9e9e9e'}}>
          <i className="bi-bar-chart" style={{fontSize:40,marginBottom:12,opacity:.4}}></i>
          <div style={{fontSize:15,fontWeight:600}}>No data available for the selected period</div>
          <div style={{fontSize:13,marginTop:4}}>Try adjusting your filters or check back later</div>
        </div>
      </div>
    );
  }

  return(
    <div style={{flex:1,overflowY:'auto',padding:'0'}}>
      {/* Filters */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 24px 0',flexWrap:'wrap',gap:10}}>
        <p style={{fontSize:13,color:'#9e9e9e',margin:0}}>{subtitleText}</p>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          {/* Region filter */}
          {settings.analytics_show_region_filter!==false&&<div style={{display:'flex',background:'#f7f5f2',borderRadius:128,padding:3,gap:2}}>
            {REGIONS.map(r=>{
              const active=regionFilter===r.id;
              return(
                <button key={r.id} onClick={()=>setRegionFilter(r.id)} style={{padding:'4px 12px',borderRadius:'var(--radius-pill)',fontSize:'var(--font-sm)',fontWeight:active?600:400,background:active?'var(--purple)':'transparent',color:active?'#fff':'var(--text-secondary)',border:active?'none':'1px solid var(--border)',cursor:'pointer',transition:'all 0.15s'}}>
                  {r.label}
                </button>
              );
            })}
          </div>}
          {/* Date range segmented control */}
          <div style={{display:'flex',background:'#f7f5f2',borderRadius:128,padding:3,gap:2}}>
            {DATE_RANGES.map(r=>{
              const active=dateRange===r.id;
              return(
                <button key={r.id} onClick={()=>setDateRange(r.id)} style={{padding:'4px 12px',borderRadius:'var(--radius-pill)',fontSize:'var(--font-sm)',fontWeight:active?600:400,background:active?'var(--purple)':'transparent',color:active?'#fff':'var(--text-secondary)',border:active?'none':'1px solid var(--border)',cursor:'pointer',transition:'all 0.15s'}}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{padding:'16px 24px'}}>

      {(activeTab==='Overview'||activeTab==='SLA')&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
        {[
          {label:'Received Today', value:all.length,      sub:`${open.length} still open`,           color:'#1b1b1b', icon:'bi-inbox',             iconBg:'#f7f5f2'},
          {label:'Resolved',       value:resolved.length, sub:`Avg ${avgRes}m to respond`,           color:'#29811e',icon:'bi-check-circle-fill',  iconBg:'#e8f5e3'},
          {label:'In Progress',    value:open.filter(t=>t.status==='in_progress').length, sub:'being handled', color:'#ed8d00',icon:'bi-arrow-repeat',iconBg:'#fff8e6'},
          {label:'Active Alerts',  value:tasks.filter(t=>t.isAlert&&t.status!=='resolved').length, sub:'from Looker data', color:'#d42d35',icon:'bi-exclamation-triangle-fill',iconBg:'#ffe2de'},
        ].map(s=>(
          <div key={s.label} style={{background:'white',border:'1px solid #e8e8e8',borderRadius:12,padding:'14px 16px',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
            onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
            <div style={{width:36,height:36,background:s.iconBg,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:10}}><i className={s.icon} style={{color:s.color,fontSize:16}}></i></div>
            <div style={{fontSize:28,fontWeight:700,color:s.color,lineHeight:1,letterSpacing:'-0.5px',fontVariantNumeric:'tabular-nums'}}>{s.value}</div>
            <div style={{fontSize:13,color:'#1b1b1b',fontWeight:700,marginTop:6}}>{s.label}</div>
            <div style={{fontSize:12,color:'#616161',marginTop:2}}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* 4th KPI card: Escalation Rate */}
      <div style={{marginBottom:24}}>
        <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'20px 20px',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s',display:'flex',alignItems:'center',gap:20}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
          <div style={{width:40,height:40,background:'#fef3ee',borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-arrow-up-circle-fill" style={{color:'#ed5e2a',fontSize:17}}></i></div>
          <div>
            <div style={{display:'flex',alignItems:'baseline',gap:8}}>
              <div style={{fontSize:32,fontWeight:800,color:'#ed5e2a',lineHeight:1,letterSpacing:'-1px',fontVariantNumeric:'tabular-nums'}}>{escalRate}%</div>
              <span style={{fontSize:12,color:rateColor,fontWeight:700,display:'flex',alignItems:'center',gap:2}}><i className={rateIcon} style={{fontSize:10}}></i>{Math.abs(escalRateDelta)}% vs yesterday</span>
            </div>
            <div style={{fontSize:13,color:'#1b1b1b',fontWeight:700,marginTop:6}}>Escalation Rate</div>
            <div style={{fontSize:12,color:'#616161',marginTop:2}}>{escalCount} escalations from {all.length} total tasks</div>
          </div>
        </div>
      </div>
      </>}

      {(activeTab==='Overview'||activeTab==='Sources')&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
        <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:24,boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
          <div style={{fontWeight:600,color:'#9e9e9e',fontSize:13,marginBottom:16}}>Tasks by source</div>
          {bySrc.map(x=>(
            <div key={x.key} style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{fontSize:13,color:'#616161',fontWeight:500}}>{x.label}</span><span style={{fontSize:13,fontWeight:700,color:x.color,fontVariantNumeric:'tabular-nums'}}>{x.count}</span></div>
              <Bar pct={(x.count/maxSrc)*100} color={x.color} value={x.count}/>
            </div>
          ))}
        </div>
        <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:24,boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
          <div style={{fontWeight:600,color:'#9e9e9e',fontSize:13,marginBottom:16}}>Tasks by function</div>
          {byFn.map(x=>(
            <div key={x.key} style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{fontSize:13,color:'#616161',fontWeight:500}}>{x.label}</span><span style={{fontSize:13,fontWeight:700,color:x.color,fontVariantNumeric:'tabular-nums'}}>{x.count}</span></div>
              <Bar pct={(x.count/maxFn)*100} color={x.color} value={x.count}/>
            </div>
          ))}
        </div>
      </div></>}

      {(activeTab==='Overview'||activeTab==='SLA')&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
        <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:24,boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
          <div style={{fontWeight:600,color:'#9e9e9e',fontSize:13,marginBottom:16}}>Hourly volume</div>
          <div style={{display:'flex',alignItems:'flex-end',gap:5,height:90,marginBottom:4}}>
            {HOURLY_VOLUME.map(h=>{
              const isPeak=h.v===maxHV;
              return(
                <div key={h.h} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,height:'100%',justifyContent:'flex-end',position:'relative'}}>
                  <span style={{fontSize:9.5,color:isPeak?'#29811e':'#9e9e9e',fontWeight:isPeak?700:500,fontVariantNumeric:'tabular-nums'}}>{h.v}</span>
                  <div title={`${h.h}:00 — ${h.v} tasks`} style={{width:'100%',background:isPeak?'#29811e':'#1f74b3',borderRadius:'4px 4px 0 0',height:`${(h.v/maxHV)*70}px`,transition:'height .6s ease',minHeight:3,opacity:isPeak?1:.55,cursor:'pointer'}}
                    onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity=isPeak?'1':'.55'}></div>
                  <span style={{fontSize:9,color:'#9e9e9e',fontWeight:isPeak?600:400}}>{h.h}</span>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:4,fontSize:11,color:'#9e9e9e',textAlign:'center'}}>
            Peak: <span style={{color:'#29811e',fontWeight:700}}>11:00</span> — {maxHV} tasks
          </div>
        </div>
        <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:24,boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
          <div style={{fontWeight:600,color:'#9e9e9e',fontSize:13,marginBottom:16}}>Tasks by country</div>
          {byCtry.map(x=>(
            <div key={x.c} style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span style={{fontSize:13,color:'#616161'}}>{FLAGS[x.c]} {x.c}</span><span style={{fontSize:13,fontWeight:700,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{x.count}</span></div>
              <Bar pct={(x.count/maxCtry)*100} color='#29811e' value={x.count}/>
            </div>
          ))}
        </div>
      </div></>}

      {(activeTab==='Overview'||activeTab==='Team Performance')&&<><div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,boxShadow:'0 1px 2px rgba(0,0,0,0.04)',overflow:'hidden'}}>
        <div style={{padding:'20px 24px 0'}}>
          <div style={{fontWeight:700,color:'#1b1b1b',fontSize:14,marginBottom:16}}>Agent Performance</div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 60px 80px 80px 90px 90px',gap:6,padding:'12px 16px',background:'#fafaf9',borderBottom:'1px solid #f2f2f2'}}>
          {[
            {k:'',l:'Agent'},
            {k:'assigned',l:'Assigned'},
            {k:'resolved',l:'Resolved'},
            {k:'open',l:'Open'},
            {k:'avgT',l:'Avg time'},
            {k:'escalRate',l:'Esc rate'},
            {k:'',l:'Avg 1st resp'},
            {k:'slaComp',l:'SLA comp%'},
          ].map(({k,l})=>(
            <span key={l} onClick={k?()=>toggleSort(k):undefined} style={{color:k&&sortCol===k?'var(--text, #1b1b1b)':'var(--text-muted, #9e9e9e)',fontSize:13,fontWeight:500,textTransform:'none',letterSpacing:'normal',textAlign:l==='Agent'?'left':'center',cursor:k?'pointer':'default',userSelect:'none',display:'flex',alignItems:'center',justifyContent:l==='Agent'?'flex-start':'center',gap:2}}>
              {l}{k&&<SortIcon col={k}/>}
            </span>
          ))}
        </div>
        {sortedAgents.map(({a,assigned,resolved,open,avgT,escalRate:er,avgFirstResp,slaComp})=>(
          <div key={a.id} style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 60px 80px 80px 90px 90px',gap:6,padding:'12px 16px',minHeight:48,borderBottom:'1px solid #f2f2f2',alignItems:'center',transition:'background .1s'}}
            onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{display:'flex',alignItems:'center',gap:8}}><Avatar name={a.name} size={28}/><div><div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>{a.name}</div><div style={{fontSize:11,color:'#616161'}}>{FLAGS[a.country]} {a.team}</div></div></div>
            <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{assigned}</span>
            <span style={{textAlign:'center',fontSize:14,fontWeight:700,color:'#29811e',fontVariantNumeric:'tabular-nums'}}>{resolved}</span>
            <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#ed8d00',fontVariantNumeric:'tabular-nums'}}>{open}</span>
            <div style={{textAlign:'center',fontSize:13,fontWeight:600,color:'#1b1b1b',fontVariantNumeric:'tabular-nums'}}>{avgT}m</div>
            <span style={{textAlign:'center',fontSize:13,fontWeight:600,color:er>5?'#d42d35':er>3?'#ed8d00':'#29811e',fontVariantNumeric:'tabular-nums'}}>{er}%</span>
            <span style={{textAlign:'center',fontSize:12,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{avgFirstResp}</span>
            <div style={{textAlign:'center'}}>
              <span style={{fontSize:12,fontWeight:700,color:slaComp>=95?'#29811e':slaComp>=90?'#1f74b3':'#ed8d00',background:slaComp>=95?'#e8f5e3':slaComp>=90?'#e8f0fe':'#fff8e6',padding:'2px 8px',borderRadius:128,fontVariantNumeric:'tabular-nums'}}>{slaComp}%</span>
            </div>
          </div>
        ))}
      </div>
      </>}

      </div>
    </div>
  );
};

export default Analytics;
