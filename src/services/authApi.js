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
  // `/me` blocks user-keyed LS reads on first paint; if the upstream is
  // slow we don't want to wait the full 90s default — the rest of the
  // app stays in a half-rendered state while it hangs. 10s is plenty
  // for one DB read; if it times out, the caller surfaces a session
  // error and the user can refresh.
  return apiFetch('/me', { skipImpersonation: true, timeoutMs: 10_000 });
}
