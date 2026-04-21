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
// Admin amendment page. Deep-links to the side-pane for a specific amendment.
// Example: https://admin.deel.network/eor/change-requests?requestId=...&requestType=amendments&status=PreparingDocuments&subStatus=PreparingDocuments.WaitingHrxAction
const DEEL_AMENDMENT_URL = (id, currentStatus) => {
  if (!id) return '';
  const sub = currentStatus ? `&subStatus=${encodeURIComponent(currentStatus)}` : '';
  return `${DEEL_ADMIN_BASE}/eor/change-requests?requestId=${encodeURIComponent(id)}&requestType=amendments&sortBy=createdAt&sortOrder=desc&status=PreparingDocuments${sub}`;
};

// Admin redline page. Deep-links into the side-pane for a specific redline.
// The admin UI REQUIRES both `redlineType` (templateRedline | contractRedline)
// and `requestId` — omitting either opens an empty side-pane.
// Param order mirrors the admin UI's own share URL (redlineType first).
const DEEL_REDLINE_URL = (id, isExecution, redlineType) => {
  if (!id) return '';
  const sub = isExecution ? 'preparingDocuments.HRXToExecute' : 'preparingDocuments.legalReview';
  // Default to templateRedline when we couldn't infer the type — better to
  // open the wrong template than a blank page.
  const rt = redlineType || 'templateRedline';
  return `${DEEL_ADMIN_BASE}/eor/change-requests?redlineType=${encodeURIComponent(rt)}&requestId=${encodeURIComponent(id)}&requestType=redlines&sortBy=createdAt&sortOrder=desc&status=preparingDocuments&subStatus=${encodeURIComponent(sub)}`;
};

// SLA windows (per Ops policy):
//   - Amendments Action Needed / Redlines: 24h from createdAt
//   - Amendments Paused:                    48h from when it entered Paused.*
const AMENDMENT_SLA_ACTIVE_MS = 24 * 60 * 60 * 1000;
const AMENDMENT_SLA_PAUSED_MS = 48 * 60 * 60 * 1000;
const REDLINE_SLA_ACTIVE_MS   = 24 * 60 * 60 * 1000;

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

// Track collisions during map build so two members who would both resolve to
// the same fuzzy key don't silently clobber each other — the existing code
// was last-wins, which could route a ticket for "Jane Smith (EMEA)" to
// "Jane Smith (LATAM)" if a duplicate existed. We WARN instead of hard-fail so
// a transient data-quality issue doesn't break onboarding rendering.
function _noteCollision(mapName, key, existingEmail, incomingEmail) {
  if (existingEmail && existingEmail !== incomingEmail) {
    console.warn(
      `[normalizeSourceRows] name→email collision in ${mapName}: key="${key}" already mapped to ${existingEmail}, not overriding with ${incomingEmail}`,
    );
    return true;
  }
  return false;
}

for (const m of TEAM_MEMBERS) {
  const lower = m.name.toLowerCase();
  const stripped = stripAccents(lower);
  const collapsed = stripped.replace(/\s+/g, '');
  if (!_noteCollision('exact', lower, _nameToEmail.get(lower), m.email)) {
    _nameToEmail.set(lower, m.email);
  }
  if (!_noteCollision('stripped', stripped, _nameToEmailNorm.get(stripped), m.email)) {
    _nameToEmailNorm.set(stripped, m.email);
  }
  if (!_noteCollision('collapsed', collapsed, _nameNoSpace.get(collapsed), m.email)) {
    _nameNoSpace.set(collapsed, m.email);
  }
  const tokens = tokenize(m.name);
  if (tokens.length >= 2) {
    const flKey = `${tokens[0]}|${tokens[tokens.length - 1]}`;
    if (!_noteCollision('first|last', flKey, _firstLastToEmail.get(flKey), m.email)) {
      _firstLastToEmail.set(flKey, m.email);
    }
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
      clientName: p.clientName || '',
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
      clientName: p.clientName || '',
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
    const changesSummary = a.changes?.length > 0
      ? a.changes.map(c => c.label || c.dataPoint).filter(Boolean).join(', ')
      : '';

    // SLA is derived: 24h from createdAt when active, 48h from pausedAt when paused.
    // slaRemaining is seconds (matches the workbench convention) so the shared
    // SourceTable badge renders without special-casing.
    let slaRemaining = null;
    let slaBreachStatus = null;
    const now = Date.now();
    if (a.isPaused && a.pausedAt) {
      const deadline = new Date(a.pausedAt).getTime() + AMENDMENT_SLA_PAUSED_MS;
      slaRemaining = Math.round((deadline - now) / 1000);
      slaBreachStatus = slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED';
    } else if (a.createdAt) {
      const deadline = new Date(a.createdAt).getTime() + AMENDMENT_SLA_ACTIVE_MS;
      slaRemaining = Math.round((deadline - now) / 1000);
      slaBreachStatus = slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED';
    }

    return {
      id: String(a.id || ''),
      source: 'amendments',
      subject: a.employeeName || 'Unknown',
      function: changesSummary || `${a.type || 'Amendment'} Amendment`,
      country: a.country || '',
      clientName: a.clientName || '',
      assignee: '',  // no server-side assignee — SourceTable renders "Assign me"
      assigneeEmail: '',
      createdAt: a.createdAt || '',
      updatedAt: a.updatedAt || a.createdAt || '',
      status: a.displayStatus || { label: 'Amendment', severity: 'active', color: '#1d4ed8' },
      taskUrl: DEEL_AMENDMENT_URL(a.id, a.currentStatus),
      contractUrl: DEEL_CONTRACT_URL(a.contractOid),
      pausedAt: a.pausedAt || null,
      isPaused: !!a.isPaused,
      slaRemaining,
      slaBreachStatus,
    };
  });
}

// ── Redlines → normalized rows ──
export function normalizeRedlines(items = []) {
  return items.map(r => {
    const typeLabel = r.type === 'templateRedline' ? 'Template' : r.type === 'contractRedline' ? 'Contract' : r.type || '';

    // Subject — the row's lead identifier, shown in the Employee column.
    //   - Contract redlines: the employee's legal name (enriched from
    //     /rest/v2/contracts in the BE if missing from the raw payload).
    //   - Template redlines: the creating organization's name.
    //   - Else: fall back to template name, then a truncated redline ID so
    //     the row is never anonymous.
    const subject = r.employeeName
                 || r.orgName
                 || r.templateName
                 || (r.id ? `${typeLabel || 'Redline'} ${String(r.id).slice(0, 8)}` : 'Redline');

    // 24h SLA countdown from createdAt (both review and execution are
    // action-needed surfaces — no paused state).
    let slaRemaining = null;
    let slaBreachStatus = null;
    if (r.createdAt) {
      const deadline = new Date(r.createdAt).getTime() + REDLINE_SLA_ACTIVE_MS;
      slaRemaining = Math.round((deadline - Date.now()) / 1000);
      slaBreachStatus = slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED';
    }

    return {
      id: String(r.id || ''),
      source: 'redlines',
      subject,
      function: `${typeLabel} Redline${r.countries?.length ? ' · ' + r.countries.join(', ') : ''}`,
      country: r.countryCode || (r.countries?.[0] || ''),
      // Client Name column: always the creating org (template redlines) or
      // the employee's employer org if available.
      clientName: r.orgName || '',
      assignee: '',  // no server-side assignee — SourceTable renders "Assign me"
      assigneeEmail: '',
      createdAt: r.createdAt || '',
      updatedAt: r.updatedAt || r.createdAt || '',
      status: r.displayStatus || { label: 'Redline Review', severity: 'warning', color: '#ed8d00' },
      taskUrl: DEEL_REDLINE_URL(r.id, r.isExecution, r.type),
      // Workbench task associated with this redline — opens in the ops
      // workbench UI alongside the admin side-pane.
      workbenchUrl: r.workbenchTaskId ? `${DEEL_WORKBENCH_BASE}/${r.workbenchTaskId}` : '',
      // Contract redlines tie back to an employee contract; template redlines
      // don't have a single contract (applies to all employees in that template).
      contractUrl: r.contractOid ? DEEL_CONTRACT_URL(r.contractOid) : '',
      isExecution: !!r.isExecution,
      slaRemaining,
      slaBreachStatus,
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
