import { useState, useEffect, useCallback } from 'react';
import { TOOLS, FLAGS, SLA_MINS } from '../../data/constants';
import { MEMBERS } from '../../data/members';
import { DEFAULT_SETTINGS } from '../../data/settings';
import { KB_SEARCH_INDEX } from '../../data/knowledge';
import PageHeader from '../ui/PageHeader';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import ZapierSettings from '../settings/ZapierSettings';
import AccessControlSettings from '../settings/AccessControlSettings';
import IntegrationsSettings from '../settings/IntegrationsSettings';
import HandoverSettingsSection from '../settings/HandoverSettingsSection';

const SETTINGS_GROUPS=[
  {
    label:'Workflow',
    items:[
      {id:'sla',       icon:'bi-clock-history',          label:'SLA Configuration',ariaLabel:'SLA Configuration settings'},
      {id:'queue',     icon:'bi-inbox-fill',              label:'Queue & Tasks'},
      {id:'sources',   icon:'bi-plug-fill',               label:'Source Integrations'},
      {id:'zapier',    icon:'bi-lightning-charge-fill',    label:'Zapier Integrations'},
      {id:'live',      icon:'bi-cloud-arrow-down-fill',    label:'Live Integrations'},
    ],
  },
  {
    label:'Views & Navigation',
    items:[
      {id:'nav',       icon:'bi-layout-sidebar',          label:'Navigation & Sidebar'},
      {id:'briefing',  icon:'bi-speedometer2',             label:'Briefing Dashboard'},
      {id:'slack',     icon:'bi-chat-left-text-fill',      label:'Slack Integration'},
      {id:'alerts',    icon:'bi-exclamation-triangle-fill',label:'Alerts'},
    ],
  },
  {
    label:'Team',
    items:[
      {id:'escalation',icon:'bi-arrow-up-circle-fill',    label:'Escalation Rules'},
      {id:'team',      icon:'bi-people-fill',              label:'Team Management'},
      {id:'access',    icon:'bi-shield-lock-fill',         label:'Access Control'},
      {id:'handovers', icon:'bi-airplane',                 label:'Handovers'},
    ],
  },
  {
    label:'Preferences',
    items:[
      {id:'ai',        icon:'bi-stars',                   label:'AI & Suggested Replies'},
      {id:'notif',     icon:'bi-bell-fill',                label:'Notifications'},
      {id:'ui',        icon:'bi-palette-fill',             label:'UI & Display'},
      {id:'brand',     icon:'bi-brush-fill',               label:'Branding'},
    ],
  },
  {
    label:'Compliance',
    items:[
      {id:'kb',        icon:'bi-book-half',                label:'Knowledge Hub Config'},
      {id:'calendar',  icon:'bi-calendar3',                label:'Calendar & Deadlines'},
    ],
  },
  {
    label:'Analytics & Reporting',
    items:[
      {id:'analytics', icon:'bi-graph-up',                 label:'Analytics'},
      {id:'export',    icon:'bi-cloud-download-fill',      label:'Export & Reporting'},
    ],
  },
  {
    label:'Modules',
    items:[
      {id:'projects',      icon:'bi-kanban-fill',          label:'Projects'},
      {id:'announcements', icon:'bi-broadcast-pin',        label:'Announcements'},
    ],
  },
  {
    label:'⚠ Danger Zone',
    isDanger: true,
    items:[
      {id:'danger',    icon:'bi-exclamation-octagon-fill', label:'Danger Zone'},
    ],
  },
];
// Flat list for any legacy references
const SETTINGS_CATS=SETTINGS_GROUPS.flatMap(g=>g.items);

const SettingsView=({settings,setSettings,user,addToast,tasks,setTasks,subFilter,accessTypes,setAccessTypes,userAccessMap,setUserAccessMap,perms})=>{
  const catMap={'General':'queue','SLA Rules':'sla','Notifications':'notif','Export':'export'};
  const [cat,setCat]=useState(subFilter?catMap[subFilter]||'sla':'sla');
  useEffect(()=>{if(subFilter&&catMap[subFilter])setCat(catMap[subFilter]);},[subFilter]);
  const [saved,setSaved]=useState(false);
  const [newMember,setNewMember]=useState(null);
  const [searchTerm,setSearchTerm]=useState('');

  const s=settings;
  const set=(key,val)=>{ setSettings(prev=>{const n={...prev,[key]:val};try{localStorage.setItem('ops_hub_settings',JSON.stringify(n));}catch(e){}return n;}); flash(); };
  const setNested=(key,sub,val)=>{ setSettings(prev=>{const n={...prev,[key]:{...prev[key],[sub]:val}};try{localStorage.setItem('ops_hub_settings',JSON.stringify(n));}catch(e){}return n;}); flash(); };
  const flash=()=>{setSaved(true);setTimeout(()=>setSaved(false),1800);};
  const setArr=(key,val)=>{ setSettings(prev=>{const n={...prev,[key]:val};try{localStorage.setItem('ops_hub_settings',JSON.stringify(n));}catch(e){}return n;}); flash(); };

  const Toggle=({id:toggleId,label,desc,value,onChange})=>{
    const uid=toggleId||('toggle-'+label.replace(/\s+/g,'-').toLowerCase());
    return(
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
        <div style={{flex:1}}>
          <label htmlFor={uid} style={{fontSize:14,fontWeight:500,color:'var(--text)',cursor:'pointer',display:'block'}}>{label}</label>
          {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{desc}</div>}
        </div>
        <label className="deel-toggle" htmlFor={uid} style={{flexShrink:0}}>
          <input id={uid} type="checkbox" checked={!!value} onChange={()=>onChange(!value)}/>
          <span className="deel-toggle-track"/>
        </label>
      </div>
    );
  };

  const Select=({label,desc,value,onChange,options})=>(
    <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
      <div style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
        {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1}}>{desc}</div>}
      </div>
      <select value={value} onChange={e=>onChange(e.target.value)} style={{border:'1px solid var(--border)',borderRadius:12,padding:'5px 10px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)',cursor:'pointer',minWidth:130}}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  const NumberInput=({label,desc,value,onChange,min,max,suffix})=>(
    <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
      <div style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
        {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1}}>{desc}</div>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:5}}>
        <input type="number" value={value} onChange={e=>{const v=Number(e.target.value);onChange(Math.max(min||0,Math.min(max||9999,v)));}} min={min} max={max} style={{width:70,border:'1px solid var(--border)',borderRadius:12,padding:'5px 8px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)',textAlign:'right'}}/>
        {suffix&&<span style={{fontSize:12,color:'var(--text-muted)'}}>{suffix}</span>}
      </div>
    </div>
  );

  const TextInput=({label,desc,value,onChange,placeholder})=>(
    <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
      <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
      {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:5}}>{desc}</div>}
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||''} style={{width:'100%',border:'1px solid var(--border)',borderRadius:12,padding:'7px 10px',fontSize:12.5,outline:'none',fontFamily:'inherit',color:'var(--text)',boxSizing:'border-box',marginTop:4}}/>
    </div>
  );

  const TextArea=({label,desc,value,onChange,rows})=>(
    <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
      <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
      {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:5}}>{desc}</div>}
      <textarea value={value} onChange={e=>onChange(e.target.value)} rows={rows||3} style={{width:'100%',border:'1px solid var(--border)',borderRadius:12,padding:'7px 10px',fontSize:12.5,outline:'none',fontFamily:'inherit',color:'var(--text)',boxSizing:'border-box',resize:'vertical',marginTop:4,lineHeight:1.5}}/>
    </div>
  );

  const SectionHeader=({icon,title,desc})=>(
    <div style={{marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
        <i className={icon} style={{fontSize:18,color:'var(--text)'}}></i>
        <span style={{fontSize:18,fontWeight:700,color:'var(--text)'}}>{title}</span>
      </div>
      {desc&&<div style={{fontSize:13,color:'var(--text-muted)',marginLeft:28}}>{desc}</div>}
    </div>
  );

  // Reusable list editor for string arrays
  const StringListEditor=({label,desc,items,onChange})=>{
    const [draft,setDraft]=useState('');
    return(
      <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
        <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
        {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>{desc}</div>}
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6,marginBottom:8}}>
          {(items||[]).map((item,i)=>(
            <span key={i} style={{display:'inline-flex',alignItems:'center',gap:4,background:'var(--surface-3)',border:'1px solid var(--border)',borderRadius:20,padding:'4px 10px',fontSize:12,color:'var(--text-secondary)'}}>
              {item}
              <button onClick={()=>{const next=[...items];next.splice(i,1);onChange(next);}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,lineHeight:1,padding:0,marginLeft:2}}>&times;</button>
            </span>
          ))}
        </div>
        <div style={{display:'flex',gap:6}}>
          <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Add new item..." onKeyDown={e=>{if(e.key==='Enter'&&draft.trim()){onChange([...(items||[]),draft.trim()]);setDraft('');}}} style={{flex:1,border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)'}}/>
          <button onClick={()=>{if(draft.trim()){onChange([...(items||[]),draft.trim()]);setDraft('');}}} style={{height:30,padding:'0 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,fontWeight:600,cursor:'pointer'}}>Add</button>
        </div>
      </div>
    );
  };

  // Reusable long-text list editor (for templates etc)
  const LongTextListEditor=({label,desc,items,onChange,placeholder})=>{
    const [draft,setDraft]=useState('');
    return(
      <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
        <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
        {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>{desc}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6,marginBottom:8}}>
          {(items||[]).map((item,i)=>(
            <div key={i} style={{display:'flex',alignItems:'flex-start',gap:6,background:'var(--surface-3)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',fontSize:12,color:'var(--text-secondary)'}}>
              <span style={{flex:1,lineHeight:1.4}}>{item}</span>
              <button onClick={()=>{const next=[...items];next.splice(i,1);onChange(next);}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,lineHeight:1,padding:0,flexShrink:0}}>&times;</button>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:6}}>
          <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder={placeholder||'Add new...'} onKeyDown={e=>{if(e.key==='Enter'&&draft.trim()){onChange([...(items||[]),draft.trim()]);setDraft('');}}} style={{flex:1,border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)'}}/>
          <button onClick={()=>{if(draft.trim()){onChange([...(items||[]),draft.trim()]);setDraft('');}}} style={{height:30,padding:'0 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,fontWeight:600,cursor:'pointer'}}>Add</button>
        </div>
      </div>
    );
  };

  // Toggle group for object settings like {key: true/false}
  const ToggleGroup=({label,desc,obj,settingsKey})=>(
    <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
      <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
      {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>{desc}</div>}
      {Object.entries(obj||{}).map(([k,v])=>(
        <Toggle key={k} label={k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} value={v} onChange={val=>setNested(settingsKey,k,val)}/>
      ))}
    </div>
  );

  // Editable object list (for quick links, country resources, teams, etc)
  const ObjectListEditor=({label,desc,items,onChange,fields,renderItem})=>{
    const [showAdd,setShowAdd]=useState(false);
    const [draft,setDraft]=useState(()=>fields.reduce((a,f)=>({...a,[f.key]:''}),{}));
    return(
      <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
        <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
        {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>{desc}</div>}
        <div style={{border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginTop:6,marginBottom:8}}>
          <div style={{display:'flex',padding:'8px 12px',background:'var(--surface-2)',borderBottom:'1px solid #e8e8e8',fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>
            {fields.map(f=><span key={f.key} style={{flex:f.flex||1}}>{f.label}</span>)}
            <span style={{width:30}}></span>
          </div>
          {(items||[]).map((item,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',padding:'6px 12px',borderBottom:'1px solid #f7f5f2',fontSize:12,color:'var(--text-secondary)'}}>
              {fields.map(f=><span key={f.key} style={{flex:f.flex||1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:4}}>{item[f.key]||''}</span>)}
              <button onClick={()=>{const next=[...items];next.splice(i,1);onChange(next);}} style={{width:30,background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14}}>&times;</button>
            </div>
          ))}
        </div>
        {showAdd?(
          <div style={{display:'flex',gap:6,alignItems:'flex-end',flexWrap:'wrap'}}>
            {fields.map(f=>(
              <input key={f.key} value={draft[f.key]} onChange={e=>setDraft(prev=>({...prev,[f.key]:e.target.value}))} placeholder={f.label} style={{flex:f.flex||1,minWidth:80,border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)'}}/>
            ))}
            <button onClick={()=>{if(fields.some(f=>draft[f.key]?.trim())){onChange([...(items||[]),{...draft}]);setDraft(fields.reduce((a,f)=>({...a,[f.key]:''}),{}));setShowAdd(false);}}} style={{height:30,padding:'0 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,fontWeight:600,cursor:'pointer'}}>Save</button>
            <button onClick={()=>setShowAdd(false)} style={{height:30,padding:'0 10px',borderRadius:8,border:'none',background:'none',color:'var(--text-muted)',fontSize:12,cursor:'pointer'}}>Cancel</button>
          </div>
        ):(
          <button onClick={()=>setShowAdd(true)} style={{height:30,padding:'0 12px',borderRadius:8,border:'1px dashed #dedede',background:'var(--surface)',color:'var(--text-secondary)',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}><i className="bi-plus" style={{fontSize:14}}></i>Add item</button>
        )}
      </div>
    );
  };

  // SLA-style table for severity -> minutes mapping
  const SeveritySlaTable=({label,desc,obj,settingsKey})=>(
    <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
      <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{label}</div>
      {desc&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>{desc}</div>}
      <div style={{border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginTop:6}}>
        <div style={{display:'flex',padding:'8px 14px',background:'var(--surface-2)',borderBottom:'1px solid #e8e8e8',fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>
          <span style={{flex:1}}>Severity</span><span style={{width:90,textAlign:'right'}}>Target (min)</span><span style={{width:60,textAlign:'right'}}>Hours</span>
        </div>
        {Object.entries(obj||{}).map(([sev,mins])=>(
          <div key={sev} style={{display:'flex',alignItems:'center',padding:'7px 14px',borderBottom:'1px solid #f7f5f2',fontSize:12.5}}>
            <span style={{flex:1,fontWeight:600,color:sev==='critical'?'#d42d35':sev==='high'?'#ed8d00':sev==='medium'?'#1f74b3':'#616161',textTransform:'capitalize'}}>{sev}</span>
            <input type="number" value={mins} onChange={e=>setNested(settingsKey,sev,Number(e.target.value))} min={5} style={{width:80,border:'1px solid var(--border)',borderRadius:6,padding:'3px 8px',fontSize:12,outline:'none',textAlign:'right',fontFamily:'inherit'}}/>
            <span style={{width:60,textAlign:'right',color:'var(--text-muted)',fontSize:11}}>{(mins/60).toFixed(1)}h</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSection=()=>{
    switch(cat){
      case 'sla': return(<div>
        <SectionHeader icon="bi-clock-history" title="SLA Configuration" desc="Toggle SLA tracking and notifications. Per-queue thresholds (Zendesk / Jira / Onboarding / Offboarding / Amendments / Redlines / Workbench) live on the Team tab so leads can tune them directly."/>
        <Toggle label="Enable SLA tracking" desc="Show SLA countdown on tasks and trigger breach alerts" value={s.sla_enabled} onChange={v=>set('sla_enabled',v)}/>
        <Toggle label="Notify lead on SLA breach" desc="Automatically alert the team lead when a task breaches its SLA" value={s.sla_breach_notify_lead} onChange={v=>set('sla_breach_notify_lead',v)}/>
        <Toggle label="Notify admin on SLA breach" desc="Send a notification to the admin when any SLA is breached" value={s.sla_breach_notify_admin} onChange={v=>set('sla_breach_notify_admin',v)}/>
        <NumberInput label="SLA warning threshold" desc="Show warning when this % of SLA time has elapsed" value={s.sla_warning_pct} onChange={v=>set('sla_warning_pct',v)} min={50} max={95} suffix="%"/>
        <div style={{marginTop:16,marginBottom:8,padding:'12px 14px',borderRadius:12,background:'#fbfafc',border:'1px solid #efeaf5',fontSize:12,color:'var(--text-secondary)',lineHeight:1.5}}>
          <i className="bi-info-circle" style={{marginRight:6,color:'#7c3aed'}}/>
          Per-queue SLA windows are configured in <strong>Team → Queue SLA settings</strong> (business-day clock, Sat/Sun excluded). The legacy per-function table here was retired on 2026-05-01 — its values were never read at runtime.
        </div>
      </div>);

      case 'queue': return(<div>
        <SectionHeader icon="bi-inbox-fill" title="Queue & Task Management" desc="Control how tasks appear, age, and get assigned across your team."/>
        <NumberInput label="Aging threshold" desc="Minutes before a task is marked as AGING (yellow)" value={s.aging_warn_mins} onChange={v=>set('aging_warn_mins',v)} min={5} max={120} suffix="min"/>
        <NumberInput label="Hot threshold" desc="Minutes before a task is marked as HOT (orange)" value={s.aging_hot_mins} onChange={v=>set('aging_hot_mins',v)} min={15} max={240} suffix="min"/>
        <NumberInput label="Urgent threshold" desc="Minutes before a task is marked as URGENT (red)" value={s.aging_urgent_mins} onChange={v=>set('aging_urgent_mins',v)} min={30} max={480} suffix="min"/>
        <Select label="Auto-assignment mode" desc="How new tasks get assigned to agents" value={s.auto_assign_mode} onChange={v=>set('auto_assign_mode',v)} options={[{value:'manual',label:'Manual (lead assigns)'},{value:'round_robin',label:'Round Robin'},{value:'load_balance',label:'Load Balance (fewest open)'}]}/>
        <Select label="Default sort order" desc="How the queue is sorted when first loaded" value={s.queue_sort_default} onChange={v=>set('queue_sort_default',v)} options={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'priority',label:'By priority'},{value:'sla',label:'By SLA (most urgent)'}]}/>
        <NumberInput label="Max tasks per agent" desc="Warning threshold — highlight when an agent exceeds this count" value={s.max_tasks_per_agent} onChange={v=>set('max_tasks_per_agent',v)} min={5} max={100} suffix="tasks"/>
        <Toggle label="Show resolved tasks in queue" desc="Display today's resolved tasks at the bottom of the queue" value={s.show_resolved_in_queue} onChange={v=>set('show_resolved_in_queue',v)}/>
        <Toggle label="Enable bulk actions" desc="Allow selecting multiple tasks and performing batch operations" value={s.enable_bulk_actions} onChange={v=>set('enable_bulk_actions',v)}/>
        <Select label="Default task status" desc="Status assigned to newly created tasks" value={s.default_task_status} onChange={v=>set('default_task_status',v)} options={[{value:'new',label:'New'},{value:'open',label:'Open'},{value:'in_progress',label:'In Progress'}]}/>
        <Toggle label="Keyboard shortcuts" desc="Enable J/K navigation, R to reply, E to escalate, C to close" value={s.enable_keyboard_shortcuts} onChange={v=>set('enable_keyboard_shortcuts',v)}/>

        <div style={{marginTop:16,marginBottom:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>QUEUE ADVANCED</div>
        <Toggle label="Show inbound/outbound toggle" desc="Display the inbound vs outbound filter toggle at the top of the queue" value={s.queue_show_inbound_outbound_toggle} onChange={v=>set('queue_show_inbound_outbound_toggle',v)}/>
        <Toggle label="Show AI summary" desc="Display an AI-generated summary on the task detail panel" value={s.queue_show_ai_summary} onChange={v=>set('queue_show_ai_summary',v)}/>
        <Toggle label="Show quick reply" desc="Show the quick-reply bar at the bottom of task detail" value={s.queue_show_quick_reply} onChange={v=>set('queue_show_quick_reply',v)}/>
        <Toggle label="Show linked tickets" desc="Display related/linked tickets on the task detail panel" value={s.queue_show_linked_tickets} onChange={v=>set('queue_show_linked_tickets',v)}/>
        <Toggle label="Show offboarding tracker" desc="Display the offboarding progress tracker on offboarding tasks" value={s.queue_show_offboarding_tracker} onChange={v=>set('queue_show_offboarding_tracker',v)}/>

        <ToggleGroup label="Filter chips" desc="Which quick-filter chips appear above the queue" obj={s.queue_filter_chips} settingsKey="queue_filter_chips"/>
        <ToggleGroup label="Detail tabs" desc="Which tabs are available on the task detail panel" obj={s.queue_detail_tabs} settingsKey="queue_detail_tabs"/>

        <LongTextListEditor label="Reply templates" desc="Pre-written replies agents can insert with one click" items={s.queue_reply_templates} onChange={v=>setArr('queue_reply_templates',v)} placeholder="Type a reply template..."/>
        <StringListEditor label="Translate languages" desc="Languages available in the auto-translate dropdown" items={s.queue_translate_languages} onChange={v=>setArr('queue_translate_languages',v)}/>
      </div>);

      case 'sources': return(<div>
        <SectionHeader icon="bi-plug-fill" title="Source Integrations" desc="Enable or disable ticket sources and configure external tool URLs."/>
        {Object.entries(TOOLS).filter(([k])=>k!=='slack').map(([key,tool])=>(
          <div key={key} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid #f7f5f2'}}>
            <div style={{width:30,height:30,borderRadius:7,background:tool.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <i className={tool.icon} style={{color:tool.color,fontSize:12}}></i>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>{tool.label}</div>
              <input value={s.source_urls[key]||''} onChange={e=>{const v=e.target.value;if(v.trim().length>0&&/^(javascript|data|vbscript):/i.test(v.trim()))return;setNested('source_urls',key,v);}} style={{width:'100%',border:'1px solid #dedede',borderRadius:5,padding:'4px 8px',fontSize:11,color:'var(--text-secondary)',marginTop:3,boxSizing:'border-box',outline:'none'}} placeholder="Base URL"/>
            </div>
            <button onClick={()=>setNested('sources_enabled',key,!s.sources_enabled[key])} style={{width:40,height:22,borderRadius:11,border:'none',background:s.sources_enabled[key]?'var(--g)':'#dedede',cursor:'pointer',position:'relative',transition:'background .2s',flexShrink:0}}>
              <div style={{width:16,height:16,borderRadius:'50%',background:'var(--surface)',position:'absolute',top:3,left:s.sources_enabled[key]?21:3,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,.15)'}}></div>
            </button>
          </div>
        ))}
        <div style={{marginTop:12,padding:'10px 14px',background:'var(--surface-3)',borderRadius:8,fontSize:11.5,color:'var(--text-secondary)'}}>
          <i className="bi-info-circle" style={{marginRight:5}}></i>Disabling a source hides it from the queue. Existing tasks from that source remain but won't receive new tickets.
        </div>
      </div>);

      case 'zapier': return(<div style={{margin:'-20px -28px',height:'calc(100% + 40px)'}}><ZapierSettings addToast={addToast} tasks={tasks} setTasks={setTasks}/></div>);

      case 'live': return(<div style={{margin:'-20px -28px',height:'calc(100% + 40px)'}}><IntegrationsSettings addToast={addToast}/></div>);

      case 'ai': return(<div>
        <SectionHeader icon="bi-stars" title="AI & Suggested Replies" desc="Control how AI-generated reply suggestions behave for your team."/>
        <Toggle label="Enable AI suggested replies" desc="Show AI-drafted reply suggestions on each task" value={s.ai_replies_enabled} onChange={v=>set('ai_replies_enabled',v)}/>
        <Select label="Reply tone" desc="Default tone for generated replies" value={s.ai_reply_tone} onChange={v=>set('ai_reply_tone',v)} options={[{value:'professional',label:'Professional'},{value:'friendly',label:'Friendly & warm'},{value:'concise',label:'Concise & direct'}]}/>
        <Toggle label="Auto-translate" desc="Automatically translate replies to the employee's language when country differs" value={s.ai_auto_translate} onChange={v=>set('ai_auto_translate',v)}/>
        <Toggle label="Require manager review" desc="AI replies must be approved by a lead before sending" value={s.ai_require_review} onChange={v=>set('ai_require_review',v)}/>
        <TextArea label="Email signature template" desc="Used at the bottom of every outgoing reply. Use {agent_name} as placeholder." value={s.ai_signature_template} onChange={v=>set('ai_signature_template',v)} rows={3}/>
      </div>);

      case 'escalation': return(<div>
        <SectionHeader icon="bi-arrow-up-circle-fill" title="Escalation Rules" desc="Configure how escalations are routed and who can trigger them."/>
        <Toggle label="Auto-route escalations" desc="Automatically route escalations to the agent's team lead" value={s.escal_auto_route} onChange={v=>set('escal_auto_route',v)}/>
        <NumberInput label="Escalation SLA" desc="Maximum time for a lead to respond to an escalation" value={s.escal_sla_mins} onChange={v=>set('escal_sla_mins',v)} min={30} max={1440} suffix="min"/>
        <Select label="Who can escalate" desc="Which roles are allowed to escalate tickets to managers" value={s.escal_who_can} onChange={v=>set('escal_who_can',v)} options={[{value:'all',label:'All agents'},{value:'leads_only',label:'Leads & admin only'}]}/>
        <Toggle label="Notify via Slack" desc="Post escalation alerts to the team's Slack channel" value={s.escal_notify_slack} onChange={v=>set('escal_notify_slack',v)}/>
        <Toggle label="Require escalation note" desc="Agents must provide a reason when escalating a task" value={s.escal_require_note} onChange={v=>set('escal_require_note',v)}/>
        <Toggle label="Notify RM on critical" desc="Automatically notify the Regional Manager on critical escalations" value={s.escal_critical_notify_rm} onChange={v=>set('escal_critical_notify_rm',v)}/>

        <div style={{marginTop:16,marginBottom:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>ESCALATION CHAIN & SEVERITY</div>
        <StringListEditor label="Severity levels" desc="Ordered list of escalation severity levels (highest to lowest)" items={s.escal_severity_levels} onChange={v=>setArr('escal_severity_levels',v)}/>
        <StringListEditor label="Escalation chain" desc="Routing chain for escalations — each step is a role" items={s.escal_chain} onChange={v=>setArr('escal_chain',v)}/>
        <SeveritySlaTable label="Response SLA by severity" desc="Maximum response time per severity level" obj={s.escal_response_sla_by_severity} settingsKey="escal_response_sla_by_severity"/>
      </div>);

      case 'notif': return(<div>
        <SectionHeader icon="bi-bell-fill" title="Notifications" desc="Choose what triggers notifications and how they're delivered."/>
        <Toggle label="Sound notifications" desc="Play a sound when a new notification arrives" value={s.notif_sound} onChange={v=>set('notif_sound',v)}/>
        <Toggle label="Desktop push notifications" desc="Show browser push notifications for critical events" value={s.notif_desktop} onChange={v=>set('notif_desktop',v)}/>
        <div style={{marginTop:10,marginBottom:6,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>TRIGGER EVENTS</div>
        <Toggle label="New ticket received" desc="Notify when a new task is assigned to the queue" value={s.notif_new_ticket} onChange={v=>set('notif_new_ticket',v)}/>
        <Toggle label="SLA warning" desc="Notify when a task approaches its SLA deadline" value={s.notif_sla_warning} onChange={v=>set('notif_sla_warning',v)}/>
        <Toggle label="SLA breach" desc="Notify immediately when an SLA is breached" value={s.notif_sla_breach} onChange={v=>set('notif_sla_breach',v)}/>
        <Toggle label="New escalation" desc="Notify when a task is escalated to you or your team" value={s.notif_escalation} onChange={v=>set('notif_escalation',v)}/>
                <Select label="Email digest" desc="Summary email of all notifications" value={s.notif_digest} onChange={v=>set('notif_digest',v)} options={[{value:'off',label:'Off'},{value:'daily',label:'Daily digest'},{value:'weekly',label:'Weekly digest'}]}/>
        <div style={{marginTop:10,marginBottom:6,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>NOTIFICATION SOURCES</div>
        <Toggle label="Show Zendesk notifications" desc="Receive notifications from Zendesk tickets" value={s.notificationSources?.zendesk!==false} onChange={v=>setNested('notificationSources','zendesk',v)}/>
        <Toggle label="Show Gmail notifications" desc="Receive notifications from Gmail (off by default to reduce noise)" value={s.notificationSources?.gmail===true} onChange={v=>setNested('notificationSources','gmail',v)}/>
        <Toggle label="Show Jira notifications" desc="Receive notifications from Jira tickets" value={s.notificationSources?.jira!==false} onChange={v=>setNested('notificationSources','jira',v)}/>
        <Toggle label="Show Slack notifications" desc="Receive notifications from Slack messages" value={s.notificationSources?.slack!==false} onChange={v=>setNested('notificationSources','slack',v)}/>
        <Toggle label="Show Workbench notifications" desc="Receive notifications from Workbench updates" value={s.notificationSources?.workbench!==false} onChange={v=>setNested('notificationSources','workbench',v)}/>
        <Toggle label="Show Calendar notifications" desc="Receive notifications from Calendar events" value={s.notificationSources?.calendar!==false} onChange={v=>setNested('notificationSources','calendar',v)}/>
        <Toggle label="Show Looker alerts" desc="Receive notifications from Looker report alerts" value={s.notificationSources?.looker!==false} onChange={v=>setNested('notificationSources','looker',v)}/>
      </div>);

      case 'ui': return(<div>
        <SectionHeader icon="bi-palette-fill" title="UI & Display" desc="Customize the interface, default views, and visible columns."/>
        <Select label="Default view on login" desc="Which page loads when users open the app" value={s.default_view} onChange={v=>set('default_view',v)} options={[{value:'my-queue',label:'My Queue'},{value:'analytics',label:'Analytics'},{value:'team',label:'Team View'},{value:'alerts',label:'Alerts'}]}/>
        <Toggle label="Sidebar expanded by default" desc="Start with the sidebar open (vs collapsed icons)" value={s.sidebar_default_open} onChange={v=>set('sidebar_default_open',v)}/>
        <Toggle label="Show onboarding for new users" desc="Display the welcome wizard on first visit" value={s.show_onboarding_new_users} onChange={v=>set('show_onboarding_new_users',v)}/>
        <Toggle label="Compact row mode" desc="Reduce vertical padding in task rows for higher density" value={s.compact_rows} onChange={v=>set('compact_rows',v)}/>
        <div style={{marginTop:10,marginBottom:6,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>VISIBLE QUEUE COLUMNS</div>
        {[['ticket','Ticket ID'],['source','Source'],['function','Function'],['assignee','Assignee'],['country','Country'],['time','Time'],['status','Status']].map(([key,label])=>(
          <Toggle key={key} label={label} desc={`Show the ${label} column in the task queue`} value={s.queue_columns[key]} onChange={v=>setNested('queue_columns',key,v)}/>
        ))}
      </div>);

      case 'access': return(<div style={{margin:'-20px -28px',minHeight:'calc(100% + 40px)'}}>
        <AccessControlSettings accessTypes={accessTypes} setAccessTypes={setAccessTypes} userAccessMap={userAccessMap} setUserAccessMap={setUserAccessMap} addToast={addToast} user={user}/>
      </div>);

      case 'handovers': return(<div>
        <HandoverSettingsSection user={user} addToast={addToast}/>
      </div>);

      case 'brand': return(<div>
        <SectionHeader icon="bi-brush-fill" title="Branding" desc="Customize the app name and colors to match your org."/>
        <TextInput label="Application name" desc="Displayed in the header and browser tab" value={s.app_name} onChange={v=>set('app_name',v)} placeholder="HRX Ops Hub"/>
        <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
          <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>Primary color</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>Main accent color used across the app</div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <input type="color" value={s.primary_color} onChange={e=>set('primary_color',e.target.value)} style={{width:36,height:28,border:'1px solid #dedede',borderRadius:6,cursor:'pointer',padding:0}}/>
            <input value={s.primary_color} onChange={e=>set('primary_color',e.target.value)} style={{width:90,border:'1px solid #dedede',borderRadius:6,padding:'5px 8px',fontSize:12,fontFamily:'monospace',color:'var(--text-secondary)',outline:'none'}}/>
            <button onClick={()=>{set('primary_color','#1f74b3');set('brand_dark','#0a5a99');}} style={{border:'1px solid #dedede',borderRadius:6,padding:'5px 10px',fontSize:11,color:'var(--text-secondary)',cursor:'pointer',background:'var(--surface)'}}>Reset to Deel</button>
          </div>
        </div>
        <div style={{padding:'14px 0',borderBottom:'1px solid #e8e8e8'}}>
          <div style={{fontSize:14,fontWeight:500,color:'var(--text)'}}>Dark accent color</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:1,marginBottom:6}}>Used for hover states and emphasis</div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <input type="color" value={s.brand_dark} onChange={e=>set('brand_dark',e.target.value)} style={{width:36,height:28,border:'1px solid #dedede',borderRadius:6,cursor:'pointer',padding:0}}/>
            <input value={s.brand_dark} onChange={e=>set('brand_dark',e.target.value)} style={{width:90,border:'1px solid #dedede',borderRadius:6,padding:'5px 8px',fontSize:12,fontFamily:'monospace',color:'var(--text-secondary)',outline:'none'}}/>
          </div>
        </div>
        <div style={{marginTop:14,padding:'12px 14px',background:'var(--surface-3)',borderRadius:8}}>
          <div style={{fontSize:11.5,fontWeight:600,color:'var(--text-secondary)',marginBottom:8}}>PREVIEW</div>
          <div style={{display:'flex',gap:8}}>
            <div style={{height:32,padding:'0 16px',borderRadius:8,background:s.primary_color,color:'white',fontSize:12,fontWeight:700,display:'flex',alignItems:'center'}}>Primary Button</div>
            <div style={{height:32,padding:'0 16px',borderRadius:8,background:s.brand_dark,color:'white',fontSize:12,fontWeight:700,display:'flex',alignItems:'center'}}>Dark Accent</div>
            <div style={{height:32,padding:'0 16px',borderRadius:8,border:`2px solid ${s.primary_color}`,color:s.primary_color,fontSize:12,fontWeight:700,display:'flex',alignItems:'center',background:'var(--surface)'}}>Outline</div>
          </div>
        </div>
      </div>);

      case 'calendar': return(<div>
        <SectionHeader icon="bi-calendar3" title="Calendar & Deadlines" desc="Manage how deadlines and review dates are surfaced."/>
        <NumberInput label="Deadline warning threshold" desc="Days before a deadline when it starts showing as upcoming" value={s.deadline_warning_days} onChange={v=>set('deadline_warning_days',v)} min={1} max={30} suffix="days"/>
        <Select label="Default calendar view" desc="Initial view when opening the Deadlines tab" value={s.calendar_default_view} onChange={v=>set('calendar_default_view',v)} options={[{value:'week',label:'Week view'},{value:'month',label:'Month view'}]}/>
      </div>);

      case 'team': return(<div>
        <SectionHeader icon="bi-people-fill" title="Team Management" desc="Add, edit, or remove team members and manage role assignments."/>
        <div style={{border:'1px solid var(--border)',borderRadius:16,overflow:'hidden',marginBottom:14}}>
          <div style={{display:'flex',padding:'7px 12px',background:'var(--surface-3)',borderBottom:'1px solid #e8e8e8',fontSize:13,fontWeight:500,color:'var(--text-muted)'}}>
            <span style={{flex:1}}>Name</span><span style={{width:70}}>Role</span><span style={{width:60}}>Team</span><span style={{width:40}}>Co.</span><span style={{width:60,textAlign:'right'}}>Status</span>
          </div>
          {MEMBERS.map(m=>(
            <div key={m.id} style={{display:'flex',alignItems:'center',padding:'8px 12px',borderBottom:'1px solid #f7f5f2',fontSize:12.5}}>
              <div style={{flex:1,display:'flex',alignItems:'center',gap:8}}>
                <Avatar name={m.name} size={22}/>
                <span style={{fontWeight:600,color:'var(--text)'}}>{m.name}</span>
              </div>
              <span style={{width:70,fontSize:11,fontWeight:600,color:m.role==='admin'?'#c4b1f9':m.role==='team_lead'?'#ed8d00':'#616161',textTransform:'capitalize'}}>{m.role}</span>
              <span style={{width:60,fontSize:11,color:'var(--text-secondary)'}}>{m.team}</span>
              <span style={{width:40,fontSize:14}}>{FLAGS[m.country]||''}</span>
              <span style={{width:60,textAlign:'right'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:10,fontWeight:600,color:'#29811e'}}><span style={{width:5,height:5,borderRadius:'50%',background:'#29811e'}}></span>Active</span>
              </span>
            </div>
          ))}
        </div>
        <div style={{padding:'12px 14px',background:'#e8f5e3',borderRadius:8,border:'1px solid #c2eeb5',marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:'#29811e',marginBottom:4}}><i className="bi-info-circle" style={{marginRight:5}}></i>Team management</div>
          <div style={{fontSize:11.5,color:'#29811e'}}>In the production version, add/remove/edit members will sync with your HRIS or Workday directory. For now, team membership is configured at deployment.</div>
        </div>

        <div style={{marginTop:16,marginBottom:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>TEAM VIEW SETTINGS</div>
        <Toggle label="Show KPI cards" desc="Display key performance indicator cards at the top of the team view" value={s.team_show_kpi_cards} onChange={v=>set('team_show_kpi_cards',v)}/>
        <StringListEditor label="KPI cards" desc="Which KPI cards to display on the team view" items={s.team_kpi_cards} onChange={v=>setArr('team_kpi_cards',v)}/>
        <Toggle label="Show region filter" desc="Display the region dropdown filter on the team view" value={s.team_show_region_filter} onChange={v=>set('team_show_region_filter',v)}/>
        <StringListEditor label="Regions" desc="Available regions for the team view filter" items={s.team_regions} onChange={v=>setArr('team_regions',v)}/>
        <Toggle label="Show parental leave tracker" desc="Display the parental leave tracker widget" value={s.team_show_parental_leave_tracker} onChange={v=>set('team_show_parental_leave_tracker',v)}/>
        <Toggle label="Show EOD summary" desc="Display the end-of-day summary section" value={s.team_show_eod_summary} onChange={v=>set('team_show_eod_summary',v)}/>
        <TextArea label="EOD template" desc="Template for end-of-day summary. Use {resolved}, {open}, {breached} placeholders." value={s.team_eod_template} onChange={v=>set('team_eod_template',v)} rows={2}/>
      </div>);

      case 'kb': return(<div>
        <SectionHeader icon="bi-book-half" title="Knowledge Hub Configuration" desc="Manage what content appears in the Knowledge Hub tabs."/>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal',marginBottom:8}}>CONFIGURED ENTRIES</div>
          <div style={{border:'1px solid var(--border)',borderRadius:16,overflow:'hidden'}}>
            <div style={{display:'flex',padding:'10px 16px',background:'var(--surface-2)',borderBottom:'1px solid #e8e8e8',fontSize:13,fontWeight:500,color:'var(--text-muted)',letterSpacing:'normal'}}>
              <span style={{width:70}}>Type</span><span style={{flex:1}}>Name</span><span style={{width:70}}>Tab</span>
            </div>
            {KB_SEARCH_INDEX.map((entry,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',padding:'6px 12px',borderBottom:'1px solid #f7f5f2',fontSize:12}}>
                <span style={{width:70,fontSize:10.5,fontWeight:600,color:entry.type==='process'?'#29811e':entry.type==='report'?'#1f74b3':entry.type==='policy'?'#c4b1f9':entry.type==='sla'?'#ed8d00':'#616161',textTransform:'none'}}>{entry.type}</span>
                <span style={{flex:1,color:'var(--text-secondary)'}}>{entry.name}</span>
                <span style={{width:70,fontSize:11,color:'var(--text-muted)'}}>{entry.tab}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:'12px 14px',background:'#e8f0fe',borderRadius:8,border:'1px solid #c7e2fe',marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:'#1E40AF',marginBottom:4}}><i className="bi-lightbulb" style={{marginRight:5}}></i>Adding entries</div>
          <div style={{fontSize:11.5,color:'#1f74b3'}}>In production, this will integrate with Confluence/Notion. Add new processes, reports, policies, and channels here and they'll appear in the Knowledge Hub search.</div>
        </div>

        <div style={{marginTop:16,marginBottom:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>KNOWLEDGE HUB ADVANCED</div>
        <Toggle label="Show search tab" desc="Display the full-text search tab in the Knowledge Hub" value={s.kb_show_search_tab} onChange={v=>set('kb_show_search_tab',v)}/>
        <Toggle label="Show Ask Claude tab" desc="Display the AI-powered Ask Claude tab for natural language queries" value={s.kb_show_ask_claude_tab} onChange={v=>set('kb_show_ask_claude_tab',v)}/>
        <StringListEditor label="Claude categories" desc="Categories available in the Ask Claude query dropdown" items={s.kb_claude_categories} onChange={v=>setArr('kb_claude_categories',v)}/>
        <ObjectListEditor label="Quick links" desc="Shortcut links displayed at the top of the Knowledge Hub" items={s.kb_quick_links} onChange={v=>setArr('kb_quick_links',v)} fields={[{key:'label',label:'Label',flex:1},{key:'url',label:'URL',flex:2},{key:'icon',label:'Icon class',flex:1}]}/>
        <ObjectListEditor label="Country resources" desc="Per-country resource links displayed in the Knowledge Hub" items={s.kb_country_resources} onChange={v=>setArr('kb_country_resources',v)} fields={[{key:'country',label:'Country code',flex:1},{key:'label',label:'Label',flex:2},{key:'url',label:'URL',flex:2}]}/>
      </div>);

      case 'export': return(<div>
        <SectionHeader icon="bi-cloud-download-fill" title="Export & Reporting" desc="Automated exports, data retention, and scheduled reporting."/>
        <Toggle label="Automated exports" desc="Automatically export task data on a schedule" value={s.auto_export} onChange={v=>set('auto_export',v)}/>
        <Select label="Export frequency" desc="How often automated exports run" value={s.auto_export_freq} onChange={v=>set('auto_export_freq',v)} options={[{value:'daily',label:'Daily'},{value:'weekly',label:'Weekly'},{value:'monthly',label:'Monthly'}]}/>
        <Select label="Export format" desc="File format for exports" value={s.export_format} onChange={v=>set('export_format',v)} options={[{value:'csv',label:'CSV'},{value:'xlsx',label:'Excel (.xlsx)'}]}/>
        <NumberInput label="Data retention" desc="Days to keep resolved task data before archiving" value={s.data_retention_days} onChange={v=>set('data_retention_days',v)} min={30} max={365} suffix="days"/>
        <div style={{marginTop:14,display:'flex',gap:8}}>
          <button onClick={()=>{const rows=(tasks||[]).filter(t=>t.source!=='slack');const hdr='id,source,subject,status,assignee,country,type,received\n';const body=rows.map(t=>[t.id,t.source,'"'+t.subject.replace(/"/g,'""').replace(/^[=+@-]/,'\' $&')+'"',t.status,MEMBERS.find(m=>m.id===t.assigneeId)?.name||'',t.country,t.type,t.receivedAt].join(',')).join('\n');const d=document.createElement('a');d.setAttribute('href','data:text/csv;charset=utf-8,'+encodeURIComponent(hdr+body));d.setAttribute('download','ops-hub-tasks-export.csv');d.click();if(addToast)addToast('success','Exported',rows.length+' tasks exported to CSV');flash();}} style={{height:34,padding:'0 16px',borderRadius:8,border:'1px solid #dedede',background:'var(--surface)',color:'var(--text)',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}><i className="bi-download" style={{fontSize:11}}></i>Export All Tasks (CSV)</button>
          <button onClick={()=>{const all=(tasks||[]).filter(t=>t.source!=='slack');const res=all.filter(t=>t.status==='resolved');const opn=all.filter(t=>t.status!=='resolved');const body='metric,value\nTotal Tasks,'+all.length+'\nOpen,'+opn.length+'\nResolved,'+res.length+'\nIn Progress,'+all.filter(t=>t.status==='in_progress').length+'\nAlerts,'+all.filter(t=>t.isAlert&&t.status!=='resolved').length+'\n';const d=document.createElement('a');d.setAttribute('href','data:text/csv;charset=utf-8,'+encodeURIComponent(body));d.setAttribute('download','ops-hub-analytics-report.csv');d.click();if(addToast)addToast('success','Exported','Analytics report downloaded');flash();}} style={{height:34,padding:'0 16px',borderRadius:8,border:'1px solid #dedede',background:'var(--surface)',color:'var(--text)',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}><i className="bi-file-earmark-spreadsheet" style={{fontSize:11}}></i>Export Analytics Report</button>
        </div>
      </div>);

      // ── NEW SECTIONS ──

      case 'nav': return(<div>
        <SectionHeader icon="bi-layout-sidebar" title="Navigation & Sidebar" desc="Configure which views appear in the sidebar and their order."/>
        <ToggleGroup label="Enabled views" desc="Toggle which views appear in the sidebar navigation" obj={s.nav_enabled_views} settingsKey="nav_enabled_views"/>
        <StringListEditor label="Sidebar order" desc="Drag order of sidebar items (top to bottom)" items={s.nav_sidebar_order} onChange={v=>setArr('nav_sidebar_order',v)}/>
        <ToggleGroup label="Quick create items" desc="Which items appear in the quick-create (+) menu" obj={s.nav_quick_create_items} settingsKey="nav_quick_create_items"/>
        <Toggle label="Show ticker bar" desc="Display the live ticker bar at the top of the sidebar" value={s.nav_show_ticker} onChange={v=>set('nav_show_ticker',v)}/>
        <TextInput label="Global search shortcut" desc="Keyboard shortcut to open the global search" value={s.nav_global_search_shortcut} onChange={v=>set('nav_global_search_shortcut',v)} placeholder="⌘K"/>
      </div>);

      case 'briefing': return(<div>
        <SectionHeader icon="bi-speedometer2" title="Briefing Dashboard" desc="Configure what widgets and data appear on the Briefing page."/>
        <Toggle label="Show digest banner" desc="Display the daily digest summary banner at the top" value={s.briefing_show_digest_banner} onChange={v=>set('briefing_show_digest_banner',v)}/>
        <Toggle label="Show health score" desc="Display the team health score widget" value={s.briefing_show_health_score} onChange={v=>set('briefing_show_health_score',v)}/>

        <div style={{marginTop:12,marginBottom:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>HEALTH SCORE WEIGHTS</div>
        <NumberInput label="SLA weight" desc="Weight of SLA compliance in health score calculation" value={s.briefing_health_sla_weight} onChange={v=>set('briefing_health_sla_weight',v)} min={0} max={100} suffix="%"/>
        <NumberInput label="Resolution weight" desc="Weight of resolution rate in health score" value={s.briefing_health_resolution_weight} onChange={v=>set('briefing_health_resolution_weight',v)} min={0} max={100} suffix="%"/>
        <NumberInput label="Response weight" desc="Weight of first response time in health score" value={s.briefing_health_response_weight} onChange={v=>set('briefing_health_response_weight',v)} min={0} max={100} suffix="%"/>
        <NumberInput label="Capacity weight" desc="Weight of team capacity utilization in health score" value={s.briefing_health_capacity_weight} onChange={v=>set('briefing_health_capacity_weight',v)} min={0} max={100} suffix="%"/>

        <div style={{marginTop:12,marginBottom:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',letterSpacing:'normal'}}>WIDGETS</div>
        <Toggle label="Show KPI cards" desc="Display the KPI summary cards row" value={s.briefing_show_kpi_cards} onChange={v=>set('briefing_show_kpi_cards',v)}/>
        <Toggle label="Show admin actions" desc="Display admin quick-action buttons" value={s.briefing_show_admin_actions} onChange={v=>set('briefing_show_admin_actions',v)}/>
        <Toggle label="Show executive grid" desc="Display the executive summary grid" value={s.briefing_show_executive_grid} onChange={v=>set('briefing_show_executive_grid',v)}/>
        <StringListEditor label="Executive grid roles" desc="Which roles can see the executive grid" items={s.briefing_executive_grid_roles} onChange={v=>setArr('briefing_executive_grid_roles',v)}/>
        <Toggle label="Show volume trend" desc="Display the ticket volume trend chart" value={s.briefing_show_volume_trend} onChange={v=>set('briefing_show_volume_trend',v)}/>
        <Toggle label="Show start dates" desc="Display the upcoming start dates widget" value={s.briefing_show_start_dates} onChange={v=>set('briefing_show_start_dates',v)}/>
        <NumberInput label="Start dates lookahead" desc="How many days ahead to show upcoming start dates" value={s.briefing_start_dates_lookahead_days} onChange={v=>set('briefing_start_dates_lookahead_days',v)} min={1} max={90} suffix="days"/>
        <Toggle label="Show priority tasks" desc="Display the high-priority tasks widget" value={s.briefing_show_priority_tasks} onChange={v=>set('briefing_show_priority_tasks',v)}/>
        <Toggle label="Show recent activity" desc="Display the recent activity feed" value={s.briefing_show_recent_activity} onChange={v=>set('briefing_show_recent_activity',v)}/>
        <NumberInput label="Recent activity count" desc="Number of recent activity items to display" value={s.briefing_recent_activity_count} onChange={v=>set('briefing_recent_activity_count',v)} min={5} max={50} suffix="items"/>
      </div>);

      case 'slack': return(<div>
        <SectionHeader icon="bi-chat-left-text-fill" title="Slack Integration" desc="Configure how Slack channels and features are displayed."/>
        <Toggle label="Show escalations tab" desc="Display the escalations tab in the Slack view" value={s.slack_show_escalations_tab} onChange={v=>set('slack_show_escalations_tab',v)}/>
        <Toggle label="Show litigation tab" desc="Display the litigation tracking tab in the Slack view" value={s.slack_show_litigation_tab} onChange={v=>set('slack_show_litigation_tab',v)}/>
        <Select label="Litigation minimum role" desc="Minimum role required to access the litigation tab" value={s.slack_litigation_min_role} onChange={v=>set('slack_litigation_min_role',v)} options={[{value:'admin',label:'Admin only'},{value:'lead',label:'Lead & above'},{value:'agent',label:'All roles'}]}/>
        <Toggle label="AI suggested reply" desc="Show AI-suggested replies in Slack message threads" value={s.slack_ai_suggested_reply} onChange={v=>set('slack_ai_suggested_reply',v)}/>
        <StringListEditor label="Slack channels" desc="Monitored Slack channels (add channel names without #)" items={s.slack_channels} onChange={v=>setArr('slack_channels',v)}/>
      </div>);

      case 'alerts': return(<div>
        <SectionHeader icon="bi-exclamation-triangle-fill" title="Alerts" desc="Configure automatic alert detection and severity levels."/>
        <Toggle label="Auto-flag SLA breach" desc="Automatically create an alert when an SLA is breached" value={s.alerts_auto_flag_sla_breach} onChange={v=>set('alerts_auto_flag_sla_breach',v)}/>
        <Toggle label="Auto-flag escalation" desc="Automatically create an alert when a task is escalated" value={s.alerts_auto_flag_escalation} onChange={v=>set('alerts_auto_flag_escalation',v)}/>
        <StringListEditor label="Auto-flag keywords" desc="Tasks containing these keywords will automatically trigger an alert" items={s.alerts_auto_flag_keywords} onChange={v=>setArr('alerts_auto_flag_keywords',v)}/>
        <ToggleGroup label="Severity levels" desc="Toggle which severity levels are available for alerts" obj={s.alerts_severity_levels} settingsKey="alerts_severity_levels"/>
      </div>);

      case 'analytics': return(<div>
        <SectionHeader icon="bi-graph-up" title="Analytics" desc="Configure analytics dashboards, KPIs, and date ranges."/>
        <StringListEditor label="KPI cards" desc="Which KPI cards to show at the top of the analytics view" items={s.analytics_kpi_cards} onChange={v=>setArr('analytics_kpi_cards',v)}/>
        <StringListEditor label="Date ranges" desc="Available date range options (in days)" items={(s.analytics_date_ranges||[]).map(String)} onChange={v=>setArr('analytics_date_ranges',v.map(Number))}/>
        <Toggle label="Show region filter" desc="Display the region filter dropdown on analytics" value={s.analytics_show_region_filter} onChange={v=>set('analytics_show_region_filter',v)}/>
        <ToggleGroup label="Analytics tabs" desc="Which tabs are visible in the analytics view" obj={s.analytics_tabs} settingsKey="analytics_tabs"/>
        <StringListEditor label="Agent columns" desc="Columns displayed in the agent performance table" items={s.analytics_agent_columns} onChange={v=>setArr('analytics_agent_columns',v)}/>
      </div>);

      case 'projects': return(<div>
        <SectionHeader icon="bi-kanban-fill" title="Projects" desc="Configure project tracking features, types, and statuses."/>
        <Toggle label="Enable projects" desc="Show the Projects module in the sidebar" value={s.projects_enabled} onChange={v=>set('projects_enabled',v)}/>
        <StringListEditor label="Sub-tabs" desc="Tabs available within the Projects view" items={s.projects_sub_tabs} onChange={v=>setArr('projects_sub_tabs',v)}/>
        <StringListEditor label="Project types" desc="Available project type categories" items={s.projects_types} onChange={v=>setArr('projects_types',v)}/>
        <StringListEditor label="Project statuses" desc="Available status values for projects" items={s.projects_statuses} onChange={v=>setArr('projects_statuses',v)}/>
        <Toggle label="Show milestones" desc="Display milestone tracking on project detail" value={s.projects_show_milestones} onChange={v=>set('projects_show_milestones',v)}/>
        <Toggle label="Show linked tasks" desc="Display linked queue tasks on the project detail view" value={s.projects_show_linked_tasks} onChange={v=>set('projects_show_linked_tasks',v)}/>
      </div>);

      case 'announcements': return(<div>
        <SectionHeader icon="bi-broadcast-pin" title="Announcements" desc="Configure announcement features, targeting, and permissions."/>
        <Toggle label="Enable announcements" desc="Show the Announcements module in the sidebar" value={s.announcements_enabled} onChange={v=>set('announcements_enabled',v)}/>
        <StringListEditor label="Tabs" desc="Available tabs within the Announcements view" items={s.announcements_tabs} onChange={v=>setArr('announcements_tabs',v)}/>
        <Toggle label="Show seen count" desc="Display how many people have seen each announcement" value={s.announcements_show_seen_count} onChange={v=>set('announcements_show_seen_count',v)}/>
        <StringListEditor label="Targeting scopes" desc="Available targeting scopes when composing announcements" items={s.announcements_targeting_scopes} onChange={v=>setArr('announcements_targeting_scopes',v)}/>
        <Select label="Minimum compose role" desc="Minimum role required to create announcements" value={s.announcements_min_compose_role} onChange={v=>set('announcements_min_compose_role',v)} options={[{value:'admin',label:'Admin only'},{value:'lead',label:'Lead & above'},{value:'agent',label:'All roles'}]}/>
        <Toggle label="Allow pinning" desc="Allow admins to pin announcements to the top of the list" value={s.announcements_allow_pinning} onChange={v=>set('announcements_allow_pinning',v)}/>
      </div>);

      case 'danger': return(<div>
        <SectionHeader icon="bi-exclamation-octagon-fill" title="Danger Zone" desc="Destructive actions. These cannot be undone."/>
        <div style={{border:'1px solid var(--red-mid)',borderRadius:'var(--radius-lg)',background:'var(--red-light)',padding:'var(--space-4)'}}>
        <div style={{border:'1px solid #FCA5A5',borderRadius:16,padding:16,marginBottom:12,background:'#ffe2de'}}>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:'#991B1B'}}>Reset all settings to defaults</div>
              <div style={{fontSize:11.5,color:'#B91C1C',marginTop:2}}>This will revert every setting on this page to its factory default.</div>
            </div>
            <button onClick={()=>{setSettings(DEFAULT_SETTINGS);try{localStorage.removeItem('ops_hub_settings');}catch(e){}flash();}} style={{height:32,padding:'0 14px',borderRadius:128,border:'1px solid #FCA5A5',background:'var(--surface)',color:'#d42d35',fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0}}>Reset All</button>
          </div>
        </div>
        <div style={{border:'1px solid #FCA5A5',borderRadius:16,padding:16,marginBottom:12,background:'#ffe2de'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:'#991B1B'}}>Clear all resolved tasks</div>
              <div style={{fontSize:11.5,color:'#B91C1C',marginTop:2}}>Remove all resolved tasks from history. Active tasks are unaffected.</div>
            </div>
            <button onClick={()=>{if(!perms?.isAdmin)return;if(setTasks){const cnt=(tasks||[]).filter(t=>t.status==='resolved').length;setTasks(prev=>prev.filter(t=>t.status!=='resolved'));if(addToast)addToast('success','Cleared',cnt+' resolved tasks removed');}flash();}} style={{height:32,padding:'0 14px',borderRadius:128,border:'1px solid #FCA5A5',background:'var(--surface)',color:'#d42d35',fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0}}>Clear Resolved</button>
          </div>
        </div>
        <div style={{border:'1px solid #FCA5A5',borderRadius:16,padding:16,background:'#ffe2de'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:'#991B1B'}}>Reset onboarding for all users</div>
              <div style={{fontSize:11.5,color:'#B91C1C',marginTop:2}}>Force the welcome wizard to show again for every user on next login.</div>
            </div>
            <button onClick={()=>{try{localStorage.removeItem('ops_hub_onboarded');}catch(e){}flash();}} style={{height:32,padding:'0 14px',borderRadius:128,border:'1px solid #FCA5A5',background:'var(--surface)',color:'#d42d35',fontSize:12,fontWeight:700,cursor:'pointer',flexShrink:0}}>Reset Onboarding</button>
          </div>
        </div>
        </div>{/* end danger wrapper */}
      </div>);

      default: return null;
    }
  };

  // Filter sidebar groups based on search term
  const filteredGroups=searchTerm.trim()
    ? SETTINGS_GROUPS.map(group=>{
        const term=searchTerm.toLowerCase();
        const filteredItems=group.items.filter(item=>item.label.toLowerCase().includes(term)||item.id.toLowerCase().includes(term));
        if(filteredItems.length||group.label.toLowerCase().includes(term)) return {...group,items:filteredItems.length?filteredItems:group.items};
        return null;
      }).filter(Boolean)
    : SETTINGS_GROUPS;

  if(!perms?.canView('settings')) return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <PageHeader icon="bi-gear-fill" iconBg="#f7f5f2" iconColor="#616161" title="Settings" subtitle="Admin access required"/>
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <EmptyState icon="bi-shield-lock" title="Admin access required" subtitle="Only admin users can modify application settings. Contact Mohamed Tantawy for access."/>
      </div>
    </div>
  );

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <PageHeader icon="bi-gear-fill" iconBg="#f7f5f2" iconColor="#616161" title="Settings"
        subtitle="Admin control panel — configure every aspect of HRX Ops Hub"
        right={saved&&(
          <div style={{display:'flex',alignItems:'center',gap:6,color:'white',fontSize:12,fontWeight:700,animation:'fadeIn .3s ease',background:'#29811e',borderRadius:20,padding:'4px 14px'}}>
            <i className="bi-check-circle-fill" style={{fontSize:13}}></i>Settings saved
          </div>
        )}
      />
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        {/* Category nav */}
        <div style={{width:220,borderRight:'1px solid #e8e8e8',overflowY:'auto',background:'var(--surface)',flexShrink:0,padding:'8px',display:'flex',flexDirection:'column'}}>
          {/* Search bar */}
          <div style={{padding:'4px 4px 8px',position:'sticky',top:0,background:'var(--surface)',zIndex:1}}>
            <div style={{position:'relative'}}>
              <i className="bi-search" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'var(--text-muted)',pointerEvents:'none'}}></i>
              <input
                value={searchTerm}
                onChange={e=>setSearchTerm(e.target.value)}
                placeholder="Search settings..."
                style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px 7px 30px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)',boxSizing:'border-box',background:'var(--surface-2)'}}
              />
              {searchTerm&&(
                <button onClick={()=>setSearchTerm('')} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,padding:0,lineHeight:1}}>&times;</button>
              )}
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            {filteredGroups.map(group=>(
              <div key={group.label}>
                <div style={{color:'var(--text-muted)',fontSize:13,letterSpacing:'normal',textTransform:'none',fontWeight:600,padding:'12px 12px 4px'}}>
                  {group.label}
                </div>
                {group.items.map(c=>(
                  <button key={c.id} onClick={()=>setCat(c.id)} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 14px',border:'none',background:cat===c.id?'#f7f5f2':'transparent',borderRadius:8,color:group.isDanger?'var(--red)':cat===c.id?'#1b1b1b':'#616161',fontSize:13,cursor:'pointer',fontWeight:cat===c.id||group.isDanger?600:400,textAlign:'left',transition:'all .12s',marginBottom:2}}>
                    <i className={c.icon} style={{fontSize:14,width:18,textAlign:'center',color:group.isDanger?'var(--red)':cat===c.id?'#1b1b1b':'#9e9e9e'}}></i>{c.label}
                  </button>
                ))}
              </div>
            ))}
            {filteredGroups.length===0&&(
              <div style={{padding:'20px 12px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>No settings match "{searchTerm}"</div>
            )}
          </div>
        </div>
        {/* Content */}
        <div key={cat} className="fade-in" style={{flex:1,overflowY:'auto',padding:'20px 28px'}}>
          {renderSection()}
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
