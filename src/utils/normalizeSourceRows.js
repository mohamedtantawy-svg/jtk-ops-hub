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

import { TEAM_MEMBERS, MEMBERS_BY_EMAIL } from '../data/members';
import { COUNTRY_OWNERS } from '../data/countryOwners';

// ── Synthetic assignee from country owners ─────────────────────────────────
// For queues with no upstream assignee (Amendments, Redlines, Incentive
// Plans) we synthesize one from COUNTRY_OWNERS so the row attributes
// somewhere — country owners SEE these via scope today but they don't
// COUNT toward their workload anywhere (Briefing capacity, Team SLA dot,
// Analytics agent stats), since attribution is keyed off `assigneeEmail`.
//
// Onboarding has an upstream assignee in most cases; we only fall back to
// the synthetic owner when that's missing — never override a real HRX
// person actively working a row.
//
// Multi-owner countries → deterministic round-robin via DJB2 hash of the
// row id, modulo owner count. Stable across renders (same row → same
// owner) and self-rebalances when the Team-tab country picker writes new
// owners.

// DJB2 string hash — small, stable, no deps.
function _hashId(id) {
  let h = 5381;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function syntheticOwnerForCountry(country, rowId) {
  if (!country) return null;
  const cc = String(country).toUpperCase();
  const owners = COUNTRY_OWNERS[cc];
  if (!Array.isArray(owners) || owners.length === 0) return null;
  const email = owners[_hashId(rowId) % owners.length];
  if (!email) return null;
  const lc = email.toLowerCase();
  const member = MEMBERS_BY_EMAIL[lc];
  return { email: lc, name: member?.name || email, isSynthetic: true };
}

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

// Admin incentive plan page. Deep-links to the IP detail hub for the row.
// Status param is required for the hub's filter pill to highlight the right
// bucket — defaults to PENDING_IP_PREPARATION (the only actionable status).
const DEEL_INCENTIVE_PLAN_URL = (id, status) => {
  if (!id) return '';
  const s = status || 'PENDING_IP_PREPARATION';
  return `${DEEL_ADMIN_BASE}/incentive-plans/hub/details/${encodeURIComponent(id)}?status=${encodeURIComponent(s)}`;
};

// SLA windows (Mohamed's 2026-05-01 spec):
//   - Zendesk:      24h biz from latest requester reply (active);
//                   48h biz from pausedAt for `pending`/`hold` rows.
//                   Configured via slaMinsOverride in queue/route.js.
//   - Jira:         48h biz from latest update. Same path as Zendesk.
//   - Workbench:    48h biz from creation; 48h biz from pausedAt.
//   - Amendments:   24h biz from createdAt active, 48h biz from pausedAt paused.
//   - Redlines:     5 biz days from createdAt active, 48h biz from pausedAt paused.
//   - Onboarding:   24h biz from taskCreatedAt active, 48h biz from pausedAt paused.
//   - Offboarding:  type-aware — Termination 14 biz days, Resignation 5 biz days
//                   from createdAt; 48h biz from pausedAt when `isPaused`.
// Universal pause rule: 48h to unpause and continue, regardless of which Q.
// All windows tick on the BUSINESS DAY clock (see ./bizTime.js) — Saturday
// and Sunday don't elapse, so a Friday-4pm ticket doesn't bleed weekend
// hours into its SLA.
import { elapsedBizMs } from './bizTime';

const HOUR_MS                  = 60 * 60 * 1000;
const DAY_MS                   = 24 * HOUR_MS;
const PAUSED_SLA_MS            = 48 * HOUR_MS;

// These constants are the FALLBACKS used when the runtime SLA settings
// (Team-tab editable table, persisted in app_settings.queue_sla_thresholds)
// haven't loaded yet, or when a normalizer is called without a slaConfig
// argument. Once the hook delivers a config, slaMsFor() resolves to those
// values instead.
const AMENDMENT_SLA_ACTIVE_MS  = 24 * HOUR_MS;
const AMENDMENT_SLA_PAUSED_MS  = PAUSED_SLA_MS;
const REDLINE_SLA_ACTIVE_MS    = 5  * DAY_MS;
const REDLINE_SLA_PAUSED_MS    = PAUSED_SLA_MS;
// Incentive plans share the redline cadence per Mohamed's 2026-05-01 spec.
const INCENTIVE_PLAN_SLA_ACTIVE_MS = 5 * DAY_MS;
const INCENTIVE_PLAN_SLA_PAUSED_MS = PAUSED_SLA_MS;
const ONBOARDING_SLA_ACTIVE_MS = 24 * HOUR_MS;
const ONBOARDING_SLA_PAUSED_MS = PAUSED_SLA_MS;
// Offboarding splits by row type (typeLabel). Both share the same paused window.
const OFFBOARDING_TERM_ACTIVE_MS  = 14 * DAY_MS;
const OFFBOARDING_RESIG_ACTIVE_MS = 5  * DAY_MS;
const OFFBOARDING_SLA_PAUSED_MS   = PAUSED_SLA_MS;
const WORKBENCH_SLA_ACTIVE_MS  = 48 * HOUR_MS;
const WORKBENCH_SLA_PAUSED_MS  = PAUSED_SLA_MS;

// Resolve the active/paused window for a given queue. Reads slaConfig
// (the per-queue { activeMins, pausedMins? } object delivered by
// useQueueSlaSettings) when present, otherwise falls back to the
// hardcoded defaults above. Minutes → ms inline so callers can pass the
// result straight into computeSlaWindow.
function slaMsFor(slaConfig, queueId, fallbackActiveMs, fallbackPausedMs) {
  const cfg = slaConfig && slaConfig[queueId];
  const activeMs = (cfg && Number.isFinite(cfg.activeMins) && cfg.activeMins > 0)
    ? cfg.activeMins * 60 * 1000
    : fallbackActiveMs;
  const pausedMs = (cfg && Number.isFinite(cfg.pausedMins) && cfg.pausedMins > 0)
    ? cfg.pausedMins * 60 * 1000
    : fallbackPausedMs;
  return { activeMs, pausedMs };
}

// Shared SLA computation. Returns `{ slaRemaining (seconds), slaBreachStatus }`
// shaped exactly like the Workbench upstream so the SourceTable badge renders
// uniformly. When `pausedMs`/`pausedAt` are provided AND truthy, the paused
// branch wins (the pause clock is what the team actually races against).
// Elapsed time is measured on the BUSINESS DAY clock (Sat/Sun excluded) so
// a row created Friday afternoon doesn't accumulate weekend ms against its
// window. Falls back gracefully when timestamps are missing — never crashes
// the row.
function computeSlaWindow(activeMs, createdAt, opts = {}) {
  const { pausedMs, pausedAt } = opts;
  const now = Date.now();
  if (pausedMs && pausedAt) {
    const ts = new Date(pausedAt).getTime();
    if (Number.isFinite(ts) && ts > 0) {
      const slaRemaining = Math.round((pausedMs - elapsedBizMs(ts, now)) / 1000);
      return {
        slaRemaining,
        slaBreachStatus: slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED',
        slaWindowMs: pausedMs,
      };
    }
  }
  if (createdAt) {
    const ts = new Date(createdAt).getTime();
    if (Number.isFinite(ts) && ts > 0) {
      const slaRemaining = Math.round((activeMs - elapsedBizMs(ts, now)) / 1000);
      return {
        slaRemaining,
        slaBreachStatus: slaRemaining < 0 ? 'SLA_BREACHED' : 'SLA_NOT_BREACHED',
        slaWindowMs: activeMs,
      };
    }
  }
  return { slaRemaining: null, slaBreachStatus: null, slaWindowMs: null };
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

// ── Test-data filter ────────────────────────────────────────────────────────
// Catches obvious QA / sandbox rows that occasionally leak into the Deel
// admin payload and pollute the Q tab in production. Examples seen in the
// 2026-05-01 launch audit:
//   "VIA Test", "VIA THREE", "Kirce TEST-TWO", "Global Test", "Global Test New",
//   "Dan Man", "michele wrfgrw" (keyboard-mash).
//
// Patterns we filter:
//   • Standalone "TEST" / "TESTING" tokens (case-insensitive)
//   • Names containing "test-N" / "testN" sequences
//   • All-lowercase fully-random strings ≥6 chars that don't match common
//     name shapes — i.e. no vowels, or all-consonant gibberish
//   • Subject ending with "TEST", "QA", "DEMO" (case-insensitive)
// We err on the side of false-negatives (leaving real rows visible) rather
// than false-positives — anything ambiguous stays in the queue. To bypass
// for debugging set localStorage `ops_hub_show_test_rows = '1'`.
const TEST_NAME_RX = /(?:^|\s|[-_])(?:test|testing|qa|demo|sandbox|staging|tmp)(?:\s|[-_]|\d|$)|^test\b|\btest\d+\b|\btest[- ]?\w{1,4}$|^global\s+test\b|^dan\s+man$|^[a-z]{6,}$/i;

function isLikelyTestRow(name) {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed) return false;
  // Allow real names like "Tester Smith" — only flag if "test" is a *standalone*
  // token, not a substring of a longer word.
  if (/^[a-z]{6,20}$/.test(trimmed) && !/[aeiou]/i.test(trimmed)) return true; // "wrfgrw"
  if (TEST_NAME_RX.test(trimmed)) {
    // Don't flag names that contain a real first+last shape unless an explicit
    // "TEST" token is present.
    if (/\btest\b|\btesting\b|\bqa\b|\bdemo\b|\bsandbox\b|\bstaging\b|\btest[- ]?\d/i.test(trimmed)) return true;
    if (/^global\s+test\b/i.test(trimmed)) return true;
    if (/^dan\s+man$/i.test(trimmed)) return true;
  }
  return false;
}

// Allow flag-flip override from the browser console for debugging.
function testRowsAllowed() {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage?.getItem('ops_hub_show_test_rows') === '1'; } catch { return false; }
}

function dropTestRows(items, getNames) {
  if (testRowsAllowed()) return items;
  return (items || []).filter(item => {
    const names = getNames(item).filter(Boolean);
    return !names.some(n => isLikelyTestRow(n));
  });
}

// ── Date formatter for subject lines ──
function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Onboarding → normalized rows ──
export function normalizeOnboarding(items = [], slaConfig = null) {
  const { activeMs } = slaMsFor(slaConfig, 'onboarding', ONBOARDING_SLA_ACTIVE_MS, ONBOARDING_SLA_PAUSED_MS);
  return dropTestRows(items, p => [p?.name, p?.clientName]).map(p => {
    // Friendly flow step: "Onboarding.ComplianceDocs.AwaitingReview" → "Compliance Docs · Awaiting Review"
    const flowParts = (p.flowStep || '').split('.').slice(1);
    const flowDisplay = flowParts.map(part => part.replace(/([A-Z])/g, ' $1').trim()).join(' · ');
    const startStr = fmtShortDate(p.startDate);

    // Task URL: admin dashboard deep-link. The admin UI's path is shaped:
    //   /dashboards/employees/{COUNTRY}/status/{FULL_FLOW_STEP}/contract/{OID}/step/{LAST_STEP_SEGMENT}
    // e.g.
    //   /dashboards/employees/JP/status/Onboarding.ComplianceDocs.AwaitingReview/contract/3g764v7/step/AwaitingReview
    //   /dashboards/employees/DE/status/Onboarding.EA.EAAdditionalDetails.AwaitingReview/contract/36pgxxq/step/AwaitingReview
    // We previously hardcoded country=GLOBAL + status=Onboarding.ActionableQueue
    // which landed on the wrong tab; the admin UI then ignored the step
    // segment because it didn't match the bucket.
    const taskCountry = p.country || 'GLOBAL';
    const flowSegments = (p.flowStep || '').split('.').filter(Boolean);
    const lastStep = flowSegments[flowSegments.length - 1] || '';
    const taskUrl = (p.oid && p.flowStep)
      ? `${DEEL_ADMIN_BASE}/dashboards/employees/${taskCountry}/status/${p.flowStep}/contract/${p.oid}/step/${lastStep}`
      : (p.oid ? `${DEEL_ADMIN_BASE}/dashboards/employees/${taskCountry}/status/Onboarding.ActionableQueue/contract/${p.oid}` : '');

    const createdAt = p.taskCreatedAt || p.createdAt || '';
    const sla = computeSlaWindow(activeMs, createdAt);

    // Onboarding HAS an upstream HRX assignee in most cases — fall back to
    // a synthetic country-owner only when it's missing, never override.
    let assigneeName = p.assignee || '';
    let assigneeEmail = (p.assigneeEmail || resolveEmailByName(p.assignee) || '').toLowerCase();
    let assigneeIsSynthetic = false;
    if (!assigneeEmail) {
      const synth = syntheticOwnerForCountry(p.country, p.id || p.oid);
      if (synth) {
        assigneeName = synth.name;
        assigneeEmail = synth.email;
        assigneeIsSynthetic = true;
      }
    }

    return {
      id: p.id || p.oid || '',
      source: 'onboarding',
      subject: p.name || 'Unknown',
      clientName: p.clientName || '',
      startDate: p.startDate || '',
      function: flowDisplay || 'Onboarding',
      country: p.country || '',
      assignee: assigneeName,
      assigneeEmail,
      assigneeIsSynthetic,
      createdAt,
      updatedAt: p.taskCreatedAt || '',
      status: p.action || { label: 'In Progress', severity: 'active', color: '#1d4ed8' },
      taskUrl,
      contractUrl: DEEL_CONTRACT_URL(p.oid),
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
      slaWindowMs: sla.slaWindowMs,
    };
  });
}

// ── Paused Onboarding → normalized rows ──
export function normalizePausedOnboarding(items = [], slaConfig = null) {
  const { activeMs, pausedMs } = slaMsFor(slaConfig, 'onboarding', ONBOARDING_SLA_ACTIVE_MS, ONBOARDING_SLA_PAUSED_MS);
  return dropTestRows(items, p => [p?.name, p?.clientName]).map(p => {
    // Pause type label: REDLINE → "Redline", MANUAL → "Manual", AMENDMENT → "Amendment"
    const pauseLabel = (p.pauseType || 'Paused')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, c => c.toUpperCase());

    const createdAt = p.createdAt || '';
    const pausedAt = p.updatedAt || p.taskCreatedAt || '';   // best proxy for when it was paused
    const sla = computeSlaWindow(activeMs, createdAt, { pausedMs, pausedAt });

    // Same fallback pattern as actionable onboarding — only synthesize
    // when upstream is missing.
    let assigneeName = p.assignee || '';
    let assigneeEmail = (p.assigneeEmail || resolveEmailByName(p.assignee) || '').toLowerCase();
    let assigneeIsSynthetic = false;
    if (!assigneeEmail) {
      const synth = syntheticOwnerForCountry(p.country, p.id || p.oid);
      if (synth) {
        assigneeName = synth.name;
        assigneeEmail = synth.email;
        assigneeIsSynthetic = true;
      }
    }

    return {
      id: p.id || p.oid || '',
      source: 'onboarding',
      subject: p.name || 'Unknown',
      clientName: p.clientName || '',
      startDate: p.startDate || '',
      function: `Paused · ${pauseLabel}`,
      country: p.country || '',
      assignee: assigneeName,
      assigneeEmail,
      assigneeIsSynthetic,
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
      slaWindowMs: sla.slaWindowMs,
    };
  });
}

// ── Offboarding → normalized rows ──
// Type-aware SLA: Termination uses `offboarding_termination` (default 14
// biz-days), Resignation uses `offboarding_resignation` (default 5 biz-days).
// The Team-tab editor exposes both as separately tunable rows so leadership
// can dial each path independently. Paused window is the universal 48h.
export function normalizeOffboarding(items = [], slaConfig = null) {
  const term = slaMsFor(slaConfig, 'offboarding_termination', OFFBOARDING_TERM_ACTIVE_MS, OFFBOARDING_SLA_PAUSED_MS);
  const resig = slaMsFor(slaConfig, 'offboarding_resignation', OFFBOARDING_RESIG_ACTIVE_MS, OFFBOARDING_SLA_PAUSED_MS);
  return dropTestRows(items, c => [c?.name, c?.organizationName]).map(c => {
    const createdAt = c.requestedDate || c.createdAt || '';
    const isResignation = (c.typeLabel || '').startsWith('Resignation');
    const { activeMs, pausedMs } = isResignation ? resig : term;
    // Offboarding has no native paused state in the upstream payload, but
    // honour `c.isPaused` / `c.pausedAt` if either ever surfaces — keeps the
    // 48h paused rule applicable here too.
    const sla = computeSlaWindow(activeMs, createdAt, {
      pausedMs: c.isPaused ? pausedMs : null,
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
      slaWindowMs: sla.slaWindowMs,
    };
  });
}

// ── Amendments → normalized rows ──
export function normalizeAmendments(items = [], slaConfig = null) {
  const { activeMs, pausedMs } = slaMsFor(slaConfig, 'amendments', AMENDMENT_SLA_ACTIVE_MS, AMENDMENT_SLA_PAUSED_MS);
  return dropTestRows(items, a => [a?.employeeName, a?.clientName]).map(a => {
    const changesSummary = a.changes?.length > 0
      ? a.changes.map(c => c.label || c.dataPoint).filter(Boolean).join(', ')
      : '';

    // SLA: configurable active window (24h default), paused 48h default.
    const sla = computeSlaWindow(activeMs, a.createdAt, {
      pausedMs: a.isPaused ? pausedMs : null,
      pausedAt: a.pausedAt,
    });
    const slaRemaining = sla.slaRemaining;
    const slaBreachStatus = sla.slaBreachStatus;
    const slaWindowMs = sla.slaWindowMs;

    // No upstream assignee — synthesize from country owners so the row
    // attributes to a specific person in Briefing capacity / Team SLA dot /
    // Analytics. Multi-owner countries split deterministically by row id.
    const synth = syntheticOwnerForCountry(a.country, a.id);

    return {
      id: String(a.id || ''),
      source: 'amendments',
      subject: a.employeeName || 'Unknown',
      function: changesSummary || `${a.type || 'Amendment'} Amendment`,
      country: a.country || '',
      clientName: a.clientName || '',
      assignee: synth?.name || '',
      assigneeEmail: synth?.email || '',
      assigneeIsSynthetic: !!synth,
      createdAt: a.createdAt || '',
      updatedAt: a.updatedAt || a.createdAt || '',
      status: a.displayStatus || { label: 'Amendment', severity: 'active', color: '#1d4ed8' },
      taskUrl: DEEL_AMENDMENT_URL(a.id, a.currentStatus),
      contractUrl: DEEL_CONTRACT_URL(a.contractOid),
      pausedAt: a.pausedAt || null,
      isPaused: !!a.isPaused,
      slaRemaining,
      slaBreachStatus,
      slaWindowMs,
    };
  });
}

// ── Redlines → normalized rows ──
export function normalizeRedlines(items = [], slaConfig = null) {
  const { activeMs, pausedMs } = slaMsFor(slaConfig, 'redlines', REDLINE_SLA_ACTIVE_MS, REDLINE_SLA_PAUSED_MS);
  return dropTestRows(items, r => [r?.employeeName, r?.orgName, r?.templateName]).map(r => {
    const typeLabel = r.type === 'templateRedline' ? 'Template' : r.type === 'contractRedline' ? 'Contract' : r.type || '';

    // Subject — the row's lead identifier, shown in the Employee column.
    //   - Contract redlines: the employee's legal name (enriched from
    //     /rest/v2/contracts in the BE if missing from the raw payload).
    //   - Template redlines: there is no employee — render a label that makes
    //     it clear the row is org-level, not "Org Name == Org Name". Previous
    //     fall-through to `orgName` produced the 2026-05-01-audit bug where
    //     every Redlines row showed the same value in Employee and
    //     Organization columns.
    //   - Else: fall back to template name, then a truncated redline ID so
    //     the row is never anonymous.
    const isTemplate = r.type === 'templateRedline';
    const templateLabel = r.templateName
      ? `Template: ${r.templateName}`
      : (r.orgName ? `Template (${r.orgName})` : 'Template Redline');
    const subject = r.employeeName
                 || (isTemplate ? templateLabel : null)
                 || r.templateName
                 || r.orgName
                 || (r.id ? `${typeLabel || 'Redline'} ${String(r.id).slice(0, 8)}` : 'Redline');

    // Configurable active window (72h default); 48h from pausedAt when paused.
    const sla = computeSlaWindow(activeMs, r.createdAt, {
      pausedMs: r.isPaused ? pausedMs : null,
      pausedAt: r.pausedAt || null,
    });
    const slaRemaining = sla.slaRemaining;
    const slaBreachStatus = sla.slaBreachStatus;
    const slaWindowMs = sla.slaWindowMs;

    // Same synthetic-owner pattern as amendments. Country comes from
    // r.countryCode first; falls back to the first listed country for
    // template redlines that span several.
    const country = r.countryCode || (r.countries?.[0] || '');
    const synth = syntheticOwnerForCountry(country, r.id);

    return {
      id: String(r.id || ''),
      source: 'redlines',
      subject,
      function: `${typeLabel} Redline${r.countries?.length ? ' · ' + r.countries.join(', ') : ''}`,
      country,
      // Client Name column: always the creating org (template redlines) or
      // the employee's employer org if available.
      clientName: r.orgName || '',
      assignee: synth?.name || '',
      assigneeEmail: synth?.email || '',
      assigneeIsSynthetic: !!synth,
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
      slaWindowMs,
    };
  });
}

// ── Incentive Plans → normalized rows ──
// Same SLA cadence as redlines (5 biz-days active, 48h biz from pausedAt
// when paused). No upstream assignee — country-OR-assignee scoping in the
// FE means country owners + their TL/RM chain see the row regardless of
// who's editing it.
export function normalizeIncentivePlans(items = [], slaConfig = null) {
  const { activeMs, pausedMs } = slaMsFor(slaConfig, 'incentive_plans', INCENTIVE_PLAN_SLA_ACTIVE_MS, INCENTIVE_PLAN_SLA_PAUSED_MS);
  return dropTestRows(items, p => [p?.employeeName, p?.orgName]).map(p => {
    const sla = computeSlaWindow(activeMs, p.createdAt, {
      pausedMs: p.isPaused ? pausedMs : null,
      pausedAt: p.pausedAt || null,
    });
    // No upstream assignee — synthesize from country owners (mirrors
    // amendments / redlines).
    const synth = syntheticOwnerForCountry(p.country, p.id);

    return {
      id: String(p.id || ''),
      source: 'incentive_plans',
      // Employee column — IP rows are always tied to a single employee.
      subject: p.employeeName || 'Incentive Plan',
      // Function column — fixed for now since the only actionable status
      // is PENDING_IP_PREPARATION; SourceTable users rarely sort by it.
      function: 'Incentive Plan Preparation',
      country: p.country || '',
      clientName: p.orgName || '',
      assignee: synth?.name || '',
      assigneeEmail: synth?.email || '',
      assigneeIsSynthetic: !!synth,
      startDate: p.startDate || '',
      createdAt: p.createdAt || '',
      updatedAt: p.updatedAt || p.createdAt || '',
      status: p.displayStatus || { label: 'Pending IP Preparation', severity: 'warning', color: '#ed8d00' },
      taskUrl: DEEL_INCENTIVE_PLAN_URL(p.id, p.status),
      contractUrl: DEEL_CONTRACT_URL(p.contractOid || p.eorContractId),
      isPaused: !!p.isPaused,
      pausedAt: p.pausedAt || null,
      isWhiteLabeled: !!p.isWhiteLabeled,
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
      slaWindowMs: sla.slaWindowMs,
    };
  });
}

// ── Workbench → normalized rows ──
export function normalizeWorkbench(items = [], slaConfig = null) {
  const { activeMs, pausedMs } = slaMsFor(slaConfig, 'workbench', WORKBENCH_SLA_ACTIVE_MS, WORKBENCH_SLA_PAUSED_MS);
  return dropTestRows(items, t => [t?.name]).map(t => {
    // Override upstream Deel-side SLA with the configured flat-from-creation
    // policy. The upstream `t.slaTime`/`t.slaRemaining` vary arbitrarily per
    // task config and don't match the team's operating model. Paused branch
    // (configurable) applies when upstream flags a pause state.
    const isPaused = !!t.isPaused || t.status === 'ON_HOLD';
    const pausedAt = t.pausedAt || (t.status === 'ON_HOLD' ? t.updatedAt : null);
    const sla = computeSlaWindow(activeMs, t.createdAt, {
      pausedMs: isPaused ? pausedMs : null,
      pausedAt,
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
      // Surfaces the paused state to SourceTable so the Paused section
      // partition picks up workbench `ON_HOLD` rows alongside the upstream
      // `isPaused` flag.
      isPaused,
      pausedAt,
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
      slaWindowMs: sla.slaWindowMs,
    };
  });
}
