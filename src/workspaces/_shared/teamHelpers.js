// Helpers shared by every workspace's Team view. Pure functions, no React.

// Derive a human-readable name from a @deel.com email.
//   aaron.roche@deel.com → "Aaron Roche"
//   john.smith.jr@deel.com → "John Smith Jr"
//   Kamvam@deel.com → "Kamvam"
export function deriveName(email) {
  if (!email) return '';
  const local = email.split('@')[0] || email;
  const parts = local
    .replace(/_/g, '.')
    .split('.')
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join(' ') || email;
}

// Two-letter avatar initials from a name.
//   "Aaron Roche" → "AR"
//   "Kamvam" → "KA"
export function deriveInitials(name) {
  if (!name) return '··';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.slice(0, 2) || '··').toUpperCase();
}

// Stable color per email — used for avatar tints. Hash-based so the same
// person always gets the same color across views and sessions.
const AVATAR_PALETTE = [
  { bg: '#fff3e0', fg: '#9c5b00' }, // amber
  { bg: '#e0f2fe', fg: '#0369a1' }, // sky
  { bg: '#dcfce7', fg: '#15803d' }, // emerald
  { bg: '#f3e8ff', fg: '#7c3aed' }, // purple
  { bg: '#fee2e2', fg: '#b91c1c' }, // rose
  { bg: '#fef9c3', fg: '#854d0e' }, // yellow
  { bg: '#cffafe', fg: '#0e7490' }, // cyan
  { bg: '#fce7f3', fg: '#be185d' }, // pink
];

export function avatarColors(email) {
  if (!email) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// Given a roster {email → managerEmail|null}, build a tree:
//   {
//     roots: [email, ...]              // people whose manager is null or external to the team
//     reportsByManager: {email: [...]} // for each email, list of direct reports
//   }
export function buildOrgTree(roster) {
  const reportsByManager = {};
  const allEmails = new Set(Object.keys(roster));
  const roots = [];

  for (const [email, manager] of Object.entries(roster)) {
    if (manager && allEmails.has(manager)) {
      if (!reportsByManager[manager]) reportsByManager[manager] = [];
      reportsByManager[manager].push(email);
    } else {
      roots.push(email);
    }
  }

  // Sort everything alphabetically by derived name for predictable display.
  const sortByName = arr => arr.slice().sort((a, b) => deriveName(a).localeCompare(deriveName(b)));
  for (const k of Object.keys(reportsByManager)) {
    reportsByManager[k] = sortByName(reportsByManager[k]);
  }

  return { roots: sortByName(roots), reportsByManager };
}

// Total reports (direct + indirect) under a given email. Used to show
// org-tree leaf counts so users can decide what to expand.
export function countDescendants(email, reportsByManager) {
  const direct = reportsByManager[email];
  if (!direct || !direct.length) return 0;
  let count = direct.length;
  for (const child of direct) count += countDescendants(child, reportsByManager);
  return count;
}
