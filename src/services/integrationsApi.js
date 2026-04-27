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
  return apiFetch(`/integrations/deel/offboarding${qs}`);
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
  return apiFetch(`/integrations/deel/workbench${qs ? `?${qs}` : ''}`);
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

// Reassign a ticket in Zendesk/Jira via our backend
export async function reassignQueueTicket(ticketId, assigneeEmail) {
  return apiFetch('/queue/reassign', {
    method: 'POST',
    body: JSON.stringify({ ticketId, assigneeEmail }),
  });
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

// Discover the 4 ops-hub-tracked Zendesk custom fields (employeeCountry /
// form / rootCauseSupport / rootCauseSelector). Cached server-side for 1h;
// the FE can call this once per Detail mount and rely on the result.
// `force=true` busts the server cache (admin/dev workflow when fields were
// reconfigured in Zendesk and we want them visible immediately).
export async function fetchZendeskTicketFields({ force } = {}) {
  const qs = force ? '?force=1' : '';
  return apiFetch(`/integrations/zendesk/ticket-fields${qs}`);
}

// Active Zendesk macros (cached server-side 5 min). Optional `search`
// filters by title client-side to avoid burning a ZD call per keystroke.
export async function fetchZendeskMacros({ search } = {}) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch(`/integrations/zendesk/macros${qs}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket Comments & Actions
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchTicketComments(ticketId) {
  return apiFetch(`/queue/${ticketId}/comments`);
}

export async function postTicketAction(ticketId, actionPayload) {
  return apiFetch(`/queue/${ticketId}/actions`, {
    method: 'POST',
    body: JSON.stringify(actionPayload),
  });
}

// PUT one or more of the 4 ops-hub-tracked Zendesk custom fields.
// patch shape: { employeeCountry?, form?, rootCauseSupport?, rootCauseSelector? }
// Backend resolves FE keys → Zendesk field IDs and PUTs the ticket;
// queue cache is busted on success so the next sync reflects the change.
export async function updateTicketCustomFields(ticketId, patch) {
  return apiFetch(`/queue/${ticketId}/custom-fields`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// Macro preview — what would this macro change on this ticket?
// Returns { changes: [{type, ...}, ...] } describing the diff.
export async function previewTicketMacro(ticketId, macroId) {
  return apiFetch(`/queue/${encodeURIComponent(ticketId)}/macros/${encodeURIComponent(macroId)}/preview`);
}

// Macro apply — commits the macro on the ticket via Zendesk's macro_ids[].
// Queue cache is busted on success so the next sync reflects all the
// changes the macro made (status, fields, comments, etc.).
export async function applyTicketMacro(ticketId, macroId) {
  return apiFetch(`/queue/${encodeURIComponent(ticketId)}/macros/${encodeURIComponent(macroId)}/apply`, {
    method: 'POST',
  });
}
