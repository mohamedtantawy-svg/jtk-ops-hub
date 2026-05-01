// ── Frontend API client for all external integrations ────────────────────────
// Mirrors the backend proxy routes at /api/v1/integrations/*
import { apiFetch } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// Status — check which integrations are configured
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchIntegrationStatus() {
  return apiFetch('/integrations/status');
}

// ─────────────────────────────────────────────────────────────────────────────
// Deel Admin API
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchDeelHealth() {
  return apiFetch('/integrations/deel/health');
}

export async function fetchDeelPeople({ search, email, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (email) params.set('email', email);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString();
  return apiFetch(`/integrations/deel/people${qs ? `?${qs}` : ''}`);
}

export async function fetchDeelContracts({ search, statuses, types, limit, offset, id } = {}) {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (search) params.set('search', search);
  if (statuses) params.set('statuses', statuses);
  if (types) params.set('types', types);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString();
  return apiFetch(`/integrations/deel/contracts${qs ? `?${qs}` : ''}`);
}

export async function fetchDeelTimeOff({ contract_id, status, limit } = {}) {
  const params = new URLSearchParams();
  if (contract_id) params.set('contract_id', contract_id);
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/integrations/deel/time-off${qs ? `?${qs}` : ''}`);
}

export async function fetchDeelOrg() {
  return apiFetch('/integrations/deel/org');
}

export async function fetchDeelOffboarding({ bustCache } = {}) {
  const qs = bustCache ? '?bust=1' : '';
  // Server caps the scan at 45s and falls back to a `_warming` empty payload
  // beyond that — give the FE a slightly higher 60s ceiling so we capture
  // the warming response cleanly instead of timing out the network request.
  return apiFetch(`/integrations/deel/offboarding${qs}`, { timeoutMs: 60_000 });
}

export async function fetchDeelOnboarding({ limit, offset } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString();
  return apiFetch(`/integrations/deel/onboarding${qs ? `?${qs}` : ''}`);
}

export async function fetchDeelOnboardingPaused() {
  return apiFetch('/integrations/deel/onboarding-paused');
}

export async function fetchDeelAmendments({ statuses, bustCache } = {}) {
  const params = new URLSearchParams();
  if (statuses) params.set('statuses', statuses);
  if (bustCache) params.set('bust', '1');
  const qs = params.toString();
  return apiFetch(`/integrations/deel/amendments${qs ? `?${qs}` : ''}`);
}

export async function fetchDeelRedlines({ status, bustCache } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (bustCache) params.set('bust', '1');
  const qs = params.toString();
  return apiFetch(`/integrations/deel/redlines${qs ? `?${qs}` : ''}`);
}

export async function fetchDeelWorkbench({ limit, bustCache } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (bustCache) params.set('bust', '1');
  const qs = params.toString();
  // Server caps the scan at 30s; give the FE 45s so warming responses arrive
  // intact instead of being aborted by the default 90s ceiling.
  return apiFetch(`/integrations/deel/workbench${qs ? `?${qs}` : ''}`, { timeoutMs: 45_000 });
}

export async function fetchDeelIncentivePlans({ status, bustCache } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (bustCache) params.set('bust', '1');
  const qs = params.toString();
  return apiFetch(`/integrations/deel/incentive-plans${qs ? `?${qs}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Jira
// ─────────────────────────────────────────────────────────────────────────────
export async function searchJiraIssues(jql, { maxResults, startAt, fields } = {}) {
  return apiFetch('/integrations/jira/search', {
    method: 'POST',
    body: JSON.stringify({ jql, maxResults, startAt, fields }),
  });
}

export async function fetchJiraIssue(key) {
  return apiFetch(`/integrations/jira/issues?key=${encodeURIComponent(key)}`);
}

export async function createJiraIssue({ summary, description, issueType, projectKey }) {
  return apiFetch('/integrations/jira/issues', {
    method: 'POST',
    body: JSON.stringify({ summary, description, issueType, projectKey }),
  });
}

export async function addJiraComment(issueKey, comment) {
  return apiFetch('/integrations/jira/issues', {
    method: 'POST',
    body: JSON.stringify({ action: 'comment', issueKey, comment }),
  });
}

export async function fetchJiraProjects({ maxResults, startAt } = {}) {
  const params = new URLSearchParams();
  if (maxResults) params.set('maxResults', String(maxResults));
  if (startAt) params.set('startAt', String(startAt));
  const qs = params.toString();
  return apiFetch(`/integrations/jira/projects${qs ? `?${qs}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchSlackChannels() {
  return apiFetch('/integrations/slack/channels');
}

export async function fetchSlackChannelHistory(channelId, { limit, oldest, latest, thread_ts } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (oldest) params.set('oldest', oldest);
  if (latest) params.set('latest', latest);
  if (thread_ts) params.set('thread_ts', thread_ts);
  const qs = params.toString();
  return apiFetch(`/integrations/slack/channels/${channelId}/history${qs ? `?${qs}` : ''}`);
}

export async function sendSlackMessage(channelId, text, { thread_ts, blocks } = {}) {
  return apiFetch(`/integrations/slack/channels/${channelId}/send`, {
    method: 'POST',
    body: JSON.stringify({ text, thread_ts, blocks }),
  });
}

export async function fetchSlackUsers({ email, limit } = {}) {
  const params = new URLSearchParams();
  if (email) params.set('email', email);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/integrations/slack/users${qs ? `?${qs}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Queue — live sync from Zendesk + Jira
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchQueue({ bustCache } = {}) {
  const qs = bustCache ? `?_t=${Date.now()}` : '';
  return apiFetch(`/queue${qs}`);
}

// Per-source queue fetch (independent sync per source).
// Accepts an AbortSignal so callers (useQueueSync) can cancel a pending fetch
// when the user switches view mid-flight, preventing stale responses from
// overwriting newer state.
export async function fetchQueueBySource(source, { bustCache, signal } = {}) {
  const params = new URLSearchParams();
  params.set('source', source);
  if (bustCache) params.set('_t', String(Date.now()));
  return apiFetch(`/queue?${params.toString()}`, { signal });
}

// ─────────────────────────────────────────────────────────────────────────────
// Zendesk
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchZendeskTickets({ page, per_page, sort_by, sort_order } = {}) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (per_page) params.set('per_page', String(per_page));
  if (sort_by) params.set('sort_by', sort_by);
  if (sort_order) params.set('sort_order', sort_order);
  const qs = params.toString();
  return apiFetch(`/integrations/zendesk/tickets${qs ? `?${qs}` : ''}`);
}

export async function searchZendeskTickets(query) {
  return apiFetch(`/integrations/zendesk/search?query=${encodeURIComponent(query)}`);
}

export async function fetchZendeskGroups() {
  return apiFetch('/integrations/zendesk/groups');
}

export async function fetchZendeskViews() {
  return apiFetch('/integrations/zendesk/views');
}
