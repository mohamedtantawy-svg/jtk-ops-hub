import { useState, useEffect, useRef } from 'react';
import { KB_SEARCH_INDEX, KB_ARTICLES } from '../../data/knowledge';

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

// ── Claude mock responses (B) ────────────────────────────────────────────────
const getMockResponse=(msg)=>{
  const m=msg.toLowerCase();
  if(m.includes('leave')||m.includes('pto')||m.includes('holiday')||m.includes('vacation'))
    return 'Leave policies vary by country and entity type. UK employees receive a minimum of 28 days (including bank holidays) under the Working Time Regulations. In Germany, the BUrlG mandates at least 20 days on a 5-day week. Singapore employees get 7–14 days annual leave depending on service years under the Employment Act. For parental leave, global policy covers maternity (up to 26 weeks), paternity (up to 5 days statutory, enhanced per country), and shared parental leave where applicable. Need specifics for a particular country or leave type?';
  if(m.includes('onboard')||m.includes('new hire')||m.includes('day 1')||m.includes('start'))
    return 'The EOR onboarding process has five key stages: (1) Contract signature via DocuSign — triggered once the start date is confirmed; (2) System provisioning — IT access, email, and Slack within 48h of signature; (3) Benefits enrollment — employee has a 30-day window from start date; (4) Workbench onboarding checklist — all tasks must be completed before the start date; (5) Day-1 readiness confirmation — HR and manager sign-off in Workbench. MHR clients have an additional HRIS integration step. Is there a specific stage you need help with?';
  if(m.includes('zd')||m.includes('zendesk')||m.includes('ticket')||m.includes('macro')||m.includes('queue'))
    return 'The ZD workflow for HR Ops follows this path: New tickets land in the **Unassigned** view → agent picks up or is auto-routed by country tag → first response using the appropriate macro within the SLA window → if resolution requires engineering, link the ZD ticket to a Jira issue via the ZD-Jira app → on resolution, use the "Resolution Confirmation" macro and set status to Solved. For escalations: tag the ticket `#escalate-t2`, add an internal note with reason and urgency, then post in #hrx-escalations. CSAT surveys trigger 2h after ticket is Solved. Need the macro library or tagging taxonomy?';
  if(m.includes('amendment')||m.includes('bonus')||m.includes('salary change')||m.includes('variable comp')||m.includes('retention')||m.includes('signing'))
    return 'Contract amendments follow a four-step process: (1) **Approval** — compensation changes need finance sign-off; bonuses need manager + finance approval with the bonus agreement template; (2) **Workbench action** — use "Compensation & Benefits Adjustment" for salary changes or "Employment Contract Amendment" for role/title; (3) **Addendum generation** — contract addendum auto-generated via Workbench; employee signs via DocuSign; (4) **Payroll alignment** — confirm effective date aligns with payroll cut-off (usually 15th of the month). Retention and signing bonuses require a separate clawback agreement. Which amendment type do you need guidance on?';
  if(m.includes('immigrat')||m.includes('visa')||m.includes('work permit')||m.includes('permit')||m.includes('ep ')||m.includes('cos')||m.includes('sponsored'))
    return 'Immigration processes are handled in partnership with Fragomen. The 12-week renewal trigger rule is critical — permits expiring within 12 weeks must be flagged immediately in the Work Permit Renewal Tracker. For UK Skilled Worker visas: CoS assignment in SMS → Fragomen application → UKVI processing (8–12 weeks). For Singapore EP: apply via myMOM portal, min salary $5,000/month (2025). For Germany: EU Blue Card requires a recognised degree + €43,759 min salary. Always escalate to the immigration specialist if a worker is at risk of illegal working. Need a country-specific guide?';
  if(m.includes('mhr')||m.includes('managed hr'))
    return 'MHR (Managed HR) clients receive dedicated HR operations support. Service tiers: Standard (48h response), Gold (24h), Platinum (4h). Monthly deliverables include a reporting pack (headcount, payroll summary, open tickets, SLA performance) pulled from the MHR Client Coverage dashboard in Looker. Client escalations should be copied to the assigned CSM; Platinum client emergencies use the #dedicated-csms channel. MHR onboarding includes entity setup, payroll calendar configuration, benefits configuration, and HRIS integration. Which aspect of MHR do you need help with?';
  if(m.includes('payroll')||m.includes('salary')||m.includes('pay'))
    return 'Payroll processing runs on a monthly cycle with a data cut-off typically on the 15th. Key steps: collect change data from Workbench → variance review (flag anything >5% or >$1,000 vs prior month) → payroll specialist approval → disbursement 3 business days before pay date → post-payroll reconciliation. For off-cycle urgent payments, raise via the Off-Cycle Payroll request form (Finance portal). Discrepancies >$500 require escalation to the Payroll Specialist via #hrx-payroll. Need the reconciliation checklist or off-cycle process?';
  if(m.includes('benefit')||m.includes('pension')||m.includes('401k')||m.includes('insurance')||m.includes('medical'))
    return 'Benefits enrollment is available during two windows: (1) New hire window — 30 days from start date; (2) Annual open enrollment — typically Q4. Benefits vary by country: UK offers private medical (Bupa/AXA), auto-enrolment pension (min 5% EE + 3% ER), and cycle-to-work. US offers 401k (3% match), HDHP/PPO health plans, FSA/HSA. Singapore provides statutory CPF contributions plus supplemental medical. Late enrollment requests require manager approval and may have evidence of insurability requirements. Which country or benefit type can I help with?';
  if(m.includes('compli')||m.includes('gdpr')||m.includes('audit')||m.includes('right to work'))
    return 'Compliance checks in HR Ops cover: (1) Monthly Redline Workbench Controls — pull the exception report from Looker, clear all flagged records by day 5 of each month; (2) Right-to-Work — UK requires online share code or manual document check before first day (List A/B documents); (3) GDPR — DSAR requests must be acknowledged within 3 days and completed within 30 days; data retention schedules apply per country; (4) EOR contract mandatory clauses — reviewed quarterly by Legal. For audit documentation, use the Compliance Audit Documentation Guide in the Policies tab. Need anything specific?';
  return "I can help you with HR policies, Zendesk workflows, Jira procedures, and Deel platform guidance. Try asking about leave policies, onboarding steps, ZD macros, contract amendments, work permits, payroll processing, benefits enrollment, or MHR procedures.";
};

const KnowledgeHub=({subFilter, user})=>{
  // ── Section tab (Search / Ask Claude) ─────────────────────────────────────
  const [kbTab,setKbTab]=useState(subFilter==='Ask Claude'?'claude':'search');

  // ── Inner content tab (under Search) ──────────────────────────────────────
  const [search,setSearch]=useState('');
  const tabMap={'Policies':'policies','Runbooks':'processes','Tools':'looker','FAQs':'sla'};
  const [tab,setTab]=useState(subFilter?tabMap[subFilter]||'sla':'sla');
  useEffect(()=>{
    if(subFilter==='Ask Claude'){setKbTab('claude');return;}
    if(subFilter&&tabMap[subFilter]){setKbTab('search');setTab(tabMap[subFilter]);}
  },[subFilter]);

  // ── Claude chat state (B) ──────────────────────────────────────────────────
  const [messages,setMessages]=useState([
    {role:'assistant',text:"Hi! I'm Claude. Ask me anything about HR policies, workflows, or the Deel platform."}
  ]);
  const [chatInput,setChatInput]=useState('');
  const [typing,setTyping]=useState(false);
  const chatEndRef=useRef(null);
  useEffect(()=>{
    if(kbTab==='claude')chatEndRef.current?.scrollIntoView({behavior:'smooth'});
  },[messages,typing,kbTab]);

  const sendMessage=()=>{
    const text=chatInput.trim();
    if(!text||typing)return;
    setMessages(prev=>[...prev,{role:'user',text}]);
    setChatInput('');
    setTyping(true);
    setTimeout(()=>{
      const reply=getMockResponse(text);
      setMessages(prev=>[...prev,{role:'assistant',text:reply}]);
      setTyping(false);
    },1200);
  };

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

        {/* ── KB / Claude toggle (B) ───────────────────────────────────────── */}
        <div style={{display:'flex',gap:6,marginBottom:18,padding:'3px',background:'#f0ece6',borderRadius:128,width:'fit-content'}}>
          {[['search','bi-search','Knowledge Base'],['claude','bi-stars','Ask Claude']].map(([id,icon,label])=>(
            <button key={id} onClick={()=>setKbTab(id)} style={{
              display:'flex',alignItems:'center',gap:6,
              padding:'7px 18px',
              borderRadius:128,fontSize:13,fontWeight:600,
              border:'none',cursor:'pointer',transition:'all .18s',
              background:kbTab===id?'white':'transparent',
              color:kbTab===id?'#1b1b1b':'#9e9e9e',
              boxShadow:kbTab===id?'0 1px 4px rgba(0,0,0,0.10)':'none',
            }}>
              <i className={icon} style={{fontSize:12}}></i>{label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SEARCH PANEL                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {kbTab==='search'&&(<>
          {/* Search input */}
          <div style={{position:'relative',marginBottom:16}}>
            <i className="bi-search" style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'#9e9e9e',fontSize:13}}></i>
            <input type="text" placeholder="Search knowledge hub..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%',paddingLeft:38,paddingRight:12,paddingTop:10,paddingBottom:10,border:'1px solid #e8e8e8',borderRadius:12,fontSize:14,color:'#1b1b1b',outline:'none',boxSizing:'border-box',transition:'border-color .15s,box-shadow .15s'}} onFocus={e=>{e.target.style.borderColor='#1f74b3';e.target.style.boxShadow='0 0 0 3px rgba(31,116,179,0.1)';}} onBlur={e=>{e.target.style.borderColor='#e8e8e8';e.target.style.boxShadow='none';}}/>
            {search&&<button aria-label="Clear search" onClick={()=>setSearch('')} style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'#616161',cursor:'pointer',fontSize:15}}><i className="bi-x"></i></button>}
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
              <div style={{padding:'24px 0',textAlign:'center',color:'#9e9e9e'}}>
                <i className="bi-search" style={{fontSize:28,display:'block',marginBottom:10,opacity:.35}}></i>
                <div style={{fontSize:14,fontWeight:600,color:'#1b1b1b'}}>No articles found for &ldquo;{search}&rdquo;</div>
                <div style={{fontSize:12,marginTop:4}}>Try a different search term or browse the tabs below</div>
              </div>
            );
            return(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none',marginBottom:10}}>Knowledge articles ({hits.length})</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {hits.map(a=>(
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'white',border:'1px solid #e8e8e8',borderRadius:12,padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
                      onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                      <div style={{width:32,height:32,background:'#f3eff8',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <i className="bi-file-earmark-text" style={{color:'#7c3aed',fontSize:14}}></i>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontWeight:600,fontSize:13,color:'#1b1b1b'}}>{a.title}</span>
                          <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:128,background:'#f0ece6',color:'#9e9e9e'}}>{a.category}</span>
                        </div>
                        <div style={{fontSize:12,color:'#616161',lineHeight:1.5,marginBottom:6}}>{a.summary}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                          {a.tags.slice(0,5).map(t=>(
                            <span key={t} style={{fontSize:10,padding:'1px 7px',borderRadius:128,background:'#f5f5f5',color:'#9e9e9e'}}>{t}</span>
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
                <a key={p.name} href={p.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 18px',display:'flex',gap:12,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{width:40,height:40,background:`${p.color}18`,borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={p.icon} style={{color:p.color,fontSize:17}}></i></div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:14,color:'#1b1b1b',marginBottom:4}}>{p.name}</div><div style={{fontSize:12,color:'#616161',lineHeight:1.5}}>{p.desc}</div></div>
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
                      <span style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none'}}>{cat.toUpperCase()}</span>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {rpts.map(r=>(
                        <a key={r.name} href={r.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'white',border:'1px solid #e8e8e8',borderRadius:12,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,transition:'box-shadow .15s',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}
                          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                          <div style={{width:28,height:28,background:'#fff8e6',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className="bi-graph-up" style={{color:'#ed8d00',fontSize:12}}></i></div>
                          <span style={{flex:1,fontSize:13,fontWeight:500,color:'#1b1b1b'}}>{r.name}</span>
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
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}><span style={{width:8,height:8,borderRadius:'50%',background:tc,display:'inline-block'}}></span><span style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none'}}>{type.toUpperCase()}</span></div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                      {chs.map(ch=>(
                        <a key={ch.name} href="#" onClick={e=>{e.preventDefault();window.open(`https://deel.slack.com/archives/${ch.name.replace('#','')}`,'_blank');}}
                          style={{textDecoration:'none',background:'white',border:'1px solid #e8e8e8',borderLeft:`3px solid ${ch.color}`,borderRadius:12,padding:'12px 14px',display:'flex',gap:8,alignItems:'flex-start',cursor:'pointer',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
                          onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                          <i className="bi-hash" style={{color:ch.color,fontSize:14,marginTop:1,flexShrink:0}}></i>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:'#1f74b3'}}>{ch.name.replace('#','')}</div>
                            <div style={{fontSize:12,color:'#616161',marginTop:2}}>{ch.desc}</div>
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
            <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 110px 82px 1fr',gap:10,padding:'12px 16px',background:'#fafaf9',borderBottom:'1px solid #f2f2f2'}}>
                {['Process','SLA','Priority','Notes'].map(h=><span key={h} role="columnheader" style={{color:'#9e9e9e',fontSize:13,fontWeight:500,textTransform:'none',letterSpacing:'normal'}}>{h}</span>)}
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
                    <span style={{fontSize:13,fontWeight:500,color:'#1b1b1b'}}>{s.process}</span>
                    <span style={{fontSize:13,fontWeight:700,color:'#616161',fontVariantNumeric:'tabular-nums'}}>{s.sla}</span>
                    <span style={{display:'inline-flex',alignItems:'center',padding:'3px 10px',borderRadius:128,background:ps.background,color:ps.color,fontSize:11,fontWeight:700,width:'fit-content'}}>{s.priority}</span>
                    <span style={{fontSize:12,color:'#616161'}}>{s.notes}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab==='policies'&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {flt(POLICIES,['title','desc']).map(p=>(
                <a key={p.title} href={p.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 18px',display:'flex',gap:12,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'} onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                  <div style={{width:40,height:40,background:`${p.color}15`,borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={p.icon} style={{color:p.color,fontSize:18}}></i></div>
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:'#1b1b1b',marginBottom:4}}>{p.title}</div><div style={{fontSize:13,color:'#616161',lineHeight:1.55}}>{p.desc}</div></div>
                  <i className="bi-box-arrow-up-right" style={{color:'#e8e8e8',fontSize:12,flexShrink:0,marginTop:3}}></i>
                </a>
              ))}
            </div>
          )}

          {tab==='quicklinks'&&(
            <div>
              {/* ── Customize panel (C) ──────────────────────────────────── */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                <span style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>Quick Links</span>
                <button onClick={()=>setShowCustomize(v=>!v)} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:128,border:'1px solid #e8e8e8',background:showCustomize?'#f0ece6':'white',color:'#616161',fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s'}}>
                  <i className={showCustomize?'bi-x':'bi-gear'} style={{fontSize:12}}></i>
                  {showCustomize?'Close':'Customize'}
                </button>
              </div>

              {showCustomize&&(
                <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'18px',marginBottom:20,boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#1b1b1b',marginBottom:12}}>Your custom links</div>
                  {customLinks.length===0&&(
                    <div style={{fontSize:12,color:'#9e9e9e',marginBottom:14}}>No custom links yet. Add one below.</div>
                  )}
                  {customLinks.map((lnk,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'#f9f8f6',borderRadius:10,marginBottom:6}}>
                      <i className="bi-link-45deg" style={{color:'#9e9e9e',fontSize:13}}></i>
                      <span style={{flex:1,fontSize:13,fontWeight:500,color:'#1b1b1b'}}>{lnk.name}</span>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:128,background:'#e8f4e8',color:'#29811e',fontWeight:600}}>custom</span>
                      <span style={{fontSize:11,color:'#9e9e9e'}}>{lnk.category}</span>
                      <button onClick={()=>removeCustomLink(i)} style={{background:'none',border:'none',cursor:'pointer',color:'#d42d35',padding:'2px 4px',fontSize:14,lineHeight:1}} title="Remove"><i className="bi-x"></i></button>
                    </div>
                  ))}
                  <div style={{borderTop:'1px solid #f2f2f2',marginTop:12,paddingTop:12}}>
                    <div style={{fontSize:12,fontWeight:600,color:'#616161',marginBottom:8}}>Add new link</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:8,alignItems:'end'}}>
                      <div>
                        <div style={{fontSize:11,color:'#9e9e9e',marginBottom:3}}>Name</div>
                        <input value={newLinkName} onChange={e=>setNewLinkName(e.target.value)} placeholder="e.g. My Dashboard" style={{width:'100%',padding:'8px 10px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,color:'#1b1b1b',outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='#1f74b3'} onBlur={e=>e.target.style.borderColor='#e8e8e8'}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:'#9e9e9e',marginBottom:3}}>URL</div>
                        <input value={newLinkUrl} onChange={e=>setNewLinkUrl(e.target.value)} placeholder="https://..." style={{width:'100%',padding:'8px 10px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,color:'#1b1b1b',outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='#1f74b3'} onBlur={e=>e.target.style.borderColor='#e8e8e8'}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:'#9e9e9e',marginBottom:3}}>Category</div>
                        <select value={newLinkCat} onChange={e=>setNewLinkCat(e.target.value)} style={{padding:'8px 10px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,color:'#1b1b1b',background:'white',outline:'none',cursor:'pointer'}}>
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
                    <span style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none'}}>{cat.category}</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                    {cat.links.map(link=>(
                      <a key={link.name} href={link.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',background:'white',border:'1px solid #e8e8e8',borderRadius:16,padding:'16px 16px',display:'flex',gap:10,alignItems:'flex-start',boxShadow:'0 1px 2px rgba(0,0,0,0.04)',transition:'box-shadow .15s',position:'relative'}}
                        onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}
                        onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)'}>
                        {link._custom&&<span style={{position:'absolute',top:10,right:10,fontSize:9,padding:'1px 6px',borderRadius:128,background:'#e8f4e8',color:'#29811e',fontWeight:700}}>custom</span>}
                        <div style={{width:36,height:36,background:`${cat.color}15`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <i className={link.icon} style={{color:cat.color,fontSize:15}}></i>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,color:'#1b1b1b',marginBottom:3,display:'flex',alignItems:'center',gap:5}}>
                            {link.name}
                            <i className="bi-box-arrow-up-right" style={{color:'var(--purple)',fontSize:10,flexShrink:0}}></i>
                          </div>
                          <div style={{fontSize:12,color:'#616161',lineHeight:1.45}}>{link.desc}</div>
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
                  <span style={{fontSize:13,fontWeight:600,color:'#9e9e9e',letterSpacing:'normal',textTransform:'none'}}>Country Resources</span>
                </div>
                <div style={{background:'white',border:'1px solid #e8e8e8',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
                  {COUNTRY_RESOURCES.map((cr,i)=>(
                    <div key={cr.country} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 16px',borderBottom:i<COUNTRY_RESOURCES.length-1?'1px solid #f2f2f2':'none',transition:'background .1s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f9f8f6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <span style={{fontSize:18,lineHeight:1,flexShrink:0}}>{cr.flag}</span>
                      <span style={{fontSize:12,fontWeight:700,color:'#616161',width:28,flexShrink:0}}>{cr.country}</span>
                      <i className="bi-table" style={{color:'#9e9e9e',fontSize:13,flexShrink:0}}></i>
                      <span style={{flex:1,fontSize:13,color:'#1b1b1b',fontWeight:500}}>{cr.name}</span>
                      <a href={cr.url} target="_blank" rel="noreferrer" style={{textDecoration:'none',padding:'4px 12px',borderRadius:128,background:'#f0ece6',color:'#1b1b1b',fontSize:12,fontWeight:600,flexShrink:0,transition:'background .15s'}}
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

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ASK CLAUDE PANEL (B)                                               */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {kbTab==='claude'&&(
          <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 260px)',minHeight:400}}>
            {/* Chat window */}
            <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:12,paddingBottom:12}}>
              {messages.map((msg,i)=>(
                <div key={i} style={{display:'flex',justifyContent:msg.role==='user'?'flex-end':'flex-start'}}>
                  {msg.role==='assistant'&&(
                    <div style={{width:28,height:28,borderRadius:'50%',background:'#f3eff8',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginRight:8,marginTop:2}}>
                      <i className="bi-stars" style={{color:'#7c3aed',fontSize:12}}></i>
                    </div>
                  )}
                  <div style={{
                    maxWidth:'72%',
                    padding:'10px 14px',
                    borderRadius:msg.role==='user'?'18px 18px 4px 18px':'18px 18px 18px 4px',
                    background:msg.role==='user'?'#1f74b3':'white',
                    color:msg.role==='user'?'white':'#1b1b1b',
                    fontSize:13,
                    lineHeight:1.6,
                    boxShadow:msg.role==='assistant'?'0 1px 4px rgba(0,0,0,0.08)':'none',
                    border:msg.role==='assistant'?'1px solid #e8e8e8':'none',
                    whiteSpace:'pre-wrap',
                    wordBreak:'break-word',
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {typing&&(
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#f3eff8',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <i className="bi-stars" style={{color:'#7c3aed',fontSize:12}}></i>
                  </div>
                  <div style={{padding:'10px 14px',borderRadius:'18px 18px 18px 4px',background:'white',border:'1px solid #e8e8e8',boxShadow:'0 1px 4px rgba(0,0,0,0.08)',display:'flex',gap:4,alignItems:'center'}}>
                    {[0,1,2].map(d=>(
                      <span key={d} style={{width:6,height:6,borderRadius:'50%',background:'#bdbdbd',display:'inline-block',animation:`pulse 1.2s ease-in-out ${d*0.2}s infinite`}}></span>
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Input bar */}
            <div style={{display:'flex',gap:8,alignItems:'flex-end',paddingTop:12,borderTop:'1px solid #e8e8e8'}}>
              <textarea
                rows={1}
                value={chatInput}
                onChange={e=>{setChatInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';}}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}
                placeholder="Ask about HR policies, ZD workflows, amendments, immigration..."
                style={{
                  flex:1,resize:'none',padding:'10px 14px',
                  border:'1px solid #e8e8e8',borderRadius:16,fontSize:13,
                  color:'#1b1b1b',outline:'none',lineHeight:1.5,
                  fontFamily:'inherit',overflow:'hidden',
                  transition:'border-color .15s, box-shadow .15s',
                }}
                onFocus={e=>{e.target.style.borderColor='#7c3aed';e.target.style.boxShadow='0 0 0 3px rgba(124,58,237,0.1)';}}
                onBlur={e=>{e.target.style.borderColor='#e8e8e8';e.target.style.boxShadow='none';}}
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim()||typing}
                style={{
                  width:40,height:40,borderRadius:'50%',border:'none',
                  background:chatInput.trim()&&!typing?'#7c3aed':'#e8e8e8',
                  color:'white',cursor:chatInput.trim()&&!typing?'pointer':'default',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  flexShrink:0,transition:'background .15s',
                }}>
                <i className="bi-send-fill" style={{fontSize:13}}></i>
              </button>
            </div>

            <div style={{fontSize:11,color:'#bdbdbd',textAlign:'center',marginTop:8}}>
              Responses are illustrative. Always verify against official Deel policy documents.
            </div>
          </div>
        )}

      </div>
      {/* Typing indicator pulse animation */}
      <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}`}</style>
    </div>
  );
};

export default KnowledgeHub;
