// Helper to extract authenticated user info from request headers
// These headers are set by middleware.js after JWT verification

// `x-user-name` is URL-encoded by the middleware because HTTP header
// values are ByteStrings (Latin-1 only), and a display name with a
// non-Latin-1 character (e.g. Polish `Ś`) would otherwise throw
// `TypeError: Cannot convert argument to a ByteString…` and lock the
// user out of every API call. Decode defensively — if the value
// doesn't round-trip (e.g. a JWT issued by an older build still has
// the raw name in some odd path), fall back to the raw string so the
// request keeps working. The header is best-effort context only; the
// canonical identity is x-user-email (skill rule #4).
function _safeDecodeName(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string' || raw.length === 0) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function getAuthUser(req) {
  const id = req.headers.get('x-user-id');
  const email = req.headers.get('x-user-email');
  const role = req.headers.get('x-user-role');
  const name = _safeDecodeName(req.headers.get('x-user-name'));
  return { id: id ? Number(id) : null, email, role, name };
}

export function requireRole(req, ...allowedRoles) {
  const user = getAuthUser(req);
  // Email is the canonical identity (skill rule #4: never use members.id
  // for matching). Middleware has already verified the JWT signature +
  // expiry, so reaching this point means the session is valid. The old
  // `!user.id` gate falsely rejected admins/RMs whose JWT carried
  // `sub: 0` — the DB-less fallback path used when a user is in
  // team_member_overrides but not yet in the members table (common
  // immediately after the 2026-05-06 recovery, or for any new hire added
  // via the Team tab before the members row is seeded).
  if (!user.email) {
    return { authorized: false, status: 401, error: 'Unauthorized' };
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return { authorized: false, status: 403, error: 'Insufficient permissions' };
  }
  return { authorized: true, user };
}
