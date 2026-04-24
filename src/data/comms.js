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
