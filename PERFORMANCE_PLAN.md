# Performance Tab — Build Plan (living doc)

HR Hub → 2 sub-tabs: **HR Requests** (existing board, all depts, unchanged) + **Performance** (new,
term performance management). Org-tree-scoped (member=self, TL=team, RM=subtree, admin=all),
dept-scoped (multi-dept via org_nodes), seeded for HRX from the legacy Gsheet.

## Two monthly inputs per member per cycle (one `perf_reviews` row)
1. **Evaluation (scored)** — role template of Yes/No criteria + KPI points(0–100) → auto sub-scores
   Operations / KPI / Growth → Final = Ops·0.5 + KPI·0.3 + Growth·0.2 → band; + Sentiment(1–5);
   Overall = ROUND(Final); promotion flag.
2. **Check-In (qualitative)** — wellness (Energized/Steady/Stretched/Near-capacity), achievements,
   growth (continue/refine/next-level), manager feedback + agreed actions, priorities (next 30d),
   workload/PTO context. Member contributes self-reflection; manager owns scores + finalization.

## Scoring engine (server SOT) — `src/lib/performance-constants.js`
Ops 0.5 / KPI 0.3 / Growth 0.2. Bands: 1 ⚠️ Insufficient · 2 💪 Developing · 3 🏆 Solid · 4 🌟 Star ·
5 🥇 Exceptional. KPI points→tier: ≥75→5,≥51→4,≥26→3,≥1→2,else 1. Criteria Yes-count→tier per
template thresholds. Template-versioned so history is immutable.

## Data model (all `org_node_id`-scoped)
- `perf_cycles` (dept, month, year, status open|locked) — auto-opened by cron.
- `perf_templates` (role key, criteria sets JSONB, weights, KPI/score bands; versioned; dept-editable).
- `perf_reviews` (member, manager, cycle, scored eval JSONB + check-in JSONB + status + lock).
- `perf_warnings` (level verbal|written|final|pip, reason, linked review, ack, history).

## Access (reuse existing)
- Read scope: `getVisibleEmails(user)` (clone Set for admins). Manager-of: `getAllReports(mgrEmail)`.
- Member manager/role/title/dept from merged roster row (managerEmail/access/title/orgNodeId).
- Stackable grant `is_performance_admin` (5-point plumbing, mirror is_hr_hub_admin) +
  `can_manage_performance` power + `performance-admin.js::canAdministerPerformance`.

## Phases (commit + push each to dev; deploy once all done)
- [ ] **A** Sub-tab shell (HR Requests + Performance) + data model (4 tables) + `is_performance_admin`
      grant + `can_manage_performance` + constants + empty PerformanceView.
- [ ] **B** Role templates (seed HRX 5 roles) + server scoring engine + admin Settings editor.
- [ ] **C** Monthly cycle + Evaluation form (auto-score) + Check-In form + status workflow + lock + API.
- [ ] **D** Individual dashboard: monthly trend, radar, quarter avg, band ring, promotion eligibility.
- [ ] **E** Team/manager dashboard + review queue: completion %, distribution, top/bottom, heatmap.
- [ ] **F** Warnings + promotions (issue/ack/history, eligibility auto-suggest).
- [ ] **G** Reminders: `usePerfBadge` home cards (managers + members) + bell notifications + monthly cron.
- [ ] **H** Historical ingestion (`data/perf_historical_seed.json` → perf_reviews, name→email→org) +
      Command Center rollup + adversarial review + live-audit playbook.

## Decisions (baked in; flag to change)
1 review row = eval + check-in. Member self-reflection + manager scores. Role templates dept-editable
(seeded HRX). Warnings: verbal→written→final→pip. Promotion auto-eligible at Overall ≥4 over last 3
cycles. Multi-dept from day one (HRX seeded, others default template).

## Historical SOT
3 sheets → 533 deduped scored records, 98 members, 13 managers, Oct 2025→May 2026. Map name→email via
`resolveEmailByName`, manager→org. Idempotent (externalId = `email|YYYY-MM`). Launch shows history.
