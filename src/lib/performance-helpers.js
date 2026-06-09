// ── Performance helpers (server) ────────────────────────────────────────────
// The scoring engine + org-tree scope for the Performance tab. Combines the
// pure scoring math (performance-constants) with a template (criteria sets +
// weights + thresholds) and the existing org-tree visibility helpers, so the
// server is the single source of truth for both scores and who-can-see-whom.

import {
  computeOverall, kpiTierFromPoints, tierFromYesCount, bandForScore, METRIC_WEIGHTS,
} from './performance-constants';
import { getVisibleEmails, isAdminUser } from './queue-scoping';
import { MEMBERS_BY_EMAIL, getAllReports, getDirectReports } from '../data/members';

// ── Scoring ─────────────────────────────────────────────────────────────────
// Count "Yes" answers in a {key: bool} map, restricted to a criteria set.
function countYes(answers, criteria) {
  if (!answers || typeof answers !== 'object' || !Array.isArray(criteria)) return 0;
  let n = 0;
  for (const c of criteria) if (answers[c.key] === true) n++;
  return n;
}

/**
 * Score one evaluation against its template. Returns the sub-scores +
 * weighted + overall + band. Pure (no DB). `evalAnswers` = { ops:{key:bool},
 * growth:{key:bool} }; `kpiPoints` 0–100. Operations/Growth tiers come from
 * the template's criteria-set sizes (+ optional explicit thresholds); KPI from
 * the points band; weighted from the template weights (default 50/30/20).
 */
export function scoreEvaluation({ template, evalAnswers = {}, kpiPoints = 0 }) {
  const ops = Array.isArray(template?.operations_criteria) ? template.operations_criteria : [];
  const grw = Array.isArray(template?.growth_criteria) ? template.growth_criteria : [];
  const operations = tierFromYesCount(countYes(evalAnswers.ops, ops), ops.length, template?.ops_thresholds);
  const growth = tierFromYesCount(countYes(evalAnswers.growth, grw), grw.length, template?.growth_thresholds);
  const kpi = kpiTierFromPoints(kpiPoints);
  const w = (template?.weights && typeof template.weights === 'object') ? template.weights : METRIC_WEIGHTS;
  const wo = Number(w.operations) || METRIC_WEIGHTS.operations;
  const wk = Number(w.kpi) || METRIC_WEIGHTS.kpi;
  const wg = Number(w.growth) || METRIC_WEIGHTS.growth;
  const weighted = Math.round((operations * wo + kpi * wk + growth * wg) * 10) / 10;
  const overall = computeOverall(weighted);
  const band = bandForScore(weighted);
  return { operations, kpi, growth, weighted, overall, band: band.label };
}

// ── Org-tree scope ────────────────────────────────────────────────────────
// Emails this user may SEE performance for. Admin → everyone; RM → self +
// subtree; TL → self + direct reports; agent → self. Clone the Set for admins
// because getVisibleEmails returns the shared mutable ALL_EMAILS_SET.
export function visiblePerfEmails(user, extraEmails = null) {
  const s = getVisibleEmails(user, extraEmails);
  return isAdminUser(user) ? new Set(s) : s;
}

// Can this user VIEW a given member's reviews?
export function canViewMemberPerf(user, memberEmail) {
  if (!user?.email || !memberEmail) return false;
  if (isAdminUser(user)) return true;
  return visiblePerfEmails(user).has(String(memberEmail).toLowerCase());
}

// Can this user SCORE/finalize a member's review? (manager-of, any level) OR
// admin OR perf-admin grant — pass `isPerfAdmin` from canAdministerPerformance.
export function canScoreMemberPerf(user, memberEmail, isPerfAdmin = false) {
  if (!user?.email || !memberEmail) return false;
  if (isAdminUser(user) || isPerfAdmin) return true;
  const target = String(memberEmail).toLowerCase();
  if (target === String(user.email).toLowerCase()) return false;   // can't score self
  try {
    // getAllReports returns an array of EMAIL STRINGS (not member objects) —
    // BFS over managerEmail. getDirectReports returns objects, hence the
    // difference vs directReportEmails below.
    return getAllReports(String(user.email).toLowerCase()).some(e => String(e || '').toLowerCase() === target);
  } catch { return false; }
}

// Member's manager / role / title / dept anchor, from the merged roster row.
export function resolveMemberContext(email) {
  const lc = String(email || '').toLowerCase();
  const m = MEMBERS_BY_EMAIL[lc] || null;
  if (!m) return { memberEmail: lc, memberName: '', managerEmail: '', managerName: '', role: '', title: '', orgNodeId: null };
  const mgrLc = (m.managerEmail || '').toLowerCase();
  const mgr = mgrLc ? MEMBERS_BY_EMAIL[mgrLc] : null;
  return {
    memberEmail: lc,
    memberName: m.name || '',
    managerEmail: mgrLc || '',
    managerName: mgr?.name || '',
    role: m.access || m.role || '',
    title: m.title || '',
    orgNodeId: m.orgNodeId || null,
  };
}

// Direct reports of a manager (for the "My Team" review queue).
export function directReportEmails(managerEmail) {
  try { return getDirectReports(String(managerEmail || '').toLowerCase()).map(r => (r.email || '').toLowerCase()).filter(Boolean); }
  catch { return []; }
}
