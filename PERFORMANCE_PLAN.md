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
- [x] **A** Sub-tab shell (HR Requests + Performance) + data model (4 tables) + `is_performance_admin`
      grant + `can_manage_performance` + constants + empty PerformanceView. — `a3c6fa4`
- [x] **B** Role templates (seed HRX 5 roles) + server scoring engine + admin Settings editor. — `9688f8a`
- [x] **C** Monthly cycle + Evaluation form (auto-score) + Check-In form + status workflow + lock + API. — `e114210`
- [x] **D** Individual dashboard: monthly trend, radar, quarter avg, band ring, promotion eligibility +
      team/manager dashboard (distribution, completion). — `ff12bcd`
- [x] **E** Warnings (verbal→PIP): issue/acknowledge/resolve, member + manager panels; promotions on
      reviews surfaced as eligibility. — `7342df2`
- [x] **F** Reminders: `usePerfBadge` home cards (managers + members) + bell notifications
      (`link_view='performance'`) + monthly cron (`performance-cycle-sync`, idempotent, daily-gated). — `daf3214`
- [x] **G** Historical ingestion (`data/perf_historical_seed.json` → perf_reviews, name→email→org,
      finalized+locked, source='import', idempotent sentinel + ON CONFLICT). — Phase G/H commit
- [x] **H** Command Center People rollup (per-dept avg score, latest finalized month) + registry
      (`commandCenterSources.js` `performance`, §3.18) + final adversarial review. — Phase G/H commit

## Decisions (baked in; flag to change)
1 review row = eval + check-in. Member self-reflection + manager scores. Role templates dept-editable
(seeded HRX). Warnings: verbal→written→final→pip. Promotion auto-eligible at Overall ≥4 over last 3
cycles. Multi-dept from day one (HRX seeded, others default template).

## Historical SOT
3 sheets → 533 deduped scored records, 98 members, 13 managers, Oct 2025→May 2026. Map name→email via
`resolveEmailByName`, manager→org. Idempotent (externalId = `email|YYYY-MM`). Launch shows history.
