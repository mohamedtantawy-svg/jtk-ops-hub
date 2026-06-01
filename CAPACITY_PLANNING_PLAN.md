# Capacity Planning — Living Build Plan

> Source-of-truth living doc for the Leaders Hub → Capacity sub-tab. Started 2026-06-01 from Kristina Fomina's spreadsheet audit (`Capacity Audit Kristina Team.xlsx`). Every phase ships its own PR to `dev`; every new rule, formula, or cross-feature decision is appended HERE before the next phase ships.

## Goal

A first-class capacity planning surface inside Leaders Hub that reproduces Kristina's manual spreadsheet audit as a live, per-department feature. The same shape works for HR Experience, Global Immigration, Payroll Operations, and Benefits Operations — each dept sees only its own members, countries, and demand.

## Spec — mirroring the source audit

Kristina's audit has four sheets. We reproduce all four as views inside the sub-tab, plus a Settings panel:

1. **Country Workload** — monthly averages per country (demand side).
2. **Capacity Current** — per-member load grouped by Team Lead, signal-banded.
3. **Capacity Proposed** — interactive what-if: rebalance country assignments, see signals update live, save scenarios.
4. **Team Summary** — per-Team-Lead roll-up.
5. **Settings** — minutes per task, minutes per call, working days, baseline call hrs, signal thresholds, manual EOR HC, manual call counts.

## Formula model (reverse-engineered from the audit)

Verified against Pilar Dominguez's row:
- `Tasks/day = Tasks/mo / working_days` → 480.2 / 22 = **21.8** ✓
- `Task hrs/day = Tasks/day × minutes_per_task / 60` → 21.8 × 15 / 60 = **5.46** ✓
- `Call hrs/day = baseline_call_hrs + Calls/mo × minutes_per_call / 60 / working_days` → 2.47 + 37.5 × 15 / 60 / 22 = **2.90** ✓ (Aleksa with 0 calls confirms the baseline = 2.47)
- `Total WL/mo = Tasks/mo + Calls/mo`
- `Total hrs/day = Task hrs/day + Call hrs/day`

**Defaults** (configurable per dept):

| Setting | Default | Source |
|---|---|---|
| `working_days_per_month` | 22 | Kristina's audit |
| `minutes_per_task` | 15 | Reverse-engineered |
| `minutes_per_call` | 15 | Reverse-engineered |
| `baseline_call_hrs_per_day` | 2.47 | Aleksa's zero-call row |
| Signal: 🟢 OK | `< 5.5 hrs/day` | Proposed sheet bands |
| Signal: 🟡 Moderate | `5.5 – 7 hrs/day` | Proposed sheet bands |
| Signal: 🟠 Elevated | `7 – 8 hrs/day` | Proposed sheet bands |
| Signal: 🔴 High | `≥ 8 hrs/day` | Proposed sheet bands |

## Data model — what we add vs reuse

**Reused from existing Ops Hub:**
- `team_member_overrides` (member identity + dept placement + access tier)
- `team_member_countries` (member ↔ country assignments — already the country-ownership source of truth)
- `org_nodes` (dept hierarchy for tenancy + Team-Lead derivation via `managerEmail` chain)
- Queue normalizers (`src/utils/normalizeSourceRows.js`) — every source row already carries `country`, so per-country task counts are an aggregation, not a re-extract

**Net-new tables (all per-dept, `org_node_id NOT NULL`):**

```sql
-- 1. Per-dept formula + threshold settings (one row per dept)
CREATE TABLE capacity_settings (
  org_node_id          uuid PRIMARY KEY REFERENCES org_nodes(id) ON DELETE CASCADE,
  working_days         smallint     NOT NULL DEFAULT 22,
  minutes_per_task     smallint     NOT NULL DEFAULT 15,
  minutes_per_call     smallint     NOT NULL DEFAULT 15,
  baseline_call_hrs    numeric(4,2) NOT NULL DEFAULT 2.47,
  threshold_ok         numeric(4,2) NOT NULL DEFAULT 5.5,   -- < this = OK
  threshold_moderate   numeric(4,2) NOT NULL DEFAULT 7.0,
  threshold_elevated   numeric(4,2) NOT NULL DEFAULT 8.0,   -- >= this = High
  -- threshold_high is implicit (anything >= threshold_elevated)
  updated_at           timestamptz  NOT NULL DEFAULT NOW(),
  updated_by           text
);

-- 2. Manual EOR HC override per (dept, country) — optional; computed
--    Tasks/mo doesn't depend on HC, but the audit surfaces it as context.
CREATE TABLE capacity_country_hc (
  org_node_id   uuid    NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  country_code  varchar(10) NOT NULL,
  eor_hc        integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_by    text,
  PRIMARY KEY (org_node_id, country_code)
);

-- 3. Manual monthly call count per member (no automated source in Ops Hub today).
CREATE TABLE capacity_member_calls (
  org_node_id  uuid    NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  email        text    NOT NULL,
  calls_per_mo numeric(6,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz  NOT NULL DEFAULT NOW(),
  updated_by   text,
  PRIMARY KEY (org_node_id, email)
);

-- 4. Saved what-if scenarios. `snapshot` captures member↔countries at save time;
--    `proposed` captures the proposed re-assignment. Both JSONB so we don't need
--    a child row table.
CREATE TABLE capacity_proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_node_id  uuid    NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  title        text    NOT NULL,
  description  text,
  snapshot     jsonb   NOT NULL,    -- { email: [country_code, ...] }  at create time
  proposed     jsonb   NOT NULL,    -- { email: [country_code, ...] }  the new state
  status       text    NOT NULL DEFAULT 'draft', -- draft | applied | discarded
  applied_at   timestamptz,
  applied_by   text,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  created_by   text    NOT NULL
);
CREATE INDEX idx_capacity_proposals_dept ON capacity_proposals(org_node_id, status);
```

**Demand-side aggregation** — no new table. The aggregator route runs a per-call query that joins the queue cache (or recomputes from the 8 source endpoints) over a rolling 30-day window, grouped by country. Cached in `app_settings` keyed `capacity_country_workload:<deptId>` with a 15-min TTL (long enough to keep the table responsive, short enough that adding a country doesn't take a full day to show up).

## Multi-tenancy

Every table has `org_node_id NOT NULL`. Every endpoint uses `getCurrentDeptId(user, req)` from `src/lib/dept-scope.js` to scope reads/writes — matches the Phase 11+ pattern for Announcements / HR Hub / Leader Alerts.

The super-admin's dept picker (`useCurrentDept().setDept`) flips the cookie; this view's data hooks re-fetch automatically via the existing `currentDeptId` subscription.

## Permissions

- **Read access** — anyone in the dept whose role is Team Lead / Regional Manager / Director (mirrors the existing Leaders Hub "Reports" gate). Agents cannot see capacity.
- **Edit access** — same set, plus `is_hr_hub_admin` per-user grant if present. Settings PUT is gated server-side too.
- **Apply proposal** — Director / Regional Manager / Team Lead (because applying rewrites `team_member_countries`, which is sensitive).

## Phase ledger

| Phase | Status | PR | Notes |
|---|---|---|---|
| 0. Schema + sub-tab shell + skeleton API | ✅ shipped | [#885](https://github.com/Deel-Playground/jtk-ops-hub-v2/pull/885) | 4 per-dept tables, "Capacity" sub-tab in Leaders Hub, skeleton GET. Live on dev awaiting Deploy Now. |
| 1. Country Workload table | ✅ shipped | [#886](https://github.com/Deel-Playground/jtk-ops-hub-v2/pull/886) | Demand aggregator over 8 visible Deel sources + sortable table with totals row + owner derivation from `team_member_countries`. Zendesk/Jira/EVL columns ship as "soon" placeholders (Phase 1B extracts them from the queue route). |
| 2. Capacity Current (per-member) | 🔜 in progress | — | `aggregateMemberLoad` + `CapacityMembersCurrentTable` — agents grouped by Team Lead in collapsible sections with section-level totals + signal banding + load bar. |
| 3. Team Summary roll-up | ⏳ pending | — | Per-Team-Lead aggregation. |
| 4. Settings panel | ⏳ pending | — | Gear icon → drawer with formula tuning, signal thresholds, HC, member calls. |
| 5. Proposed scenarios (what-if) | ⏳ pending | — | Drag-and-drop rebalancing, save, apply. |
| 6. CSV export | ⏳ pending | — | Multi-section export matching Kristina's audit. |
| 7. Polish + cross-feature audit | ⏳ pending | — | Responsive / dark mode / empty states / 4-role matrix walk / final pass. |
| 1B. Zendesk + Jira per-country (deferred) | ⏳ later | — | Extract `fetchZendeskQueueForDept` + `fetchJiraQueueForDept` from `/api/v1/queue/route.js` into a shared module so the capacity aggregator can fan them out by country without re-implementing the per-dept dispatch. Columns ship in Phase 1 as "soon" placeholders. |

## Maintenance protocol

Per skill §3.10:
1. Every new rule, formula, decision, or cross-feature edge case learned during a phase MUST be appended to this doc **before** the next phase's PR ships.
2. Tick the phase row above when the PR lands on `dev`. Strikethrough + a note if a phase is skipped or merged into another.
3. Audit log section below captures pre-launch findings (mistakes caught in the read-through pass).
4. Never delete a checked item — history matters when a regression appears 3 weeks later.

## Audit log

### Phase 1 — Country Workload table (2026-06-01)

- **Snapshot ≠ monthly average.** The audit's "/mo" columns are 3-6 month rolling averages computed manually by Kristina. Ops Hub doesn't persist historical per-country counts anywhere yet — so Phase 1 ships the **live actionable snapshot** as the closest proxy, surfaced through the table with the same "/mo" label so the column headers stay 1:1 with the audit. A Phase 7 follow-up adds a daily `capacity_country_snapshot` table + cron so the 30-day rolling avg becomes available without changing the FE.
- **Per-dept dispatch via existing `deel-api` exports.** `listWorkbenchTasks` and `listImmigrationActions` accept `adminTokenOverride` (Phase 13b plumbing); the other Deel source list functions don't — but they only run for HRX where the env-var DEEL_ADMIN_TOKEN is correct. The aggregator wires both styles by looking up `resolveWorkbenchConfig(deptSlug)` and conditionally passing the override. Skill mistake #50 (slug constant must match `org_nodes.slug` in prod) avoided — we read the slug from `getCurrentDeptSlugAndId()`, not a hardcoded constant.
- **`useCurrentDept()` exposes `dept: { id, name, slug }`** — not a flat `deptSlug` field. Caught while wiring the GIX-only Immigration column gate; if you destructure `deptSlug` directly you get `undefined` and the column never shows for GIX. Pattern: `const currentDeptSlug = useCurrentDept().dept?.slug || null;`
- **`Promise.all` + `.catch` on each source.** The aggregator runs 8 sources in parallel and swallows per-source failures inside `safe()` (returns `{ items: [] }`). One failed source can't take the whole table to a 500 — matches skill mistake #22 (optional secondary queries).
- **Country resolution defensive.** Rows from older queue paths sometimes carry `country` (mapped to ISO from `employmentCountry`), others carry `countryCode`. The aggregator reads either, uppercase-normalises, and falls back to `'UNKNOWN'` so a row with no country tag still surfaces (as an "Unknown country" group) rather than silently dropping out.
- **15-minute in-process cache per dept.** Keyed by `deptId` so HRX and GIX refreshes don't trample each other. The refresh button sends `?bustCache=1` to force a fresh pull; the regular refetch on tab open uses the cache.

### Phase 2 — Capacity Current (2026-06-01)

- **Tasks/mo is a SHARE, not a per-country sum.** When a country has 3 co-owners in the dept, each owner gets `country.totalTasks / 3` — verified against Alexandra Apsychou's audit row (Greece 185 alone + Cyprus 113 alone + Portugal 456.8 / 3 = 450.3 ≈ Kristina's 450.2). The aggregator's `loadCountryOwners` already returns dept-scoped owner sets, so the share denominator is the *dept's* count, not a global one.
- **Team Lead grouping uses the same chain-walker as `teamLeadEmailFor`.** Capped at 6 hops to defend against malformed cycles. Walked in-memory using a member-by-email map built once per request (no per-member DB roundtrip). Members at TL+ tier (team_lead / regional_manager / admin / manager) don't appear as rows — they're section headers. If a TL also handles tasks directly, Phase 4 will add an opt-in toggle.
- **`on_leave` rows still render with counts.** A member on leave IS the workload that's currently uncovered, so showing their numbers helps the lead spot the gap. Their row gets an "On leave" badge so the lead doesn't mis-read the signal as "alive load."
- **`numCountries === 0` overrides the signal to ⚪ Inactive.** Aleksa Apostolov's row in the audit's Current sheet shows this — zero countries = zero tasks = no meaningful signal. The aggregator still emits the underlying `signal: 'ok'` so the FE can recompute if needed; the table forces 'inactive' for display.
- **Section-level rollup on the Lead row** — HC sum, WL/mo sum, average hrs/day, count of 🔴 and 🟠 members. Lets a manager scan dept health without expanding every section. Lifted straight from Kristina's "Team Summary" sheet's row shape so Phase 3 mostly reuses the math.
- **Load bar capped at the Elevated threshold** — anything red maxes out the bar visually (100%). Calibrating against the *configurable* threshold means it auto-adapts when Phase 4 lets a dept widen its bands.

## Open questions (resolved during build)

- **Demand window** — rolling 30 days. Audit log will note if 60-day moving average performs better.
- **Headcount source** — Phase 1 manual. Phase 7 explores `hiring_insights_summary_get` Deel admin endpoint for auto-pull.
- **Calls source** — Phase 1 manual entry. Future: scrape from Slack huddles or Calendar (out of scope for this build).
- **Working-day customization per country** — not yet. Single working_days value per dept. Could split per country in a follow-up if asked.
