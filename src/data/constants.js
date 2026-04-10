export const TOOLS={
  zendesk:       {label:'Zendesk',        icon:'bi-headset',          color:'#29811e',bg:'#e8f5e9',dot:'#29811e'},
  jira:          {label:'Jira',           icon:'bi-kanban',           color:'#1565c0',bg:'#e3f2fd',dot:'#1565c0'},
  workbench:     {label:'Workbench',      icon:'bi-tools',            color:'#29811e',bg:'#e8f5e9',dot:'#29811e'},
  onboarding:    {label:'Onboarding',     icon:'bi-person-plus-fill', color:'#1f74b3',bg:'#e8f0fe',dot:'#1f74b3'},
  offboarding:   {label:'Offboarding',    icon:'bi-person-dash-fill', color:'#d42d35',bg:'#ffe2de',dot:'#d42d35'},
  change_request:{label:'Change Request', icon:'bi-pencil-square',    color:'#ed8d00',bg:'#fff8e6',dot:'#ed8d00'},
  gmail:         {label:'Gmail',          icon:'bi-envelope',         color:'#c62828',bg:'#fce4ec',dot:'#c62828'},
  slack:         {label:'Slack',          icon:'bi-chat-dots',        color:'#c4b1f9',bg:'#f3eff8',dot:'#c4b1f9'},
  calendar:      {label:'Calendar',       icon:'bi-calendar3',        color:'#1565c0',bg:'#e3f2fd',dot:'#1565c0'},
  looker:        {label:'Looker',         icon:'bi-graph-up',         color:'#ed8d00',bg:'#fff8e6',dot:'#ed8d00'},
  bamboohr:      {label:'BambooHR',      icon:'bi-person-badge',     color:'#73c41d',bg:'#f0f9e0',dot:'#73c41d'},
  greenhouse:    {label:'Greenhouse',    icon:'bi-flower1',          color:'#3b8427',bg:'#e8f5e9',dot:'#3b8427'},
  notion:        {label:'Notion',        icon:'bi-journal-text',     color:'#1b1b1b',bg:'#f7f5f2',dot:'#1b1b1b'},
  custom:        {label:'Custom',        icon:'bi-puzzle',           color:'#616161',bg:'#f3f3f3',dot:'#616161'},
};
// Source types shown as queue filters (excludes slack, calendar, looker)
export const QUEUE_SOURCES=['zendesk','jira','workbench','onboarding','offboarding','change_request','gmail'];
export const STATUSES={
  new:        {label:'New',        color:'#1f74b3',bg:'#e8f0fe'},
  in_progress:{label:'In Progress',color:'#e65100',bg:'#fff3e0'},
  waiting:    {label:'Pause',      color:'#616161',bg:'#f3f3f3'},
  escalated:  {label:'Escalated',  color:'#d42d35',bg:'#fef2f2'},
  resolved:   {label:'Resolved',   color:'#29811e',bg:'#e8f5e9'},
};
export const FUNCTIONS={
  'Onboarding':      {label:'Onboarding',   color:'#1f74b3',bg:'#f3eff8'},
  'Offboarding':     {label:'Offboarding',  color:'#d42d35',bg:'#ffe2de'},
  'Benefits':        {label:'Benefits',     color:'#c4b1f9',bg:'#f3eff8'},
  'Leave Request':   {label:'Leave Mgmt',   color:'#1f74b3',bg:'#e8f0fe'},
  'Leave Query':     {label:'Leave Mgmt',   color:'#1f74b3',bg:'#e8f0fe'},
  'Document Request':{label:'Documentation',color:'#616161',bg:'#f7f5f2'},
  'Payment Issue':   {label:'Payroll',      color:'#29811e',bg:'#e8f5e3'},
  'Immigration':     {label:'Immigration',  color:'#ed8d00',bg:'#fff8e6'},
  'Access Issue':    {label:'IT Access',    color:'#1f74b3',bg:'#e8f0fe'},
  'Policy Query':    {label:'HR Policy',    color:'#bebebe',bg:'#f7f5f2'},
  'Expenses':        {label:'Expenses',     color:'#ed5e2a',bg:'#fff3ee'},
  'Scheduling':      {label:'Scheduling',   color:'#1A73E8',bg:'#e8f0fe'},
  'Anomaly Alert':   {label:'Data Alert',   color:'#d42d35',bg:'#ffe2de'},
  'Compensation':    {label:'Compensation', color:'#0052CC',bg:'#EFF4FF'},
  'Promotion':       {label:'Promotions',   color:'#c4b1f9',bg:'#f3eff8'},
  'Recruitment':     {label:'Recruitment',  color:'#d42d35',bg:'#FDF2F8'},
  'Record Update':   {label:'Records',      color:'#29811e',bg:'#F0FDFA'},
  'Equipment':       {label:'Equipment',    color:'#1b1b1b',bg:'#f7f5f2'},
  'Amendment':       {label:'Amendment',   color:'#0369a1',bg:'#e0f2fe'},
  'Compliance':      {label:'Compliance',  color:'#7c3aed',bg:'#f5f0ff'},
};
export const FLAGS={
  // Original
  UK:'🇬🇧',US:'🇺🇸',DE:'🇩🇪',FR:'🇫🇷',NL:'🇳🇱',SG:'🇸🇬',BR:'🇧🇷',AU:'🇦🇺',AE:'🇦🇪',CA:'🇨🇦',
  // Asia-Pacific
  PH:'🇵🇭',IN:'🇮🇳',JP:'🇯🇵',KR:'🇰🇷',ID:'🇮🇩',TH:'🇹🇭',MY:'🇲🇾',VN:'🇻🇳',CN:'🇨🇳',TW:'🇹🇼',HK:'🇭🇰',
  // Latin America
  MX:'🇲🇽',CO:'🇨🇴',AR:'🇦🇷',CL:'🇨🇱',PE:'🇵🇪',
  // Europe
  ES:'🇪🇸',IT:'🇮🇹',PT:'🇵🇹',PL:'🇵🇱',RO:'🇷🇴',CZ:'🇨🇿',HU:'🇭🇺',SE:'🇸🇪',NO:'🇳🇴',DK:'🇩🇰',FI:'🇫🇮',IE:'🇮🇪',AT:'🇦🇹',CH:'🇨🇭',BE:'🇧🇪',GR:'🇬🇷',
  // Africa
  ZA:'🇿🇦',NG:'🇳🇬',KE:'🇰🇪',EG:'🇪🇬',GH:'🇬🇭',
  // Middle East & South Asia
  IL:'🇮🇱',SA:'🇸🇦',TR:'🇹🇷',PK:'🇵🇰',
};
export const DEFAULT_SOURCE_URLS={zendesk:'https://deel.zendesk.com',jira:'https://deel.atlassian.net',gmail:'https://mail.google.com',slack:'https://app.slack.com/client/deel',workbench:'https://workbench.deel.com',calendar:'https://calendar.google.com',looker:'https://deel.looker.com'};
export const SLA_MINS={'Access Issue':240,'Document Request':240,'Offboarding':1440,'Anomaly Alert':120,'Payment Issue':480,'Benefits':1440,'Leave Request':720,'Leave Query':1440,'Scheduling':1440,'Compensation':2880,'Promotion':1440,'Recruitment':1440,'Record Update':1440,'Equipment':2880,'Policy Query':1440,'Onboarding':2880,'Immigration':1440,'Expenses':480,'Amendment':1440,'Compliance':2880};
