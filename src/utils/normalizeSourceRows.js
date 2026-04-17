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
// The Deel admin API returns only the display name for assignees. To scope
// rows to the right agent/lead, we need to map that name back to their Deel
// email. Handles accents, spacing differences ("De Luca" ↔ "Deluca"), and
// extra middle names ("Jessica Czech" ↔ "Jessica Sabrina Czech").
function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function tokenize(name) {
  return stripAccents((name || '').toLowerCase())
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const _nameToEmail = new Map();         // lowercase name → email
const _nameToEmailNorm = new Map();     // accent-stripped → email
const _nameNoSpace = new Map();         // "federicadeluca" → email (collapses spacing)
const _firstLastToEmail = new Map();    // "jessica|czech" → email (ignores middle names)

for (const m of TEAM_MEMBERS) {
  const lower = m.name.toLowerCase();
  const stripped = stripAccents(lower);
  _nameToEmail.set(lower, m.email);
  _nameToEmailNorm.set(stripped, m.email);
  _nameNoSpace.set(stripped.replace(/\s+/g, ''), m.email);
  const tokens = tokenize(m.name);
  if (tokens.length >= 2) {
    _firstLastToEmail.set(`${tokens[0]}|${tokens[tokens.length - 1]}`, m.email);
  }
}

function resolveEmailByName(name) {
  if (!name) return '';
  const lower = name.toLowerCase();
  const stripped = stripAccents(lower);

  // 1. Exact match
  let hit = _nameToEmail.get(lower);
  if (hit) return hit;
  // 2. Accent-stripped
  hit = _nameToEmailNorm.get(stripped);
  if (hit) return hit;
  // 3. Whitespace-collapsed ("Federica Deluca" ↔ "Federica De Luca")
  hit = _nameNoSpace.get(stripped.replace(/\s+/g, ''));
  if (hit) return hit;
  // 4. First + last token only ("Jessica Czech" ↔ "Jessica Sabrina Czech")
  const tokens = tokenize(name);
  if (tokens.length >= 2) {
    hit = _firstLastToEmail.get(`${tokens[0]}|${tokens[tokens.length - 1]}`);
    if (hit) return hit;
  }
  return '';
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
      subject: p.name || 'Unknown',
      startDate: p.startDate || '',
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

// ── Paused Onboarding → normalized rows ──
export function normalizePausedOnboarding(items = []) {
  return items.map(p => {
    // Pause type label: REDLINE → "Redline", MANUAL → "Manual", AMENDMENT → "Amendment"
    const pauseLabel = (p.pauseType || 'Paused')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, c => c.toUpperCase());

    return {
      id: p.id || p.oid || '',
      source: 'onboarding',
      subject: p.name || 'Unknown',
      startDate: p.startDate || '',
      function: `Paused · ${pauseLabel}`,
      country: p.country || '',
      assignee: p.assignee || '',
      assigneeEmail: (p.assigneeEmail || resolveEmailByName(p.assignee) || '').toLowerCase(),
      createdAt: p.createdAt || '',
      updatedAt: p.updatedAt || p.taskCreatedAt || '',       // best proxy for when it was paused
      pausedAt: p.updatedAt || p.taskCreatedAt || '',        // explicit pause timestamp for SLA
      status: { label: `Paused · ${pauseLabel}`, severity: 'warning', color: '#6b6560' },
      taskUrl: p.oid
        ? `${DEEL_ADMIN_BASE}/dashboards/employees/${p.country || 'GLOBAL'}/status/Onboarding.EA.EASigning.Paused/contract/${p.oid}/step/Paused`
        : '',
      contractUrl: DEEL_CONTRACT_URL(p.oid),
      isPaused: true,
      pauseType: p.pauseType || '',
      slaRemaining: null,
      slaBreachStatus: null,
    };
  });
}

// ── Offboarding → normalized rows ──
export function normalizeOffboarding(items = []) {
  return items.map(c => ({
    id: String(c.id || ''),
    source: 'offboarding',
    subject: c.name || 'Unknown',
    clientName: c.organizationName || '',
    endDate: c.endDate || c.desiredEndDate || '',
    endDateIsConfirmed: c.endDateIsConfirmed === true,   // false → render "ASAP" instead of date
    isUrgentEndDate: c.isUrgentEndDate === true,
    typeLabel: c.typeLabel || 'Termination',
    function: c.reason
      ? (c.reason || '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()).toLowerCase().replace(/^\w/, ch => ch.toUpperCase())
      : (c.typeLabel || 'Termination'),
    country: c.country || '',
    assignee: c.exAssignee || '',
    assigneeEmail: (c.exAssigneeEmail || resolveEmailByName(c.exAssignee) || '').toLowerCase(),
    createdAt: c.requestedDate || c.createdAt || '',
    updatedAt: c.updatedAt || '',
    status: c.status || { label: 'Awaiting Triage', severity: 'warning', color: '#ed8d00' },
    taskUrl: c.id ? `${DEEL_ADMIN_BASE}/eor/termination_v3/${c.id}` : '',
    contractUrl: DEEL_CONTRACT_URL(c.contractOid),
    jiraUrl: c.jiraUrl || '',
    zendeskUrl: c.zendeskUrl || '',
    slaRemaining: null,
    slaBreachStatus: null,
  }));
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
