export const PROJECT_TYPES = [
  { id:'onboarding',          label:'Onboarding',           icon:'bi-person-check' },
  { id:'offboarding',         label:'Offboarding',          icon:'bi-person-dash' },
  { id:'compliance',          label:'Compliance',           icon:'bi-shield-check' },
  { id:'process_improvement', label:'Process Improvement',  icon:'bi-arrow-repeat' },
  { id:'reporting',           label:'Reporting',            icon:'bi-clipboard-data' },
  { id:'audit',               label:'Audit',                icon:'bi-search' },
  { id:'other',               label:'Other',                icon:'bi-folder' },
];

export const PROJECT_STATUSES = [
  { id:'planning',   label:'Planning',   color:'#616161', bg:'#f2f2f2' },
  { id:'active',     label:'Active',     color:'#7c5cbf', bg:'#f3eff8' },
  { id:'on_hold',    label:'On Hold',    color:'#ed8d00', bg:'#fff8e6' },
  { id:'completed',  label:'Completed',  color:'#1f74b3', bg:'#e8f0fe' },
  { id:'cancelled',  label:'Cancelled',  color:'#616161', bg:'#f2f2f2' },
];

// Live projects come from /api/v1/projects via App.jsx — this used to seed
// five demo rows ("Q2 EMEA Onboarding", "Global Compliance Audit 2026", etc.)
// so the project page wasn't empty in screenshots, but they leaked into the
// Briefing tile count and into anything that imported INITIAL_PROJECTS
// directly. Result: a fresh tenant saw "1 project assigned" but the projects
// view (which reads from the API state) was empty — the tile pointed at a
// row that wasn't there. Empty seed = no demo bleed.
export const INITIAL_PROJECTS = [];
