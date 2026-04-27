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
// HRX Operations team ID — used for the admin ops-workbench deep-link.
const HRX_OPERATIONS_TEAM_ID = 'f235fd21-c5a0-4804-badf-2cc3dc76191e';
const DEEL_OPS_WORKBENCH_URL = (taskId) =>
  taskId ? `${DEEL_ADMIN_BASE}/ops-workbench/${encodeURIComponent(taskId)}?teamIds%5B%5D=${HRX_OPERATIONS_TEAM_ID}` : '';
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

// SLA windows (per Ops policy — Pilar's 2026-04-27 spec):
//   - Zendesk:      24h from latest requester reply (open/new only — pending /
//                   hold map to 'waiting' in queue-scoping, slaInfo() ignores
//                   those statuses entirely). Configured via slaMinsOverride
//                   in queue/route.js, not here.
//   - Jira:         48h from latest update. Same path as Zendesk.
//   - Workbench:    48h from creation. Overrides upstream Deel slaTime so
//                   every workbench task lands on the same policy.
//   - Amendments:   24h from createdAt active, 48h from pausedAt paused.
//   - Redlines:     72h from createdAt active, 48h from pausedAt paused.
//   - Onboarding:   7 days from createdAt active, 48h from pausedAt paused
//                   (Paused Onboarding rows expose `pausedAt`).
//   - Offboarding:  21 days from createdAt active, 48h from pausedAt paused.
// Universal pause rule: 48h to unpause and continue, regardless of which Q.
const HOUR_MS                  = 60 * 60 * 1000;
const DAY_MS                   = 24 * HOUR_MS;
const PAUSED_SLA_MS            = 48 * HOUR_MS;

const AMENDMENT_SLA_ACTIVE_MS  = 24 * HOUR_MS;
const AMENDMENT_SLA_PAUSED_MS  = PAUSED_SLA_MS;
const REDLINE_SLA_ACTIVE_MS    = 72 * HOUR_MS;
const REDLINE_SLA_PAUSED_MS    = PAUSED_SLA_MS;
const ONBOARDING_SLA_ACTIVE_MS = 7  * DAY_MS;
const ONBOARDING_SLA_PAUSED_MS = PAUSED_SLA_MS;
const OFFBOARDING_SLA_ACTIVE_MS= 21 * DAY_MS;
const OFFBOARDING_SLA_PAUSED_MS= PAUSED_SLA_MS;
const WORKBENCH_SLA_ACTIVE_MS  = 48 * HOUR_MS;

// Shared SLA computation. Returns `{ slaRemaining (seconds), slaBreachStatus }`
// shaped exactly like the Workbench upstream so the SourceTable badge renders
// uniformly. When `pausedMs`/`pausedAt` are provided AND truthy, the paused
// branch wins (the pause clock is what the team actually races against).
// Falls back gracefully when timestamps are missing — never crashes the row.
function computeSlaWindow(activeMs, createdAt, opts = {}) {
  const { pausedMs, pausedAt } = opts;
  const now = Date.now();
  if (pausedMs && pausedAt) {
    const ts = new Date(pausedAt).getTime();
    if (Number.isFinite(ts) && ts > 0) {
      const slaRemaining = Math.round((ts + pausedMs - now) / 1000);
      return { slaRemaining, slaBreachStatus: slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED' };
    }
  }
  if (createdAt) {
    const ts = new Date(createdAt).getTime();
    if (Number.isFinite(ts) && ts > 0) {
      const slaRemaining = Math.round((ts + activeMs - now) / 1000);
      return { slaRemaining, slaBreachStatus: slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED' };
    }
  }
  return { slaRemaining: null, slaBreachStatus: null };
}

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

    const createdAt = p.taskCreatedAt || p.createdAt || '';
    const sla = computeSlaWindow(ONBOARDING_SLA_ACTIVE_MS, createdAt);

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
      createdAt,
      updatedAt: p.taskCreatedAt || '',
      status: p.action || { label: 'In Progress', severity: 'active', color: '#1d4ed8' },
      taskUrl,
      contractUrl: DEEL_CONTRACT_URL(p.oid),
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
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

    const createdAt = p.createdAt || '';
    const pausedAt = p.updatedAt || p.taskCreatedAt || '';   // best proxy for when it was paused
    const sla = computeSlaWindow(ONBOARDING_SLA_ACTIVE_MS, createdAt, {
      pausedMs: ONBOARDING_SLA_PAUSED_MS,
      pausedAt,
    });

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
      createdAt,
      updatedAt: pausedAt,
      pausedAt,
      status: { label: `Paused · ${pauseLabel}`, severity: 'warning', color: '#6b6560' },
      taskUrl: p.oid
        ? `${DEEL_ADMIN_BASE}/dashboards/employees/${p.country || 'GLOBAL'}/status/Onboarding.EA.EASigning.Paused/contract/${p.oid}/step/Paused`
        : '',
      contractUrl: DEEL_CONTRACT_URL(p.oid),
      isPaused: true,
      pauseType: p.pauseType || '',
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
    };
  });
}

// ── Offboarding → normalized rows ──
export function normalizeOffboarding(items = []) {
  return items.map(c => {
    const createdAt = c.requestedDate || c.createdAt || '';
    // Offboarding has no native paused state in the upstream payload, but
    // honour `c.isPaused` / `c.pausedAt` if either ever surfaces — keeps the
    // 48h paused rule applicable here too.
    const sla = computeSlaWindow(OFFBOARDING_SLA_ACTIVE_MS, createdAt, {
      pausedMs: c.isPaused ? OFFBOARDING_SLA_PAUSED_MS : null,
      pausedAt: c.pausedAt || null,
    });
    return {
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
      createdAt,
      updatedAt: c.updatedAt || '',
      pausedAt: c.pausedAt || null,
      isPaused: !!c.isPaused,
      status: c.status || { label: 'Awaiting Triage', severity: 'warning', color: '#ed8d00' },
      taskUrl: c.id ? `${DEEL_ADMIN_BASE}/eor/termination_v3/${c.id}` : '',
      contractUrl: DEEL_CONTRACT_URL(c.contractOid),
      jiraUrl: c.jiraUrl || '',
      zendeskUrl: c.zendeskUrl || '',
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
    };
  });
}

// ── Amendments → normalized rows ──
export function normalizeAmendments(items = []) {
  return items.map(a => {
    const changesSummary = a.changes?.length > 0
      ? a.changes.map(c => c.label || c.dataPoint).filter(Boolean).join(', ')
      : '';

    // SLA: 24h from createdAt when active, 48h from pausedAt when paused.
    const sla = computeSlaWindow(AMENDMENT_SLA_ACTIVE_MS, a.createdAt, {
      pausedMs: a.isPaused ? AMENDMENT_SLA_PAUSED_MS : null,
      pausedAt: a.pausedAt,
    });
    const slaRemaining = sla.slaRemaining;
    const slaBreachStatus = sla.slaBreachStatus;

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

    // 72h SLA from createdAt active; 48h from pausedAt when paused. Redline
    // payloads don't normally expose a pause state — `isPaused`/`pausedAt`
    // are honoured if upstream ever provides them so the universal pause
    // rule applies wherever it can be detected.
    const sla = computeSlaWindow(REDLINE_SLA_ACTIVE_MS, r.createdAt, {
      pausedMs: r.isPaused ? REDLINE_SLA_PAUSED_MS : null,
      pausedAt: r.pausedAt || null,
    });
    const slaRemaining = sla.slaRemaining;
    const slaBreachStatus = sla.slaBreachStatus;

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
      // Workbench process associated with this redline — deep-links into the
      // admin workbench process page (NOT app.deel.com/workbench/tasks, which
      // is a different UI). Uses the workbench PROCESS id, not the task id.
      workbenchUrl: r.workbenchProcessId
        ? `${DEEL_ADMIN_BASE}/ops-workbench-processes/${r.workbenchProcessId}`
        : '',
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
  return items.map(t => {
    // Override upstream Deel-side SLA with our flat 48h-from-creation policy
    // (per Pilar's spec). The upstream `t.slaTime`/`t.slaRemaining` vary
    // arbitrarily per task config and don't match the team's operating model.
    // 48h paused branch applies if upstream ever flags a pause state.
    const sla = computeSlaWindow(WORKBENCH_SLA_ACTIVE_MS, t.createdAt, {
      pausedMs: t.isPaused || t.status === 'ON_HOLD' ? PAUSED_SLA_MS : null,
      pausedAt: t.pausedAt || (t.status === 'ON_HOLD' ? t.updatedAt : null),
    });
    return {
      id: String(t.id || ''),
      source: 'workbench',
      subject: t.name || 'Untitled Task',
      // typeLabel drives the "Type" column when SourceTable is rendered with
      // showType=true — e.g. "Expedite EOR Onboarding", "HRX Escalation".
      typeLabel: t.taskType || t.sourceType || 'Workbench',
      function: t.taskType || t.sourceType || 'Workbench',
      country: t.country || '',
      assignee: t.assignee?.name || '',
      assigneeEmail: (t.assignee?.email || '').toLowerCase(),
      createdAt: t.createdAt || '',
      updatedAt: t.updatedAt || t.createdAt || '',
      status: t.displayStatus || { label: t.status || 'Unknown', severity: 'info', color: '#616161' },
      // Deep-link to the admin workbench task page (NOT app.deel.com — that's
      // a different UI that doesn't recognise these IDs).
      taskUrl: DEEL_OPS_WORKBENCH_URL(t.id),
      contractUrl: DEEL_CONTRACT_URL(t.contractOid),
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
    };
  });
}
