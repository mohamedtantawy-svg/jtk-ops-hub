import { apiFetch } from './api';

export async function login(email) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Validate current session and return user profile.
 *
 * Always skips the impersonation header — `/me`'s job is to return the
 * ACTOR (the human signed in via JWT), never the impersonated target.
 * Without this, refreshing while impersonating writes the target's
 * profile back into `user` state, the App.jsx impersonation restore
 * effect then sees an actor mismatch and wipes sessionStorage — so the
 * NEXT refresh has nothing to restore from and the view drops back to
 * the actor's own scope (Kristina's 2026-05-12 bug report).
 */
export async function fetchMe() {
  return apiFetch('/me', { skipImpersonation: true });
}
