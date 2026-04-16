// ── normalizeSourceRows ──────────────────────────────────────────────────────
// Converts data from each Deel API hook into a unified row format
// for the SourceTable component.
//
// Row shape:
// {
//   id, source, subject, function, country, assignee, assigneeEmail,
//   createdAt, updatedAt, status: { label, severity, color },
//   taskUrl, slaRemaining, slaBreachStatus
// }

import { TEAM_MEMBERS } from '../data/members';

const DEEL_ADMIN_BASE = 'https://admin.deel.network';
const DEEL_CONTRACT_URL = (oid) => oid ? `${DEEL_ADMIN_BASE}/contracts/${oid}/details` : '';
const DEEL_WORKBENCH_BASE = 'https://app.deel.com/workbench/tasks';

// ── Name → email lookup for sources that only provide assignee name ──
// Normalize accents/diacritics for robust matching (André → andre)
function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
const _nameToEmail = new Map();
const _nameToEmailNorm = new Map(); // accent-stripped fallback
for (const m of TEAM_MEMBERS) {
  _nameToEmail.set(m.name.toLowerCase(), m.email);
  _nameToEmailNorm.set(stripAccents(m.name.toLowerCase()), m.email);
}
function resolveEmailByName(name) {
  if (!name) return '';
  const lower = name.toLowerCase();
  // Exact match first, then accent-stripped fallback
  return _nameToEmail.get(lower) || _nameToEmailNorm.get(stripAccents(lower)) || '';
}

// ── Date formatter for subject lines ──
function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Onboarding → normalized rows ──
export function normalizeOnboarding(items = []) {
  return items.map(p => {
    // Friendly flow step: "Onboarding.ComplianceDocs.AwaitingReview" → "Compliance Docs · Awaiting Review"
    const flowParts = (p.flowStep || '').split('.').slice(1);
    const flowDisplay = flowParts.map(part => part.replace(/([A-Z])/g, ' $1').trim()).join(' · ');
    const startStr = fmtShortDate(p.startDate);

    // Task URL: admin dashboard with contract OID + flow step
    // e.g. https://admin.deel.network/dashboards/employees/GLOBAL/status/Onboarding.ActionableQueue/contract/3kzqg4j/step/Onboarding.ComplianceDocs.AwaitingReview
    const taskUrl = (p.oid && p.flowStep)
      ? `${DEEL_ADMIN_BASE}/dashboards/employees/GLOBAL/status/Onboarding.ActionableQueue/contract/${p.oid}/step/${p.flowStep}`
      : (p.oid ? `${DEEL_ADMIN_BASE}/dashboards/employees/GLOBAL/status/Onboarding.ActionableQueue/contract/${p.oid}` : '');

    return {
      id: p.id || p.oid || '',
      source: 'onboarding',
      subject: startStr ? `${p.name || 'Unknown'} — ${startStr}` : (p.name || 'Unknown'),
      function: flowDisplay || 'Onboarding',
      country: p.country || '',
      assignee: p.assignee || '',
      assigneeEmail: (p.assigneeEmail || resolveEmailByName(p.assignee) || '').toLowerCase(),
      createdAt: p.taskCreatedAt || p.createdAt || '',
      updatedAt: p.taskCreatedAt || '',
      status: p.action || { label: 'In Progress', severity: 'active', color: '#1d4ed8' },
      taskUrl,
      contractUrl: DEEL_CONTRACT_URL(p.oid),
      slaRemaining: null,
      slaBreachStatus: null,
    };
  });
}

// ── Offboarding → normalized rows ──
export function normalizeOffboarding(items = []) {
  return items.map(c => {
    const endStr = fmtShortDate(c.endDate || c.desiredEndDate);
    return {
      id: String(c.id || ''),
      source: 'offboarding',
      subject: endStr ? `${c.name || 'Unknown'} — ${endStr}` : (c.name || 'Unknown'),
      function: c.reason
        ? (c.reason || '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()).toLowerCase().replace(/^\w/, ch => ch.toUpperCase())
        : 'Termination',
      country: c.country || '',
      assignee: c.exAssignee || '',
      assigneeEmail: (c.exAssigneeEmail || resolveEmailByName(c.exAssignee) || '').toLowerCase(),
      createdAt: c.requestedDate || c.createdAt || '',
      updatedAt: c.updatedAt || '',
      status: c.status || { label: 'Awaiting Triage', severity: 'warning', color: '#ed8d00' },
      taskUrl: c.contractUrl || DEEL_CONTRACT_URL(c.contractOid),
      contractUrl: DEEL_CONTRACT_URL(c.contractOid),
      jiraUrl: c.jiraUrl || '',
      slaRemaining: null,
      slaBreachStatus: null,
    };
  });
}

// ── Amendments → normalized rows ──
export function normalizeAmendments(items = []) {
  return items.map(a => {
    const effectiveStr = fmtShortDate(a.effectiveDate);
    const changesSummary = a.changes?.length > 0
      ? a.changes.map(c => c.label || c.dataPoint).filter(Boolean).join(', ')
      : '';
    return {
      id: String(a.id || ''),
      source: 'amendments',
      subject: effectiveStr ? `${a.employeeName || 'Unknown'} — ${effectiveStr}` : (a.employeeName || 'Unknown'),
      function: changesSummary || `${a.type || 'Amendment'} Amendment`,
      country: a.country || '',
      assignee: '',  // Amendments don't have assignee in current data
      assigneeEmail: '',
      createdAt: a.createdAt || '',
      updatedAt: a.updatedAt || '',
      status: a.displayStatus || { label: 'Amendment', severity: 'active', color: '#1d4ed8' },
      taskUrl: DEEL_CONTRACT_URL(a.contractOid),
      contractUrl: DEEL_CONTRACT_URL(a.contractOid),
      slaRemaining: null,
      slaBreachStatus: null,
    };
  });
}

// ── Redlines → normalized rows ──
export function normalizeRedlines(items = []) {
  return items.map(r => {
    const typeLabel = r.type === 'templateRedline' ? 'Template' : r.type === 'contractRedline' ? 'Contract' : r.type || '';
    return {
      id: String(r.id || ''),
      source: 'redlines',
      subject: r.orgName || 'Unknown Org',
      function: `${typeLabel} Redline${r.countries?.length ? ' · ' + r.countries.join(', ') : ''}`,
      country: r.countryCode || (r.countries?.[0] || ''),
      assignee: '',  // Redlines don't have assignee in current data
      assigneeEmail: '',
      createdAt: r.createdAt || '',
      updatedAt: r.updatedAt || '',
      status: r.displayStatus || { label: 'Redline', severity: 'active', color: '#1d4ed8' },
      taskUrl: '',
      contractUrl: '',  // Redlines are org-level, no single contract
      slaRemaining: null,
      slaBreachStatus: null,
    };
  });
}

// ── Workbench → normalized rows ──
export function normalizeWorkbench(items = []) {
  return items.map(t => ({
    id: String(t.id || ''),
    source: 'workbench',
    subject: t.name || 'Untitled Task',
    function: t.taskType || t.sourceType || 'Workbench',
    country: t.country || '',
    assignee: t.assignee?.name || '',
    assigneeEmail: (t.assignee?.email || '').toLowerCase(),
    createdAt: t.createdAt || '',
    updatedAt: t.updatedAt || '',
    status: t.displayStatus || { label: t.status || 'Unknown', severity: 'info', color: '#616161' },
    taskUrl: t.id
      ? `${DEEL_WORKBENCH_BASE}/${t.id}`
      : DEEL_CONTRACT_URL(t.contractOid),
    contractUrl: DEEL_CONTRACT_URL(t.contractOid),
    slaRemaining: t.slaRemaining,
    slaBreachStatus: t.slaBreachStatus || '',
  }));
}
