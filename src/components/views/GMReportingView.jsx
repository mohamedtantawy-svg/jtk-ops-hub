import { useState, useMemo } from 'react';
import { GM_REPORTS } from '../../data/reports';

const DATE_RANGES = [
  { id:'7d',  label:'Last 7 Days',  days:7  },
  { id:'30d', label:'Last 30 Days', days:30 },
  { id:'90d', label:'Last 90 Days', days:90 },
];

const GMReportingView=({user,addToast,createReportModal,setCreateReportModal})=>{
  const [selReportId,setSelReportId]=useState(null);
  const [filterStatus,setFilterStatus]=useState('all');
  const [filterType,setFilterType]=useState('all');
  const [searchTerm,setSearchTerm]=useState('');
  const [newComment,setNewComment]=useState('');
  const [dateRange,setDateRange]=useState('30d');
  const [newReportType,setNewReportType]=useState('hr_report');
  const [newReportSummary,setNewReportSummary]=useState('');
  const [newReportPriority,setNewReportPriority]=useState('normal');

  const selReport=GM_REPORTS.find(r=>r.id===selReportId)||null;

  const filteredReports=useMemo(()=>GM_REPORTS.filter(r=>{
    if(filterStatus!=='all'&&r.status!==filterStatus)return false;
    if(filterType!=='all'&&r.type!==filterType)return false;
    if(searchTerm&&!r.summary.toLowerCase().includes(searchTerm.toLowerCase())&&!r.id.toLowerCase().includes(searchTerm.toLowerCase()))return false;
    // Date range filter
    if(r.createdAt){
      const rangeObj=DATE_RANGES.find(d=>d.id===dateRange);
      if(rangeObj){
        const reportDate=new Date(r.createdAt);
        const now=new Date();
        const cutoff=new Date(now.getTime()-rangeObj.days*24*60*60*1000);
        if(reportDate<cutoff)return false;
      }
    }
    return true;
  }),[filterStatus,filterType,searchTerm,dateRange]);

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

  const handleCreateReport=()=>{
    if(!newReportSummary.trim())return;
    const maxNum=GM_REPORTS.reduce((mx,r)=>{const n=parseInt(r.id.replace('RPT-',''));return n>mx?n:mx;},0);
    const id='RPT-'+String(maxNum+1).padStart(3,'0');
    const now=new Date().toISOString().slice(0,10);
    GM_REPORTS.unshift({id,type:newReportType,summary:newReportSummary.trim(),status:'new',priority:newReportPriority,createdAt:now,reporter:user.name,assignedTo:'',relatedFunction:'General',slaStatus:'on_track',slaDeadline:240,comments:[]});
    setNewReportSummary('');setNewReportType('hr_report');setNewReportPriority('normal');
    if(setCreateReportModal)setCreateReportModal(false);
  };

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {/* Create Report Modal */}
      {createReportModal&&(
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setCreateReportModal&&setCreateReportModal(false)}>
          <div style={{background:'white',borderRadius:16,padding:24,width:480,maxWidth:'90vw',boxShadow:'0 8px 32px rgba(0,0,0,0.12)'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <h3 style={{fontSize:16,fontWeight:700,color:'#1b1b1b',margin:0}}>New Report</h3>
              <button onClick={()=>setCreateReportModal&&setCreateReportModal(false)} style={{border:'none',background:'none',cursor:'pointer',color:'#9e9e9e',fontSize:18,padding:4}}><i className="bi-x-lg"></i></button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:'#616161',display:'block',marginBottom:4}}>Type</label>
                <select value={newReportType} onChange={e=>setNewReportType(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:10,border:'1px solid #e8e8e8',fontSize:13,color:'#1b1b1b',outline:'none',background:'white'}}>
                  <option value="hr_report">HR Report</option>
                  <option value="tech_ops">Tech Ops</option>
                  <option value="hrx_request">HRX Request</option>
                  <option value="handover">Handover</option>
                </select>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:'#616161',display:'block',marginBottom:4}}>Summary</label>
                <textarea value={newReportSummary} onChange={e=>setNewReportSummary(e.target.value)} placeholder="Describe the report..." style={{width:'100%',padding:'8px 12px',borderRadius:10,border:'1px solid #e8e8e8',fontSize:13,color:'#1b1b1b',outline:'none',fontFamily:'inherit',minHeight:80,resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:'#616161',display:'block',marginBottom:4}}>Priority</label>
                <div style={{display:'flex',gap:8}}>
                  {['normal','urgent'].map(p=>(
                    <button key={p} onClick={()=>setNewReportPriority(p)} style={{padding:'6px 16px',borderRadius:128,border:`1px solid ${newReportPriority===p?(p==='urgent'?'#d42d35':'#1b1b1b'):'#e8e8e8'}`,background:newReportPriority===p?(p==='urgent'?'#ffe2de':'#f7f5f2'):'white',color:newReportPriority===p?(p==='urgent'?'#d42d35':'#1b1b1b'):'#616161',fontSize:12,fontWeight:newReportPriority===p?700:500,cursor:'pointer',textTransform:'capitalize'}}>{p}</button>
                  ))}
                </div>
              </div>
              <button onClick={handleCreateReport} disabled={!newReportSummary.trim()} style={{marginTop:4,padding:'10px 24px',borderRadius:128,border:'none',background:newReportSummary.trim()?'#1b1b1b':'#e8e8e8',color:newReportSummary.trim()?'white':'#9e9e9e',fontSize:13,fontWeight:700,cursor:newReportSummary.trim()?'pointer':'not-allowed',alignSelf:'flex-end'}}>Submit Report</button>
            </div>
          </div>
        </div>
      )}

      <div style={{padding:'16px 24px 0',background:'white',flexShrink:0}}>
        {/* Date range pills + Export button (one line) */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
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

        {/* Combined type + status filters + search (all one line) */}
        <div style={{display:'flex',alignItems:'center',gap:6,paddingBottom:12,overflowX:'auto',borderBottom:'1px solid #e8e8e8'}}>
          {[{id:'all',label:`All (${filteredReports.length})`},{id:'hr_report',label:`HR (${reportCounts.hr_report})`},{id:'tech_ops',label:`Tech Ops (${reportCounts.tech_ops})`},{id:'hrx_request',label:`HRX (${reportCounts.hrx_request})`},{id:'handover',label:`Handovers (${reportCounts.handover})`}].map(tab=>(
            <button key={tab.id} onClick={()=>setFilterType(tab.id)} style={{padding:'5px 12px',borderRadius:128,border:`1px solid ${filterType===tab.id?'#1b1b1b':'#e8e8e8'}`,background:filterType===tab.id?'#1b1b1b':'white',color:filterType===tab.id?'white':'#616161',fontSize:11,cursor:'pointer',fontWeight:filterType===tab.id?700:500,whiteSpace:'nowrap',flexShrink:0}}>
              {tab.label}
            </button>
          ))}
          <div style={{width:1,height:20,background:'#e8e8e8',flexShrink:0,margin:'0 2px'}}/>
          {[{id:'all',label:'All Status'},{id:'new',label:'New'},{id:'acknowledged',label:'Ack'},{id:'in_review',label:'In Review'},{id:'resolved',label:'Resolved'}].map(chip=>(
            <button key={chip.id} onClick={()=>setFilterStatus(chip.id)} style={{padding:'5px 12px',borderRadius:128,border:`1px solid ${filterStatus===chip.id?'#6b3fa0':'#e8e8e8'}`,background:filterStatus===chip.id?'#f3eff8':'white',color:filterStatus===chip.id?'#6b3fa0':'#616161',fontSize:11,cursor:'pointer',fontWeight:filterStatus===chip.id?700:500,whiteSpace:'nowrap',flexShrink:0}}>
              {chip.label}
            </button>
          ))}
          <input type="text" placeholder="Search reports..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} style={{marginLeft:'auto',border:'1px solid #e8e8e8',borderRadius:10,padding:'6px 12px',fontSize:12,color:'#1b1b1b',outline:'none',minWidth:160,flexShrink:0,transition:'border-color .15s,box-shadow .15s'}} onFocus={e=>{e.target.style.borderColor='#1f74b3';e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)';}} onBlur={e=>{e.target.style.borderColor='#e8e8e8';e.target.style.boxShadow='none';}}/>
        </div>
      </div>

      {/* Main content area */}
      <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
        {/* Report stats bar */}
        <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 20px',marginBottom:20,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
          {[
            {label:'Total Reports',value:filteredReports.length,color:'#1f74b3'},
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

        {/* Reports table */}
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
      <div style={{display:'flex',overflow:'hidden',flex:1,minHeight:300}}>
        {/* Left: Table */}
        <div style={{width:selReport?'50%':'100%',borderRight:selReport?'1px solid #e8e8e8':undefined,overflowY:'auto',background:'white',border:'1px solid #e8e8e8',borderRadius:selReport?'12px 0 0 12px':'12px'}}>
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
          <div style={{width:'50%',display:'flex',flexDirection:'column',overflowY:'auto',background:'#fafaf9',borderLeft:'1px solid #e8e8e8',border:'1px solid #e8e8e8',borderRadius:'0 12px 12px 0'}}>
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
