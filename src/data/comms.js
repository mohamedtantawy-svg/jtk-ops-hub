// ── Canonical audience enum ──────────────────────────────────────────────────
// Used by compose UI, API validation, and FE filter. Matches member.team
// via matchesAudience() below (AMERICAS = NAM ∪ LATAM; LATAM+NAM members
// match all three).
export const AUDIENCES = ['global','emea','apac','americas','nam','latam'];
export const AUDIENCE_LABELS = {
  global:'Global (All Teams)', emea:'EMEA', apac:'APAC',
  americas:'Americas (NAM + LATAM)', nam:'NAM', latam:'LATAM',
};

export function matchesAudience(target, memberTeam) {
  if (!target || target === 'all' || target === 'global') return true;
  const t = String(target).toLowerCase();
  const team = String(memberTeam || '').toLowerCase();
  if (!team) return false;
  if (t === team) return true;
  // LATAM + NAM members match both regions AND americas
  if (team === 'latam + nam' && (t === 'nam' || t === 'latam' || t === 'americas')) return true;
  if (t === 'americas' && (team === 'nam' || team === 'latam' || team === 'latam + nam')) return true;
  return false;
}

// ── Sound presets for popup announcements ────────────────────────────────────
// Each preset is a list of [freqHz, startOffsetSec, durationSec] tuples.
// null freqs = silent.
export const SOUND_PRESETS = {
  chime: { label:'Chime (default)',  tones:[[523.25,0,0.3],[659.25,0.15,0.35]] },
  alert: { label:'Alert',            tones:[[880,0,0.15],[660,0.18,0.15],[880,0.36,0.2]] },
  kudos: { label:'Kudos',            tones:[[523.25,0,0.2],[659.25,0.18,0.2],[783.99,0.36,0.28]] },
  none:  { label:'Silent',           tones:null },
};

export const COMMS_TYPES={
  alert:    {label:'Alert',        icon:'bi-exclamation-triangle-fill', color:'#d42d35',bg:'#ffe2de',border:'#FCA5A5'},
  announce: {label:'Announcement', icon:'bi-megaphone-fill',            color:'#ed8d00',bg:'#fff8e6',border:'#FCD34D'},
  update:   {label:'Update',       icon:'bi-arrow-up-circle-fill',      color:'#1f74b3',bg:'#e8f0fe',border:'#c7e2fe'},
  guidance: {label:'Guidance',     icon:'bi-book-half',                 color:'#c4b1f9',bg:'#f3eff8',border:'#c4b1f9'},
  kudos:    {label:'Kudos',        icon:'bi-trophy-fill',               color:'#29811e',bg:'#F0FDF4',border:'#c2eeb5'},
};

export const ALL_AGENT_IDS=[1,2,3,4,5,6,7,8,9,10,16,17,18,19,20];

export const INITIAL_COMMS=[
  {id:'COM-001',type:'alert',title:'HRX Continuity & Redundancy Plan',body:'Following a review of our regional coverage gaps, we have updated the HRX Continuity & Redundancy Plan for Q2 2026. Key changes include: new escalation paths for APAC after-hours cases, updated backup coverage assignments for urgent termination cases, and revised handoff summary requirements for Manager On Call shifts.\n\nAll agents must review the updated SOP linked below and confirm they understand the new escalation paths for their region.',author:{id:14,name:'Mohamed Tantawy'},sentAt:'2026-03-16',target:'all',status:'sent',acks:[1,2,5,7,9,10],link:'https://letsdeel.slack.com/archives/C03SXFLNUSW/p1773399353629199',priority:'high',isPopup:true,imageUrl:'',reactions:{},comments:[],linkedIds:['COM-004']},
  {id:'COM-002',type:'guidance',title:'Seniority Date Updates Beyond 5 Years — New Guidance',body:'Effective immediately, all seniority date update requests that fall beyond the 5-year mark must follow the new verification workflow outlined in SOP section 3.2. This requires a secondary approval from the Country Owner before the update is processed in Workday.\n\nCases that were processed under the old process in the last 30 days do not need to be retroactively reviewed.',author:{id:11,name:'Alex Thompson'},sentAt:'2026-03-17',target:'all',status:'sent',acks:[1,2,3,4,5,6,7,8,9,10],link:'https://letsdeel.slack.com/archives/C03SXFLNUSW/p1773646745521129',priority:'medium',isPopup:false,imageUrl:'',reactions:{},comments:[],linkedIds:[]},
  {id:'COM-003',type:'update',title:'C-Level Job Titles Support for EOR Quotes',body:'We now support C-Level job titles in EOR quotes. Previously, Director and above titles required manual intervention from the legal team. As of this week, the Deel platform can auto-generate compliant EOR quotes for C-Suite roles across all supported countries.\n\nIf you encounter any edge cases or country-specific issues with this new flow, please flag them in the #hrx-gm-urgent-assist-internal channel.',author:{id:14,name:'Mohamed Tantawy'},sentAt:'2026-03-18',target:'all',status:'sent',acks:[1,3,4,6,8],link:'https://letsdeel.slack.com/archives/C022DN1FLA3/p1773754346473409',priority:'medium',isPopup:false,imageUrl:'',reactions:{},comments:[],linkedIds:['COM-006']},
  {id:'COM-004',type:'alert',title:'Slack DMs & Channels Handling — Effective Now',body:'A new policy governing how HRX agents handle Slack DMs and channel messages is effective immediately. Key points:\n\n• Do not resolve tickets directly over Slack DMs — always create a Zendesk or Workbench ticket\n• All client-facing Slack responses must be mirrored in the relevant ticket within 2 hours\n• Escalations initiated via Slack must be re-filed through the proper escalation workflow in the tool\n\nNon-compliance will be flagged in QA reviews.',author:{id:14,name:'Mohamed Tantawy'},sentAt:'2026-03-19',target:'all',status:'sent',acks:[2,5,9],link:'https://letsdeel.slack.com/archives/C03SXFLNUSW/p1773832486817389',priority:'high',isPopup:true,imageUrl:'',reactions:{},comments:[],linkedIds:['COM-001']},
  {id:'COM-005',type:'kudos',title:'Shoutout: André Martins — Mass Termination Case',body:'Huge shoutout to André Martins for his outstanding support during a sensitive mass termination situation this week. André stayed calm under pressure, coordinated flawlessly with Legal and Payroll, and ensured every impacted employee received clear, empathetic communication on time.\n\nThis is exactly the kind of ownership and professionalism that makes HRX exceptional. Thank you André! \u{1F3C6}',author:{id:14,name:'Mohamed Tantawy'},sentAt:'2026-03-10',target:'all',status:'sent',acks:[1,2,3,4,5,6,7,8,9,10],link:'',priority:'low',isPopup:false,imageUrl:'',reactions:{},comments:[],linkedIds:[]},
  {id:'COM-006',type:'update',title:'Legal AI Amendment Assessment — Now Live',body:'The Legal AI Amendment Assessment feature is now live across all EOR contracts. This tool provides instant AI-powered assessment of amendment requests before they are sent to the legal team, significantly reducing back-and-forth.\n\nAll agents handling EOR amendments should test this on their next 3 cases and provide feedback via the form linked below. Adoption will be tracked as part of the Q2 productivity metrics.',author:{id:12,name:'Jenny Liu'},sentAt:'2026-03-12',target:'all',status:'sent',acks:[1,4,6,8,10],link:'https://letsdeel.slack.com/archives/C022DN1FLA3/p1773222110061589',priority:'medium',isPopup:false,imageUrl:'',reactions:{},comments:[],linkedIds:['COM-003']},
  {id:'COM-007',type:'guidance',title:'Termination Ownership Transfer to HRX — Process Update',body:'Following the recent org change, ownership of all standard termination cases is now transitioning from the Country Owners to HRX. This is effective for all new cases opened after March 24, 2026.\n\nExisting cases in flight remain with the current owner until resolution. A full handover SOP is being prepared and will be shared by end of week. In the meantime, please do not pick up new termination cases unless explicitly assigned.',author:{id:13,name:'Carlos Reyes'},sentAt:'2026-02-24',target:'all',status:'sent',acks:[1,2,3,4,5,6,7,8,9,10],link:'https://letsdeel.slack.com/archives/C022DN1FLA3/p1771833610219379',priority:'high',isPopup:false,imageUrl:'',reactions:{},comments:[],linkedIds:[]},
  {id:'COM-008',type:'announce',title:'Q2 APAC Coverage Realignment — Draft',body:'We are planning a realignment of APAC coverage windows for Q2. The proposed changes affect after-hours coverage for AU and SG. Please review the draft schedule attached and submit feedback by March 25.\n\nThis is a draft — not effective yet.',author:{id:12,name:'Jenny Liu'},sentAt:'',target:'APAC',status:'draft',acks:[],link:'',priority:'medium',isPopup:false,imageUrl:'',reactions:{},comments:[],linkedIds:[]},
];
