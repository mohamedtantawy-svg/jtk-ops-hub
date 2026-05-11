// ── Handovers API client ──────────────────────────────────────────────
// Phase 2 ships the write paths; Phase 4 will add the cron-only routes.

import { apiFetch } from './api';

/** Per-lens counts for the OOO header chip row. */
export async function fetchHandoverLensCounts() {
  return apiFetch('/handovers/lens-counts');
}

/** Default checklist template + settings preset for the current caller. */
export async function fetchDefaultChecklistTemplate() {
  return apiFetch('/handover-checklist-templates/default');
}

/**
 * Currently-merged coverages for the caller. Returns active or
 * approved-in-window handovers where the caller has accepted coverage.
 * Used by the Briefing CoverageBanner + CoverageCard.
 */
export async function fetchMyActiveCoverages() {
  return apiFetch('/handovers/my-active-coverages');
}

/** Visible-scope handover list. Filters mirror the route's query params. */
export async function listHandovers({ status, requester, manager, from, to } = {}) {
  const qs = new URLSearchParams();
  if (status)    qs.set('status', status);
  if (requester) qs.set('requester', requester);
  if (manager)   qs.set('manager', manager);
  if (from)      qs.set('from', from);
  if (to)        qs.set('to', to);
  const q = qs.toString();
  return apiFetch(`/handovers${q ? `?${q}` : ''}`);
}

/** Full handover detail (coverers + checklist + log). */
export async function getHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}`);
}

/**
 * Create a new handover draft.
 * @param {Object} payload
 * @param {string} payload.time_off_event_id        — required
 * @param {string} [payload.reason]
 * @param {Array}  [payload.coverers]               — [{ email, country_codes? }]
 * @param {Array}  [payload.checklist_items]        — overrides template
 */
export async function createHandover(payload) {
  return apiFetch('/handovers', { method: 'POST', body: JSON.stringify(payload) });
}

/** Patch a draft / pending handover. Same payload shape as create. */
export async function updateHandover(id, payload) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

/** Delete a draft. Submitted handovers must be cancelled instead. */
export async function deleteHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Move draft → pending_coverage_acceptance. */
export async function submitHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/submit`, {
    method: 'POST', body: JSON.stringify({}),
  });
}

/** Coverer accepts. */
export async function acceptHandover(id) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/accept`, {
    method: 'POST', body: JSON.stringify({}),
  });
}

/** Coverer declines (body: reason). */
export async function declineHandover(id, reason) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/decline`, {
    method: 'POST', body: JSON.stringify({ reason: reason || null }),
  });
}

/** Manager approves (body: optional note). */
export async function approveHandover(id, note) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/approve`, {
    method: 'POST', body: JSON.stringify({ note: note || null }),
  });
}

/** Manager rejects (body: reason — required). */
export async function rejectHandover(id, reason) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

/** Requester / manager / admin cancels. Admin can pass `force: true`. */
export async function cancelHandover(id, reason, { force = false } = {}) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason: reason || null, force }),
  });
}

/**
 * Toggle a single checklist item.
 * @param {string} handoverId
 * @param {string} itemId    — the stable item.id (NOT the row UUID)
 * @param {Object} body      — { completed: boolean, note?: string }
 */
export async function toggleChecklistItem(handoverId, itemId, body) {
  return apiFetch(`/handovers/${encodeURIComponent(handoverId)}/checklist/${encodeURIComponent(itemId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

/**
 * Coverer logs the return-day handback summary. Transitions the
 * handover to `completed` and ends the workspace merge.
 * @param {string} id
 * @param {Object} payload         — { summary: string, open_items?: [{kind,label,url,source,id}] }
 */
export async function logHandback(id, payload) {
  return apiFetch(`/handovers/${encodeURIComponent(id)}/handback`, {
    method: 'POST', body: JSON.stringify(payload || {}),
  });
}

/** Bulk-approve N pending handovers as a manager. Atomic. */
export async function bulkApproveHandovers(ids, note) {
  return apiFetch('/handovers/bulk/approve', {
    method: 'POST', body: JSON.stringify({ ids, note: note || null }),
  });
}

/** Bulk-reject N pending handovers as a manager (reason required). */
export async function bulkRejectHandovers(ids, reason) {
  return apiFetch('/handovers/bulk/reject', {
    method: 'POST', body: JSON.stringify({ ids, reason }),
  });
}

/**
 * Admin: full audit CSV for a date range. Triggers a browser download
 * via a synthesised <a download> click. Uses plain fetch (not apiFetch)
 * because the endpoint returns text/csv rather than JSON.
 */
export async function downloadHandoverAuditCsv({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to)   qs.set('to', to);
  const q = qs.toString();
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('ops_hub_token') || '') : '';
  const res = await fetch(`/api/v1/handovers/audit-export${q ? `?${q}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Audit export failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const fname = m ? m[1] : `handover-audit-${from || 'all'}-${to || 'now'}.csv`;
  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { ok: true, filename: fname, bytes: blob.size };
}

// ── Settings APIs (admin) ────────────────────────────────────────────

export async function listHandoverSettings() {
  return apiFetch('/handover-settings');
}
export async function createHandoverSetting(payload) {
  return apiFetch('/handover-settings', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateHandoverSetting(id, payload) {
  return apiFetch(`/handover-settings/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}
export async function deleteHandoverSetting(id) {
  return apiFetch(`/handover-settings/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listHandoverTemplates() {
  return apiFetch('/handover-checklist-templates');
}
export async function createHandoverTemplate(payload) {
  return apiFetch('/handover-checklist-templates', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateHandoverTemplate(id, payload) {
  return apiFetch(`/handover-checklist-templates/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}
export async function deleteHandoverTemplate(id) {
  return apiFetch(`/handover-checklist-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listTimeOffImportBatches() {
  return apiFetch('/time-off-import-batches');
}
