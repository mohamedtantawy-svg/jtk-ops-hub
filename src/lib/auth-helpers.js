// Helper to extract authenticated user info from request headers
// These headers are set by middleware.js after JWT verification

export function getAuthUser(req) {
  const id = req.headers.get('x-user-id');
  const email = req.headers.get('x-user-email');
  const role = req.headers.get('x-user-role');
  const name = req.headers.get('x-user-name');
  return { id: id ? Number(id) : null, email, role, name };
}

export function requireRole(req, ...allowedRoles) {
  const user = getAuthUser(req);
  if (!user.id) {
    return { authorized: false, status: 401, error: 'Unauthorized' };
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return { authorized: false, status: 403, error: 'Insufficient permissions' };
  }
  return { authorized: true, user };
}
