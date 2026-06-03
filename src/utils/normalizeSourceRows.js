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
// Title-case a snake_case / UPPER_SNAKE database enum for display.
// "EOR_DEFINITE_CONTRACT_ENDING" → "EOR Definite Contract Ending"
// "expedite_eor_onboarding" → "Expedite EOR Onboarding"
// Already-titled inputs (e.g. "Expedite EOR Onboarding") pass through unchanged.
// 2026-05-21 audit U78: introduced to stop the Workbench TYPE column from
// rendering raw upstream enums.
const ENUM_ACRONYMS = new Set(['EOR', 'HRX', 'PTO', 'WL', 'IP', 'TC', 'OOO', 'SLA', 'MOC', 'KPI', 'EVL']);
function prettifyTaskType(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  // Heuristic: only transform when the string is clearly snake-case (contains
  // an underscore and is uppercase-heavy). Otherwise pass through so existing
  // display strings like "Expedite EOR Onboarding" stay intact.
  if (!raw.includes('_')) return raw;
  return raw.split(/[_\s]+/).filter(Boolean).map(part => {
    const upper = part.toUpperCase();
    if (ENUM_ACRONYMS.has(upper)) return upper;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ');
}

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
// 2026-05-28 (Pablo Gonzalez — Adapt SLA timers to Immigration):
// Global Immigration workbench tasks legitimately run multi-month
// because visa cases stretch across embassy timelines. The HRX 48h
// window misrepresents them as Breached the moment they're picked up.
// Pablo spec: 2 months TRT. Applied via the `deptSlug` opt on
// normalizeWorkbench so HRX (and every other future dept) keeps the
// 48h default until they explicitly request an override.
const WORKBENCH_SLA_ACTIVE_MS_GIX = 60 * DAY_MS;
// Pablo spec: Immigration Tasks track on a 1-day TRT regardless of the
// upstream `dueDate` Deel admin happens to set. Replaces the previous
// `Math.max(1d, dueMs - createdMs)` window — that surfaced rows with
// arbitrarily-long Deel-side targets as "not at risk" for weeks, even
// when they were the same kind of work as a 1-day case.
const IMMIGRATION_TASK_SLA_ACTIVE_MS = 1 * DAY_MS;

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

function _ingestMemberIntoNameMaps(m, { warnOnCollision = true } = {}) {
  if (!m || !m.name || !m.email) return;
  const lower = m.name.toLowerCase();
  const stripped = stripAccents(lower);
  const collapsed = stripped.replace(/\s+/g, '');
  const existingExact = _nameToEmail.get(lower);
  if (existingExact === m.email) return; // already ingested (cheap idempotency)
  if (warnOnCollision) {
    if (!_noteCollision('exact', lower, existingExact, m.email)) _nameToEmail.set(lower, m.email);
    if (!_noteCollision('stripped', stripped, _nameToEmailNorm.get(stripped), m.email)) {
      _nameToEmailNorm.set(stripped, m.email);
    }
    if (!_noteCollision('collapsed', collapsed, _nameNoSpace.get(collapsed), m.email)) {
      _nameNoSpace.set(collapsed, m.email);
    }
  } else {
    // Silent set-if-absent (used by the hydration callback so a refresh
    // doesn't re-warn for collisions already noted at module init).
    if (!existingExact) _nameToEmail.set(lower, m.email);
    if (!_nameToEmailNorm.has(stripped)) _nameToEmailNorm.set(stripped, m.email);
    if (!_nameNoSpace.has(collapsed)) _nameNoSpace.set(collapsed, m.email);
  }
  const tokens = tokenize(m.name);
  if (tokens.length >= 2) {
    const flKey = `${tokens[0]}|${tokens[tokens.length - 1]}`;
    if (warnOnCollision) {
      if (!_noteCollision('first|last', flKey, _firstLastToEmail.get(flKey), m.email)) {
        _firstLastToEmail.set(flKey, m.email);
      }
    } else if (!_firstLastToEmail.has(flKey)) {
      _firstLastToEmail.set(flKey, m.email);
    }
  }
}

for (const m of TEAM_MEMBERS) {
  _ingestMemberIntoNameMaps(m, { warnOnCollision: true });
}

/**
 * Re-populate the name→email lookup with the runtime roster (overrides + Phase
 * 14 GIX seed + future per-dept rosters). Without this, `resolveEmailByName`
 * only sees the static `TEAM_MEMBERS` baseline — every member added via
 * `team_member_overrides` is invisible, so name-only upstreams (mobility
 * activeAgent, terminations_v3 exAssignee) can't resolve to an email and the
 * row falls through to country-fallback scoping. The 2026-05-29 GIX TL fix
 * (Beata) depends on this.
 *
 * Called by `roster-server.ensureRosterHydrated` after `hydrateRoster(merged)`
 * lands. Safe to call repeatedly — the per-member ingest is idempotent on
 * already-known (name, email) pairs and silent on collisions to avoid log
 * spam on every TTL refresh.
 */
export function hydrateNameToEmail(members) {
  if (!Array.isArray(members) || members.length === 0) return false;
  let added = 0;
  for (const m of members) {
    if (!m?.email || !m?.name) continue;
    if (_nameToEmail.get(m.name.toLowerCase()) === m.email) continue;
    _ingestMemberIntoNameMaps(m, { warnOnCollision: false });
    added++;
  }
  return added > 0;
}

export function resolveEmailByName(name) {
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

// ── Test-data filter (DISABLED 2026-05-04) ────────────────────────────────
// Originally caught QA / sandbox rows that leaked into the Deel admin
// payload (e.g. "VIA THREE", "Global Test", "Yoram Gondwetest", keyboard
// mash like "michele wrfgrw"). Same anti-pattern as the Deeler-tag filter
// we removed earlier in this PR cycle: silently dropping rows broke the
// "platform total = picker count" trust contract — an Incentive Plans
// audit found 11 of 43 rows being stripped (`\w{2,}test\b` and
// `\btest\w{0,4}\b` were over-matching real customer surnames like
// "Testa", "Tester"). Junk now flows through the same hide-task workflow
// every other suppression uses, which is auditable and reversible.
//
// The detection heuristics below are kept for reference (and the
// localStorage override still works for ad-hoc debugging in dev), but
// `dropTestRows` no longer filters by default.

// Number-words used in QA naming patterns ("VIA THREE", "Test Two").
const NUMBER_WORDS_RX = /(?:one|two|three|four|five|six|seven|eight|nine|ten)/i;

// Tokenise on whitespace + common separators so we can examine each part
// independently (the previous full-string regex missed `michele wrfgrw`
// because the random token was the second word).
function _tokenize(name) {
  return String(name).toLowerCase().split(/[\s_\-/]+/).filter(Boolean);
}

// Returns true if a single token looks like keyboard-mash:
//   • all consonant, length ≥ 4 ("wrfgrw", "wrfgrw", "tnnt")
//   • mixed lowercase letters with no vowels
function _isConsonantMash(token) {
  if (!/^[a-z]+$/.test(token)) return false;
  if (token.length < 4) return false;
  if (/[aeiouy]/i.test(token)) return false;
  return true;
}

function isLikelyTestRow(name) {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  // 1) Standalone "TEST" / "TESTING" / "QA" / "DEMO" / "SANDBOX" / "STAGING" / "TMP" token
  if (/(?:^|[\s\-_])(?:test|testing|qa|demo|sandbox|staging|tmp)(?:[\s\-_]|\d|$)/i.test(trimmed)) return true;

  // 2) "test"-as-suffix or embedded in a surname-like position:
  //    "Gondwetest", "Smith-test", "Anna_test", "Yoram Gondwetest"
  if (/\w{2,}test\b/i.test(trimmed)) return true;
  if (/\btest\w{0,4}\b/i.test(trimmed)) return true;

  // 3) "VIA <NUMBER-WORD>" — the live data has "VIA THREE", "VIA TWO", etc.
  if (new RegExp('^via\\s+' + NUMBER_WORDS_RX.source + '\\b', 'i').test(trimmed)) return true;

  // 4) "Global Test" / "Global Test New" / similar generic-test names.
  if (/^global\s+test\b/i.test(trimmed)) return true;

  // 5) Two-word minimal names that look fake:
  //    "Dan Man", "Foo Bar", anything short with no real surname pattern
  if (/^dan\s+man$/i.test(trimmed)) return true;

  // 6) Any token in the name that's keyboard-mash (consonant-only, ≥4 chars).
  //    Catches "michele wrfgrw" — the second token is mash. We require the
  //    name has at least 2 tokens before applying this, so single-word names
  //    like "Trinh" (Vietnamese, all consonants by Latin alphabet rules but
  //    a real name) aren't accidentally caught.
  const tokens = _tokenize(lower);
  if (tokens.length >= 2 && tokens.some(_isConsonantMash)) return true;

  // 7) Single-token all-consonant gibberish (≥6 chars) — kept from the
  //    previous version so "wrfgrw" alone still flags.
  if (tokens.length === 1 && /^[a-z]{6,}$/.test(tokens[0]) && !/[aeiou]/i.test(tokens[0])) return true;

  return false;
}

// Optional ad-hoc filter — only applied when localStorage flag
// `ops_hub_drop_test_rows = '1'` is explicitly set (was the inverse
// before: drop by default, opt-out via flag). Default behaviour is
// pass-through so nothing is silently filtered. Reuse the helper +
// `isLikelyTestRow` heuristics if/when we want to surface a one-click
// "hide test rows" toggle in the UI.
function testRowsDropEnabled() {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage?.getItem('ops_hub_drop_test_rows') === '1'; } catch { return false; }
}

function dropTestRows(items, getNames) {
  if (!testRowsDropEnabled()) return items || [];
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
      reassignedFromEmail: p.reassignedFromEmail || null,
      reassignedAt: p.reassignedAt || null,
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
      reassignedFromEmail: p.reassignedFromEmail || null,
      reassignedAt: p.reassignedAt || null,
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
      // Server flags a case whose termination workflow advanced recently (≤24h)
      // so the row shows an "Updated" badge — pairs with the bell notification.
      recentlyUpdated: c.recentlyUpdated === true,
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
    // Anchor on actionableSince (earliest entry into AmendmentRequested /
    // WaitingHrxAction) rather than upstream createdAt. createdAt is the
    // moment Deel persisted the record — often weeks/months before the
    // client confirms and the row lands in HRX's queue. Anchoring on it
    // painted just-received amendments as "181 days breached". Fall back
    // to clientConfirmedAt then createdAt for rows whose status history
    // didn't make it into the payload.
    const slaAnchor = a.actionableSince || a.clientConfirmedAt || a.createdAt;
    const sla = computeSlaWindow(activeMs, slaAnchor, {
      pausedMs: a.isPaused ? pausedMs : null,
      pausedAt: a.pausedAt,
    });
    const slaRemaining = sla.slaRemaining;
    const slaBreachStatus = sla.slaBreachStatus;
    const slaWindowMs = sla.slaWindowMs;

    // No upstream assignee — synthesize from country owners so the row
    // attributes to a specific person in Briefing capacity / Team SLA dot /
    // Analytics. Multi-owner countries split deterministically by row id.
    // An in-app reassignment (queue_reassignments) overlays a real assignee
    // on `a.assigneeEmail` server-side; if present, it wins over the
    // country-owner synth so the new assignee shows up everywhere.
    const overrideEmail = (a.assigneeEmail || '').toLowerCase();
    const synth = overrideEmail ? null : syntheticOwnerForCountry(a.country, a.id);

    return {
      id: String(a.id || ''),
      source: 'amendments',
      subject: a.employeeName || 'Unknown',
      function: changesSummary || `${a.type || 'Amendment'} Amendment`,
      country: a.country || '',
      clientName: a.clientName || '',
      assignee: overrideEmail ? (a.assignee || overrideEmail) : (synth?.name || ''),
      assigneeEmail: overrideEmail || synth?.email || '',
      assigneeIsSynthetic: !overrideEmail && !!synth,
      reassignedFromEmail: a.reassignedFromEmail || null,
      reassignedAt: a.reassignedAt || null,
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
    // template redlines that span several. An in-app reassignment overlays
    // a real assignee on r.assigneeEmail server-side and wins over synth.
    const country = r.countryCode || (r.countries?.[0] || '');
    const overrideEmail = (r.assigneeEmail || '').toLowerCase();
    const synth = overrideEmail ? null : syntheticOwnerForCountry(country, r.id);

    return {
      id: String(r.id || ''),
      source: 'redlines',
      subject,
      function: `${typeLabel} Redline${r.countries?.length ? ' · ' + r.countries.join(', ') : ''}`,
      country,
      // Client Name column: always the creating org (template redlines) or
      // the employee's employer org if available.
      clientName: r.orgName || '',
      assignee: overrideEmail ? (r.assignee || overrideEmail) : (synth?.name || ''),
      assigneeEmail: overrideEmail || synth?.email || '',
      assigneeIsSynthetic: !overrideEmail && !!synth,
      reassignedFromEmail: r.reassignedFromEmail || null,
      reassignedAt: r.reassignedAt || null,
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
    // amendments / redlines). An in-app reassignment overlays a real
    // assignee on p.assigneeEmail server-side and wins over synth.
    const overrideEmail = (p.assigneeEmail || '').toLowerCase();
    const synth = overrideEmail ? null : syntheticOwnerForCountry(p.country, p.id);

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
      assignee: overrideEmail ? (p.assignee || overrideEmail) : (synth?.name || ''),
      assigneeEmail: overrideEmail || synth?.email || '',
      assigneeIsSynthetic: !overrideEmail && !!synth,
      reassignedFromEmail: p.reassignedFromEmail || null,
      reassignedAt: p.reassignedAt || null,
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
export function normalizeWorkbench(items = [], slaConfig = null, opts = {}) {
  // 2026-05-28 — Per-dept SLA override. GIX workbench rows are
  // multi-month immigration cases; 48h breaches them on day-one. When
  // `opts.deptSlug === 'gix'` we swap the active-window default for the
  // 60-day constant before slaMsFor runs, so a global admin
  // queue_sla_thresholds row (if one ever lands for workbench) still
  // wins, but the bare-default reflects what GIX actually operates on.
  const fallbackActiveMs = opts?.deptSlug === 'gix'
    ? WORKBENCH_SLA_ACTIVE_MS_GIX
    : WORKBENCH_SLA_ACTIVE_MS;
  const { activeMs, pausedMs } = slaMsFor(slaConfig, 'workbench', fallbackActiveMs, WORKBENCH_SLA_PAUSED_MS);
  return dropTestRows(items, t => [t?.name]).map(t => {
    // `listWorkbenchTasks` returns both the active backlog (TO_DO /
    // IN_PROGRESS / ON_HOLD / ESCALATED) AND a rolling 24h of recently-
    // finished rows (COMPLETED / CLOSED) so the home "Resolved Today" KPI
    // can include workbench. Flag terminal states here so every consumer
    // can section them out of active aggregates — the SourceTable's
    // "RESOLVED TODAY" group, header counts, SLA pills, and the Briefing /
    // Team / AgentHome active-count rollups all read this.
    const rawStatus = String(t.status || '').toUpperCase();
    const isResolved = rawStatus === 'COMPLETED' || rawStatus === 'CLOSED';
    const resolvedAt = isResolved ? (t.completedAt || t.updatedAt || null) : null;
    // Override upstream Deel-side SLA with the configured flat-from-creation
    // policy. The upstream `t.slaTime`/`t.slaRemaining` vary arbitrarily per
    // task config and don't match the team's operating model. Paused branch
    // (configurable) applies when upstream flags a pause state.
    const isPaused = !isResolved && (!!t.isPaused || rawStatus === 'ON_HOLD');
    const pausedAt = isPaused ? (t.pausedAt || (rawStatus === 'ON_HOLD' ? t.updatedAt : null)) : null;
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
      // 2026-05-21 audit U78: upstream sometimes serves snake_case database
      // enums like "EOR_DEFINITE_CONTRACT_ENDING". Title-case them at the
      // normalisation layer so the column never bleeds raw DB values.
      typeLabel: prettifyTaskType(t.taskType || t.sourceType || 'Workbench'),
      function: prettifyTaskType(t.taskType || t.sourceType || 'Workbench'),
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
      isResolved,
      resolvedAt,
      // SLA fields stay populated for resolved rows so Analytics' SLA
      // compliance pool can include them with their final state (mirrors
      // how resolved tickets are evaluated at resolution time). Active-
      // backlog consumers gate on `isResolved` instead of zeroing SLA.
      slaRemaining: sla.slaRemaining,
      slaBreachStatus: sla.slaBreachStatus,
      slaWindowMs: sla.slaWindowMs,
    };
  });
}

// ── Immigration Tasks (Mobility Actions) — GIX-only ────────────────────────
// 2026-05-22 (evening). Source: `/admin/mobility/actions` via the GIX
// admin token. Each task has its OWN `dueDate` (per-task SLA), so the
// SLA window is derived per-row from (dueDate - createdAt) rather than
// a flat policy. Status enum:
//   • ONGOING — active (queried explicitly by status[]=ONGOING)
//   • COMPLETED / ARCHIVED / CANCELLED — terminal (filtered out
//     upstream; flagged here as defence in depth in case upstream
//     ever changes its mind)
//
// Task-type display: the upstream returns SCREAMING_SNAKE_CASE enums
// (UPLOAD_DOCUMENT / FILL_FORM / QUOTE_APPROVAL / ...). The friendly
// `name` field already carries the rendered label ("Document upload"),
// so we prefer that for the Type column.
function prettifyImmigrationTaskName(t) {
  if (typeof t?.name === 'string' && t.name.trim()) return t.name.trim();
  const raw = String(t?.taskType || '').replace(/_/g, ' ').toLowerCase();
  return raw ? raw.replace(/\b\w/g, c => c.toUpperCase()) : 'Immigration Task';
}

const DEEL_MOBILITY_CASE_URL = (caseId, taskId) => {
  if (!caseId) return '';
  const base = `https://admin.deel.network/mobility/case-management/cases/${caseId}`;
  return taskId ? `${base}?taskId=${taskId}` : base;
};

export function normalizeImmigrationTasks(items = []) {
  return (items || []).map(t => {
    const taskId = String(t?.id || '');
    const caseData = t?.caseData || {};
    const applicantName = caseData.applicant?.name || '';
    const caseName = caseData.name || '';
    // 2026-05-22 — Pablo Gonzalez (Immigration team) asked for the
    // primary column to show the task name (e.g. "Document upload" /
    // "Form filling" / "Quote approval") which is what the admin UI
    // labels "Task type". The applicant + case combo moves into the
    // secondary "client" slot (ORGANIZATION column in the panel) so
    // triagers still see who/what the task is for in one row, and the
    // organization name (Deel HQ / Saunders / etc.) falls back when
    // applicant/case are missing.
    const taskName = prettifyImmigrationTaskName(t);
    const subject = taskName;

    // 2026-05-28 (Pablo spec — Adapt SLA timers to Immigration):
    // Switched from per-row `dueDate - createdAt` to a flat 1-day TRT
    // computed via the shared computeSlaWindow (business-day clock —
    // weekend ms don't elapse). The previous Deel-admin dueDate model
    // varied arbitrarily per case template and let multi-week rows
    // read "not at risk" indefinitely. A flat 1d window matches the
    // operating rhythm Pablo's team actually races against.
    const sla = computeSlaWindow(IMMIGRATION_TASK_SLA_ACTIVE_MS, t?.createdAt);
    const slaWindowMs = sla.slaWindowMs;
    const slaRemaining = sla.slaRemaining;
    const slaBreachStatus = sla.slaBreachStatus;

    // Status mapping. Upstream `ONGOING` → "Active" pill — matches
    // Mohamed's "Active only" filter. Terminal states map to resolved
    // if they ever leak past the upstream filter.
    const rawStatus = String(t?.status || '').toUpperCase();
    const isResolved = rawStatus === 'COMPLETED' || rawStatus === 'ARCHIVED' || rawStatus === 'CANCELLED';
    const status = isResolved
      ? { label: 'Resolved', severity: 'info',   color: '#29811e' }
      : { label: 'Active',   severity: 'active', color: '#1f74b3' };

    // Case-team summary (e.g. "Greta Klevinskiene + 2 agents" in the
    // upstream UI). The upstream returns `caseTeamPublicProfileIds` —
    // just IDs, no resolver yet. Surface the count so the FE can
    // render a "+ N" affordance; defer name resolution to a follow-up.
    const teamIds = Array.isArray(t?.caseTeamPublicProfileIds) ? t.caseTeamPublicProfileIds : [];
    const caseTeamCount = teamIds.length;

    return {
      id: taskId,
      source: 'immigration_tasks',
      subject,
      // Type column shows the task name ("Document upload" / "Form filling").
      typeLabel: prettifyImmigrationTaskName(t),
      function: prettifyImmigrationTaskName(t),
      country: caseData.country || '',
      // 2026-05-28 (Pablo Gonzalez bug): on /admin/mobility/actions the
      // task-level `t.assignee` is the VISA APPLICANT — the person who
      // has to take the action (upload a doc, sign a form, etc.). That's
      // the same human surfaced by the `clientName` column, so writing
      // it into the Assignee column was double-rendering the client.
      //
      // The actual HRX/GIX team member coordinating the case is on
      // `caseData.activeAgent` (string name) + `caseData.activeAgentId`
      // (profile id). Prefer that. Fall back to `t.assignee.name` ONLY
      // when activeAgent is missing AND the task assignee is clearly
      // NOT the applicant (different name) — otherwise we'd still leak
      // the client into the column on cases without an active agent.
      //
      // 2026-05-29 (Beata Sroda — GIX TL blind spot): the previous
      // version left `assigneeEmail` blank whenever the task assignee
      // was the applicant. That made every row fall through to
      // `_scopeByAssignedOrUnassigned`'s country-fallback — empty for
      // GIX TLs (GIX is a global team without per-country ownership in
      // `team_member_countries`), so TLs/RMs saw zero rows. Fix is to
      // resolve `caseData.activeAgent` (display name) → member email
      // via the existing `resolveEmailByName` helper, exactly how
      // terminations_v3 handles its name-only upstream (skill §3.6 /
      // mistake #23). When the name resolves, the row carries a real
      // assigneeEmail and the assignee-chain visibility works.
      // Unresolvable names (typos, ex-employees, embassy contacts)
      // still fall back to country visibility as before.
      assignee: (() => {
        const activeAgent = (typeof caseData.activeAgent === 'string') ? caseData.activeAgent.trim() : '';
        if (activeAgent) return activeAgent;
        const taskName = (typeof t?.assignee?.name === 'string') ? t.assignee.name.trim() : '';
        if (!taskName) return '';
        if (applicantName && taskName === applicantName) return '';
        return taskName;
      })(),
      assigneeEmail: (() => {
        // 1. Prefer the resolved activeAgent email (the actual GIX/HRX
        //    coordinator). This is the only branch that produces a real
        //    assignee chain for TL/RM scoping.
        const activeAgent = (typeof caseData.activeAgent === 'string') ? caseData.activeAgent.trim() : '';
        if (activeAgent) {
          const resolved = resolveEmailByName(activeAgent);
          if (resolved) return resolved;
        }
        // 2. Otherwise honour the task-level assignee email — but skip
        //    it when the upstream name matches the applicant (applicant
        //    is the human acting, not the case owner).
        const taskEmail = (typeof t?.assignee?.email === 'string') ? t.assignee.email.toLowerCase() : '';
        if (!taskEmail) return '';
        const taskName = (typeof t?.assignee?.name === 'string') ? t.assignee.name.trim() : '';
        if (applicantName && taskName === applicantName) return '';
        return taskEmail;
      })(),
      // 2026-05-22 — `clientName` populates the panel's secondary cell
      // (rendered as ORGANIZATION). Triage needs the applicant + case
      // before the customer org, so prefer that combo and fall back to
      // the organisation name when applicant data is missing.
      clientName: (applicantName && caseName)
        ? `${applicantName} · ${caseName}`
        : (applicantName || caseName || caseData.organization?.name || ''),
      // Surface the case name + ID + URL separately so a follow-up can
      // render a dedicated "Immigration case" link cell without
      // re-parsing the subject.
      caseName,
      caseId: String(caseData.id || ''),
      caseUrl: caseData.id ? DEEL_MOBILITY_CASE_URL(caseData.id) : '',
      processName: t?.processName || '',
      stepName: t?.stepName || '',
      createdAt: t?.createdAt || '',
      updatedAt: t?.updatedAt || t?.createdAt || '',
      // Per-task due date — primary date the SourceTable renders
      // (configured via dateField='dueDate' + dateLabel='Due Date'
      // from Queue.jsx).
      dueDate: t?.dueDate || '',
      dueInDays: typeof t?.dueInDays === 'number' ? t.dueInDays : null,
      status,
      // Deep-link to the case + task in admin.deel.network. Format
      // confirmed by Mohamed via screenshot.
      taskUrl: DEEL_MOBILITY_CASE_URL(caseData.id, taskId),
      caseTeamCount,
      caseTeamIds: teamIds,
      isPaused: false,
      pausedAt: null,
      isResolved,
      resolvedAt: isResolved ? (t?.completedAt || null) : null,
      slaRemaining,
      slaBreachStatus,
      slaWindowMs,
    };
  });
}

// ── Immigration Cases (GIX) — /admin/mobility/cases (OPEN + ON_HOLD) ────────
// Maps a Deel mobility CASE → the row backing the bespoke ImmigrationCasesTable
// (exact columns per Mohamed's 2026-06-03 screenshot).
//
// Field map CONFIRMED against a real /admin/mobility/cases payload (DevTools
// capture 2026-06-03). Confirmed paths: applicantName / applicant.name,
// organization.name, country, type.friendlyName + type.workType, the active
// process (processes[].isActive) → type.friendlyName + lastStatus.status.
// friendlyName, that process's actions[] (dueDate / isSLABreached / userType)
// for the SLA + action-required columns, caseTeam[], tags[],
// expectedCompletionDate, caseDates[] (Next case date) and updatedAt. A
// case-level `vendor` and `expiry` date are NOT in the payload — their
// accessors keep safe fallbacks in case other case types carry them.
const _imCaseField = {
  applicantName: (c) => c?.applicantName || c?.applicant?.name || c?.worker?.name || '',
  organization:  (c) => c?.organization?.name || c?.client?.name || c?.organizationName || '',
  country:       (c) => c?.country || c?.caseCountry || c?.applicant?.country || '',
  vendor:        (c) => c?.vendor?.name || c?.vendorName || (typeof c?.vendor === 'string' ? c.vendor : '') || '',
  tags:          (c) => (Array.isArray(c?.tags) ? c.tags.map(t => (typeof t === 'string' ? t : (t?.name || t?.label || ''))).filter(Boolean) : []),
  estCompletion: (c) => c?.expectedCompletionDate || c?.estimatedCompletionDate || c?.estCompletionDate || '',
  expiry:        (c) => c?.expiryDate || c?.expiresAt || c?.expirationDate || '',
  updatedAt:     (c) => c?.updatedAt || c?.lastUpdatedAt || '',
};

function _imHumanizeWorkType(wt) {
  if (!wt) return '';
  return String(wt).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

const _IM_USERTYPE_LABEL = { AGENT: 'Deel', APPLICANT: 'Applicant', CLIENT: 'Client' };

export function normalizeImmigrationCases(items = []) {
  const now = Date.now();
  return (items || []).map(c => {
    const caseStatus = String(c?.status || '').toUpperCase();           // OPEN / ON_HOLD
    const processes = Array.isArray(c?.processes) ? c.processes : [];
    // Active process drives Process step / SLA / Action required / Case team.
    const proc = processes.find(p => p?.isActive && !p?.isFinished) || processes[0] || null;

    const processName = proc?.type?.friendlyName?.trim() || '';
    const processStep = proc?.lastStatus?.status?.friendlyName?.trim()
      || (proc?.currentStatuses || []).find(s => s?.state === 'ACTIVE')?.friendlyName?.trim()
      || '';

    // Actionable actions = anything still ONGOING/TODO on the active process.
    const actionableActions = (proc?.actions || []).filter(a => {
      const s = String(a?.status || '').toUpperCase();
      return s === 'ONGOING' || s === 'TODO';
    });
    // Distinct action owners, in encounter order (e.g. "Applicant, Deel").
    const ownerSeen = new Set();
    const actionOwners = [];
    for (const a of actionableActions) {
      const ut = String(a?.userType || '').toUpperCase();
      const label = _IM_USERTYPE_LABEL[ut] || (ut ? ut[0] + ut.slice(1).toLowerCase() : '');
      if (label && !ownerSeen.has(label)) { ownerSeen.add(label); actionOwners.push(label); }
    }
    // Step-owner suffix on the Process-step column ("· Deel"): Deel if Deel
    // has any actionable action on the step, else the next party.
    const stepOwner = actionOwners.includes('Deel') ? 'Deel' : (actionOwners[0] || '');

    // Soonest action due + breach flag → Action-required due label + SLA tier.
    let soonestDueMs = null;
    let anyBreached = false;
    for (const a of actionableActions) {
      if (a?.isSLABreached === true) anyBreached = true;
      const d = a?.dueDate ? Date.parse(a.dueDate) : NaN;
      if (Number.isFinite(d)) soonestDueMs = soonestDueMs == null ? d : Math.min(soonestDueMs, d);
    }
    const dueLabel = (() => {
      if (soonestDueMs == null) return '';
      const days = Math.ceil((soonestDueMs - now) / 86400000);
      if (days < 0) return 'Overdue';
      if (days === 0) return 'Due today';
      if (days === 1) return 'Due in 1 day';
      return `Due in ${days} days`;
    })();

    // SLA = the soonest actionable action's due date. The cases payload carries
    // the due date on the ACTIONS (proc.actions[].dueDate), NOT on lastStatus —
    // so derive from soonestDueMs (computed above), which is also what the
    // "Process step SLA" column renders. Emit slaRemaining + slaWindowMs so the
    // Queue's shared rowSlaSeverity / tallyDeelSla treat cases like every other
    // Deel source (header pills agree with the table — §1.9). An action-level
    // isSLABreached also forces a breach. No per-action SLA window is exposed,
    // so the at-risk band uses a flat 2-day window.
    const stepDueMs = soonestDueMs;
    const stepDueIso = stepDueMs != null ? new Date(stepDueMs).toISOString() : null;
    const slaWindowMs = 2 * 86400000;
    const slaRemaining = stepDueMs != null ? Math.round((stepDueMs - now) / 1000) : null;
    const slaBreachStatus = (anyBreached || (slaRemaining != null && slaRemaining <= 0)) ? 'SLA_BREACHED'
      : (slaRemaining != null && slaRemaining < slaWindowMs / 4 / 1000) ? 'SLA_AT_RISK'
      : 'ON_TRACK';
    const severity = slaBreachStatus === 'SLA_BREACHED' ? 'critical'
      : slaBreachStatus === 'SLA_AT_RISK' ? 'warning' : 'active';

    const activeAgent = proc?.activeAgent || null;
    const assigneeEmail = activeAgent?.email ? String(activeAgent.email).toLowerCase() : '';

    // col 8 — Case team. Prefer the active agent (current owner), then append
    // "+N" for the other distinct members of the real caseTeam[] array.
    const caseTeamNames = Array.isArray(c?.caseTeam)
      ? c.caseTeam.map(m => (m?.name || '').trim()).filter(Boolean)
      : [];
    const caseTeamPrimary = (activeAgent?.name || '').trim() || caseTeamNames[0] || '';
    const caseTeamExtra = caseTeamNames.filter(n => n !== caseTeamPrimary).length;
    const caseTeamLabel = caseTeamPrimary
      ? (caseTeamExtra > 0 ? `${caseTeamPrimary} +${caseTeamExtra}` : caseTeamPrimary)
      : '';

    // col 7 — Next case date. Pick the soonest UPCOMING entry in caseDates[];
    // if none are in the future, fall back to the soonest overall. Each entry
    // names itself ("Case start", etc.), used as the column label.
    const caseDatesArr = Array.isArray(c?.caseDates) ? c.caseDates : [];
    const nextCaseDateInfo = (() => {
      let upcoming = null;
      let earliest = null;
      for (const d of caseDatesArr) {
        const ms = d?.dueDate ? Date.parse(d.dueDate) : NaN;
        if (!Number.isFinite(ms)) continue;
        const entry = { ms, iso: d.dueDate, label: d.name || 'Case date' };
        if (earliest == null || ms < earliest.ms) earliest = entry;
        if (ms >= now && (upcoming == null || ms < upcoming.ms)) upcoming = entry;
      }
      const pick = upcoming || earliest;
      return pick ? { iso: pick.iso, label: pick.label } : { iso: null, label: '' };
    })();

    return {
      id: String(c?.id || ''),
      source: 'immigration_cases',
      caseStatus,
      // col 1 — Name and organization
      applicantName: _imCaseField.applicantName(c),
      organization: _imCaseField.organization(c),
      // col 2 — Country and case type
      country: _imCaseField.country(c),
      workTypeLabel: _imHumanizeWorkType(c?.type?.workType),
      caseTypeLabel: c?.type?.friendlyName?.trim() || '',
      // col 3 — Process step
      processName,
      processStep,
      processStepOwner: stepOwner,
      // col 4 — Process step SLA (soonest actionable action due date)
      processStepSlaDate: stepDueIso,
      // col 5 — Action required
      actionOwners,
      actionDueLabel: dueLabel,
      hasActionRequired: actionableActions.length > 0,
      // col 6 — Vendor
      vendor: _imCaseField.vendor(c),
      // col 7 — Next case date (soonest upcoming caseDates[] entry)
      nextCaseDate: nextCaseDateInfo.iso,
      nextCaseDateLabel: nextCaseDateInfo.label,
      // col 8 — Case team
      caseTeam: caseTeamLabel,
      // col 9 — Tags
      tags: _imCaseField.tags(c),
      // col 10 — Est. completion date
      estCompletionDate: _imCaseField.estCompletion(c) || null,
      // col 11 — Expiry date
      expiryDate: _imCaseField.expiry(c) || null,
      // col 12 — Last updated on
      updatedAt: _imCaseField.updatedAt(c) || proc?.updatedAt || c?.createdAt || null,
      // ── scoping + queue chrome ──
      assignee: activeAgent?.name || '',
      assigneeEmail,
      caseUrl: c?.id ? DEEL_MOBILITY_CASE_URL(c.id) : '',
      status: {
        label: caseStatus === 'ON_HOLD' ? 'On hold' : 'Open',
        severity,
        color: severity === 'critical' ? '#d42d35' : severity === 'warning' ? '#ed8d00' : '#1f74b3',
      },
      slaBreachStatus,
      slaRemaining,
      slaWindowMs,
      isResolved: false,
      isPaused: caseStatus === 'ON_HOLD',
      createdAt: c?.createdAt || null,
    };
  });
}
