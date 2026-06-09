// ── Task-age helpers ────────────────────────────────────────────────────────
// "Task age" = BUSINESS-DAY time since createdAt (weekends don't elapse; each
// weekday = 24h, via bizTime.elapsedBizMs). Used by the org health score and the
// analytics surfaces so they all agree. Quality bands (Mohamed, 2026-06-09):
//   < 10 biz days  → Great
//   10–14 biz days → Good
//   > 14 biz days  → Bad
import { elapsedBizMs, BIZ_DAY_MS } from './bizTime';

// Business-day age of a single row's createdAt (in biz days). null if unusable.
export function bizDaysSince(createdAt, now = Date.now()) {
  if (!createdAt) return null;
  const ms = new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const d = elapsedBizMs(ms, now) / BIZ_DAY_MS;
  return d >= 0 ? d : null;
}

// Mean + max biz-day age across rows (reads row.createdAt). Rows without a valid
// created date are skipped. → { avgDays, maxDays, count }.
export function bizDayAgeStats(rows, now = Date.now()) {
  let sum = 0, max = 0, n = 0;
  for (const r of rows || []) {
    const d = bizDaysSince(r && r.createdAt, now);
    if (d == null) continue;
    sum += d; if (d > max) max = d; n += 1;
  }
  return { avgDays: n > 0 ? sum / n : 0, maxDays: max, count: n };
}

// 0–100 health score from biz-day age. Smooth + monotonic, honouring the bands:
//   ≤7 → 100 · 7–10 → 100→85 (Great) · 10–14 → 85→60 (Good) · >14 → 60→0 (Bad).
export function taskAgeScore(bizDays) {
  const d = Number(bizDays) || 0;
  if (d <= 7) return 100;
  if (d < 10) return Math.round(100 - (d - 7) * 5);
  if (d <= 14) return Math.round(85 - (d - 10) * 6.25);
  return Math.max(0, Math.round(60 - (d - 14) * 6));
}

// Qualitative band label from biz-day age.
export function taskAgeBand(bizDays) {
  const d = Number(bizDays) || 0;
  if (d < 10) return 'Great';
  if (d <= 14) return 'Good';
  return 'Bad';
}

// Display string for a biz-day age, e.g. "8.3d" (1 decimal). "0d" when ≤0.
export function fmtBizDays(bizDays) {
  const d = Number(bizDays) || 0;
  if (d <= 0) return '0d';
  return `${Math.round(d * 10) / 10}d`;
}
