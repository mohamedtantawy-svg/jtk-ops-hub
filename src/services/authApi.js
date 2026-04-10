import { apiFetch } from './api';

export async function login(email) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Exchange a Google ID token credential for an app JWT */
export async function loginWithGoogle(credential) {
  return apiFetch('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
}

export async function fetchMe() {
  return apiFetch('/me');
}
