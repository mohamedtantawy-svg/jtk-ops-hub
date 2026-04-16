// ── Normalizers: Bridge BE API response shapes → FE component shapes ────────
// The FE components expect specific field names (e.g. `country`, `minutesAgo`).
// The BE returns different shapes (e.g. `countryCode`, `createdAt` timestamps).
// These functions convert between the two so components don't need to change.

const minsAgo = (dateStr) => {
  if (!dateStr) return 0;
  const result = Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 60000));
  return Number.isNaN(result) ? null : result;
};

// ── Tasks ────────────────────────────────────────────────────────────────────
const STATUS_MAP_BE_TO_FE = {
  open: 'new',
  in_progress: 'in_progress',
  pending: 'waiting',
  snoozed: 'waiting',
  escalated: 'in_progress',
  resolved: 'resolved',
  closed: 'resolved',
};

const STATUS_MAP_FE_TO_BE = {
  new: 'open',
  in_progress: 'in_progress',
  waiting: 'pending',
  resolved: 'resolved',
};

export function normalizeTask(t) {
  if (!t) return null;
  return {
    id: t.externalId || t.id,
    _beId: t.id, // preserve BE UUID for API calls
    source: t.source || 'manual',
    subject: t.subject || '',
    body: t.description || '',
    assigneeId: t.assigneeId ? Number(t.assigneeId) : null,
    country: t.countryCode || '',
    minutesAgo: minsAgo(t.sourceCreatedAt || t.createdAt),
    updatedMinsAgo: minsAgo(t.updatedAt),
    receivedAt: t.sourceCreatedAt ? new Date(t.sourceCreatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
    status: STATUS_MAP_BE_TO_FE[t.status] || t.status || 'new',
    type: (t.tags && t.tags[0]) || 'Access Issue',
    priority: t.priority || 'medium',
    isAlert: t.priority === 'critical',
    requesterName: t.reporterId || 'System',
    linkedTickets: t.linkedTickets || t.linked_tickets || [],
    externalUrl: t.externalUrl || '',
    snoozedUntil: t.snoozedUntil ? new Date(t.snoozedUntil).getTime() : null,
    snoozeLabel: t.snoozedUntil ? 'Snoozed' : null,
    prevStatus: t.prevStatus || t.prev_status || null,
    aiSummary: t.aiSummary || t.ai_summary || '',
    suggestedReply: t.suggestedReply || t.suggested_reply || '',
  };
}

export function denormalizeTaskForCreate(form) {
  return {
    externalId: form.id || `MAN-${Date.now()}`,
    source: form.source || 'manual',
    subject: form.subject,
    description: form.body || '',
    priority: form.priority || 'medium',
    assigneeId: form.assigneeId ? String(form.assigneeId) : null,
    countryCode: form.country || null,
    tags: form.type ? [form.type] : [],
    externalUrl: form.link || null,
  };
}

export function feStatusToBe(feStatus) {
  return STATUS_MAP_FE_TO_BE[feStatus] || feStatus;
}

// ── Members ──────────────────────────────────────────────────────────────────
export function normalizeMember(m) {
  if (!m) return null;
  return {
    id: Number(m.id),
    name: m.name || '',
    initials: (m.name || '').split(' ').filter(w => w.length > 0).map(w => w[0]).join('').toUpperCase().slice(0, 2),
    role: m.role || 'agent',
    team: m.team || m.region || '',
    region: m.region || m.team || '',
    country: '', // BE doesn't store country per-member in the same way
    lead: m.leadId ? Number(m.leadId) : null,
    email: m.email || '',
    avatarUrl: m.avatarUrl || null,
    isActive: m.isActive !== false,
  };
}

// ── Escalations ──────────────────────────────────────────────────────────────
export function normalizeEscalation(e) {
  if (!e) return null;
  return {
    id: e.id,
    task: null, // hydrated client-side in App.jsx by taskId lookup
    taskId: e.taskId || null,
    subject: e.subject || '',
    reason: e.reason || '',
    escalatedBy:      e.escalatedBy || '',
    escalatedByEmail: (e.escalatedByEmail || '').toLowerCase() || null,
    escalatedById:    e.escalatedById ? Number(e.escalatedById) : null,
    escalatedAt: e.escalatedAt ? new Date(e.escalatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
    managerId: e.managerId ? Number(e.managerId) : null,
    managerName: e.managerName || 'Team Lead',
    status: e.status || 'pending',
    managerResponseStatus: e.managerResponseStatus || 'pending_response',
    managerResponse: e.managerResponse || null,
    managerRespondedAt: e.managerRespondedAt ? new Date(e.managerRespondedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null,
    managerRespondedBy: e.managerRespondedBy || null,
    escalationSource: e.escalationSource || 'ticket',
    slackChannel: e.slackChannel || null,
    slackUser: e.slackUser || null,
    slackMessageUrl: e.slackMessageUrl || null,
    severity: e.severity || 'medium',
    resolvedAt: e.resolvedAt || null,
    resolvedBy: e.resolvedBy || null,
    createdAt: e.createdAt || null,
  };
}

// ── Projects ─────────────────────────────────────────────────────────────────
export function normalizeProject(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.title || p.name || '',
    type: (p.tags && p.tags[0]) || p.type || 'general',
    status: p.status || 'active',
    priority: p.priority || 'medium',
    leadId: p.ownerId ? Number(p.ownerId) : null,
    assigneeIds: p.assigneeIds || p.assignee_ids || [],
    assignScope: 'individuals',
    assignTeam: p.teamId || null,
    deadline: p.deadline || null,
    description: p.description || '',
    progress: p.progress || 0,
    createdBy: p.ownerId ? Number(p.ownerId) : null,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
  };
}

// ── Requests ─────────────────────────────────────────────────────────────────
export function normalizeRequest(r) {
  if (!r) return null;
  return {
    id: r.id,
    subject: r.subject || '',
    description: r.description || '',
    toTeam: r.toTeam || '',
    status: r.status || 'open',
    priority: r.priority || 'medium',
    raisedById: r.fromMemberId ? Number(r.fromMemberId) : null,
    linkedTaskId: r.linkedTaskId || r.taskId || null,
    linkedSource: null,
    externalRef: r.externalRef || null,
    notes: '',
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
    resolvedAt: r.resolvedAt || null,
    dueDate: r.dueDate || null,
  };
}

// ── Notes ────────────────────────────────────────────────────────────────────
export function normalizeNote(n) {
  if (!n) return null;
  return {
    id: n.id,
    text: n.body || '',
    author: n.authorName || 'Unknown',
    authorId: n.authorId ? Number(n.authorId) : null,
    time: n.createdAt ? new Date(n.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
    isInternal: n.isInternal || false,
  };
}

// ── Activity ─────────────────────────────────────────────────────────────────
export function normalizeActivity(a) {
  if (!a) return null;
  return {
    type: a.eventType || 'status',
    text: a.eventText || '',
    user: a.actorName || '',
    time: a.occurredAt ? new Date(a.occurredAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
  };
}
