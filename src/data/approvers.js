// ---------------------------------------------------------------------------
// Announcement Approval Queue — approver roster.
// These emails can review, approve, reject, and publish announcement
// requests submitted by any user. They can also send announcements
// directly (bypassing the queue).
// Shared by frontend (Approval Queue UI) and backend (/announcement-requests).
// ---------------------------------------------------------------------------

export const APPROVER_EMAILS_LIST = [
  'mohamed.tantawy@deel.com',
  'kristina.fomina@deel.com',
  'sarah.suge@deel.com',
  'megan.lawrence@deel.com',
  'laura.llopislopez@deel.com',
  'melissa.capicchiano@deel.com',
];

export const APPROVER_EMAILS = new Set(
  APPROVER_EMAILS_LIST.map((e) => e.toLowerCase())
);

/**
 * Case-insensitive membership check.
 * Accepts undefined/null safely and returns false.
 */
export function isApprover(email) {
  if (!email || typeof email !== 'string') return false;
  return APPROVER_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Users who can publish announcements without the approval queue.
 * - Approvers (explicit roster above)
 * - Admins (role-based, typically RMs / leadership)
 */
export function canDirectPublish(user) {
  if (!user) return false;
  if (isApprover(user.email)) return true;
  const role = String(user.role || '').toLowerCase();
  return role === 'admin' || role === 'regional_manager';
}
