# Command Center — Living Build Plan

> Source-of-truth living doc for the **executive Command Center** — a cross-department
> oversight surface for the CEO / VP of Operations / COO. Started 2026-06-03.
>
> **Maintenance protocol (read before every phase):** every new rule, formula,
> data source, control, or cross-feature decision MUST be appended HERE before the
> phase that introduces it ships. Tick the per-phase checkboxes in the same commit
> that lands the work. Never delete an unchecked item — strike it through with a note
> if it's dropped. This doc + `src/data/commandCenterSources.js` (the Source Registry,
> Phase 0) are the two artifacts that keep the Command Center from drifting out of
> sync with the departments it oversees.

---

## 1. Goal

A first-class **Command Center** view inside the live Ops Hub that lets leadership
(CEO / VP Ops / COO) oversee **overall operational performance across every
department at once** — health, SLA, volume, capacity, people, and risk — with
executive-grade reports and overviews. It must be:

- **100% connected** to every department defined in the Org tab and every
  operational data source those departments run.
- **Adaptive** — when a department is added / renamed / archived, or enables a new
  source, the Command Center reflects it automatically with **zero code change**
  for the common cases, and a **clear, audited path** for the rare cases that need one.
- **Flawless** — zero bugs, executive-grade UI/UX. This audience does not tolerate
  a broken chart or a wrong number. Every phase passes the full 3-pillar + UI-polish
  audit before it ships.

**Audience reality check:** these users are not agents or team leads. They want
*signal*, not queues. The Command Center surfaces "what's the state of the
operation and what needs my attention," then deep-links into the owning
department's existing surface for the detail. It does **not** reimplement queues.

---

## 2. Key findings from the scoping audit (2026-06-03)

These shaped every decision below. Recorded so we don't relitigate them mid-build.

1. **The `src/workspaces/` system is dead code.** `app/page.jsx → WorkspaceRouter`
   (2026-05-22 "final cut") single-mounts `HrApp` (`src/App.jsx`) for everyone.
   The `command-center/`, `payroll/`, `gix/` workspace apps + `WorkspacePicker` are
   **unreachable**. The product pivoted to: one app, departments are multi-tenant
   *inside* it via dept-scope isolation (`org_node_id` stamp + per-dept read filter +
   super-admin TopNav dept-switch chip).
   → **The Command Center is built as a new top-level VIEW in `App.jsx`**, not the
   dead workspace. (The dead `command-center` workspace + its leadership roster
   `COMMAND_CENTER_EMAILS = [carlos@, kento.arrue@, mohamed@]` are reused only as a
   seed list for exec access; pruning the dead tree is an optional later chore.)

2. **The data backbone already exists.** These internal tables carry `org_node_id`
   and roll up per-dept with a `GROUP BY` today:
   `hr_hub_request`, `leader_alert`, `urgent_assist_request`, `urgent_assist_schedule`,
   `time_off_events`, `handovers`, `work_tasks` / `work_projects`, `announcements`,
   `mention_group`, `tasks`. Members attach to depts via `team_member_overrides.org_node_id`.

3. **External / queue sources are per-dept-gated** via `src/lib/dept-integrations.js`
   (keyed by `org_nodes.slug`): Zendesk, Jira, Workbench, Onboarding, Offboarding,
   Amendments, Redlines, Incentive Plans, Immigration Tasks. Each dept's `deelSources`
   map says which render. HR Experience = all; GIX = Workbench + Immigration Tasks;
   Payroll / Benefits = none yet (fail-closed). The Command Center must **only roll up
   sources a dept actually has enabled**, and pick up new ones automatically.

4. **Proven server-side per-dept aggregators to REUSE** (don't reinvent):
   - `src/lib/capacity-aggregator.js` → `app/api/v1/leader-reports/capacity` (15-min cache, `bustCache=1`).
   - `src/lib/productivity-aggregator.js` (exports `CATEGORIES`) → `app/api/v1/leader-reports/productivity` (5-min cache).
   - `app/api/v1/sla-extension/report`.
   These are **per-dept** (scoped to caller's dept). The Command Center loops **all**
   depts and aggregates — it can reuse these aggregators per-dept in a fan-out.

5. **The Health Score is the canonical health metric** (`BriefingView.jsx` ~L1011-1095):
   composite 0–100 = `SLA Compliance ×50 + Resolution ×10 + Response ×20 + Capacity ×20`
   (weights live in `app_settings.briefing_health_*_weight`). Today it's computed
   **client-side** over the current user's dept queue. The Command Center needs this
   **ported server-side** so it can compute it per-dept across all depts without
   loading every queue into one browser. Bands: ≥80 Healthy (green), ≥60 Attention
   (amber), <60 Critical (red).

6. **Trends need a historical store.** BriefingView notes "Trends static until a
   historical data endpoint exists." Exec audiences live on trends (▲/▼ vs last
   period). → We add a **daily snapshot table** early (Phase 0/1) so history accrues
   from day one of the build, even though trend UIs land later.

7. **Access model:** today there is no "exec" role — only `at_admin` (dataScope
   `all_tasks`), the per-user stackable `at_*_admin` grants, and the `GLOBAL_SUPER_ADMIN`
   (mohamed). Adding a top-level view = `ALL_VIEWS` + `VIEW_LABELS` in
   `accessControl.js`, a `view===` mount block in `App.jsx`, a `PRIMARY_TABS` entry in
   `DeelTopNav.jsx`, and the `App.jsx` URL-gate (`perms.canView(view)===false → briefing`).

---

## 3. Architecture decisions

### 3.1 Host: a new top-level view
- View id **`command-center`**, label **"Command Center"**, icon `bi-speedometer2`,
  accent purple `#7c3aed`. Mounted in `App.jsx` alongside the other views; nav tab in
  `DeelTopNav.jsx`, far right, **exec-gated**.

### 3.2 Cross-department aggregation — the inverse of dept-scope (SECURITY-CRITICAL)
- Every other route scopes reads to `getCurrentDeptId(user, req)` (one dept). The
  Command Center routes do the **opposite**: they aggregate across **all** `org_nodes`.
  This crosses the tenant boundary the entire Phase 11+ multi-tenant work established.
  **Therefore the CC routes are gated server-side to exec/super-admin only** — never
  trust the FE. A dedicated server gate (`assertCommandCenterAccess(user)`) is the
  single chokepoint; every `/api/v1/command-center/*` route calls it first.
- New aggregator `src/lib/command-center-aggregator.js`. New routes under
  `app/api/v1/command-center/*` (`overview`, `sla`, `volume`, `capacity`, `people`,
  `risk`, `coverage`, `export`).

### 3.3 Performance posture
- **Prefer internal DB rollups** (`GROUP BY org_node_id`) — fast, no external calls.
- **Reuse the existing per-dept aggregator caches** (capacity 15-min, productivity
  5-min) rather than recomputing.
- **Never trigger N synchronous live external scans** (Zendesk/Jira/Deel) from one CC
  request — read the **latest cached** queue snapshots the per-dept sync already
  maintains. CC requests must stay fast even with 5+ depts.
- Lite-shape every list payload (skill §3.17 / mistakes #45): scalars + counts on the
  rollup path; detail only on drill-in.
- Per-dept fan-out is bounded + `.catch()`-isolated so one slow/empty dept can't 500
  the whole board (skill mistake #22).

### 3.4 Adaptability — three layers (the heart of the request)
1. **Live dept enumeration** — the CC reads departments from `org_nodes` at request
   time (`rootNodes` = `parent_id IS NULL`), never a hardcoded list. Add/rename/archive
   a dept in the Org tab → CC reflects it on next load. (Honors skill mistake #50:
   slugs are user-picked.)
2. **Source-awareness** — the CC reads each dept's enabled sources from
   `dept-integrations.js` (`visibleDeelSourcesFor(slug)`) + the `org_node_id`-bearing
   internal tables, and only aggregates what each dept actually runs. A dept enabling a
   new source surfaces automatically.
3. **The Source Registry** (`src/data/commandCenterSources.js`, Phase 0) — a single
   declarative manifest of every source/metric the CC aggregates and how. When a new
   dept-scoped feature is built anywhere in the app, the developer adds one entry here
   (enforced by the new skill rule). The CC's **Self-Audit panel** (Phase 8) reads this
   registry against live `org_nodes` + `dept-integrations` and **flags anything not yet
   represented** — so nothing silently goes missing or stale.

### 3.5 Access & security model (CONFIRMED 2026-06-03 — "New Executive role")
- New admin power **`can_view_command_center`** + new default access type
  **`at_command_center`** ("Executive / Leadership", read-only, global). Stackable,
  assignable from the Team tab via the existing per-user grant pattern.
- Per-user column **`is_command_center_viewer`** on `team_member_overrides`, plumbed
  through the same **5 points** as `is_hr_hub_admin` (migrate → server helper →
  team-members-merge → `/api/v1/me` → `accessControl` + `usePermissions.canViewCommandCenter`).
- **Auto-granted** to `at_admin` + `GLOBAL_SUPER_ADMIN`; **seeded** for the leadership
  roster (`carlos@`, `kento.arrue@`). Read-only — execs can view + export + tune
  thresholds, but the CC performs no destructive cross-dept writes.

---

## 4. Phase plan

Each phase is independently shippable to `dev`, passes the full audit gate (§5), and
ticks its checklist here. **Nothing deploys to prod until ALL phases are done and you
give the word** (per your instruction).

### Phase 0 — Foundation, governance & gated shell  ✅ implemented (on `feat/command-center-phase-0`, landing → dev)
**Goal:** exec gating, the view scaffold, the aggregation foundation, and the
governance artifacts — all proven end-to-end with *no metrics yet*.
- [x] **Skill update #1 (governance):** added §3.18 "Command Center cross-impact —
      check on EVERY change" + mistake #54 to `ops-hub-improvement/SKILL.md`, and the
      Command Center trigger to the skill description.
- [x] **Source Registry:** `src/data/commandCenterSources.js` — declares every
      dept-scoped source (table, dept dimension, KPIs, owning phase) + the Deel-source
      key list for the Phase 8 self-audit.
- [x] **Access:** `can_view_command_center` power + `at_command_center` "Executive"
      type + `is_command_center_viewer` 5-point plumbing (migrate → team-members-merge
      → `/me` → App.jsx hydration ×2 → usePermissions). Gate = super-admin / seed
      roster / full admin / per-user flag — IDENTICAL on FE (`perms.canViewCommandCenter`)
      and server (`src/lib/command-center-access.js`). Regional Managers explicitly
      EXCLUDED (filtered out of `VIEWS_NO_EXEC` + `ADMIN_POWERS_NO_EXEC`; gate never
      keys off `can_manage_settings`, which Regionals hold).
- [x] **View scaffold:** `command-center` in `ALL_VIEWS`/`VIEW_LABELS`, mounted in
      `App.jsx`, exec-gated `PRIMARY_TABS` tab in `DeelTopNav.jsx`, URL-gate special-
      cased to `canViewCommandCenter`. New `src/components/views/CommandCenterView.jsx`
      shell — live dept cards + org-wide totals + honest "rolling out" roadmap, all
      CSS-var (dark-mode-safe), with loading/error/empty/403 states.
- [x] **Aggregator + endpoint:** `src/lib/command-center-aggregator.js` (`getOverview`
      → live dept roster + whole-subtree headcount via recursive CTE) + exec-gated
      `GET /api/v1/command-center/overview` + `src/services/commandCenterApi.js`.
- [→] **History store (`command_center_daily_snapshot`)** — MOVED to Phase 3, where
      trends are first consumed. Rationale: deploy happens only after ALL phases, so
      prod history can't accrue until the final deploy regardless of which phase creates
      the table — no benefit to an empty table now; keeps Phase 0 lean.
- [→] **Team-tab "Executive" toggle widget** — the `is_command_center_viewer` column +
      all read-plumbing are in place (settable via DB today); the grant *widget* in the
      Team access modal is deferred to Phase 7 (Controls). Phase 0's real exec users
      (admins, super-admin, seed roster) work end-to-end without it.
- **Verify:** exec sees CC tab + all live depts enumerated; agent/TL/Regional see **no**
  CC tab and `?view=command-center` bounces to briefing; `/command-center/overview`
  returns 403 for non-exec. `next build` clean; dark mode + responsive on the shell.

### Phase 1 — Org-wide + per-department Scorecards (hero overview)  ✅ scorecards shipped (landing → dev)
**Goal:** the landing screen leadership opens to — live, accurate, fast.
- [x] Per-dept operational scorecards from INTERNAL dept-scoped tables (fast indexed
      GROUP BYs folded to the root dept in JS — no external scans): headcount, teams,
      open HR Hub requests, urgent (high/critical) HR Hub, open roles (`org_vacant_roles`),
      people out today (approved leave overlapping today, attributed via the member's dept).
- [x] Org-wide totals strip (Departments / People / Open HR Hub / Urgent / Out today) +
      responsive per-dept scorecard grid generated from the LIVE dept list (adapts when a
      dept is added/renamed/archived). `getOverview()` now returns per-dept metrics + totals.
- [→] **Composite Health Score + health ring** — RESEQUENCED to Phase 2: the Health Score
      is 50% SLA-compliance, which needs the queue/Deel SLA pool rolled up cross-dept.
      Building it in Phase 2 keeps the number faithful rather than shipping a half-weighted
      score now.
- [→] **SLA % / breach / at-risk** → Phase 2; **capacity band** → Phase 4; **Δ vs prior
      snapshot** → Phase 3 (needs the snapshot store); **per-dept drill-in** → Phase 2
      (when there's per-source detail to drill into).
- **Verify:** `next build` green; scorecards generated from live `org_nodes` (adapts to dept
  changes); internal-only queries (no external scans); numbers reconcile vs each dept's own
  surfaces — confirm live in the post-deploy audit (dev preview is unauthenticated).

### Phase 2 — SLA & Breach Command (cross-dept)
- [ ] Per-dept × per-source SLA compliance, breaches, at-risk, oldest-breach age
      (reuse `bizTime` / `slaInfo` / `computeSlaWindow` semantics — single source of truth).
- [ ] UI: dept × source SLA heatmap, breach leaderboard, at-risk watchlist; each row
      **deep-links** into the owning dept's queue/HR Hub filtered to the breach.
- **Verify:** SLA math matches Queue/Analytics per dept; deep-links land correctly.

### Phase 3 — Volume & Throughput trends
- [ ] **History store (moved from Phase 0):** `command_center_daily_snapshot` table +
      a once-per-day opportunistic capture (the `/me` `promoteDueScheduled` pattern, or
      the existing scheduled-sync mechanism) so trend deltas have data to chart.
- [ ] Inbound vs resolved over time per dept + org-wide (reuse `productivity-aggregator`
      `CATEGORIES` + queue volume), backlog growth, throughput/day, busiest sources.
- [ ] UI: trend charts (period selector 7d/30d/90d/custom), backlog trajectory.
- **Verify:** trend series match snapshot history; custom range validation mirrors the
  productivity route's guards.

### Phase 4 — Capacity & Workload (cross-dept)
- [ ] Fan-out `capacity-aggregator` across all depts → per-dept load, over/under signals,
      headcount-vs-demand, country/team hotspots (respecting each dept's capacity settings).
- [ ] UI: cross-dept capacity heatmap + over-capacity alerts + hotspot drill-in.
- **Verify:** matches each dept's Leaders Hub → Capacity tab; signal bands consistent.

### Phase 5 — People, Coverage & Productivity
- [ ] Headcount/vacancy roll-up; OOO **coverage risk** (`time_off_events` + `handovers`
      — who's out, uncovered gaps); productivity roll-up; activity/last-seen (`member_logins`).
- [ ] UI: org headcount + vacancy, coverage-risk board, productivity leaderboard by
      dept/category, engagement signal.
- **Verify:** coverage gaps match OOO/Handovers; productivity matches the per-dept report.

### Phase 6 — Risk & Escalations Radar
- [ ] Roll up `leader_alert` + `urgent_assist_request` + `escalations` — open/critical
      items needing exec attention, by dept, aging.
- [ ] UI: exec risk radar (critical alerts, urgent assists, aging escalations,
      SLA-critical), all cross-dept + deep-linkable.
- **Verify:** counts match each source's own view per dept.

### Phase 7 — Executive Controls, Comparison & Export
- [ ] Controls: global date-range, **department compare** (side-by-side), exec override
      of Health weights + thresholds (`command_center_settings`), surface/hide depts/sources.
- [ ] **Export:** executive report — CSV (UTF-8 BOM + CRLF + always-quote, skill §3.15)
      + print/PDF layout.
- **Verify:** controls re-scope every panel consistently; export opens clean in Excel.

### Phase 8 — Adaptability Engine & Self-Audit
- [ ] CC reconciles live `org_nodes` + `dept-integrations` + the Source Registry and
      **flags drift**: depts not represented, sources enabled-but-not-aggregated, new
      depts needing config, stale snapshots.
- [ ] UI: super-admin "Coverage" panel showing CC completeness + actionable gaps.
- **Verify:** add a test dept/source → it appears as an actionable gap, then clears once wired.

### Phase 9 — Final polish, performance & full audit
- [ ] Dark mode, responsive (1440/1280/1024/900), 125–150% zoom, empty/loading/error
      states on **every** panel, lite-shape perf pass, the full 4-role + UI-polish audit,
      live post-deploy audit readiness (skill §6.7).
- [ ] **Skill update #2 (reconcile):** confirm the CC rule + Source Registry + maintenance
      protocol are complete and self-consistent in the skill.

---

## 5. Per-phase quality gate (mandatory — every phase)

Borrowed verbatim from the discipline in `ops-hub-improvement/SKILL.md`:
1. **Phase-1 deep audit** before coding (data map, cross-tab consumers, identity=email,
   cache keys, the new CC cross-impact check).
2. **Three pillars:** all four roles (here: confirm non-exec roles see *nothing*); tree
   integrity if any hierarchy surface is touched; UI must *look* executive-grade.
3. **Server-side exec gate** verified (403 for non-exec on every CC route).
4. **Post-impl sweep:** conflict markers, dead imports, hook-order (§4.7), `apiFetch`
   contract (mistake #49), lite shapes.
5. **Commit → push `nexus` → PR base `dev` → CI (CodeQL + Analyze×2) → squash-merge to
   `dev`.** Update this doc's checkboxes in the same commit. **Stop at `dev`.**
6. No deploy until every phase is merged and you give the green light.

---

## 6. Decisions — CONFIRMED 2026-06-03

- **Host = new top-level view** in `App.jsx` (not the dead workspace). ✅ locked.
- **Exec access = new `at_command_center` "Executive" role + `can_view_command_center`** —
  read-only + global, auto-granted to Admins + super-admin, seeded for `carlos@` /
  `kento.arrue@`, assignable per-person from the Team tab. ✅ confirmed (chose "New
  Executive role" over reuse-admin / email-allowlist).
- **Read-only** Command Center (view + export + exec threshold tuning; no destructive
  cross-dept writes). ✅ locked.
- **Report scope = the 6 core areas** (Health, SLA/breach, Volume, Capacity,
  People/coverage, Risk/escalations). ✅ confirmed sufficient to start.
- **Deferred (out of scope for now — each needs a data source we don't yet wire):**
  financial/cost, CSAT/quality, hiring/attrition. The architecture (Source Registry +
  adaptable rollups) absorbs these later without rework.
- **Phase count = 10 (0–9).** Locked unless you ask to split/merge.
```
