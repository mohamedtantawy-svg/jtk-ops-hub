// ── Performance constants + scoring engine ─────────────────────────────────
// Single source of truth for the Performance tab's scoring model + enums.
// Pure data + pure functions only — NO React, NO API, NO DB imports — so it
// is safely importable from the server routes/seed AND the FE dashboards.
// Replicates the legacy HRX Gsheet formulas exactly so the app and any sheet
// always agree (Weighted = Ops·0.5 + KPI·0.3 + Growth·0.2; Overall = ROUND;
// 5 SWITCH bands; KPI-points→tier; criteria Yes-count→tier).

// ── Metric weights (Operations 50% / KPI 30% / Growth 20%) ──────────────────
export const METRIC_WEIGHTS = { operations: 0.5, kpi: 0.3, growth: 0.2 };

// Sentiment (1–5) is tracked alongside but is NOT in the weighted formula —
// it is the manager's qualitative read, surfaced on dashboards.
export const METRIC_KEYS = ['sentiment', 'operations', 'kpi', 'growth'];

// ── Final-score bands (1–5) — status semantics stay LITERAL (skill §4.5) ────
export const SCORE_BANDS = [
  { min: 0,   label: 'Insufficient', emoji: '⚠️', color: '#dc2626', bg: '#fef2f2' },
  { min: 1.5, label: 'Developing',   emoji: '💪', color: '#d97706', bg: '#fff7ed' },
  { min: 2.5, label: 'Solid',        emoji: '🏆', color: '#0369a1', bg: '#e0f2fe' },
  { min: 3.5, label: 'Star',         emoji: '🌟', color: '#7c3aed', bg: '#f3eff8' },
  { min: 4.5, label: 'Exceptional',  emoji: '🥇', color: '#15803d', bg: '#dcfce7' },
];

// Match the sheet's SWITCH(INT(score)) banding by integer tier 1–5.
export function bandForScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s) || s <= 0) return SCORE_BANDS[0];
  // Walk descending so the highest matching threshold wins.
  for (let i = SCORE_BANDS.length - 1; i >= 0; i--) {
    if (s >= SCORE_BANDS[i].min) return SCORE_BANDS[i];
  }
  return SCORE_BANDS[0];
}

// ── Scoring functions ───────────────────────────────────────────────────────
// Weighted = Ops·0.5 + KPI·0.3 + Growth·0.2 (each sub-score 1–5). Returns a
// float rounded to 1 decimal (matches the sheet's display).
export function computeWeighted({ operations, kpi, growth }) {
  const o = Number(operations) || 0, k = Number(kpi) || 0, g = Number(growth) || 0;
  return Math.round((o * METRIC_WEIGHTS.operations + k * METRIC_WEIGHTS.kpi + g * METRIC_WEIGHTS.growth) * 10) / 10;
}

// Overall = ROUND(Weighted, 0) — the 1–5 integer used for top/bottom + promotion.
export function computeOverall(weighted) {
  const w = Number(weighted);
  return Number.isFinite(w) ? Math.round(w) : 0;
}

// KPI points (0–100) → tier 1–5. Exact sheet thresholds: ≥75→5, ≥51→4, ≥26→3, ≥1→2, else 1.
export function kpiTierFromPoints(points) {
  const p = Number(points);
  if (!Number.isFinite(p)) return 1;
  if (p >= 75) return 5;
  if (p >= 51) return 4;
  if (p >= 26) return 3;
  if (p >= 1) return 2;
  return 1;
}

// Criteria Yes-count → tier 1–5, scaled to the criteria-set size. Templates may
// override with explicit thresholds; this is the proportional default that
// reproduces the sheet's intent for any criteria count (7-criterion Operations:
// ≤2→1, 3→2, 4–5→3, 6→4, 7→5; 5-criterion Growth: 0→1,1→2,2→3,3→4,4–5→5).
export function tierFromYesCount(yesCount, total, thresholds = null) {
  const y = Math.max(0, Number(yesCount) || 0);
  const n = Math.max(1, Number(total) || 1);
  if (Array.isArray(thresholds) && thresholds.length === 5) {
    // thresholds[i] = min yes-count for tier (i+1); walk descending.
    for (let t = 5; t >= 1; t--) if (y >= thresholds[t - 1]) return t;
    return 1;
  }
  const ratio = y / n;
  if (ratio >= 0.99) return 5;
  if (ratio >= 0.80) return 4;
  if (ratio >= 0.50) return 3;
  if (ratio >= 0.30) return 2;
  return 1;
}

// ── Review status workflow ──────────────────────────────────────────────────
export const REVIEW_STATUSES = [
  { key: 'draft',          label: 'Draft',           color: '#6b6560', bg: '#f3f3f3' },
  { key: 'member_input',   label: 'Awaiting member', color: '#0369a1', bg: '#e0f2fe' },
  { key: 'manager_review', label: 'Manager review',  color: '#d97706', bg: '#fff7ed' },
  { key: 'finalized',      label: 'Finalized',       color: '#15803d', bg: '#dcfce7' },
  { key: 'acknowledged',   label: 'Acknowledged',    color: '#7c3aed', bg: '#f3eff8' },
];
export const REVIEW_STATUS_KEYS = new Set(REVIEW_STATUSES.map(s => s.key));
export function reviewStatusMeta(k) { return REVIEW_STATUSES.find(s => s.key === k) || REVIEW_STATUSES[0]; }

// ── Wellness (monthly check-in: "how did this month feel?") ─────────────────
export const WELLNESS_OPTIONS = [
  { key: 'energized',     label: 'Energized',     color: '#15803d', bg: '#dcfce7' },
  { key: 'steady',        label: 'Steady',        color: '#0369a1', bg: '#e0f2fe' },
  { key: 'stretched',     label: 'Stretched',     color: '#d97706', bg: '#fff7ed' },
  { key: 'near_capacity', label: 'Near capacity', color: '#dc2626', bg: '#fef2f2' },
];

// ── Warnings ──────────────────────────────────────────────────────────────
export const WARNING_LEVELS = [
  { key: 'verbal',  label: 'Verbal',  rank: 1, color: '#0369a1', bg: '#e0f2fe' },
  { key: 'written', label: 'Written', rank: 2, color: '#d97706', bg: '#fff7ed' },
  { key: 'final',   label: 'Final',   rank: 3, color: '#dc2626', bg: '#fef2f2' },
  { key: 'pip',     label: 'PIP',     rank: 4, color: '#7c2d12', bg: '#fef2f2' },
];
export const WARNING_LEVEL_KEYS = new Set(WARNING_LEVELS.map(w => w.key));
export function warningLevelMeta(k) { return WARNING_LEVELS.find(w => w.key === k) || WARNING_LEVELS[0]; }

// ── Promotion ───────────────────────────────────────────────────────────────
export const PROMOTION_OPTIONS = [
  { key: 'no',       label: 'No' },
  { key: 'eligible', label: 'Eligible' },
  { key: 'yes_p1',   label: 'Yes — P1' },
  { key: 'yes_p0',   label: 'Yes — P0' },
];
// Auto-eligibility: sustained Overall ≥ 4 across the last N finalized cycles.
export const PROMOTION_ELIGIBLE_MIN_OVERALL = 4;
export const PROMOTION_ELIGIBLE_CYCLES = 3;

// ── Role template keys (the 5 HRX evaluation roles, seeded in Phase B) ──────
export const ROLE_TEMPLATE_KEYS = [
  'country_owner', 'hrx_247', 'swat_new_services', 'team_lead', 'new_services',
];

// ── Months (1–12) ─────────────────────────────────────────────────────────
export const MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function quarterOfMonth(m) { return Math.floor((Number(m) - 1) / 3) + 1; }

// Managerial roles allowed to view/score (mirrors the queue managerial gate;
// includes legacy short forms as belt-and-suspenders). Agents see only self.
export const PERF_MANAGERIAL_ROLES = ['admin', 'regional_manager', 'team_lead', 'regional_mgr', 'lead'];
export function isManagerialRole(role) { return PERF_MANAGERIAL_ROLES.includes(String(role || '').toLowerCase()); }
