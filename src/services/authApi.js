import { apiFetch } from './api';

export async function login(email) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function fetchMe() {
  return apiFetch('/me');
}
