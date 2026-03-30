import { useState } from 'react';
import { GM_REPORTS } from '../../data/reports';
import { MEMBERS } from '../../data/members';
import PageHeader from '../ui/PageHeader';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';

const DATE_RANGES = [
  { id:'7d',  label:'Last 7 Days',  days:7  },
  { id:'30d', label:'Last 30 Days', days:30 },
  { id:'90d', label:'Last 90 Days', days:90 },
];

const GM_SUB_TABS = ['Overview', 'By Country', 'By Team'];

const COUNTRY_DATA = [
  { flag:'🇬🇧', name:'United Kingdom', tasks:842, resolved:798, open:44, sla:96.2, topIssue:'Onboarding' },
  { flag:'🇩🇪', name:'Germany',        tasks:715, resolved:682, open:33, sla:95.4, topIssue:'Compliance' },
  { flag:'🇺🇸', name:'United States',  tasks:1203,resolved:1141,open:62, sla:94.8, topIssue:'Payroll' },
  { flag:'🇧🇷', name:'Brazil',         tasks:688, resolved:641, open:47, sla:93.2, topIssue:'Offboarding' },
  { flag:'🇸🇬', name:'Singapore',      tasks:421, resolved:410, open:11, sla:97.4, topIssue:'Benefits' },
  { flag:'🇦🇺', name:'Australia',      tasks:389, resolved:371, open:18, sla:95.4, topIssue:'Onboarding' },
  { flag:'🇫🇷', name:'France',         tasks:502, resolved:477, open:25, sla:95.0, topIssue:'Compliance' },
  { flag:'🇦🇪', name:'UAE',            tasks:334, resolved:318, open:16, sla:95.2, topIssue:'HR Reports' },
  { flag:'🇨🇦', name:'Canada',         tasks:478, resolved:454, open:24, sla:94.9, topIssue:'Payroll' },
  { flag:'🇳🇱', name:'Netherlands',    tasks:294, resolved:281, open:13, sla:95.6, topIssue:'Benefits' },
  { flag:'🇯🇵', name:'Japan',          tasks:268, resolved:254, open:14, sla:94.8, topIssue:'Onboarding' },
  { flag:'🇮🇳', name:'India',          tasks:622, resolved:585, open:37, sla:94.1, topIssue:'Compliance' },
  { flag:'🇲🇽', name:'Mexico',         tasks:411, resolved:389, open:22, sla:94.6, topIssue:'Offboarding' },
  { flag:'🇵🇱', name:'Poland',         tasks:187, resolved:179, open:8,  sla:95.7, topIssue:'HR Reports' },
  { flag:'🇿🇦', name:'South Africa',   tasks:183, resolved:174, open:9,  sla:95.1, topIssue:'Benefits' },
];

const TEAM_DATA = [
  { team:'EMEA', lead:'Alex Thompson', agents:5, volume:2353, avgHandle:'2h 08m', sla:95.6 },
  { team:'APAC', lead:'Jenny Liu',     agents:2, volume:810,  avgHandle:'2h 22m', sla:96.2 },
  { team:'AMER', lead:'Carlos Reyes',  agents:3, volume:1369, avgHandle:'2h 18m', sla:94.1 },
];

const GMReportingView=({user,addToast})=>{
  const [selReportId,setSelReportId]=useState(null);
  const [filterStatus,setFilterStatus]=useState('all');
  const [filterType,setFilterType]=useState('all');
  const [searchTerm,setSearchTerm]=useState('');
  const [newComment,setNewComment]=useState('');
  const [gmSubTab,setGmSubTab]=useState('Overview');
  const [dateRange,setDateRange]=useState('30d');

  const selReport=GM_REPORTS.find(r=>r.id===selReportId)||null;

  const filteredReports=GM_REPORTS.filter(r=>{
    if(filterStatus!=='all'&&r.status!==filterStatus)return false;
    if(filterType!=='all'&&r.type!==filterType)return false;
    if(searchTerm&&!r.summary.toLowerCase().includes(searchTerm.toLowerCase())&&!r.id.toLowerCase().includes(searchTerm.toLowerCase()))return false;
    return true;
  });

  const reportCounts={
    hr_report:GM_REPORTS.filter(r=>r.type==='hr_report').length,
    tech_ops:GM_REPORTS.filter(r=>r.type==='tech_ops').length,
    hrx_request:GM_REPORTS.filter(r=>r.type==='hrx_request').length,
    handover:GM_REPORTS.filter(r=>r.type==='handover').length,
  };

  const openCount=GM_REPORTS.filter(r=>r.status!=='resolved').length;
  const atRiskCount=GM_REPORTS.filter(r=>r.slaStatus==='at_risk').length;
  const resolvedTodayCount=GM_REPORTS.filter(r=>r.status==='resolved').length;

  const typeLabel=t=>{
    const labels={hr_report:'HR Reports',tech_ops:'Tech Ops',hrx_request:'HRX Requests',handover:'Handovers'};
    return labels[t]||t;
  };

  const typeBgColor=t=>{
    const colors={hr_report:'#f3eff8',tech_ops:'#e8f5e3',hrx_request:'#f3eff8',handover:'#fff8e6'};
    return colors[t]||'#fafaf9';
  };

  const typeColor=t=>{
    const colors={hr_report:'#1f74b3',tech_ops:'#29811e',hrx_request:'#c4b1f9',handover:'#ed8d00'};
    return colors[t]||'#1b1b1b';
  };

  const statusColor=s=>{
    const colors={new:'#1f74b3',acknowledged:'#1f74b3',in_review:'#ed8d00',resolved:'#29811e',rejected:'#d42d35'};
    return colors[s]||'#9e9e9e';
  };

  const statusLabel=s=>{
    const labels={new:'New',acknowledged:'Acknowledged',in_review:'In Review',resolved:'Resolved',rejected:'Rejected'};
    return labels[s]||s;
  };

  const slaColor=s=>{
    if(s==='on_track')return'#29811e';
    if(s==='at_risk')return'#ed8d00';
    return'#d42d35';
  };

  const handleAddComment=()=>{
    if(!newComment.trim()||!selReport)return;
    const updated=GM_REPORTS.map(r=>r.id===selReport.id?{...r,comments:[...r.comments,{author:user.name,text:newComment,timestamp:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}]}:r);
    Object.assign(GM_REPORTS[0],updated.find(r=>r.id===selReportId));
    setNewComment('');
  };

  const handleExport=()=>{
    const headers=['Date','Reporter','Summary','Type','Assigned','Status','SLA'];
    const rows=GM_REPORTS.map(r=>[r.createdAt||'',r.reporter||'',(r.summary||'').replace(/,/g,''),r.type||'',r.assignedTo||'',r.status||'',r.slaStatus||'']);
    const csv=[headers,...rows].map(r=>r.join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='hrx-reports.csv';a.click();
    URL.revokeObjectURL(url);
  };

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'24px 24px 0',background:'white',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,background:'#fff3ee',borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <i className="bi-flag-fill" style={{color:'#ed8d00',fontSize:18}}></i>
            </div>
            <div>
              <h1 style={{fontSize:20,fontWeight:700,color:'#1b1b1b',margin:0}}>GM Reporting</h1>
              <p style={{fontSize:13,color:'#9e9e9e',margin:'3px 0 0'}}>Track reports, requests & handovers</p>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {/* Date range segmented control */}
            <div style={{display:'flex',background:'#f7f5f2',borderRadius:128,padding:3,gap:2}}>
              {DATE_RANGES.map(r=>{
                const active=dateRange===r.id;
                return(
                  <button key={r.id} onClick={()=>setDateRange(r.id)} style={{padding:'5px 12px',borderRadius:128,border:'none',background:active?'white':'transparent',color:active?'#1b1b1b':'#616161',fontSize:12,fontWeight:active?700:500,cursor:'pointer',boxShadow:active?'0 1px 3px rgba(0,0,0,0.08)':undefined,transition:'all .15s'}}>
                    {r.label}
                  </button>
                );
              })}
            </div>
            <button onClick={handleExport} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 18px',borderRadius:128,border:'1px solid #e8e8e8',background:'white',color:'#1b1b1b',fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='#f7f5f2';}}
              onMouseLeave={e=>{e.currentTarget.style.background='white';}}>
              <i className="bi-download" style={{fontSize:12}}></i> Export CSV
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div style={{display:'flex',gap:0,borderBottom:'1px solid #e8e8e8'}}>
          {GM_SUB_TABS.map(tab=>{
            const active=gmSubTab===tab;
            return(
              <button key={tab} onClick={()=>setGmSubTab(tab)} style={{padding:'8px 14px',background:active?'#f3eff8':'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:active?600:500,color:active?'#6b3fa0':'#616161',borderRadius:8,borderBottom:'none',transition:'all .15s'}}>
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
      {gmSubTab==='Overview'&&(
        <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
          {/* 4 metric cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
            {[
              {label:'Total Tasks This Month',value:'8,420',color:'#1f74b3',icon:'bi-inbox-fill',bg:'#e8f0fe',sub:'All regions combined'},
              {label:'Avg Resolution Time',   value:'2h 14m',color:'#1b1b1b',icon:'bi-clock-history',bg:'#f7f5f2',sub:'↓ 12min vs last month'},
              {label:'SLA Compliance',        value:'94.2%',color:'#29811e',icon:'bi-shield-check-fill',bg:'#e8f5e3',sub:'↑ 1.4% vs last month'},
              {label:'Escalation Rate',       value:'3.1%',color:'#ed5e2a',icon:'bi-arrow-up-circle-fill',bg:'#fef3ee',sub:'↓ 0.2% vs last month'},
            ].map(s=>(
              <div key={s.label} style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'20px',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                <div style={{width:40,height:40,background:s.bg,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:12}}>
                  <i className={s.icon} style={{color:s.color,fontSize:17}}></i>
                </div>
                <div style={{fontSize:'var(--font-4xl, 28px)',fontWeight:800,color:s.color,lineHeight:1,letterSpacing:'-0.5px',fontVariantNumeric:'tabular-nums'}}>{s.value}</div>
                <div style={{fontSize:'var(--font-sm)',color:'#1b1b1b',fontWeight:700,marginTop:6}}>{s.label}</div>
                <div style={{fontSize:11,color:'#9e9e9e',marginTop:2}}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Original stats bar */}
          <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 20px',marginBottom:20,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
            {[
              {label:'Total Reports',value:GM_REPORTS.length,color:'#1f74b3'},
              {label:'Open',value:openCount,color:'#29811e'},
              {label:'At Risk SLA',value:atRiskCount,color:'#ed8d00'},
              {label:'Resolved Today',value:resolvedTodayCount,color:'#29811e'},
            ].map(s=>(
              <div key={s.label}>
                <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none',marginBottom:6}}>{s.label}</div>
                <div style={{fontSize:22,fontWeight:800,color:s.color,fontVariantNumeric:'tabular-nums'}}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Reports table (original) */}
          <OriginalReportsSection
            filteredReports={filteredReports}
            reportCounts={reportCounts}
            filterType={filterType}
            setFilterType={setFilterType}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selReport={selReport}
            selReportId={selReportId}
            setSelReportId={setSelReportId}
            newComment={newComment}
            setNewComment={setNewComment}
            handleAddComment={handleAddComment}
            typeLabel={typeLabel}
            typeBgColor={typeBgColor}
            typeColor={typeColor}
            statusColor={statusColor}
            statusLabel={statusLabel}
            slaColor={slaColor}
            user={user}
          />
        </div>
      )}

      {/* ── BY COUNTRY TAB ───────────────────────────────────────────────── */}
      {gmSubTab==='By Country'&&(
        <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
          <div style={{background:'white',borderRadius:16,border:'1px solid #e8e8e8',overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
            <div style={{display:'grid',gridTemplateColumns:'200px 80px 80px 80px 80px 140px',gap:8,padding:'12px 16px',background:'#fafaf9',borderBottom:'1px solid #f2f2f2'}}>
              {['Country','Tasks','Resolved','Open','SLA %','Top issue'].map(h=>(
                <span key={h} style={{fontSize:13,fontWeight:500,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',textAlign:h==='Country'||h==='Top issue'?'left':'center'}}>{h}</span>
              ))}
            </div>
            {COUNTRY_DATA.map((c,i)=>(
              <div key={c.name} style={{display:'grid',gridTemplateColumns:'200px 80px 80px 80px 80px 140px',gap:8,padding:'14px 16px',borderBottom:i<COUNTRY_DATA.length-1?'1px solid #f2f2f2':'none',alignItems:'center',transition:'background .1s'}}
                onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:18}}>{c.flag}</span>
                  <span style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>{c.name}</span>
                </div>
                <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#1b1b1b',fontVariantNumeric:'tabular-nums'}}>{c.tasks.toLocaleString()}</span>
                <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#29811e',fontVariantNumeric:'tabular-nums'}}>{c.resolved.toLocaleString()}</span>
                <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#ed8d00',fontVariantNumeric:'tabular-nums'}}>{c.open}</span>
                <div style={{textAlign:'center'}}>
                  <span style={{fontSize:12,fontWeight:700,color:c.sla>=96?'#29811e':c.sla>=94?'#1f74b3':'#ed8d00',background:c.sla>=96?'#e8f5e3':c.sla>=94?'#e8f0fe':'#fff8e6',padding:'3px 8px',borderRadius:128,fontVariantNumeric:'tabular-nums'}}>{c.sla}%</span>
                </div>
                <span style={{fontSize:12,color:'#616161',fontWeight:500}}>{c.topIssue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BY TEAM TAB ──────────────────────────────────────────────────── */}
      {gmSubTab==='By Team'&&(
        <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
          <div style={{background:'white',borderRadius:16,border:'1px solid #e8e8e8',overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
            <div style={{display:'grid',gridTemplateColumns:'100px 160px 70px 100px 120px 80px',gap:8,padding:'12px 16px',background:'#fafaf9',borderBottom:'1px solid #f2f2f2'}}>
              {['Team','Lead','Agents','Volume','Avg handle','SLA %'].map(h=>(
                <span key={h} style={{fontSize:13,fontWeight:500,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal',textAlign:h==='Team'||h==='Lead'?'left':'center'}}>{h}</span>
              ))}
            </div>
            {TEAM_DATA.map((t,i)=>(
              <div key={t.team} style={{display:'grid',gridTemplateColumns:'100px 160px 70px 100px 120px 80px',gap:8,padding:'18px 16px',borderBottom:i<TEAM_DATA.length-1?'1px solid #f2f2f2':'none',alignItems:'center',transition:'background .1s'}}
                onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <span style={{fontSize:13,fontWeight:700,color:'#1b1b1b',background:'#f3eff8',padding:'3px 10px',borderRadius:128,display:'inline-block',textAlign:'center'}}>{t.team}</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#f3eff8',color:'#7c3aed',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {t.lead.split(' ').map(w=>w[0]).join('').slice(0,2)}
                  </div>
                  <span style={{fontSize:13,color:'#1b1b1b',fontWeight:500}}>{t.lead}</span>
                </div>
                <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{t.agents}</span>
                <span style={{textAlign:'center',fontSize:14,fontWeight:600,color:'#1b1b1b',fontVariantNumeric:'tabular-nums'}}>{t.volume.toLocaleString()}</span>
                <span style={{textAlign:'center',fontSize:13,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{t.avgHandle}</span>
                <div style={{textAlign:'center'}}>
                  <span style={{fontSize:12,fontWeight:700,color:t.sla>=96?'#29811e':t.sla>=94?'#1f74b3':'#ed8d00',background:t.sla>=96?'#e8f5e3':t.sla>=94?'#e8f0fe':'#fff8e6',padding:'3px 8px',borderRadius:128,fontVariantNumeric:'tabular-nums'}}>{t.sla}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const STATUS_STYLES={
  new:          {background:'var(--blue-light)',   color:'var(--blue)'},
  acknowledged: {background:'var(--blue-light)',   color:'var(--blue)'},
  in_review:    {background:'var(--orange-light)', color:'var(--orange)'},
  resolved:     {background:'var(--green-light)',  color:'var(--green)'},
  rejected:     {background:'var(--red-light)',    color:'var(--red)'},
};

const SLA_ROW_STYLES={
  'on_track': {color:'var(--green)',  background:'var(--green-light)'},
  'at_risk':  {color:'var(--orange)', background:'var(--orange-light)'},
  'overdue':  {color:'var(--red)',    background:'var(--red-light)'},
};

// Extracted original reports section as a sub-component to keep the main component clean
function OriginalReportsSection({filteredReports,reportCounts,filterType,setFilterType,filterStatus,setFilterStatus,searchTerm,setSearchTerm,selReport,selReportId,setSelReportId,newComment,setNewComment,handleAddComment,typeLabel,typeBgColor,typeColor,statusColor,statusLabel,slaColor,user}){
  return(
    <div style={{display:'flex',flexDirection:'column',overflow:'hidden',flex:1}}>
      {/* Filter tabs */}
      <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:'12px 12px 0 0',borderBottom:'none',padding:'0 12px',display:'flex',gap:2,overflowX:'auto'}}>
        {[{id:'all',label:`All (${GM_REPORTS.length})`},{id:'hr_report',label:`HR Reports (${reportCounts.hr_report})`},{id:'tech_ops',label:`Tech Ops (${reportCounts.tech_ops})`},{id:'hrx_request',label:`HRX Requests (${reportCounts.hrx_request})`},{id:'handover',label:`Handovers (${reportCounts.handover})`}].map(tab=>(
          <button key={tab.id} onClick={()=>setFilterType(tab.id)} style={{display:'flex',alignItems:'center',gap:6,padding:'10px 8px',border:'none',borderBottom:`2px solid ${filterType===tab.id?'#1b1b1b':'transparent'}`,background:'none',color:filterType===tab.id?'#1b1b1b':'#616161',fontSize:13,cursor:'pointer',fontWeight:filterType===tab.id?700:500,whiteSpace:'nowrap',transition:'all .15s'}}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter chips and search */}
      <div style={{background:'white',border:'1px solid #e8e8e8',borderTop:'1px solid #f2f2f2',padding:'10px 12px',display:'flex',alignItems:'center',gap:8,overflowX:'auto'}}>
        {[{id:'all',label:'All Status'},{id:'new',label:'New'},{id:'acknowledged',label:'Acknowledged'},{id:'in_review',label:'In Review'},{id:'resolved',label:'Resolved'}].map(chip=>(
          <button key={chip.id} onClick={()=>setFilterStatus(chip.id)} style={{padding:'6px 14px',borderRadius:128,border:`1px solid ${filterStatus===chip.id?'#1b1b1b':'#e8e8e8'}`,background:filterStatus===chip.id?'#1b1b1b':'white',color:filterStatus===chip.id?'white':'#1b1b1b',fontSize:12,cursor:'pointer',fontWeight:filterStatus===chip.id?700:500,whiteSpace:'nowrap'}}>
            {chip.label}
          </button>
        ))}
        <input type="text" placeholder="Search reports..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} style={{marginLeft:'auto',border:'1px solid #e8e8e8',borderRadius:12,padding:'8px 14px',fontSize:13,color:'#1b1b1b',outline:'none',minWidth:180,transition:'border-color .15s,box-shadow .15s'}} onFocus={e=>{e.target.style.borderColor='#1f74b3';e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)';}} onBlur={e=>{e.target.style.borderColor='#e8e8e8';e.target.style.boxShadow='none';}}/>
      </div>

      <div style={{display:'flex',overflow:'hidden',flex:1,minHeight:300}}>
        {/* Left: Table */}
        <div style={{width:selReport?'50%':'100%',borderRight:selReport?'1px solid #e8e8e8':undefined,overflowY:'auto',background:'white',border:'1px solid #e8e8e8',borderTop:'none',borderRadius:selReport?'0 0 0 12px':'0 0 12px 12px'}}>
          <div style={{display:'grid',gridTemplateColumns:'100px 100px 1fr 100px 90px 80px 80px',alignItems:'center',padding:'12px 16px',borderBottom:'1px solid #f2f2f2',background:'#fafaf9',position:'sticky',top:0}}>
            {['Date','Reporter','Summary','Type','Assigned','Status','SLA'].map(h=>(
              <div key={h} style={{fontSize:13,fontWeight:500,color:'#9e9e9e',textTransform:'none',letterSpacing:'normal'}}>{h}</div>
            ))}
          </div>
          {filteredReports.map(r=>(
            <div key={r.id} onClick={()=>setSelReportId(r.id)} style={{display:'grid',gridTemplateColumns:'100px 100px 1fr 100px 90px 80px 80px',alignItems:'center',padding:'14px 16px',borderBottom:'1px solid #f2f2f2',cursor:'pointer',background:selReport?.id===r.id?'#f9f8f6':'white',borderLeft:selReport?.id===r.id?'3px solid #1b1b1b':'3px solid transparent',transition:'all .12s'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background=selReport?.id===r.id?'#f9f8f6':'white'}>
              <div style={{fontSize:12,color:'#1b1b1b'}}>{r.createdAt}</div>
              <div style={{fontSize:12,color:'#1b1b1b'}}>{r.reporter}</div>
              <div style={{fontSize:12,color:'#1b1b1b',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{r.summary}</div>
              <div><span style={{background:typeBgColor(r.type),color:typeColor(r.type),fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:128,display:'inline-block'}}>{typeLabel(r.type).split(' ')[0]}</span></div>
              <div style={{fontSize:12,color:r.assignedTo?'#1b1b1b':'#9e9e9e'}}>{r.assignedTo?r.assignedTo.split(' ')[0]:'—'}</div>
              <div><span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:128,fontSize:10,fontWeight:700,...(STATUS_STYLES[r.status]||{background:'#f2f2f2',color:'#616161'})}}>{statusLabel(r.status)}</span></div>
              <div>{(()=>{const slaKey=r.slaStatus==='on_track'?'on_track':r.slaStatus==='at_risk'?'at_risk':'overdue';const ss=SLA_ROW_STYLES[slaKey]||SLA_ROW_STYLES.overdue;const slaLabel=r.slaStatus==='on_track'?'On Track':r.slaStatus==='at_risk'?'At Risk':'Overdue';return(<span style={{display:'inline-flex',alignItems:'center',padding:'3px 8px',borderRadius:128,fontSize:10,fontWeight:700,...ss}}>{slaLabel}</span>);})()}</div>
            </div>
          ))}
        </div>

        {/* Right: Detail panel */}
        {selReport&&(
          <div style={{width:'50%',display:'flex',flexDirection:'column',overflowY:'auto',background:'#fafaf9',borderLeft:'1px solid #e8e8e8',border:'1px solid #e8e8e8',borderTop:'none',borderRadius:'0 0 12px 0'}}>
            <div style={{padding:'20px',borderBottom:'1px solid #e8e8e8',background:'white'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:16,fontWeight:700,color:'#1b1b1b',margin:'0 0 6px'}}>{selReport.id}</h3>
                  <p style={{fontSize:14,color:'#1b1b1b',margin:0}}>{selReport.summary}</p>
                </div>
                <button onClick={()=>setSelReportId(null)} style={{border:'none',background:'none',cursor:'pointer',padding:4,color:'#9e9e9e',fontSize:18}}><i className="bi-x-lg"></i></button>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 12px',borderRadius:128,fontSize:11,fontWeight:600,background:typeBgColor(selReport.type),color:typeColor(selReport.type)}}>{typeLabel(selReport.type)}</span>
                <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 12px',borderRadius:128,fontSize:11,fontWeight:600,background:statusColor(selReport.status)+'18',color:statusColor(selReport.status)}}>{statusLabel(selReport.status)}</span>
                <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 12px',borderRadius:128,fontSize:11,fontWeight:600,background:selReport.priority==='urgent'?'#ffe2de':'#fafaf9',color:selReport.priority==='urgent'?'#d42d35':'#1b1b1b'}}>{selReport.priority==='urgent'?'Urgent':'Normal'}</span>
              </div>
            </div>

            <div style={{padding:'20px',flex:1,display:'flex',flexDirection:'column'}}>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',marginBottom:10,textTransform:'none',letterSpacing:'normal'}}>Details</div>
                <div style={{display:'grid',gridTemplateColumns:'90px 1fr',gap:'12px 16px',fontSize:13}}>
                  <div style={{color:'#616161',fontWeight:600}}>Created</div>
                  <div style={{color:'#1b1b1b'}}>{selReport.createdAt}</div>
                  <div style={{color:'#616161',fontWeight:600}}>Reporter</div>
                  <div style={{color:'#1b1b1b'}}>{selReport.reporter}</div>
                  <div style={{color:'#616161',fontWeight:600}}>Assigned to</div>
                  <div style={{color:selReport.assignedTo?'#1b1b1b':'#9e9e9e'}}>{selReport.assignedTo||'Unassigned'}</div>
                  <div style={{color:'#616161',fontWeight:600}}>Category</div>
                  <div style={{color:'#1b1b1b'}}>{selReport.relatedFunction}</div>
                  <div style={{color:'#616161',fontWeight:600}}>SLA</div>
                  <div style={{color:slaColor(selReport.slaStatus),fontWeight:600}}>{selReport.slaDeadline}m · {selReport.slaStatus==='on_track'?'On Track':selReport.slaStatus==='at_risk'?'At Risk':'Breached'}</div>
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',marginBottom:10,textTransform:'none',letterSpacing:'normal'}}>Comments ({selReport.comments.length})</div>
                <div style={{maxHeight:140,overflowY:'auto',marginBottom:12}}>
                  {selReport.comments.map((c,i)=>(
                    <div key={i} style={{marginBottom:10,padding:'12px 14px',background:'white',borderRadius:12,border:'1px solid #e8e8e8',borderLeft:'3px solid #1f74b3'}}>
                      <div style={{fontSize:11,fontWeight:600,color:'#1b1b1b',marginBottom:3}}>{c.author} <span style={{color:'#9e9e9e',fontWeight:500}}>{c.timestamp}</span></div>
                      <div style={{fontSize:13,color:'#1b1b1b',lineHeight:1.5}}>{c.text}</div>
                    </div>
                  ))}
                </div>
                <textarea value={newComment} onChange={e=>setNewComment(e.target.value)} placeholder="Add a comment..." style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:12,padding:'10px 14px',fontSize:13,color:'#1b1b1b',resize:'none',outline:'none',fontFamily:'inherit',minHeight:60,boxSizing:'border-box',transition:'border-color .15s,box-shadow .15s'}} onFocus={e=>{e.target.style.borderColor='#1f74b3';e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)';}} onBlur={e=>{e.target.style.borderColor='#e8e8e8';e.target.style.boxShadow='none';}}/>
                <button onClick={handleAddComment} disabled={!newComment.trim()} style={{marginTop:10,padding:'8px 18px',borderRadius:128,border:'none',background:newComment.trim()?'#1b1b1b':'#e8e8e8',color:newComment.trim()?'white':'#9e9e9e',fontSize:13,fontWeight:700,cursor:newComment.trim()?'pointer':'not-allowed'}}>Add Comment</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GMReportingView;
