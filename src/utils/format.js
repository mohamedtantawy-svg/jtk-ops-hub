// ── Cross-app formatting helpers ───────────────────────────────────────────
// Created 2026-05-21 — UI audit U153 / U154. Centralises number and
// relative-time formatting so consumers don't reinvent the rules. Adopting
// these in new code; existing inline formatters can be migrated over time.

/**
 * Format a number with comma thousand-separators using the user's locale.
 * Never displays scientific notation; never drops decimals on integers.
 * Falls back to the raw value for null/undefined/non-numeric input so callers
 * don't need to guard.
 *
 * Examples:
 *   formatCount(1736) → "1,736"
 *   formatCount(0)    → "0"
 *   formatCount(null) → ""
 *   formatCount('not a number') → "not a number"
 */
export function formatCount(n) {
  if (n == null) return '';
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  try {
    return n.toLocaleString('en-US');
  } catch {
    // Fallback for environments without Intl
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}

/**
 * Format an ISO timestamp (or Date) as a human-readable relative time.
 * Compact resolution: "just now" / "Nm ago" / "Nh ago" / "Nd ago" / full date
 * after 30 days. Used by HrHubView and elsewhere — moving toward a single
 * helper for cross-surface consistency.
 *
 * Examples:
 *   formatRelativeTime('2026-05-21T22:30:00Z') (now=22:32) → "2m ago"
 *   formatRelativeTime(Date.now() - 90 * 86_400_000)       → "21 Feb 2026"
 *   formatRelativeTime(null)                                → ""
 */
export function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
