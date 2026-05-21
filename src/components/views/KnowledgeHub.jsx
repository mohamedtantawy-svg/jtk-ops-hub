import { useState, useEffect, useContext } from 'react';
import { KB_SEARCH_INDEX, KB_ARTICLES } from '../../data/knowledge';
import { PermissionsContext } from '../../App';

// ── Country Resources (D) ────────────────────────────────────────────────────
const COUNTRY_RESOURCES=[
  {country:'UK',  flag:'🇬🇧', name:'UK Payroll & Compliance Tracker',  url:'#'},
  {country:'DE',  flag:'🇩🇪', name:'Germany Entity Tracker',            url:'#'},
  {country:'FR',  flag:'🇫🇷', name:'France HR Operations Sheet',        url:'#'},
  {country:'SG',  flag:'🇸🇬', name:'Singapore MOM & EP Tracker',        url:'#'},
  {country:'AU',  flag:'🇦🇺', name:'Australia Fair Work Tracker',       url:'#'},
  {country:'US',  flag:'🇺🇸', name:'US Benefits & Payroll Tracker',     url:'#'},
  {country:'NL',  flag:'🇳🇱', name:'Netherlands WKR & Leave Sheet',     url:'#'},
  {country:'JP',  flag:'🇯🇵', name:'Japan Labour Standards Tracker',    url:'#'},
];


const KnowledgeHub=({subFilter, user})=>{
  const perms=useContext(PermissionsContext);
  if(perms&&perms.canView('knowledge-hub')===false)return(
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      <div style={{textAlign:'center',color:'var(--text-muted)'}}><i className="bi-shield-lock" style={{fontSize:32,display:'block',marginBottom:8,opacity:.5}}></i><div style={{fontSize:14,fontWeight:600}}>Access Denied</div><div style={{fontSize:12,marginTop:4}}>You don't have permission to view this page.</div></div>
    </div>
  );
  // ── Inner content tab ──────────────────────────────────────────────────────
  const [search,setSearch]=useState('');
  const tabMap={'Policies':'policies','Runbooks':'processes','Tools':'looker','FAQs':'sla'};
  const [tab,setTab]=useState(subFilter?tabMap[subFilter]||'sla':'sla');
  useEffect(()=>{
    if(subFilter&&tabMap[subFilter]){setTab(tabMap[subFilter]);}
  },[subFilter]);

  // ── Quick Links personalization state (C) ──────────────────────────────────
  const LS_KEY=`ops_hub_quick_links_${user?.id||'default'}`;
  const DEFAULT_QUICK_LINKS=[
    {category:'Service Desks',icon:'bi-headset',color:'#d42d35',links:[
      {name:'Jira Service Desk (Dev)',desc:'Submit tickets to the engineering team for bugs, features, or system issues',url:'https://deel.atlassian.net/servicedesk',icon:'bi-kanban'},
      {name:'Legal Portal',desc:'Request legal reviews, contract approvals, and compliance sign-offs',url:'https://deel.atlassian.net/servicedesk/legal',icon:'bi-briefcase'},
      {name:'Finance Portal',desc:'Submit finance requests — invoices, reimbursements, budget approvals',url:'https://deel.atlassian.net/servicedesk/finance',icon:'bi-cash-stack'},
    ]},
    {category:'Tools',icon:'bi-tools',color:'#1f74b3',links:[
      {name:'Zendesk Admin',desc:'Manage Zendesk tickets, macros, and support queue settings',url:'https://deel.zendesk.com/admin',icon:'bi-headset'},
      {name:'Workbench Dashboard',desc:'Access the HR Workbench for employee lifecycle actions',url:'https://admin.deel.network/workbench',icon:'bi-grid-3x3-gap'},
      {name:'Looker Studio',desc:'Analytics dashboards and operational reporting',url:'https://deel.looker.com',icon:'bi-graph-up'},
    ]},
    {category:'Documentation',icon:'bi-journal-text',color:'#29811e',links:[
      {name:'Confluence Wiki',desc:'Team wiki with runbooks, meeting notes, and project docs',url:'https://deel.atlassian.net/wiki',icon:'bi-book-half'},
      {name:'Google Drive Shared',desc:'Shared drive with templates, reports, and team files',url:'https://drive.google.com/drive/shared',icon:'bi-folder2-open'},
      {name:'SOPs Library',desc:'Standard operating procedures for all HR processes',url:'https://deel.notion.site/sops',icon:'bi-file-earmark-text'},
    ]},
    {category:'Communication',icon:'bi-chat-dots',color:'#7c3aed',links:[
      {name:'Slack HRX Channel',desc:'Jump to the main #hrx-general Slack channel',url:'https://deel.slack.com/archives/hrx-general',icon:'bi-hash'},
      {name:'Email Templates',desc:'Pre-approved email templates for common HR communications',url:'https://deel.notion.site/email-templates',icon:'bi-envelope'},
    ]},
  ];

  // Custom links stored flat in LS; we prepend them to Service Desks on render
  const loadCustomLinks=()=>{
    try{
      const raw=localStorage.getItem(LS_KEY);
      return raw?JSON.parse(raw):[];
    }catch(e){return [];}
  };
  const [customLinks,setCustomLinks]=useState(loadCustomLinks);
  const [showCustomize,setShowCustomize]=useState(false);
  const [newLinkName,setNewLinkName]=useState('');
  const [newLinkUrl,setNewLinkUrl]=useState('');
  const [newLinkCat,setNewLinkCat]=useState('Service Desks');

  const saveCustomLinks=(links)=>{
    setCustomLinks(links);
    try{localStorage.setItem(LS_KEY,JSON.stringify(links));}catch(e){}
  };

  const addCustomLink=()=>{
    if(!newLinkName.trim()||!newLinkUrl.trim())return;
    const link={name:newLinkName.trim(),url:newLinkUrl.trim(),category:newLinkCat,icon:'bi-link-45deg',desc:'Custom link',custom:true};
    saveCustomLinks([...customLinks,link]);
    setNewLinkName('');setNewLinkUrl('');
  };

  const removeCustomLink=(idx)=>saveCustomLinks(customLinks.filter((_,i)=>i!==idx));

  // Build QUICK_LINKS merging custom links into their respective categories
  const QUICK_LINKS=DEFAULT_QUICK_LINKS.map(cat=>({
    ...cat,
    links:[
      ...customLinks.filter(l=>l.category===cat.category).map(l=>({...l,_custom:true})),
      ...cat.links,
    ],
  }));

  const q=search.toLowerCase();
  const flt=(arr,keys)=>q?arr.filter(i=>keys.some(k=>i[k]?.toLowerCase().includes(q))):arr;

  const PROCESSES=[
    {name:'Employee Additional Detail Change',  desc:'Update employee personal or professional details across all HR systems',  url:'https://admin.deel.network/workbench/employee-additional-detail-change', icon:'bi-person-lines-fill',color:'#29811e'},
    {name:'Country Validation Change Request',  desc:'Request country-specific validation or data rule change in Workbench',      url:'https://admin.deel.network/workbench/country-validation',               icon:'bi-globe2',            color:'#0052CC'},
    {name:'Raise Internal Form to Support',     desc:'Submit an internal HR support request or escalation via Workbench',        url:'https://admin.deel.network/workbench/internal-support',                 icon:'bi-file-earmark-text', color:'#c4b1f9'},
    {name:'Time Off & Holiday Change Request',  desc:'Modify time off balances or holiday calendar entries for an employee',     url:'https://admin.deel.network/workbench/time-off-change',                  icon:'bi-calendar-check',    color:'#ed8d00'},
    {name:'Onboarding Checklist Management',    desc:'Review and manage onboarding task completion for new hires',               url:'https://admin.deel.network/workbench/onboarding',                       icon:'bi-check2-all',        color:'#29811e'},
    {name:'Offboarding Process',                desc:'Initiate and track the full employee offboarding workflow',                 url:'https://admin.deel.network/workbench/offboarding',                      icon:'bi-door-open',         color:'#d42d35'},
    {name:'Compensation & Benefits Adjustment', desc:'Process salary changes, bonus adjustments, and benefits modifications',    url:'https://admin.deel.network/workbench/compensation-adjustment',          icon:'bi-currency-exchange',  color:'#1f74b3'},
    {name:'Employment Contract Amendment',      desc:'Handle contract amendments including role, salary, and terms changes',     url:'https://admin.deel.network/workbench/contract-amendment',               icon:'bi-file-earmark-diff', color:'#7c3aed'},
    {name:'Probation Review Scheduling',        desc:'Schedule and manage probation reviews for employees approaching review dates', url:'https://admin.deel.network/workbench/probation-review',             icon:'bi-person-check',      color:'#ed8d00'},
    {name:'Background Check Initiation',        desc:'Initiate pre-employment background checks via Checkr integration',         url:'https://admin.deel.network/workbench/background-check',                 icon:'bi-shield-check',      color:'#0052CC'},
    {name:'Employee Relocation Request',        desc:'Process international employee relocations including entity transfers',     url:'https://admin.deel.network/workbench/relocation',                       icon:'bi-airplane',          color:'#29811e'},
  ];
  const LOOKER=[
    {name:'Active EORs Non-Nationals',                    url:'https://deel.looker.com/dashboards/active-eors-non-nationals',          cat:'Operations'},
    {name:'Nationals vs Non-Nationals',                   url:'https://deel.looker.com/dashboards/nationals-vs-non-nationals',         cat:'Operations'},
    {name:'Onboardings Pending EE Signature',             url:'https://deel.looker.com/dashboards/onboardings-pending',                cat:'Onboarding'},
    {name:'Open Resignations & Terminations',             url:'https://deel.looker.com/dashboards/resignations-terminations',          cat:'Offboarding'},
    {name:'Redline WB Controls',                          url:'https://deel.looker.com/dashboards/redline-wb-controls',                cat:'Compliance'},
    {name:'EOR Termination & Expiration Tracker',         url:'https://deel.looker.com/dashboards/eor-termination-tracker',           cat:'Offboarding'},
    {name:'Notifications Audience Builder (Workers)',     url:'https://deel.looker.com/dashboards/notifications-workers',             cat:'Operations'},
    {name:'Notifications Audience Builder (Clients)',     url:'https://deel.looker.com/dashboards/notifications-clients',             cat:'Operations'},
    {name:'HRX Operations Control',                       url:'https://deel.looker.com/dashboards/hrx-operations-control',            cat:'Analytics'},
    {name:'HRX Operations Health Report',                 url:'https://deel.looker.com/dashboards/hrx-health',                       cat:'Analytics'},
    {name:'Monthly Clean-Up',                             url:'https://deel.looker.com/dashboards/monthly-cleanup',                   cat:'Analytics'},
    {name:'AISAT HRX Daily',                              url:'https://deel.looker.com/dashboards/aisat-daily',                      cat:'KPIs'},
    {name:'Terminations Processing Time',                 url:'https://deel.looker.com/dashboards/terminations-processing',           cat:'KPIs'},
    {name:'Start Date Compliance',                        url:'https://deel.looker.com/dashboards/start-date-compliance',             cat:'KPIs'},
    {name:'HR Experience Board',                          url:'https://deel.looker.com/dashboards/hr-experience',                    cat:'Analytics'},
    {name:'MHR Client Coverage Dashboard',                url:'https://deel.looker.com/dashboards/mhr-client-coverage',              cat:'Operations'},
    {name:'Amendment Processing Tracker',                 url:'https://deel.looker.com/dashboards/amendment-processing',              cat:'Compliance'},
    {name:'EOR Contract Expiration Tracker',              url:'https://deel.looker.com/dashboards/eor-contract-expiration',           cat:'Compliance'},
    {name:'Folder of Base Reports',                       url:'https://deel.looker.com/folders/base-reports',                        cat:'Resources'},
  ];
  const CHANNELS=[
    {name:'#hrx-general',                       desc:'Main HRX team channel — announcements & updates',    type:'General',       color:'#1f74b3'},
    {name:'#hrx-onboarding',                    desc:'Onboarding coordination and new hire support',        type:'General',       color:'#1f74b3'},
    {name:'#hrx-payroll',                       desc:'Payroll queries, alerts & processing updates',        type:'Urgent Assist', color:'#d42d35'},
    {name:'#hrx-immigration',                   desc:'Immigration & work permit support and escalations',   type:'Urgent Assist', color:'#d42d35'},
    {name:'#hrx-benefits',                      desc:'Benefits administration queries and enrollment',      type:'Urgent Assist', color:'#d42d35'},
    {name:'#hrx-escalations',                   desc:'Urgent escalations requiring immediate attention',    type:'Urgent Assist', color:'#d42d35'},
    {name:'#legal',                             desc:'Legal & compliance escalations',                      type:'Urgent Assist', color:'#d42d35'},
    {name:'#techops',                           desc:'Technical operations support',                        type:'Urgent Assist', color:'#d42d35'},
    {name:'#urgent-assistance-from-support',    desc:'Urgent escalations from support team',                type:'Urgent Assist', color:'#d42d35'},
    {name:'#scale-pooled-clients',              desc:'Scale tier pooled client escalations',                 type:'Urgent Assist', color:'#ed8d00'},
    {name:'#dedicated-csms',                    desc:'Dedicated CSM client escalations',                    type:'Urgent Assist', color:'#ed8d00'},
    {name:'#fintech-payments',                  desc:'Fintech & payments issues',                           type:'Urgent Assist', color:'#ed8d00'},
    {name:'#gsc',                               desc:'Global support center coordination',                  type:'Urgent Assist', color:'#ed8d00'},
    {name:'#fincrime',                          desc:'Financial crime escalations',                         type:'Urgent Assist', color:'#ed8d00'},
    {name:'#credit-control',                    desc:'Credit control queries',                              type:'Urgent Assist', color:'#ed8d00'},
    {name:'#integrations',                      desc:'Systems integration issues',                          type:'Urgent Assist', color:'#ed8d00'},
    {name:'#peo',                               desc:'PEO service queries',                                 type:'Urgent Assist', color:'#ed8d00'},
    {name:'#product',                           desc:'Product team collaboration',                          type:'Collaboration',  color:'#1f74b3'},
  ];
  const SLA=[
    {process:'Standard HR Request',       sla:'24 hours',          priority:'Normal',   notes:'Business hours only'},
    {process:'Document Request (urgent)', sla:'4 hours',           priority:'High',     notes:'Visa / mortgage docs'},
    {process:'Onboarding Checklist',      sla:'48 hours',          priority:'Normal',   notes:'Must complete before start date'},
    {process:'Offboarding Access Removal',sla:'4 hours',           priority:'Critical', notes:'Same day as last working day'},
    {process:'Payroll Issue',             sla:'24 hours',          priority:'High',     notes:'Escalate if value > $1,000'},
    {process:'Work Permit Renewal',       sla:'5 business days',   priority:'High',     notes:'Initiate 12 weeks before expiry'},
    {process:'Redline WB Controls',       sla:'5 days',            priority:'Normal',   notes:'Monthly cycle'},
    {process:'Benefits Enrollment',       sla:'24 hours',          priority:'High',     notes:'Before enrollment window closes'},
    {process:'Name / Record Change',      sla:'24 hours',          priority:'Normal',   notes:'All systems updated same day'},
    {process:'Anomaly Alert (Looker)',     sla:'2 hours',           priority:'Critical', notes:'Investigate + respond'},
    {process:'Immigration Query',         sla:'48 hours',          priority:'High',     notes:'Loop in specialist'},
    {process:'Compensation Dispute',      sla:'48 hours',          priority:'High',     notes:'Loop in Compensation team'},
  ];
  const POLICIES=[
    {title:'Global Employee Handbook',          desc:'HR policies, code of conduct, benefits overview, and company guidelines for all Deel employees.',url:'https://deel.notion.site/global-handbook',       icon:'bi-book',          color:'#1f74b3'},
    {title:'OOO Coverage Policy',               desc:'How to handle coverage when team members are out. Includes escalation paths and reassignment rules.',url:'https://deel.notion.site/ooo-policy',            icon:'bi-calendar-x',    color:'#ed8d00'},
    {title:'KPI Definitions — AISAT',           desc:'Average Initial Solution Attempt Time targets and measurement methodology for HR Operations.',        url:'https://deel.notion.site/kpi-aisat',             icon:'bi-speedometer2',  color:'#29811e'},
    {title:'KPI Definitions — Termination TPT', desc:'Termination Total Processing Time benchmarks, targets, and improvement plan.',                        url:'https://deel.notion.site/kpi-termination-tpt',  icon:'bi-graph-down',    color:'#d42d35'},
    {title:'Start Date Compliance Policy',      desc:'Targets for employee readiness on day 1: provisioning, access, and onboarding all complete.',         url:'https://deel.notion.site/kpi-start-date',        icon:'bi-calendar-check',color:'#1f74b3'},
    {title:'Immigration & Work Permit Policy',  desc:'Standard processes for permit applications, renewals, and escalation paths to Fragomen.',              url:'https://deel.notion.site/immigration-policy',    icon:'bi-passport',      color:'#0052CC'},
    {title:'MHR Service Level Agreement',       desc:'Managed HR service tier definitions, response times, and escalation procedures for MHR clients.',      url:'https://deel.notion.site/mhr-sla',               icon:'bi-file-earmark-ruled',color:'#7c3aed'},
    {title:'Termination Compliance Checklist',  desc:'Country-by-country termination requirements, notice periods, severance calculations, and legal review steps.', url:'https://deel.notion.site/termination-compliance',icon:'bi-list-check',    color:'#d42d35'},
    {title:'EOR Onboarding Compliance Guide',   desc:'Entity-specific onboarding requirements for EOR employees including documentation, benefits enrollment, and provisioning.',url:'https://deel.notion.site/eor-onboarding-compliance',icon:'bi-building-check',color:'#29811e'},
  ];

  const lkCats=[...new Set(LOOKER.map(r=>r.cat))];
  const chTypes=['Urgent Assist','General','Collaboration'];

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflowY:'hidden'}}>
      <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* KNOWLEDGE BASE                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {(<>
          {/* Search input */}
          <div style={{position:'relative',marginBottom:16}}>
            <i className="bi-search" style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)',fontSize:13}}></i>
            <input type="text" placeholder="Search knowledge hub..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%',paddingLeft:38,paddingRight:12,paddingTop:10,paddingBottom:10,border:'1px solid var(--border)',borderRadius:12,fontSize:14,color:'var(--text)',outline:'none',boxSizing:'border-box',transition:'border-color .15s,box-shadow .15s'}} onFocus={e=>{e.target.style.borderColor='#1f74b3';e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)';}} onBlur={e=>{e.target.style.borderColor='#e8e8e8';e.target.style.boxShadow='none';}}/>
            {search&&<button aria-label="Clear search" onClick={()=>setSearch('')} style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:15}}><i className="bi-x"></i></button>}
          </div>

          {/* If searching, show KB article results first */}
          {search&&(()=>{
            const sq=search.toLowerCase();
            const hits=KB_ARTICLES.filter(a=>
              a.title.toLowerCase().includes(sq)||
              a.tags.some(t=>t.includes(sq))||
              a.summary.toLowerCase().includes(sq)
            );
            if(!hits.length)return(
              <div style={{padding:'24px 0',textAlign:'center',color:'var(--text-muted)'}}>
                <i className="bi-search" style={{fontSize:28,display:'block',marginBottom:10,opacity:.35}}></i>
                <div style={{fontSize:14,fontWeight:600,color:'var(--text)'}}>No articles found for &ldquo;{search}&rdquo;</div>
                <div style={{fontSize:12,marginTop:4}}>Try a different search term or browse the tabs below</div>
              </div>
            );
            return(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal',textTransform:'none',marginBottom:10}}>Knowledge articles ({hits.length})</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {hits.map(a=>(
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
                      onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                      <div style={{width:32,height:32,background:'#f3eff8',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <i className="bi-file-earmark-text" style={{color:'#7c3aed',fontSize:14}}></i>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontWeight:600,fontSize:13,color:'var(--text)'}}>{a.title}</span>
                          <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:128,background:'#f0ece6',color:'var(--text-muted)'}}>{a.category}</span>
                        </div>
                        <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.5,marginBottom:6}}>{a.summary}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                          {a.tags.slice(0,5).map(t=>(
                            <span key={t} style={{fontSize:10,padding:'1px 7px',borderRadius:128,background:'var(--surface-3)',color:'var(--text-muted)'}}>{t}</span>
                          ))}
                        </div>
                      </div>
                      <div style={{flexShrink:0,textAlign:'right'}}>
                        <div style={{fontSize:10,color:'#bdbdbd',marginBottom:4}}>{a.updatedAt}</div>
                        <i className="bi-box-arrow-up-right" style={{color:'#e8e8e8',fontSize:11}}></i>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Content tabs */}
          <div role="tablist" style={{display:'flex',gap:4,marginBottom:20,flexWrap:'wrap'}}>
            {[['sla','bi-clock','SLA Table'],['looker','bi-graph-up','Looker Reports'],['processes','bi-tools','Processes'],['channels','bi-hash','Channels'],['policies','bi-shield-check','Policies'],['quicklinks','bi-link-45deg','Quick Links']].map(([id,icon,label])=>(
              <div key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 14px',fontSize:13,fontWeight:tab===id?600:500,color:tab===id?'#6b3fa0':'var(--text-secondary)',background:tab===id?'#f3eff8':'transparent',borderRadius:8,borderBottom:'none',cursor:'pointer',transition:'all .15s'}}>
                <i className={icon} style={{fontSize:12}}></i>{label}
              </div>
            ))}
          </div>

          {tab==='processes'&&(
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
              {flt(PROCESSES,['name','desc']).map(p=>(
                <a key={p.name} href={p.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:'16px 18px',display:'flex',gap:12,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{width:40,height:40,background:`${p.color}18`,borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={p.icon} style={{color:p.color,fontSize:17}}></i></div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:14,color:'var(--text)',marginBottom:4}}>{p.name}</div><div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.5}}>{p.desc}</div></div>
                  <i className="bi-box-arrow-up-right" style={{color:'#e8e8e8',fontSize:11,flexShrink:0,marginTop:3}}></i>
                </a>
              ))}
            </div>
          )}

          {tab==='looker'&&(
            <div>
              {lkCats.map(cat=>{
                const rpts=flt(LOOKER.filter(r=>r.cat===cat),['name']);
                if(!rpts.length)return null;
                const catColors={Operations:'#1f74b3',Onboarding:'#29811e',Offboarding:'#d42d35',Compliance:'#7c3aed',Analytics:'#ed8d00',KPIs:'#0052CC',Resources:'#616161'};
                const cc=catColors[cat]||'#616161';
                return(
                  <div key={cat} style={{marginBottom:20}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
                      <span style={{width:8,height:8,borderRadius:'50%',background:cc,display:'inline-block'}}></span>
                      <span style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal',textTransform:'none'}}>{cat.toUpperCase()}</span>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {rpts.map(r=>(
                        <a key={r.name} href={r.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,transition:'box-shadow .15s',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}
                          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                          <div style={{width:28,height:28,background:'#fff8e6',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-graph-up" style={{color:'#ed8d00',fontSize:12}}></i></div>
                          <span style={{flex:1,fontSize:13,fontWeight:500,color:'var(--text)'}}>{r.name}</span>
                          <i className="bi-box-arrow-up-right" style={{color:'#e8e8e8',fontSize:11}}></i>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab==='channels'&&(
            <div>
              {chTypes.map(type=>{
                const chs=flt(CHANNELS.filter(c=>c.type===type),['name','desc']);
                if(!chs.length)return null;
                const tc=type==='Urgent Assist'?'#d42d35':type==='General'?'#1f74b3':'#1f74b3';
                return(
                  <div key={type} style={{marginBottom:20}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}><span style={{width:8,height:8,borderRadius:'50%',background:tc,display:'inline-block'}}></span><span style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal',textTransform:'none'}}>{type.toUpperCase()}</span></div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                      {chs.map(ch=>(
                        <a key={ch.name} href="#" onClick={e=>{e.preventDefault();window.open(`https://deel.slack.com/archives/${ch.name.replace('#','')}`,'_blank');}}
                          style={{textDecoration:'none',background:'var(--surface)',border:'1px solid var(--border)',borderLeft:`3px solid ${ch.color}`,borderRadius:12,padding:'12px 14px',display:'flex',gap:8,alignItems:'flex-start',cursor:'pointer',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
                          onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                          <i className="bi-hash" style={{color:ch.color,fontSize:14,marginTop:1,flexShrink:0}}></i>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:'#1f74b3'}}>{ch.name.replace('#','')}</div>
                            <div style={{fontSize:12,color:'var(--text-secondary)',marginTop:2}}>{ch.desc}</div>
                          </div>
                          <i className="bi-box-arrow-up-right" style={{color:'#e8e8e8',fontSize:10,flexShrink:0,marginTop:3}}></i>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab==='sla'&&(
            <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 110px 82px 1fr',gap:10,padding:'12px 16px',background:'var(--surface-2)',borderBottom:'1px solid #f2f2f2'}}>
                {['Process','SLA','Priority','Notes'].map(h=><span key={h} role="columnheader" style={{color:'var(--text-muted)',fontSize:13,fontWeight:500,textTransform:'none',letterSpacing:'normal'}}>{h}</span>)}
              </div>
              {flt(SLA,['process','notes']).map((s,i)=>{
                const PRIORITY_STYLES={
                  Critical:{background:'var(--red-light)',color:'var(--red)'},
                  High:{background:'var(--orange-light)',color:'var(--orange)'},
                  Normal:{background:'var(--surface-3)',color:'var(--text-secondary)'},
                };
                const ps=PRIORITY_STYLES[s.priority]||PRIORITY_STYLES.Normal;
                return(
                  <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 110px 82px 1fr',gap:10,padding:'14px 16px',borderBottom:'1px solid #f2f2f2',alignItems:'center',transition:'background .1s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{fontSize:13,fontWeight:500,color:'var(--text)'}}>{s.process}</span>
                    <span style={{fontSize:13,fontWeight:700,color:'var(--text-secondary)',fontVariantNumeric:'tabular-nums'}}>{s.sla}</span>
                    <span style={{display:'inline-flex',alignItems:'center',padding:'3px 10px',borderRadius:128,background:ps.background,color:ps.color,fontSize:11,fontWeight:700,width:'fit-content'}}>{s.priority}</span>
                    <span style={{fontSize:12,color:'var(--text-secondary)'}}>{s.notes}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab==='policies'&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {flt(POLICIES,['title','desc']).map(p=>(
                <a key={p.title} href={p.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:'16px 18px',display:'flex',gap:12,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{width:40,height:40,background:`${p.color}15`,borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={p.icon} style={{color:p.color,fontSize:18}}></i></div>
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:'var(--text)',marginBottom:4}}>{p.title}</div><div style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.55}}>{p.desc}</div></div>
                  <i className="bi-box-arrow-up-right" style={{color:'#e8e8e8',fontSize:12,flexShrink:0,marginTop:3}}></i>
                </a>
              ))}
            </div>
          )}

          {tab==='quicklinks'&&(
            <div>
              {/* ── Customize panel (C) ──────────────────────────────────── */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>Quick Links</span>
                <button onClick={()=>setShowCustomize(v=>!v)} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:128,border:'1px solid var(--border)',background:showCustomize?'#f0ece6':'white',color:'var(--text-secondary)',fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s'}}>
                  <i className={showCustomize?'bi-x':'bi-gear'} style={{fontSize:12}}></i>
                  {showCustomize?'Close':'Customize'}
                </button>
              </div>

              {showCustomize&&(
                <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:'18px',marginBottom:20,boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:12}}>Your custom links</div>
                  {customLinks.length===0&&(
                    <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:14}}>No custom links yet. Add one below.</div>
                  )}
                  {customLinks.map((lnk,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'#f9f8f6',borderRadius:10,marginBottom:6}}>
                      <i className="bi-link-45deg" style={{color:'var(--text-muted)',fontSize:13}}></i>
                      <span style={{flex:1,fontSize:13,fontWeight:500,color:'var(--text)'}}>{lnk.name}</span>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:128,background:'#e8f4e8',color:'#29811e',fontWeight:600}}>custom</span>
                      <span style={{fontSize:11,color:'var(--text-muted)'}}>{lnk.category}</span>
                      <button onClick={()=>removeCustomLink(i)} style={{background:'none',border:'none',cursor:'pointer',color:'#d42d35',padding:'2px 4px',fontSize:14,lineHeight:1}} title="Remove"><i className="bi-x"></i></button>
                    </div>
                  ))}
                  <div style={{borderTop:'1px solid #f2f2f2',marginTop:12,paddingTop:12}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)',marginBottom:8}}>Add new link</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:8,alignItems:'end'}}>
                      <div>
                        <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:3}}>Name</div>
                        <input value={newLinkName} onChange={e=>setNewLinkName(e.target.value)} placeholder="e.g. My Dashboard" style={{width:'100%',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,color:'var(--text)',outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='#1f74b3'} onBlur={e=>e.target.style.borderColor='#e8e8e8'}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:3}}>URL</div>
                        <input value={newLinkUrl} onChange={e=>setNewLinkUrl(e.target.value)} placeholder="https://..." style={{width:'100%',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,color:'var(--text)',outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='#1f74b3'} onBlur={e=>e.target.style.borderColor='#e8e8e8'}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:3}}>Category</div>
                        <select value={newLinkCat} onChange={e=>setNewLinkCat(e.target.value)} style={{padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,color:'var(--text)',background:'var(--surface)',outline:'none',cursor:'pointer'}}>
                          {DEFAULT_QUICK_LINKS.map(c=><option key={c.category} value={c.category}>{c.category}</option>)}
                        </select>
                      </div>
                    </div>
                    <button onClick={addCustomLink} style={{marginTop:10,padding:'8px 18px',background:'#1f74b3',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',transition:'background .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#1664a0'} onMouseLeave={e=>e.currentTarget.style.background='#1f74b3'}>
                      Save Link
                    </button>
                  </div>
                </div>
              )}

              {/* Link categories */}
              {QUICK_LINKS.map(cat=>(
                <div key={cat.category} style={{marginBottom:24}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                    <div style={{width:28,height:28,background:`${cat.color}18`,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <i className={cat.icon} style={{color:cat.color,fontSize:13}}></i>
                    </div>
                    <span style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal',textTransform:'none'}}>{cat.category}</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                    {cat.links.map(link=>(
                      <a key={link.name} href={link.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:'16px 16px',display:'flex',gap:10,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s',position:'relative'}}
                        onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
                        onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                        {link._custom&&<span style={{position:'absolute',top:10,right:10,fontSize:9,padding:'1px 6px',borderRadius:128,background:'#e8f4e8',color:'#29811e',fontWeight:700}}>custom</span>}
                        <div style={{width:36,height:36,background:`${cat.color}15`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <i className={link.icon} style={{color:cat.color,fontSize:15}}></i>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,color:'var(--text)',marginBottom:3,display:'flex',alignItems:'center',gap:5}}>
                            {link.name}
                            <i className="bi-box-arrow-up-right" style={{color:'var(--purple)',fontSize:10,flexShrink:0}}></i>
                          </div>
                          <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.45}}>{link.desc}</div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ))}

              {/* ── Country Resources (D) ────────────────────────────────── */}
              <div style={{marginTop:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                  <div style={{width:28,height:28,background:'#e8f4e8',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="bi-globe2" style={{color:'#29811e',fontSize:13}}></i>
                  </div>
                  <span style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal',textTransform:'none'}}>Country Resources</span>
                </div>
                <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
                  {COUNTRY_RESOURCES.map((cr,i)=>(
                    <div key={cr.country} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 16px',borderBottom:i<COUNTRY_RESOURCES.length-1?'1px solid #f2f2f2':'none',transition:'background .1s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <span style={{fontSize:18,lineHeight:1,flexShrink:0}}>{cr.flag}</span>
                      <span style={{fontSize:12,fontWeight:700,color:'var(--text-secondary)',width:28,flexShrink:0}}>{cr.country}</span>
                      <i className="bi-table" style={{color:'var(--text-muted)',fontSize:13,flexShrink:0}}></i>
                      <span style={{flex:1,fontSize:13,color:'var(--text)',fontWeight:500}}>{cr.name}</span>
                      <a href={cr.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',padding:'4px 12px',borderRadius:128,background:'#f0ece6',color:'var(--text)',fontSize:12,fontWeight:600,flexShrink:0,transition:'background .15s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#e6e0d9'} onMouseLeave={e=>e.currentTarget.style.background='#f0ece6'}>
                        Open
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>)}


      </div>
    </div>
  );
};

export default KnowledgeHub;
