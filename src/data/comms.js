// ── Canonical audience enum ──────────────────────────────────────────────────
// Used by compose UI, API validation, and FE filter. Matches member.team
// via matchesAudience() below (AMERICAS = NAM ∪ LATAM; LATAM+NAM members
// match all three). `leaders` is the manager-role rollup (TL + RM + Admin).
// `group` is a sentinel — when target='group', the actual audience lives
// in a separate `target_group_id` column and resolves via mention_group.
export const AUDIENCES = ['global','emea','apac','americas','nam','latam','leaders'];
export const AUDIENCE_LABELS = {
  global:'Global (All Teams)', emea:'EMEA', apac:'APAC',
  americas:'Americas (NAM + LATAM)', nam:'NAM', latam:'LATAM',
  leaders:'Leaders (TLs + Regional Managers + Admins)',
};

// Roles that count as "leaders" — kept here so the FE matcher and the
// server-side audience filter use the same definition.
const LEADER_ROLES = new Set(['team_lead', 'regional_manager', 'admin']);

function isLeader(memberLike) {
  if (!memberLike || typeof memberLike !== 'object') return false;
  const access = String(memberLike.access || memberLike.role || '').toLowerCase();
  return LEADER_ROLES.has(access);
}

/**
 * Match an announcement's region/role audience against a viewer.
 *
 * Accepts either a member object (preferred — needed for the `leaders`
 * audience because that check reads `member.access`) or a raw team string
 * for legacy call sites. Tag-group targets are NOT matched here — those
 * go through `matchesGroupTarget` because they need a side-channel of
 * group membership data the FE has to load explicitly.
 */
export function matchesAudience(target, memberOrTeam) {
  if (!target || target === 'all' || target === 'global') return true;
  const t = String(target).toLowerCase();
  // `group` is a sentinel — actual fan-out is via target_group_id and is
  // resolved by `matchesGroupTarget`. Return false here so a regional /
  // role check doesn't accidentally short-circuit a group target.
  if (t === 'group') return false;
  const team = typeof memberOrTeam === 'string'
    ? String(memberOrTeam || '').toLowerCase()
    : String(memberOrTeam?.team || '').toLowerCase();
  if (t === 'leaders') {
    return typeof memberOrTeam === 'object' && memberOrTeam !== null && isLeader(memberOrTeam);
  }
  if (!team) return false;
  if (t === team) return true;
  // LATAM + NAM members match both regions AND americas
  if (team === 'latam + nam' && (t === 'nam' || t === 'latam' || t === 'americas')) return true;
  if (t === 'americas' && (team === 'nam' || team === 'latam' || team === 'latam + nam')) return true;
  return false;
}

/**
 * Match a tag-group-targeted announcement against a viewer. The caller
 * passes a Map<groupId, Set<lowercasedEmail>> (loaded once via
 * /api/v1/mention-groups). Returns true when the viewer's email is in
 * the targeted group's member set. The caller is responsible for handing
 * a stable map across renders so this function never has to do I/O.
 */
export function matchesGroupTarget(targetGroupId, viewerEmail, groupMembersById) {
  if (!targetGroupId || !viewerEmail || !groupMembersById) return false;
  const set = groupMembersById.get(String(targetGroupId));
  if (!set) return false;
  return set.has(String(viewerEmail).toLowerCase());
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
