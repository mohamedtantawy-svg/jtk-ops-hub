// ── Command Center API client ───────────────────────────────────────────────
// Thin apiFetch wrappers for the executive Command Center endpoints. Same shape
// as the other service modules (hrHubApi, orgApi) so call sites read alike.
//
// apiFetch resolves the parsed JSON body on 2xx and THROWS on non-2xx with
// `err.status` carrying the HTTP code (skill mistake #49) — treat the return as
// data and the throw as the error path. A 403 here means the caller isn't an
// exec viewer (canViewCommandCenter); the view renders a "no access" state.

import { apiFetch } from './api';

// Live department roster + org-wide totals. Exec-gated server-side.
export async function getCommandCenterOverview() {
  return apiFetch('/command-center/overview');
}

// Per-department composite Health Score + components + org roll-up.
export async function getCommandCenterHealth() {
  return apiFetch('/command-center/health');
}

// Cross-department HR Hub ageing (fresh / at-risk / breached) + urgent.
export async function getCommandCenterSla() {
  return apiFetch('/command-center/sla');
}

// Org-wide 30-day created-vs-resolved daily series + per-dept totals.
export async function getCommandCenterVolume() {
  return apiFetch('/command-center/volume');
}

// Open Leader Alerts / Urgent Assists / Escalations per dept (+ critical).
export async function getCommandCenterRisk() {
  return apiFetch('/command-center/risk');
}

// Headcount, vacancies, coverage (out today / upcoming), throughput per dept.
export async function getCommandCenterPeople() {
  return apiFetch('/command-center/people');
}

// Cross-department load proxy (open work per person, banded) per dept.
export async function getCommandCenterCapacity() {
  return apiFetch('/command-center/capacity');
}
