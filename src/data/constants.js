export const TOOLS={
  zendesk:       {label:'Zendesk',        icon:'bi-headset',          color:'#29811e',bg:'#e8f5e9',dot:'#29811e'},
  jira:          {label:'Jira',           icon:'bi-kanban',           color:'#1565c0',bg:'#e3f2fd',dot:'#1565c0'},
  workbench:     {label:'Workbench',      icon:'bi-tools',            color:'#29811e',bg:'#e8f5e9',dot:'#29811e'},
  onboarding:    {label:'Onboarding',     icon:'bi-person-plus-fill', color:'#1f74b3',bg:'#e8f0fe',dot:'#1f74b3'},
  offboarding:   {label:'Offboarding',    icon:'bi-person-dash-fill', color:'#d42d35',bg:'#ffe2de',dot:'#d42d35'},
  amendments:    {label:'Amendments',     icon:'bi-pencil-square',    color:'#ed8d00',bg:'#fff8e6',dot:'#ed8d00'},
  redlines:      {label:'Redlines',       icon:'bi-file-earmark-diff',color:'#7c3aed',bg:'#f3eff8',dot:'#7c3aed'},
  incentive_plans:{label:'Incentive Plans',icon:'bi-cash-coin',        color:'#0e7490',bg:'#ecfeff',dot:'#0e7490'},
  active_eor:    {label:'Active EOR',     icon:'bi-person-check-fill', color:'#0f766e',bg:'#f0fdfa',dot:'#0f766e'},
  immigration_tasks:{label:'Immigration Tasks',icon:'bi-passport-fill',color:'#0369a1',bg:'#e0f2fe',dot:'#0369a1'},
  immigration_cases:{label:'Immigration Cases',icon:'bi-folder-fill',   color:'#0c4a6e',bg:'#e0f2fe',dot:'#0c4a6e'},
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
export const QUEUE_SOURCES=['zendesk','jira','workbench','onboarding','offboarding','amendments','redlines','gmail'];
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
  // ISO 3166-1 alpha-2 codes — canonical (Deel API returns these)
  GB:'🇬🇧',US:'🇺🇸',DE:'🇩🇪',FR:'🇫🇷',NL:'🇳🇱',SG:'🇸🇬',BR:'🇧🇷',AU:'🇦🇺',AE:'🇦🇪',CA:'🇨🇦',
  PH:'🇵🇭',IN:'🇮🇳',JP:'🇯🇵',KR:'🇰🇷',ID:'🇮🇩',TH:'🇹🇭',MY:'🇲🇾',VN:'🇻🇳',CN:'🇨🇳',TW:'🇹🇼',HK:'🇭🇰',
  MX:'🇲🇽',CO:'🇨🇴',AR:'🇦🇷',CL:'🇨🇱',PE:'🇵🇪',
  ES:'🇪🇸',IT:'🇮🇹',PT:'🇵🇹',PL:'🇵🇱',RO:'🇷🇴',CZ:'🇨🇿',HU:'🇭🇺',SE:'🇸🇪',NO:'🇳🇴',DK:'🇩🇰',FI:'🇫🇮',IE:'🇮🇪',AT:'🇦🇹',CH:'🇨🇭',BE:'🇧🇪',GR:'🇬🇷',
  ZA:'🇿🇦',NG:'🇳🇬',KE:'🇰🇪',EG:'🇪🇬',GH:'🇬🇭',
  IL:'🇮🇱',SA:'🇸🇦',TR:'🇹🇷',PK:'🇵🇰',
  // Additional ISO codes common in Deel
  NZ:'🇳🇿',LU:'🇱🇺',LT:'🇱🇹',LV:'🇱🇻',EE:'🇪🇪',SK:'🇸🇰',SI:'🇸🇮',HR:'🇭🇷',BG:'🇧🇬',RS:'🇷🇸',
  UA:'🇺🇦',BY:'🇧🇾',GE:'🇬🇪',AM:'🇦🇲',AZ:'🇦🇿',KZ:'🇰🇿',UZ:'🇺🇿',
  QA:'🇶🇦',KW:'🇰🇼',BH:'🇧🇭',OM:'🇴🇲',JO:'🇯🇴',LB:'🇱🇧',
  UY:'🇺🇾',EC:'🇪🇨',CR:'🇨🇷',PA:'🇵🇦',DO:'🇩🇴',GT:'🇬🇹',PY:'🇵🇾',BO:'🇧🇴',
  BD:'🇧🇩',LK:'🇱🇰',NP:'🇳🇵',MM:'🇲🇲',KH:'🇰🇭',
  TZ:'🇹🇿',UG:'🇺🇬',ET:'🇪🇹',SN:'🇸🇳',RW:'🇷🇼',MA:'🇲🇦',TN:'🇹🇳',
  CY:'🇨🇾',MT:'🇲🇹',IS:'🇮🇸',
  PR:'🇵🇷',TT:'🇹🇹',JM:'🇯🇲',
  // 2026-05-19 spec coverage — the spec list Mohamed approved. These were
  // missing from FLAGS so MultiCountryPicker (which builds options from
  // Object.keys(FLAGS)) never offered them; the Team-tab Countries column
  // and other code-only displays were the symptom.
  AL:'🇦🇱',AQ:'🇦🇶',BA:'🇧🇦',BW:'🇧🇼',CI:'🇨🇮',CM:'🇨🇲',HN:'🇭🇳',KG:'🇰🇬',
  MD:'🇲🇩',ME:'🇲🇪',MG:'🇲🇬',MK:'🇲🇰',MN:'🇲🇳',MO:'🇲🇴',MR:'🇲🇷',MU:'🇲🇺',
  MW:'🇲🇼',MZ:'🇲🇿',NA:'🇳🇦',NI:'🇳🇮',RU:'🇷🇺',SR:'🇸🇷',SV:'🇸🇻',XK:'🇽🇰',ZM:'🇿🇲',
  // Operational codes from countryOwners.js that pre-date the spec
  AD:'🇦🇩',BZ:'🇧🇿',JE:'🇯🇪',MC:'🇲🇨',
  // Legacy alias — our codebase used "UK" but ISO uses "GB"
  UK:'🇬🇧',
};
// Reverse lookup: country name → code (for APIs that return full names like "Philippines")
const COUNTRY_NAME_TO_CODE={
  'United Kingdom':'GB','United States':'US','Germany':'DE','France':'FR','Netherlands':'NL',
  'Singapore':'SG','Brazil':'BR','Australia':'AU','United Arab Emirates':'AE','Canada':'CA',
  'Philippines':'PH','India':'IN','Japan':'JP','South Korea':'KR','Indonesia':'ID',
  'Thailand':'TH','Malaysia':'MY','Vietnam':'VN','China':'CN','Taiwan':'TW','Hong Kong':'HK',
  'Mexico':'MX','Colombia':'CO','Argentina':'AR','Chile':'CL','Peru':'PE',
  'Spain':'ES','Italy':'IT','Portugal':'PT','Poland':'PL','Romania':'RO','Czech Republic':'CZ',
  'Czechia':'CZ','Hungary':'HU','Sweden':'SE','Norway':'NO','Denmark':'DK','Finland':'FI',
  'Ireland':'IE','Austria':'AT','Switzerland':'CH','Belgium':'BE','Greece':'GR',
  'South Africa':'ZA','Nigeria':'NG','Kenya':'KE','Egypt':'EG','Ghana':'GH',
  'Israel':'IL','Saudi Arabia':'SA','Turkey':'TR','Türkiye':'TR','Pakistan':'PK',
  'New Zealand':'NZ','Luxembourg':'LU','Lithuania':'LT','Latvia':'LV','Estonia':'EE',
  'Slovakia':'SK','Slovenia':'SI','Croatia':'HR','Bulgaria':'BG','Serbia':'RS',
  'Ukraine':'UA','Belarus':'BY','Georgia':'GE','Armenia':'AM','Azerbaijan':'AZ',
  'Kazakhstan':'KZ','Uzbekistan':'UZ',
  'Qatar':'QA','Kuwait':'KW','Bahrain':'BH','Oman':'OM','Jordan':'JO','Lebanon':'LB',
  'Uruguay':'UY','Ecuador':'EC','Costa Rica':'CR','Panama':'PA','Dominican Republic':'DO',
  'Guatemala':'GT','Paraguay':'PY','Bolivia':'BO',
  'Bangladesh':'BD','Sri Lanka':'LK','Nepal':'NP','Myanmar':'MM','Cambodia':'KH',
  'Tanzania':'TZ','Uganda':'UG','Ethiopia':'ET','Senegal':'SN','Rwanda':'RW','Morocco':'MA','Tunisia':'TN',
  'Cyprus':'CY','Malta':'MT','Iceland':'IS',
  'Puerto Rico':'PR','Trinidad and Tobago':'TT','Jamaica':'JM',
  // 2026-05-19 spec additions — every name in Mohamed's approved list must
  // resolve. Includes alternate spellings APIs send back (e.g. "Moldova,
  // Republic of", "Russian Federation", "Macau", "Côte d'Ivoire").
  'Albania':'AL','Antarctica':'AQ','Bosnia and Herzegovina':'BA','Botswana':'BW',
  'Cameroon':'CM',"Cote D'Ivoire":'CI',"Côte d'Ivoire":'CI',"Cote d'Ivoire":'CI',
  'El Salvador':'SV','Honduras':'HN','Kosovo':'XK','Kyrgyzstan':'KG',
  'Macao':'MO','Macau':'MO','Madagascar':'MG','Malawi':'MW',
  'Mauritania':'MR','Mauritius':'MU','Moldova':'MD','Moldova, Republic of':'MD',
  'Mongolia':'MN','Montenegro':'ME','Mozambique':'MZ','Namibia':'NA',
  'Nicaragua':'NI','North Macedonia':'MK','Russia':'RU','Russian Federation':'RU',
  'Suriname':'SR','Zambia':'ZM',
  // Operational codes from countryOwners.js that pre-date the spec
  'Andorra':'AD','Belize':'BZ','Jersey':'JE','Monaco':'MC',
};
// Reverse lookup: code → name
const COUNTRY_CODE_TO_NAME = Object.fromEntries(
  Object.entries(COUNTRY_NAME_TO_CODE).map(([name, code]) => [code, name])
);
// Canonical display overrides — the reverse map of COUNTRY_NAME_TO_CODE
// hits the FIRST entry per code in insertion order. For codes with multiple
// names (e.g. "Côte d'Ivoire" vs "Cote D'Ivoire"), pin the form we want
// users to see.
COUNTRY_CODE_TO_NAME['UK'] = 'United Kingdom';
COUNTRY_CODE_TO_NAME['CI'] = "Côte d'Ivoire";
COUNTRY_CODE_TO_NAME['CZ'] = 'Czech Republic';
COUNTRY_CODE_TO_NAME['MO'] = 'Macao';
COUNTRY_CODE_TO_NAME['RU'] = 'Russia';
COUNTRY_CODE_TO_NAME['TR'] = 'Turkey';
COUNTRY_CODE_TO_NAME['MD'] = 'Moldova';

// ── Dynamic fallback — Intl.DisplayNames ─────────────────────────────────
// Any ISO-2 code we haven't enumerated above (e.g. a brand-new country an
// upstream feed starts shipping) resolves through the platform's built-in
// region table instead of degrading to the raw code. Guarantees no data
// loss: if Deel admin / Zendesk / Workbench surfaces a new country, the
// queue cell renders the proper name immediately. Cached as a singleton
// because instantiating Intl.DisplayNames is non-trivial.
let _displayNamesEN = null;
try {
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    _displayNamesEN = new Intl.DisplayNames(['en'], { type: 'region' });
  }
} catch (_) {
  _displayNamesEN = null;
}
/**
 * Resolve a country code ("PH") to full name ("Philippines").
 * Resolution order:
 *   1. Explicit map (handles overrides like "Côte d'Ivoire", "Czech Republic")
 *   2. Intl.DisplayNames (any valid ISO-2 → localised English region name)
 *   3. Fall through to the input string (already a name, or truly unknown)
 */
export function getCountryName(country) {
  if (!country) return '';
  if (COUNTRY_CODE_TO_NAME[country]) return COUNTRY_CODE_TO_NAME[country];
  const upper = String(country).toUpperCase();
  if (COUNTRY_CODE_TO_NAME[upper]) return COUNTRY_CODE_TO_NAME[upper];
  if (_displayNamesEN && /^[A-Z]{2}$/.test(upper)) {
    try {
      const name = _displayNamesEN.of(upper);
      // Intl returns the input code (e.g. "ZZ") when it doesn't recognise it
      if (name && name !== upper) return name;
    } catch (_) { /* swallow */ }
  }
  return country;
}
/**
 * Resolve a country string (code like "PH" or name like "Philippines") to a flag emoji.
 * For any valid 2-letter ISO code, generates the flag dynamically using regional indicators.
 */
export function getFlag(country) {
  if (!country) return '';
  // Direct code match
  if (FLAGS[country]) return FLAGS[country];
  // Name → code lookup
  const code = COUNTRY_NAME_TO_CODE[country];
  if (code && FLAGS[code]) return FLAGS[code];
  // Case-insensitive fallback
  const upper = country.toUpperCase();
  if (FLAGS[upper]) return FLAGS[upper];
  // Dynamic flag from any 2-letter ISO code using regional indicator symbols
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) {
    return String.fromCodePoint(...[...upper].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  return '';
}
export const DEFAULT_SOURCE_URLS={zendesk:'https://deel.zendesk.com',jira:'https://deel.atlassian.net',gmail:'https://mail.google.com',slack:'https://app.slack.com/client/deel',workbench:'https://workbench.deel.com',calendar:'https://calendar.google.com',looker:'https://deel.looker.com'};
// SLA_MINS are the default thresholds (in minutes). Runtime values come from settings.sla_thresholds.
export const SLA_MINS={'Access Issue':240,'Document Request':240,'Offboarding':1440,'Anomaly Alert':120,'Payment Issue':480,'Benefits':1440,'Leave Request':720,'Leave Query':1440,'Scheduling':1440,'Compensation':2880,'Promotion':1440,'Recruitment':1440,'Record Update':1440,'Equipment':2880,'Policy Query':1440,'Onboarding':2880,'Immigration':1440,'Expenses':480,'Amendment':1440,'Compliance':2880};
