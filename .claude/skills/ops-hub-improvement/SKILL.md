---
name: ops-hub-improvement
description: Use this skill whenever the user asks for ANY improvement, fix, feature, bug fix, refactor, or UI change in the ops-hub project. It enforces the full workflow — deep cross-feature audit, multi-role consideration (Agent/TL/Regional/Director), tree-view preservation, UI polish verification, implementation, commit, push, PR, CI wait, merge to dev — so the user only has to "go to Nexus and deploy". Includes the live post-deploy audit playbook (§6.7) for "I deployed, audit live by the book" requests, the in-app board layout reference (§3.13) anchored on Feedback's pattern, and every mistake-avoidance rule learned from prior sessions. Triggers: any ops-hub code change request, anything touching /Users/mohamed.tantawy/Desktop/ops-hub/, any mention of Queue/Briefing/Announcements/Escalations/HR Hub/Command Center/Feedback/Offboarding/Onboarding/Workbench/ACK/cache/sync/TL/Regional/Agent/Team/hierarchy/tree view, any cross-department or executive/leadership rollup, any "audit live" / "test live" request, any new tab or list-of-items surface.
---

# Ops Hub Improvement Workflow

You are working on **Deel Ops Hub** at `/Users/mohamed.tantawy/Desktop/ops-hub/` — Next.js 16 + React 19, deployed to Nexus (repo: `Deel-Playground/jtk-ops-hub-v2`, URL: jtk.dp.com).

**The user's expectation:** When they ask for an improvement, you do **everything** up to the point where all that's left is for them to click "merge" in Nexus to trigger the prod deploy. Your stop line is `dev` — everything else is automated.

---

## The Three Pillars (read this every time)

Every single change — bug fix, feature, refactor, UI tweak, anything — must satisfy all three pillars. If a change passes code review but fails any pillar, it is not done.

### Pillar 1 — Apply fixes across ALL four user types

Every ops-hub user is one of: **Agent (`at_agent`), Team Lead (`at_lead`), Regional Manager (`at_regional_mgr`), Director/Admin (`at_admin`)**. A fix for one is not a fix — it is a partial fix that creates a regression for the other three.

- Walk the four-role checklist in section **1.3** for every change
- If the feature is role-gated, verify the gating is correct for each role
- If the feature is visible to all, verify the data/behavior is correct for each role
- Never ship a fix tested under only one role

### Pillar 2 — Maintain the tree view (hierarchy integrity)

The Team Lead → Agents hierarchy is load-bearing across multiple surfaces: `Team.jsx`, `BriefingView.jsx` Team Leads card, `EscalationsView.jsx` grouping, `EscalModal` / `CreateEscalationModal` lead picker, `ReassignModal` agent picker. Any change that touches members, teams, regions, or role-based data must preserve:

- Expand/collapse state (the `Set` in Team.jsx)
- Lead → Agent visual nesting
- Region filter behavior
- Role-aware visibility (TL sees own row; Regional sees region; Admin sees all)

Walk the tree-view checklist in section **1.7** for any change near these surfaces.

### Pillar 3 — UI must look good, not just render

"It renders without errors" is not the bar. The bar is: alignment, spacing, colors via design tokens, hover/focus/disabled/loading states, responsive at 1440/1280/1024/900px, usable at 125% and 150% zoom, long text ellipsizes, empty/null/overflow states handled, dark mode intact, animations smooth.

Walk the UI polish checklist in section **4.5** for every visual change. Describe the visual result in your response to force self-review.

**If any of the three pillars is skipped, you have not finished the task.** The four-role checklist, the tree-view checklist, and the UI polish checklist are all mandatory — not "consider if relevant".

---

## Phase 1 — Deep Audit (before touching a single line)

Before writing code, ALWAYS do this audit. Skipping it causes regressions like "we fixed ack in one view but forgot three others".

### 1.1 Data model map

For the feature being changed, enumerate:
- **localStorage keys** it reads/writes (grep `localStorage.getItem\|localStorage.setItem`)
- **API endpoints** it calls (grep `apiFetch\|services/.*Api`)
- **Contexts** it consumes (`PermissionsContext`, `SettingsContext`, `IntegrationsContext`)
- **Shared hooks** (`useOnboardingData`, `useWorkbenchData`, `useChangeRequestData`, `useQueueSync`, `useQueueUnifiedSync`, etc.)
- **BroadcastChannel** messages (grep `broadcastSync\|getQueueChannel`)

### 1.2 Cross-tab consumer check

If the change touches data that multiple views consume, enumerate every consumer. The top-level views are: **Briefing (Home), Queue, Team, Analytics, Escalations, Announcements, Calendar, Projects, HR Hub, Settings, Knowledge Hub, Feedback** (the legacy `hr-reports` view was retired 2026-05-02 — its scope moved into HR Hub's `hr_reporting` flow). Audit grep:
```
Grep: <symbol you're changing> in src/components/views/ and src/App.jsx
```
If more than one view consumes it, the fix must land in the shared hook / utility, not in one view.

### 1.3 Role matrix audit — MANDATORY (non-negotiable)

**Every change must be explicitly verified against all four role perspectives — no exceptions, even for "obvious" or "trivial" fixes.** The four access types are defined in `src/data/accessControl.js`:

| Access ID | Role name | `user.access` value | What they see |
|---|---|---|---|
| `at_agent` | **Agent** | `'agent'` | Only own tasks. Cannot see Analytics/Escalations/Settings. `dataScope === 'my_tasks'`. |
| `at_lead` | **Team Lead** | `'team_lead'` | Own team's tasks via `scopeTasks(tasks, MEMBERS)`. Can impersonate own team. Home page Team Leads card filtered to own team. |
| `at_regional_mgr` | **Regional Manager** | `'regional_manager'` | Regional scope (`user.region`). "Viewing: {region}" pill shows. Team Leads card scoped to region. |
| `at_admin` | **Director / Admin / Owner** | `'admin'` | Global visibility. `isOwner` gates. Settings, user management, access control. `dataScope === 'all_tasks'`. |

**The four-role checklist — answer every row, in writing, before coding:**

```
CHANGE: <one-line description>

1. Agent (at_agent):
   - [ ] Does this change affect what an agent sees/does? How?
   - [ ] If the feature is hidden from agents, is the gating correct?
   - [ ] If visible: does the data scoping still show only their own data?

2. Team Lead (at_lead):
   - [ ] Does this affect the TL's view of their team?
   - [ ] Impersonation still works?
   - [ ] Team Leads card in BriefingView respects their scope?
   - [ ] scopeTasks(tasks, MEMBERS) applied where needed?

3. Regional Manager (at_regional_mgr):
   - [ ] Does region filter (user.region) still apply?
   - [ ] "Viewing: {region}" pill still correct?
   - [ ] Data aggregations cover all teams in the region?

4. Director/Admin (at_admin):
   - [ ] Global view intact?
   - [ ] Settings/admin-only surfaces still gated by isOwner / perms.canView?
   - [ ] No regression in cross-team/cross-region aggregations?
```

If any row is unclear, **stop and audit more**. The most common class of bug in this repo is "fixed it for Agents, broke it for TLs / Regionals / Directors (or vice versa)". A change is **not complete** until it has been verified against all four.

**Common failure modes by role — watch for these specifically:**
- Agent: forgot to gate the new feature, agent now sees something they shouldn't
- TL: forgot `scopeTasks`, lead sees global data instead of team data
- Regional: forgot `user.region` filter, regional sees only their own team not the full region
- Director: hardcoded `user.email === OWNER_EMAIL` instead of `perms.canDo(...)`, new admin can't use the feature

**Multi-role UI presence check:**
- If the change adds a UI element, confirm the element is present/hidden per role as intended
- If a dropdown filters members (e.g. Manager On Call picker), confirm the filter covers the right roles (`team_lead || regional_manager || admin`)
- If a view has different layouts per role (e.g. Briefing hero banner vs. Team card), verify ALL variants still render correctly

### 1.4 Identity audit

- **Always prefer `email`** as the identity key. **Never use `MEMBERS.id`** for matching, because `MEMBERS.id` is array-position-based and collides with DB `members.id` values.
- Past bug: ack list mixed `MEMBERS.id` with server `members.id`, causing Mohamed and Alaetra to appear acked on every announcement they never saw.
- The fix pattern is: when server provides `ackEmails` (or similar email list), use email-only matching. Use id as fallback ONLY if email is unavailable.

### 1.5 Cache key audit

Every user-scoped localStorage cache MUST be keyed with email. Pattern:
```js
const CACHE_KEY_BASE = 'ops_hub_<feature>_cache';
const cacheKeyFor = (userEmail) =>
  userEmail ? `${CACHE_KEY_BASE}:${String(userEmail).toLowerCase()}` : CACHE_KEY_BASE;
```
Without this, user A sees user B's data after a login swap. Audit all hooks in `src/hooks/use*Data.js` for this pattern.

### 1.6 BroadcastChannel audit

Cross-tab sync must also be user-scoped:
```js
broadcastSync(SOURCE_ID, items, null, userEmail);
```
The listener must discard messages where the email doesn't match the current user.

### 1.7 Tree View preservation — MANDATORY for any Team/hierarchy change

The Team view (`src/components/views/Team.jsx`) and related surfaces render a **hierarchical tree** of Team Lead → Agents, optionally filtered by Region. The Briefing view also shows a Team Leads summary card. These surfaces share structural assumptions — if you touch any of them, preserve the tree.

**What "the tree" consists of:**
- **Leads list** (level 1): filtered by `isAdmin || m.id === user.id` (TL sees own row, Regional sees region, Admin sees all)
- **Expand/collapse state**: `const [expanded, setExpanded] = useState(new Set())` — a Set of lead IDs
- **Chevron indicator**: `bi-chevron-up/down` rotates with expansion state
- **Agent rows** (level 2): rendered only when `expanded.has(lead.id)`
- **Region filter**: `[all | EMEA | APAC | AMER]` overlay that narrows the lead list
- **SLA health dot**: green/orange/red color per agent based on SLA usage
- **Stats pills**: task counts per status next to each agent

**Before and after any Team view or hierarchy change, verify:**
- [ ] Expand/collapse still works per lead (click row, chevron rotates, agents appear/disappear)
- [ ] The `expanded` Set is not accidentally cleared on every render
- [ ] Chevron direction matches state (`up` when open, `down` when closed)
- [ ] Region filter still narrows leads correctly (APAC selection doesn't show EMEA leads)
- [ ] If user is a TL (`isAdmin === false`): tree shows ONLY their own row (`m.id === user.id`)
- [ ] If user is a Regional: tree shows all leads in their region
- [ ] If user is Admin: tree shows all leads, region filter optional
- [ ] Agents' SLA health dots still compute correctly
- [ ] Keyboard: Enter/Space on a lead row toggles expansion (accessibility)
- [ ] Hover state on agent rows (background change) still works
- [ ] Empty-state message if `leads.length === 0` (e.g. "No leads in this region")

**Never break the tree by:**
- Flattening leads + agents into a single list (breaks hierarchy)
- Removing the expanded state (user loses their open/closed preference across renders)
- Changing `new Set()` to `[]` without updating the `.has()` / `.add()` / `.delete()` callers
- Hardcoding a single lead's expansion (breaks multi-lead view for admins)
- Removing the region filter (regionals and admins lose the ability to narrow)

**Related surfaces that render variations of the tree — keep them consistent:**
- `src/components/views/Team.jsx` — full tree, primary surface
- `src/components/views/BriefingView.jsx` — Team Leads summary card (flat list but same data source)
- `src/components/views/EscalationsView.jsx` — grouped by lead for escalation review
- `src/components/modals/EscalModal.jsx` / `CreateEscalationModal.jsx` — lead picker dropdown
- `src/components/modals/ReassignModal.jsx` — agent picker scoped by lead

If you change the lead/agent data shape or how `MEMBERS` is queried, **re-verify every surface above.**

### 1.8 Permission/access map

If the change adds a new action, route, or view:
- Does it need a new entry in `DEFAULT_ACCESS_TYPES` (`src/data/accessControl.js`)?
- Does it need `perms.canView` / `perms.canDo` gating?
- Does it need `restrictToEmail` owner-only gating (the `OWNER_EMAIL = 'mohamed.tantawy@deel.com'` pattern)?

### 1.9 Queue ↔ SLA cross-tab connections (load-bearing — read every time)

**Anything that touches an SLA window, capacity threshold, or per-row pill semantics MUST update every consumer in this list, otherwise the four surfaces drift and per-row pills disagree with aggregate counts.**

The whole SLA model (as of 2026-05-01) ticks on the **business-day clock** (`src/utils/bizTime.js`) — Saturday and Sunday don't elapse. There is one source of truth per data type:

| Data type | Where the SLA window comes from | Where the elapsed time is computed |
|---|---|---|
| Tickets (ZD/Jira) | `task.slaMinsOverride` (server-stamped from `app_settings.queue_sla_thresholds.zendesk\|jira`) → fallback `SLA_MINS[task.type]` | `slaInfo()` in `src/utils/helpers.js` — uses `elapsedBizMinutes(anchor, now)` |
| Deel sources (Onb / Off / Amend / Redline / Workbench / Incentive Plans) | `useQueueSlaSettings()` config keyed per queue (incl. `offboarding_termination` / `offboarding_resignation` / `incentive_plans`) → fallback constants in `normalizeSourceRows.js` | `computeSlaWindow()` in `src/utils/normalizeSourceRows.js` — uses `elapsedBizMs(anchor, now)`. Each row carries `slaWindowMs` so consumers can derive proportional bands |
| Capacity bands (Low/Good/High) | `useCapacitySettings()` → `app_settings.queue_capacity_thresholds` → fallback `{ lowMax: 40, highMin: 100 }` | classified inside BriefingView (`classifyWorkload`) and Team |

**Settings tables (FE editable):**
- **Team tab → Queue SLA settings card** (`Team.jsx::QueueSlaSettingsCard`) — edits `app_settings.queue_sla_thresholds`. 9 queue rows (incl. `offboarding_termination` + `offboarding_resignation` + `zendesk` paused + `incentive_plans`). Save broadcasts on `ops_hub_queue_sla_sync`.
- **Team tab → Workload capacity card** (`Team.jsx::CapacitySettingsCard`) — edits `app_settings.queue_capacity_thresholds`. Save broadcasts on `ops_hub_queue_capacity_sync`.
- **Settings → SLA Configuration** — only the global toggles (`sla_enabled`, breach notifications, warning %). The legacy per-function `sla_thresholds` editor was deleted on 2026-05-01 (unused at runtime; queue-sla settings are the single source of truth).

**SLA pill / count consumers — when you change a window or the at-risk band, AUDIT EACH AND VERIFY:**

1. **`src/components/queue/Queue.jsx` (header SLA pills)** — counts per-source via `rowSlaSeverity(row)` using the proportional band `slaRemaining < slaWindowMs / 4 / 1000`. Default sort is `(SLA tier ASC, createdAt ASC)`; sortable columns + tie-break per PR #326.
2. **`src/components/queue/SourceTable.jsx` (per-row pills + Paused section)** — splits sorted rows into `activeSorted`/`pausedSorted` via `row.isPaused`. Generic SLA tier helper `slaTier(row)` mirrors the Queue's pill math. Offboarding's SLA column uses the smart `offboardingUrgency(row)` (tier + end-date proximity).
3. **`src/components/views/BriefingView.jsx` (home health + org breach card)** —
   - Health Score: SLA Compliance % across **all queues except Jira** (50% default weight); Avg Response Time = ZD-only biz-day (20%); Capacity (20%); Resolution Rate ZD-only (10%).
   - Capacity bands use `useCapacitySettings()` thresholds.
   - Org breach ring (`orgBreach` / `orgAtRisk` / `orgSlaComp`) excludes Jira and includes all Deel breaches + proportional at-risk.
4. **`src/components/views/Team.jsx` (per-agent SLA dot)** — combines ticket breaches via `slaInfo()` with onb/off/wb breaches via `slaBreachStatus`. Amend/Redline have no per-agent assignee so they're excluded.
5. **`src/components/views/Analytics.jsx` (SLA Compliance KPI + agent stats)** — honours per-row `slaMinsOverride`; total compliance covers tickets + all Deel sources.
6. **`src/components/home/ApproachingBreach.jsx`, `DailySummary.jsx`** — consume `slaInfo` for tickets only.

**Critical "must update together" edges** (when you change A, also touch B):

| Change | Must also update |
|---|---|
| New SLA window for a queue | `app/api/v1/settings/queue-sla/route.js` DEFAULT_SLA + VALID_QUEUES; `src/hooks/useQueueSlaSettings.js` mirror; `src/utils/normalizeSourceRows.js` fallback constant; `Team.jsx` QUEUE_META row |
| New per-row SLA field | `normalizeSourceRows.js` (every normalizer's return); `Queue.jsx` `rowSlaSeverity`; `SourceTable.jsx` `slaTier`; BriefingView aggregates |
| New capacity band rule | `Briefing.jsx::classifyWorkload`; `Team.jsx::CapacitySettingsCard` (if user-tunable); home capacity legend |
| Change biz-day math | `bizTime.js` is the only site — all callers (`slaInfo`, `computeSlaWindow`, BriefingView response-time) inherit |
| Add a server-side `slaMinsOverride` rule | `app/api/v1/queue/route.js::getSlaOverrides` + the per-source builder (Zendesk vs Jira); FE `slaInfo` automatically picks it up |

**LocalStorage / IDB keys** — every queue cache is user-scoped (`<base>:<email>` suffix). `clearQueueCaches()` in `App.jsx` walks the prefix on logout to wipe both old global keys and new per-user keys.

If you can't trace a change through every row above, the audit is incomplete. Bet on this list staying current — when you ship, update it.

---

## Phase 2 — Pre-flight checks

Before coding, run these in parallel:

```bash
cd /Users/mohamed.tantawy/Desktop/ops-hub
git fetch nexus
git status
git log nexus/main --oneline -5
git log nexus/dev --oneline -5
```

Then:
1. **Start from a clean base.** If current branch has uncommitted work not related to the task, stop and ask the user.
2. **Branch off the right ref:**
   - For a fix: `git checkout -b fix/<scope>-<short-description> nexus/main`
   - For a feature: `git checkout -b feat/<scope>-<short-description> nexus/main`
   - Branching off `nexus/main` (not dev) ensures the PR base is minimal and reviewable.
3. **Never run destructive git commands without explicit user permission.** This includes:
   - `git checkout <ref> -- .` (overwrites working tree — I did this once and nearly lost a commit)
   - `git reset --hard`
   - `git clean -fd`
   - `git push --force` (NEVER to main/master)

---

## Phase 3 — Implementation rules

### 3.1 Inline-styled components and responsive design

Most components use inline `style={{}}`. CSS media queries don't work inline. For responsive behavior, embed a `<style>` tag with a className next to the component:

```jsx
<style>{`
  .my-responsive-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; }
  @media (max-width: 980px) { .my-responsive-grid { grid-template-columns: 1fr; } }
`}</style>
<div className="my-responsive-grid">...</div>
```

### 3.2 Grid overflow hardening

If a grid column contains variable-width content (names, avatars, badges), always apply:
- Outer grid: `gridTemplateColumns: 'minmax(0, 1fr) ...'` (not just `1fr`)
- Inner flex/grid child: `minWidth: 0`
- Text: `whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'`
- Badge rows: `flexWrap: 'wrap'`

Without this, the column will push past its allotted width and clip siblings.

### 3.3 Outside-click handler pattern

```jsx
const [showPicker, setShowPicker] = useState(false);
const ref = useRef(null);
useEffect(() => {
  if (!showPicker) return;
  const onDocClick = (e) => {
    if (ref.current && !ref.current.contains(e.target)) setShowPicker(false);
  };
  document.addEventListener('mousedown', onDocClick);
  return () => document.removeEventListener('mousedown', onDocClick);
}, [showPicker]);
```

### 3.4 Stale-while-revalidate hooks

All data hooks follow this shape — match it:
- `loadCache(userEmail)` reads from user-scoped key
- In-flight dedup via `inFlightRef`
- `broadcastSync` on success (user-scoped)
- `useEffect` listens to the channel and adopts messages where `msg.source === SOURCE_ID && msg.userEmail === currentEmail`
- Auto-refresh while visible: `visibilitychange` listener
- Stale TTL check in `refresh()`

**Empty cache ≠ "fetched and empty"** — `setLoading(false)` only when items have arrived OR a real fetch confirms an empty list. A naïve `setLoading(!cache)` flips loading off when the cache happens to be `{items: []}` (stale empty from a previous failed fetch) — the user then sees the EmptyState while a slow refresh is still in flight. Use `!cache || (cache.items?.length ?? 0) === 0` to keep the skeleton up until a real response lands. See feedback fix 2026-05-13.

### 3.5 No new files unless necessary

**Never create new files (especially .md) unless explicitly requested.** Edit existing files. The only exception is when the user asks for a new component/view or when a brand new hook is structurally the right answer.

### 3.6 Deel admin API — pagination + filter quirks

The `api-prod-admin.letsdeel.com` admin endpoints have non-obvious behaviour that's bitten us multiple times. Read this before adding or modifying any scan:

**Cursor pagination**: every paginated admin endpoint (`/admin/eor/terminations_v3`, `/admin/eor/employee-manager/list/...`, etc.) returns a `cursor` token. The cursor encodes the FILTER + SORT state from the first request. Subsequent calls must send ONLY `cursor=...` — sending `limit` or any filter param alongside an existing cursor returns 400.

**`?status[]=` IS supported on `terminations_v3`** (verified 2026-05-01 via the test-filter probe; previous comments saying Joi rejects it were wrong — an unrelated misconfig at the time looked like a validator rejection). Use it. Send the actionable status values as the initial filter and walk only the matching subset:

```
/admin/eor/terminations_v3?limit=50&sortBy=createdAt&sort=DESC&status%5B%5D=AWAITING_TRIAGE&status%5B%5D=PROCESSING
```

Without this you walk the full ~71k haystack to find the ~1k actionable rows. With it, the upstream subset is ~2.6k records over ~53 pages.

**Asymmetric Joi (status as state vs status as filter)**: some upstream values pass through as record state but get rejected as filter inputs. Example: `AWAITING_PTO` rows exist (~25 of them on terminations_v3) but `?status[]=AWAITING_PTO` returns HTTP 400. Confirm this with the test-filter probe shape: enumerate every candidate status against `count.total` and compare the sum to the unfiltered baseline. The gap = asymmetric values. Treat them as post-actionable unless you have explicit business confirmation otherwise.

**Parallel-by-status streams beat one cursor with multiple filters** when the actionable set has 2+ disjoint status values. Run one cursor stream per status via `Promise.all` and merge by `id`. Wall time becomes `max(stream durations)` instead of their sum — for terminations_v3 (PROCESSING is the larger set at ~35 pages, TRIAGE ~19 pages) total ≈ 35 × ~1.5s ≈ ~52s instead of ~80s. Each stream gets its own per-stream empty-page early-stop; defensive only with the server filter applied.

**Smart sort for huge upstreams (legacy fallback)**: if you're forced to scan unfiltered (no admin JWT, REST-v2 fallback, etc.), pass `sortBy=createdAt&sort=DESC` on the first request so actionable records cluster at the front of the walk. The cursor preserves the sort. **Never pair early-stop with the default `endDate ASC nulls first` sort** — actionable rows interleave with closed rows across the entire walk and a 50-page heuristic loses two-thirds of them.

**Track raw status counts** as you scan and surface them in the route response (`upstreamStatusCounts: { AWAITING_TRIAGE: ..., PROCESSING: ..., ... }` plus `upstreamServerTotal`, `upstreamScanned`, `upstreamPages`). This is the only way to debug "why isn't the count what I expect" — without it you have no visibility into what the upstream actually contains. The 2026-05-01 audit caught a 392-record gap (1336 PROCESSING seen vs 1728 actually present) only because the route surfaced these counters.

**Upstream returns assignee NAME, never email** on `terminations_v3` — verified 2026-05-01: 1042 of 1046 actionable rows had `exAssignee` populated with a display name, **0** had `exAssigneeEmail`. The route handler must resolve the name against the team directory before returning, otherwise:
- `_scopeCountryOrAssignee` falls through to country-only matches → TLs see a tiny fraction of their queue
- The Queue's "Unassigned" filter (`r => !r.assigneeEmail`) matches every row — looks like ~1k unassigned instead of ~5

The fix is one line per mapping: `assigneeEmail: (c.exAssigneeEmail || resolveEmailByName(c.exAssignee) || '').toLowerCase()` (helper exported from `src/utils/normalizeSourceRows.js` — handles accents, "De Luca" ↔ "Deluca", and middle-name drift). Apply the same pattern to any upstream that ships display names without emails.

**Parent-bucket endpoints can be incomplete**: `/admin/eor/employee-manager/list/Onboarding.ActionableQueue` does NOT consistently surface every sub-status (we explicitly fan out to `Onboarding.ComplianceDocs.AwaitingReview`, `Onboarding.EA.EASigning.AwaitingToSendEA`, `Onboarding.EA.EAAdditionalDetails.AwaitingReview`, `Onboarding.PayrollComplianceDetails.AwaitingReview`). When in doubt, fan out per-status and merge by `onboardingId || oid`.

**Per-country fan-out for paged sub-statuses**: most sub-status list endpoints return ~50 rows per call without a country filter. To pull every actionable row, hit `/admin/eor/employee-manager/countries/list/<status>` first to get country totals, then call `/admin/eor/employee-manager/list/<status>?countries[]=<CC>` per country. Mirror the Paused-onboarding pattern in `_scanOnboardingByStatus` for any new sub-status scan.

**The test-filter probe pattern**: when you need to confirm what an upstream accepts, ship a temporary owner-gated route that enumerates each candidate value against `count.total` plus an empirical pass that walks the first N pages and tallies real status values. Compare per-status sum vs baseline to find asymmetric (state-only) values. Delete the probe in the same commit as the real fix. Pattern lived briefly at `app/api/v1/integrations/deel/test-filter/route.js`.

### 3.7 Country ownership is DB-backed (not static)

`OWNER_COUNTRIES` and `COUNTRY_OWNERS` in `src/data/countryOwners.js` are **live-binding `let` exports**, populated on every roster hydration from the `team_member_countries` junction table. Changes:

- Server: `roster-server.js` calls `hydrateOwnerCountries(rows)` after each cache miss.
- Client: `useTeamMembers` calls the same hydrator from the API response (`countries: string[]` per member). Hydration is gated on at least one member carrying countries so a baseline cold paint can't wipe a known-good map.
- Queue scoping (`queue-scoping.js`) reads the live bindings via lazy `getAllCountries()` so admin-scope reflects the current map.
- The picker (`MultiCountryPicker.jsx`) is the only edit surface; it lives on the Team-tab Countries column.

When you change country-ownership semantics, walk this whole chain — server hydration, client hydration, queue scoping, picker UI, and the export/audit endpoints. The static fallback in `countryOwners.js` exists ONLY for cold-boot before the first hydration.

### 3.8 Versioned re-seed pattern (data correction deploys)

When you need to overwrite seeded DB data on a specific deploy without wiping manual edits made between deploys, use the `app_settings.<feature>_seed_version` pattern (see `src/lib/country-owners-seed.js`):

```js
const SEED_VERSION = 2; // bump per deploy that re-seeds

// On boot:
const stored = await getStoredVersion();
if (stored < SEED_VERSION) {
  await query('BEGIN');
  await query('LOCK TABLE <target> IN ACCESS EXCLUSIVE MODE'); // lock against PUTs
  await query('DELETE FROM <target>');
  // INSERT new rows
  await setStoredVersion(SEED_VERSION);
  await query('COMMIT');
}
```

Three things to get right:
1. **Lock the target table** during the wipe-and-reseed so a concurrent PUT can't lose its write.
2. **Always include the deploy's data file** (e.g. JSON) in the same commit as the version bump — they ship together.
3. **Use email or a stable UUID as the seed key, not a fuzzy name match.** Name-matching seeds cause display-name vs email-localpart drift bugs; the v1 country seed had this and we re-seeded as v2 to correct it.

### 3.9 Stackable per-feature admin power (Team-tab grants)

When you need a permission that gates feature-level edit rights without escalating someone to RM/Admin, mirror the existing `is_access_admin` / `is_announcements_admin` pattern. Stackable on top of any base access type (TL or agent can be granted without losing their existing role).

Five plumbing points — touch all five or the flag never reaches the FE:

1. **Migration**: `ALTER TABLE team_member_overrides ADD COLUMN IF NOT EXISTS is_<feature>_admin BOOLEAN DEFAULT FALSE` + a partial index `WHERE is_<feature>_admin = true` for the few rows that have it.
2. **Server helper** at `src/lib/<feature>-admin.js`: 30 s in-memory cache keyed by lowercased email, `canAdminister<Feature>(user)` combines `user.role === 'admin'` + DB lookup. `bust<Feature>AdminCache(email)` for the Team-tab settings UI to invalidate after a flip. Mirrors `access-admin.js` shape.
3. **`team-members-merge.js`**: include `is_<feature>_admin` in the `normaliseOverrideRow` SELECT projection AND in `applyOverride`'s no-override branch (defaulting to `false`).
4. **`/api/v1/me`**: SELECT the column, include `is<Feature>Admin: mergedEntry.isHrHubAdmin === true` in the JSON response. `App.jsx`'s localStorage snapshot init AND post-`/me` hydration must both carry the field through — three patches in one file.
5. **`accessControl.js` + `usePermissions.js`**: append the action to `ALL_ADMIN_POWERS` + label, define a dedicated default access type (e.g. `at_<feature>_admin`) bundling it, and expose `canManage<Feature>` via the permissions hook combining the per-user grant with full-admin baseline.

The HR Hub Admin grant landed via this exact pattern (`is_hr_hub_admin` + `hr-hub-admin.js` + `canManageHrHub`); replicate it for any future feature that needs delegation.

### 3.10 Long-running multi-stage builds — living plan doc + direct-to-dev

For multi-stage features (≥3 commits / ≥1 day of work) where the user is the only reviewer, the standard "feature branch → PR to dev" flow becomes friction. The pattern that works:

- **Living plan doc at the repo root** (e.g. `HR_HUB_PLAN.md`): single source of truth captured up front and kept in sync with every commit. Include a "Maintenance protocol" section at the top stating that every new rule, decision, or cross-tab connection MUST be appended here before the work ships. Stage-by-stage verification checklists with checkboxes; tick as you land each item; never delete unchecked items (cross out with strikethrough + a note if skipped).
- **Direct commits to `nexus/dev` with rebase-on-fetch**: only when the user has explicitly authorised it for the build (e.g. "commit and push to nexus dev, once all stages are done I will deploy"). The CI auto-bumps `.test-trigger`, so every push needs `git pull --rebase nexus dev` before `git push`. Don't mix this with the standard PR flow — pick one per build at the start.
- **Per-stage commit, per-stage skill update**: each stage gets its own commit with a coherent message body. Tick the plan-doc checkboxes in the same commit. Don't batch multiple stages into one commit — it makes rollback harder and the audit log noisier.
- **Pre-launch audit pass**: before the user deploys, do one final read-through of every shipped file looking for (a) `useEffect` deps including the polled state, (b) async checks that should be awaited, (c) plumbing gaps (e.g. server returns a flag but FE never reads it), (d) leftover dead-code from removed features. Capture findings in the plan's "Audit log" section.

### 3.11 Polling effect rules

Three traps for any in-app polling loop (5 s comment poll, 30 s notification poll, etc.):

- **Don't include the polled state in `useEffect` deps**. If the effect lists `[requestId, comments]`, every poll tears down + rebuilds the interval, leaking timers on long-lived sessions. Use a ref: `const commentsRef = useRef(comments); useEffect(() => { commentsRef.current = comments; }, [comments]);` and have the polling effect deps be just `[requestId]`. Read `commentsRef.current` inside the tick.
- **Cursor on the tail timestamp, not a counter**: `?since=<ISO>` of the latest known item, server returns strictly-after rows. Counter-based ("page 2") loses items if anyone else posts mid-poll.
- **Dedup by id on merge**: `setComments(prev => { const seen = new Set(prev.map(c => c.id)); return [...prev, ...fresh.filter(c => !seen.has(c.id))]; })`. Two reasons: optimistic local appends followed by a poll that returns the same row; cross-tab BroadcastChannel echoes.

### 3.12 Notification polymorphism — extending the bell

The `user_notifications` table is already polymorphic — `link_view`, `link_id`, `source_type`, `source_id` are all opaque strings. To surface a new feature in the bell, write rows with your own `link_view` value and let the existing 30 s bell hook (`src/hooks/useNotifications.js`) display them automatically. No schema change.

The deep-link routing lives in `App.jsx::handleNotifClick`. Add a branch keyed off `n.linkView === '<feature>'` that does whatever your feature needs (set view, dispatch a CustomEvent, or stash an id in the URL via `history.replaceState` before flipping the view so the receiver opens to the right detail).

Server-side fan-out helper pattern: take `recipients`, `excludeEmail` (typically the actor), `type` (e.g. `mention` / `comment` / `status_change`), title, body, requestId, sourceType, sourceId. Multi-row INSERT with a single round-trip; `ON CONFLICT DO NOTHING` to dedup by `(recipient, source_type, source_id)`.

### 3.13 In-app board layout — Feedback's pattern is the reference

Any new tab that shows a list of items (HR Hub, future "Tasks board", etc.)
should match the **Feedback board** visual rhythm so users don't have to
re-learn the surface tab to tab. The 2026-05-02 HR Hub redesign was a
direct port of these tokens — copy them; don't invent new ones.

Top-to-bottom block order, with reference styles in `FeedbackView.jsx` /
`HrHubView.jsx`:

  1. **Hero header** (`pageHead` style): 40×40 rounded coloured icon tile
     on the left, H1 + subtitle inline, primary action button on the
     right (`primaryBtn` — purple `#7c3aed` with the soft shadow). One
     line, ~58 px tall. Padding `20 0 12` keeps it tight.
  2. **Segmented scope toggle** (`segmentedControl` / `segmentBtn` /
     `segmentBtnActive` / `segmentCount`): pill-rail with each segment
     showing label + a small count badge. Active segment gets the
     subtle white pill + shadow + bold weight. Counts always reflect
     the current secondary filters so the user can pre-empt how busy
     each segment is before clicking.
  3. **4-up status filter cards** (`statusFilterBtn` + the
     `<feature>-status-grid` CSS class with `repeat(4, minmax(0,1fr))`,
     collapsing to `repeat(2, …)` at ≤900 px): coloured icon tile on
     the left, status label + "N requests" sub-line, big tabular-nums
     count on the right. Active state tints the card background + flips
     the icon tile to the bold accent. Click to filter, click again to
     clear.
  4. **Filter bar** (`filterBar`): single line. Type/category pill chips
     on the left (each with their own `filterPill` + `filterPillActive`
     accent colour), search input + sort `<select>` + refresh `iconBtn`
     + admin-only settings `iconBtn` on the right. Always at 32 px row
     height so the chips align with the inputs.
  5. **Row list** (compact, ~50 px tall per row, hover tint via
     `var(--surface-2)`): priority dot (8 px coloured) → small flow
     icon tile (24 px coloured) → two-line title + meta → status pill
     + attachment count + relative time on the right. Status pills use
     `bi-circle-fill` / `bi-arrow-repeat` / `bi-pause-circle-fill` /
     `bi-check-circle-fill` to match Feedback's icons exactly.

The token block at the bottom of `HrHubView.jsx` (`page`, `pageHead`,
`scopeRow`, `segmentedControl`, `segmentBtn`, `statusFilterBtn`,
`filterBar`, `filterPill`, `primaryBtn`, `iconBtn`) is a verbatim copy
of Feedback's. Keep them in sync — if you tune one surface's spacing,
tune the other.

Compactness target: hero + scope toggle + status cards + filter bar
should fit in ~290 px above the first row at 1440 px wide. Anything
taller wastes scroll real estate the user explicitly called out as a
problem.

### 3.14 Sync-badge state machine — per-source, not aggregate

The Queue's sync badge tracks per-source freshness, not a single `oldestSyncAt` aggregate. Old logic ("any source >10 min → red") created panic states whenever offboarding's slow scan ran in the background. The 2026-05-01 redesign:

- Each source is scored against the same thresholds independently. A stale source that's currently refreshing counts as **fresh** ("the system is fixing it") — keeps the badge green during background polls.
- Per-source threshold overrides for sources whose natural cycle is longer than the default. Offboarding gets `WARN_AFTER_BY_SOURCE = 12 min` and `STALE_AFTER_BY_SOURCE = 15 min` (vs the default 7 min / 10 min) because its scan + cache TTL puts the cycle around 5–6 min, so 2 missed cycles + slack.
- Aggregates exposed via `meta` in `useQueueUnifiedSync`: `freshSourceCount`, `staleSourceCount`, `refreshingStaleSourceCount`, `agingSources`, `staleSources`, `anyStale`, `anyAging`, `allStale`, `allFailing`. The `UnifiedSyncButton` state machine reads these — `live`, `partial-stale`, `partial-error`, `aging`, `stale`, `error`, `offline`, `waiting`, `syncing`. Quiet "Live" sublabel by default; only surface "synced N min ago" when something has actually crossed its per-source threshold.

When you add a new queue source, plumb its `lastSyncAt` and `isRefreshing` into `useQueueUnifiedSync.sources`, optionally add a per-source threshold override if the natural cycle exceeds 5 min, and the badge handles it without a state-machine change.

### 3.15 CSV export format hardening

Any new CSV download route must:
- **Prefix the body with `﻿`** (UTF-8 BOM) so Excel on Windows recognises encoding and doesn't mojibake accented HRX names.
- **Use `\r\n` line endings** per RFC 4180. LF-only breaks Numbers' import wizard and a few CSV parsers.
- **Always-quote every field** (`"value"`) including numbers and codes — handles leading-zero ISO codes, comma-bearing names, and embedded quotes uniformly.
- **ASCII-safe filename** in `Content-Disposition` (Safari drops the header on non-ASCII).
- **`.catch()` on optional secondary queries** in `Promise.all` so a missing table on a brand-new env serves with empty counts instead of 500ing the whole download.

### 3.16 Platform vs project boundary — when to escalate to the Nexus team

Some bugs aren't ours to fix. The chart files in `helm/templates/*.yaml`
and the chart-default values in `helm/values.yaml` (note the prefix —
this is NOT the project root `values.yaml`) are part of Nexus's canonical
template set; every project on the same chart version gets the same
baseline. When one of those files has a bug, project-level fixes fail:

- **Editing the template** → Nexus's `[skip ci] sync templates to v16
  with overrides` bot reverts your edit on its next cycle.
- **Deleting the template** → same bot recreates the file on the next
  cycle.
- **Adding the missing key to OUR `values.yaml`** → works on dev, but
  Nexus's `deploy: merge dev into main (user code only)` bot strips
  values.yaml from the dev → main merge, so the fix never reaches prod
  through the standard flow.

The right answer is to ask the platform team (Mariusz et al.) to fix the
canonical. The 2026-05-08 v16 SA template bug (broken
`helm/templates/service-account.yaml` referencing a values key that
wasn't in canonical defaults) was fixed by adding
`serviceAccountName: "app"` to the canonical `helm/values.yaml`, which
gave the broken template a valid fallback for every project automatically.

**How to recognise a canonical-template bug:**
- A `[skip ci] sync templates to v<N> with overrides` commit appears
  in `git log nexus/dev` shortly before the symptom started.
- The failing template references a `.Values.<key>` that isn't in
  either our `values.yaml` or the chart's `helm/values.yaml`.
- The same dry-run failure would presumably affect any other project
  on the same Nexus chart version.

**Escalate vs project-fix decision matrix:**

| Layer | Owner | Examples |
|---|---|---|
| `src/`, `app/`, `.github/workflows/`, `Dockerfile` (mostly), root `values.yaml` | Project (us) | App code, API routes, runtime config. Standard PR → dev → Deploy Now. |
| `helm/templates/*.yaml`, `helm/values.yaml`, ArgoCD config, the template-sync mechanism | Platform (Nexus team) | Escalate via Slack to Mariusz. Don't try to work around. |

The Template Overrides UI in Nexus Settings exists as a project-level
override mechanism, but the 2026-05-08 attempt to use "Add project-
specific file" for an existing canonical template was wrong per the
platform team. Until we have documented confirmation of the right UI
flow, default to platform escalation.

**Lesson logged 2026-05-08:** three failed PRs (#498/#500/#502) burned
~2 hours each trying project-level workarounds for a v16 chart bug.
The first sign of `sync templates to ... with overrides` reverting
your fix is the signal to STOP and escalate, not to try a different
angle.

### 3.17 Lite list + lazy-detail split for media-heavy lists

Any list endpoint whose rows can carry binary blobs (`screenshot` data
URI, `attachments[]` of `{kind, dataUri, name}`, etc.) MUST project a
lite shape on the list path and serve the full data only on detail:

  • **Server list query** projects scalar columns + an
    `attachment_count` derived expression like
    `(CASE WHEN screenshot IS NOT NULL THEN 1 ELSE 0 END)
     + COALESCE(jsonb_array_length(COALESCE(attachments, '[]'::jsonb)), 0)`.
    Never `SELECT r.*` when the table has `TEXT` / `JSONB` columns
    that can hold base64 payloads.
  • **Detail endpoint** (`/api/v1/<feature>/<id>`) returns the full
    row including dataUris.
  • **Client hook** exposes `loadDetail(id)` that fetches the detail
    and merges it into the local item by id (`setItems(prev =>
    prev.map(i => i.id === id ? { ...i, ...detail } : i))`).
  • **View** fires `loadDetail` on row expand. Dedupe on
    `attachments.length >= attachmentCount` (live state, NOT a ref
    of "ever loaded" ids — see mistake #44). An in-flight ref blocks
    duplicate fetches while one is mid-flight; nothing else.
  • **List-row affordance** when the row has attachments but no
    dataUris yet: render a generic "📎 N" placeholder instead of
    skipping the slot entirely, so users see the row carries media
    they can click through to.

Why this matters: the 2026-05-13 Feedback audit found `SELECT r.*`
shipping every row's full `screenshot` (≤ 3 MB) + `attachments[]`
(≤ 12 MB × 5 per row) for up to 500 rows. Worst-case response was
>100 MB — exactly the ~1-min cold-load Mohamed reported. The lite
shape brought first paint to <1 s. See PR #590.

Cache shape mirror: the LS-side SWR cache stores the lite shape (so
the cold-load cache stays small). Detail-fetched dataUris live in
in-memory state only — they go away on the next poll cycle by design,
and the lazy-fetch refires on the next expand.

### 3.18 Command Center cross-impact — check on EVERY change (mandatory)

The executive **Command Center** (`src/components/views/CommandCenterView.jsx`,
`src/lib/command-center-aggregator.js`, `app/api/v1/command-center/*`, view id
`command-center`, Source Registry `src/data/commandCenterSources.js`) is a
read-only cross-DEPARTMENT rollup for the CEO / VP Ops / COO. It aggregates
EVERY department — the inverse of the per-dept isolation the rest of the app
enforces. Because it sits on top of every department and every dept-scoped data
source, almost any change can silently make it stale or wrong.

**On every change, ask these and act on the answer:**

1. **Did I touch a department-scoped data source?** (any table with `org_node_id`,
   any per-dept Deel/queue source in `dept-integrations.js`, any metric/report).
   → Update the Source Registry `src/data/commandCenterSources.js` in the SAME
   change, AND extend the matching Command Center rollup so the exec view reflects it.
2. **Did I change what a "department" is?** (org_nodes shape, dept create/rename/
   archive, slug, headcount, the dept→team→member nesting). → The CC enumerates
   depts live from `org_nodes`, so most dept changes flow through automatically —
   but verify the rollup queries + FE cards still hold, and that nothing hardcodes
   a dept/slug (mistake #50).
3. **Did I change a metric formula or SLA/capacity math?** (Health Score, `bizTime`,
   `slaInfo`, capacity bands, the aggregators). → The CC reuses these; update the CC
   rollup so per-dept numbers don't drift from each dept's own view.
4. **Did I add/rename/retire a permission or role?** → Re-check the exec gate
   (`can_view_command_center`, `at_command_center`, `is_command_center_viewer`,
   `COMMAND_CENTER_SEED_VIEWERS`) and that FE `perms.canViewCommandCenter` stays in
   lockstep with server `canViewCommandCenter()` — a divergence either leaks the
   cross-company rollup or 403s a tab that's visible.
5. **Did I retire a feature?** → Remove its Source Registry entry + its CC rollup,
   the same way you walk the audit-before-delete list (mistake #27).

If a change has Command Center impact and you can't trace it through the registry
+ the relevant rollup, the change is NOT done. Bet on this surface being affected
by anything dept-scoped — when in doubt, open `commandCenterSources.js` and check.
The full build plan + phase status lives in `COMMAND_CENTER_PLAN.md`.

---

## Phase 4 — Post-implementation audit

Before committing, run these checks:

### 4.1 Conflict-marker sweep
```
Grep: <<<<<<< OR ======= OR >>>>>>> in src/
```
Must return empty.

### 4.2 Unused-import / dead-code sweep

If you removed a feature from a file (like Manager On Call from DeelTopNav), check imports that become dead:
```
Grep: <removed import name> in <file>
```

### 4.3 Cross-consumer sanity

If you changed a shared hook / shared data structure, re-grep every consumer and visually confirm they still handle the shape. Example: if you added `userEmail` to a hook signature, every `useThatHook()` caller must pass it.

### 4.4 Role matrix re-verification

Answer out loud (in a comment or in the response): "For Agent / TL / Regional / Director, does this change behave correctly?" If any role answer is unclear, keep iterating.

### 4.5 UI polish audit — MANDATORY for any visual change

"It renders" is not "it looks good". Before shipping any UI change, walk through this list:

**Alignment & spacing:**
- [ ] New element aligns to the same baseline/grid as its neighbors (don't eyeball — match existing `padding`, `gap`, `marginTop` values)
- [ ] Text baselines align across columns (inconsistent `lineHeight` causes staircase effects)
- [ ] Icons vertically centered with their text (`display:'flex', alignItems:'center'`)

**Color & contrast — CSS vars from day one, never "fix dark mode later":**
- [ ] Uses CSS variables where available (`var(--text)`, `var(--text-secondary)`, `var(--text-muted)`, `var(--surface)`, `var(--surface-2)`, `var(--surface-3)`, `var(--border)`, `var(--border-light)`, `var(--purple)`, etc.) — never hardcode `#1b1b1b` / `'white'` / `#f7f5f2` for theme-dependent contexts
- [ ] **Hardcoding `'white'` for `background:` is a tell that dark mode is broken.** It almost always needs to be `var(--surface)`. Same for `#1b1b1b` text on light cards, `#616161` for secondary text, `#e8e8e8` for borders.
- [ ] **Status semantics stay LITERAL on purpose.** `#0369a1` for new / `#d97706` for in-progress / `#15803d` for done / `#dc2626` for critical — these convey meaning that must NOT shift with theme. Don't blanket-replace status pill colours with CSS vars.
- [ ] If a hardcoded color is a status indicator AND has both a `color` and a `bg`, both must stay literal so the contrast pair holds in light + dark. The 2026-05-02 HR Hub Stage B sweep ran ~150 replacements but left every status-pill colour intact for this reason.
- [ ] Matches the existing Deel design tokens (fonts: Inter; body 12–13px; headings 16px; small 10–11px)
- [ ] Dark mode intact — if the change adds hardcoded theme-context colors (text, surface, border), they must have a dark-mode equivalent via `data-theme="dark"` CSS vars OR use the existing vars from the start.

**Interaction states:**
- [ ] Hover state (`onMouseEnter` / `onMouseLeave` OR `:hover` via styled block)
- [ ] Active/pressed state for buttons
- [ ] Focus ring visible for keyboard users (don't remove outline)
- [ ] Disabled state if applicable (opacity, cursor, no-op handlers)
- [ ] Loading state for async actions (spinner, skeleton, or disabled)

**Responsive & zoom:**
- [ ] Renders cleanly at 1440px, 1280px, 1024px, and 900px wide
- [ ] Still usable at 125% and 150% browser zoom (TLs and Regionals often zoom in)
- [ ] No horizontal scrollbars on any supported viewport
- [ ] Long content (name, title, email, badges) truncates with ellipsis, not overflow
- [ ] Grid/flex children with variable width use `minWidth:0` + ellipsis pattern

**Role-variant rendering:**
- [ ] Layout looks right for Agent (fewest nav tabs, smallest data set)
- [ ] Layout looks right for TL (medium data set, impersonation pill visible)
- [ ] Layout looks right for Regional (regional pill visible, multi-team aggregations)
- [ ] Layout looks right for Admin (all tabs visible, full data, settings accessible)

**Empty and edge states:**
- [ ] What if there are 0 items? (empty state copy, not a broken grid)
- [ ] What if there are 1000 items? (scroll, virtualization, or pagination)
- [ ] What if a field is null/undefined? (default display, not "undefined")
- [ ] What if an avatar has no image? (initials fallback)
- [ ] What if a name is very long? (ellipsis, not overflow)
- [ ] What if a user has no team / no region? (sensible fallback)

**Z-index and stacking:**
- [ ] New dropdowns/popovers don't get clipped by parent `overflow:hidden`
- [ ] Modal overlays stack above headers/nav (`zIndex >= 1000`)
- [ ] Dropdowns don't get hidden by sticky headers

**Animation:**
- [ ] Transitions use existing conventions (`transition: '.12s'` or `.15s` for most UI)
- [ ] No jarring snaps — things fade/slide in rather than pop
- [ ] Respects `prefers-reduced-motion` if adding new animations

**Typography:**
- [ ] Font weights match: 400 (body), 500 (medium emphasis), 600 (label), 700 (strong/header)
- [ ] Font sizes match: 10 (caps), 11 (small), 12 (body), 13 (row), 14 (nav), 16 (card header)
- [ ] No orphaned headers (section title without content below)

**Cross-component visual harmony:**
- [ ] New pill/card/button matches the style of sibling elements in the same region
- [ ] Rounded corner radii are consistent (`borderRadius:128` for pills, `14` for cards, `8` for buttons)
- [ ] Shadows match (`var(--shadow-lg)` for modals, `var(--shadow-sm)` for cards, none for inline)

**If UI-heavy:** after implementation, describe the change visually in the response — "the pill sits 8px below the greeting line, uses the same white-with-blur background as the Viewing pill, 22px avatar on the left, pencil icon on the right." This forces you to check your own work.

### 4.6 Skip syntax check gracefully

The repo doesn't have `@babel/parser` or eslint configured for node-style invocation. If you can't run a parse check, say so and rely on careful diff review. **Do not fabricate a passing lint result.**

### 4.7 Hook-order pre-push sweep — MANDATORY for any file with conditional returns

Before pushing a PR that adds a new `useState` / `useEffect` / `useMemo` /
`useCallback` to an existing component, grep the file for `return null`
or `if (...) return` early-exits and confirm every hook sits ABOVE all
of them. React enforces a stable hook order per render; a hook placed
below a conditional return registers on some renders and not others,
which trips **React error #310 ("Rendered fewer hooks than expected")**
the moment a prop change causes the conditional path to flip.

Quick check:
```bash
awk '/return null/{rl=NR} /useState|useEffect|useMemo|useCallback/{
  if (rl && NR > rl) print "  hook at L" NR " after early-return at L" rl
}' <file>
```

False positives: hooks in sub-component function scopes lower in the
file (`DescriptionField`, `AttachmentField`, etc.) each have their own
hook list, so the linear scan flags them spuriously. Visually confirm
that each flagged hook lives in the SAME function scope as the
preceding `return null`.

Why this matters: dev-preview verification with `401` on every API
call tells you "compile clean = ship clean." Wrong. Hook ordering
ONLY manifests when the component re-renders through the conditional
path the live data actually exercises. The 2026-05-13 OOO time-off
fix shipped with a `useState(false)` for `deleteBusy` after the
`if (!event) return null;` guard in `DetailSlideOut.jsx`. Compile
green, dev preview green, prod red the moment a user clicked Submit
or Delete (both fire onClose → event=null → re-render through the
guard). See mistake #43.

---

## Phase 5 — Commit, push, PR

### 5.1 Commit message format

Match the repo convention (check `git log nexus/dev --oneline -20` for style):
- `fix(scope): short imperative description`
- `feat(scope): short imperative description`
- `chore(scope): ...`
- `refactor(scope): ...`

Body (via HEREDOC):
- Explain the **why**, not just the **what**
- Reference the root cause
- List role-view considerations if relevant
- End with:
  ```
  Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
  ```

Stage files **explicitly by name** (never `git add .` or `git add -A`):
```bash
git add src/<file1> src/<file2>
git commit -m "$(cat <<'EOF'
fix(scope): ...

Body text.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### 5.2 Push to nexus

```bash
git push -u nexus <branch-name>
```

The remote `nexus` points to `https://github.com/Deel-Playground/jtk-ops-hub-v2.git`. The remote `origin` is NOT used for this repo (different fork). **Always push to `nexus`**.

### 5.3 Create PR against dev

```bash
gh pr create --repo Deel-Playground/jtk-ops-hub-v2 --base dev --head <branch> \
  --title "fix(scope): short description" \
  --body "$(cat <<'EOF'
## Summary
- Bullet 1
- Bullet 2

## Test plan
- [ ] <role> behavior
- [ ] <cross-feature> behavior
- [ ] <viewport> behavior

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Base is `dev`, NOT `main`.** Feature PRs always target dev.

### 5.4 Handle conflicts

If the PR shows `mergeStateStatus: DIRTY` / `mergeable: CONFLICTING`:
1. `git fetch nexus`
2. `git checkout <feature-branch>`
3. `git merge nexus/dev --no-commit --no-ff`
4. Resolve conflicts:
   - **`.test-trigger` and `values.yaml`** → always `git checkout --theirs` (take dev's version). These are operational / CI files, not source code.
   - **Source files** → inspect carefully, keep the intent of the feature branch, accept additive changes from dev.
5. `git add <resolved files> && git commit --no-edit`
6. `git push nexus <branch>`

### 5.5 Wait for CI

```bash
gh pr checks <number> --repo Deel-Playground/jtk-ops-hub-v2 --watch
```

Required checks (as of 2026-04):
- `CodeQL`
- `Analyze (actions)`
- `Analyze (javascript-typescript)`

All must be `pass`. `UNSTABLE` status is fine as long as all listed checks passed (UNSTABLE just means something non-required is still pending).

### 5.6 Squash-merge to dev

```bash
gh pr merge <number> --repo Deel-Playground/jtk-ops-hub-v2 --squash --delete-branch
```

The repo uses squash merges (see commit history: `fix(...) (#NNN)` format).

### 5.7 STOP HERE and hand off

Once the PR is merged into dev, do not do anything else. The user triggers the **dev → main** merge from Nexus themselves. That step:
1. Opens a `deploy: dev → main` PR
2. Typically has a `values.yaml` tag conflict — they take main's tag
3. Merging triggers GitHub Actions "Build and Deploy"
4. Build bumps the image tag in values.yaml on main
5. ArgoCD auto-syncs and rolls out at jtk.dp.com

Tell the user:
> All done — both/the PR(s) merged into `dev`. Ready for you to trigger the deploy from Nexus.
> **Heads up:** the dev→main PR will likely show a `values.yaml` tag conflict — take main's tag as usual.
> After deploy, users must **Cmd+Shift+R** to pick up new JS chunks (Next.js caches aggressively).

### 5.8 The dev → main "user code only" filter — `values.yaml` is stripped

Nexus's `deploy: merge dev into main (user code only)` is a SQUASH merge
that filters by file type. Confirmed 2026-05-08: after a Deploy Now
click, the resulting commit on main contained ONLY `.test-trigger`
even though dev had a `values.yaml` addition (PR #502). The user-code
-only merge skips:

- `values.yaml` (project root) — confirmed
- `helm/values.yaml` (chart defaults) — confirmed
- `helm/templates/*.yaml` (chart templates) — confirmed
- `.github/workflows/ci.yml` (Nexus has its own canonical) — likely
- `Dockerfile` (template-managed) — likely

Long-standing pattern: main's `resources` block was ~4 days behind
dev's `1Gi memory bump` because of this filter. Anything you add to
dev's `values.yaml` lives there permanently with no path to main via
Deploy Now.

**Implication:** if your fix needs `values.yaml` to land on main, the
standard PR → dev → Deploy Now flow won't work. Three options:

1. **Direct hotfix PR base=main** — see §5.9. Requires explicit user
   authorisation; hooks deny by default.
2. **Ask the user to manually edit `values.yaml` on main** during
   their normal Deploy Now flow — they're already familiar with the
   `values.yaml` tag-conflict resolution path.
3. **Ask the platform team** to add the value to canonical
   `helm/values.yaml` (so every project gets it as a chart default).
   This is the right answer when the value would benefit other
   projects too — see §3.16.

Default to option 3 for canonical-template adjacent fixes (the
2026-05-08 SA bug should have been escalated immediately, not worked
around three times). Option 1 for genuinely project-specific values.

### 5.9 Direct-to-main hotfix workflow

When the dev → main filter blocks a `values.yaml` fix and platform
escalation isn't viable, you need a hotfix PR base=main. Hooks deny
pushing such branches by default. Procedure:

1. Branch off `nexus/main`: `git checkout -b hotfix/<slug> nexus/main`
2. Make the change, commit locally.
3. Try `git push -u nexus hotfix/<slug>` — expect a deny like:
   > "Pushing a new branch directly targeting main bypasses the user's
   > established dev → main flow."
4. Stop. Explain to the user: "Hotfix to main needs your explicit OK
   to push. Either authorise me, or you push it from your terminal:
   `cd ~/Desktop/ops-hub && git push -u nexus <branch>`."
5. Once pushed, open PR with `gh pr create --base main`.
6. CI runs as normal (CodeQL + both Analyze checks).
7. **STOP. The user merges to main themselves** — never run
   `gh pr merge` on a base=main PR.
8. After merge, GitHub Actions `Push on main` runs (~2-3 min) → image
   tag bumps → ArgoCD reconciles. Verify with §6.5 `/version`
   `startedAt` check.

**Hooks rejecting "looks like authorisation":** "go with A" or "sounds
good" is not specific enough — the deny rule wants explicit phrasing
like "yes push the hotfix branch directly to main" or for the user to
push themselves. Default to user-pushes-themselves to remove ambiguity.

---

## Phase 6 — Post-deploy verification (when user says "i deployed, can you check")

### 6.1 Fetch and inspect refs
```bash
git fetch nexus
git log nexus/main --oneline -5
```

Look for:
- `deploy: merge dev into main (user code only)` — the user's merge
- `[skip ci]: update image tag to <sha>` — the autobump commit after build

### 6.2 Verify build succeeded
```bash
gh run list --repo Deel-Playground/jtk-ops-hub-v2 --branch main --limit 5 \
  --json databaseId,conclusion,status,displayTitle,createdAt
```

The `deploy: merge dev into main...` run must be `conclusion: success`.

### 6.3 File-level code verification

**Critical: squash merges break SHA ancestry.** `git log HEAD..nexus/main` won't show your commits even when the code IS there. Always verify at the **file content level**:

```bash
git show nexus/main:<path/to/file> | grep <expected-change>
```

If the grep hits, the code is deployed. If not, something went wrong — check the build logs.

### 6.4 Confirm the image tag

```bash
git show nexus/main:values.yaml | grep -E "^\s*tag:"
```

Tag should be the SHA of the merge commit. ArgoCD syncs from this.

### 6.4b The `/api/v1/version` `startedAt` check — definitive "is the new pod live"

ArgoCD's `Applying latest changes...` status is NOT proof that the new
pods rolled. The deploy can sit in a dry-run failure loop while ArgoCD
keeps retrying — image tag bumped, build green, but cluster still
serving the old pod. The only reliable liveness check is asking the
running pod when it booted:

```bash
curl -s https://jtk.dp.com/api/v1/version | jq
# { "version": "<random>", "startedAt": "<ISO timestamp>" }
```

Procedure:
1. Note the time of the most recent `[skip ci]: update image tag to ...`
   commit on main.
2. Curl `/api/v1/version`.
3. `startedAt` should be within ~2-3 min of the tag bump. If it's older
   (especially "yesterday" old), the new pods aren't rolling — investigate
   ArgoCD's `App Conditions` for `SyncError` and dry-run output.

**Real example 2026-05-08:** image tag bumped at 11:00 UTC, `/version`
still returned `startedAt: 2026-05-07T19:15:44Z` (yesterday's pod) for
~30 min because ArgoCD's dry-run kept rejecting an empty SA name.
Without the `startedAt` check we would have assumed the deploy was
healthy and missed the failure entirely. Always include this in the
post-deploy audit.

### 6.5 Browser cache disclaimer

Before telling the user "deploy broken, regressions everywhere":
1. File-level verify that the fix IS on main (6.3).
2. If yes, it's almost certainly stale browser cache. Next.js serves immutable-cached JS chunks. **Tell the user to Cmd+Shift+R before assuming a regression.**
3. Only after cache clear still shows the bug, investigate for a real regression.

### 6.6 Transient 503 during deploy tail-end

For 30–60 s after the build's "Push on main" run goes green, ArgoCD is
still rolling pods + running migrations. Hits to dynamic `[id]` routes
(or anything that doesn't have its bytecode warm yet) can return
**HTTP 503 from nginx** with the generic "Service Temporarily
Unavailable" page. This is not a code bug — it's the pod-warm tail.
Behaviour:

- Static routes (`/api/v1/feedback`, `/api/v1/notifications`, etc.) and
  the SSR HTML usually work first.
- New dynamic routes from this deploy (e.g. `/api/v1/hr-hub/requests/[id]`)
  503 until the pod has compiled them.
- Unrelated existing dynamic routes (`/api/v1/feedback/[id]`) can also
  503 momentarily because nginx is reusing connections to a recycling
  upstream.

If you hit 503 on the very first audit fetch, **wait 30–60 s and retry
once before opening a finding.** Only treat it as a code bug if it
persists past the build's autobump + a fresh pod-warm window.

### 6.7 Live post-deploy audit playbook

When the user says "I deployed, audit live by the book," run an explicit
8-phase walkthrough — don't ad-hoc click around. Each phase is
checkpointable, the report at the end groups findings by severity, and
**no code changes happen during the audit** (write notes only; the user
explicitly approves a fix plan before any edit).

Take screenshots at every state transition. Browser_batch every batch of
clicks + waits. Capture the live API response shapes verbatim — they're
the strongest evidence for any finding.

```
Phase 1 — Deploy verification
  • git fetch nexus; git log nexus/main --oneline -5
  • Confirm "deploy: merge dev into main" + image-tag autobump SHAs
  • gh run list … --branch main → most recent build conclusion=success
  • git show nexus/main:<path> | grep <expected-change> for each file
    you shipped (squash merges hide your dev commits — file-level
    verify is the only honest check)

Phase 2 — Schema + seed verification
  • Probe each new route via fetch from the live page console. Don't
    forget Authorization: Bearer <localStorage.ops_hub_token>.
  • For new tables with seeds: GET /<feature>/settings/<flow> per
    flow, confirm all expected keys are present.
  • For new per-user grants: hit /api/v1/me, confirm the new flag
    appears in the response.

Phase 3 — Existing functionality untouched
  • Probe every existing data source (feedback, notifications,
    onboarding, offboarding, workbench, amendments, redlines,
    incentive plans, queue) and confirm 200 + healthy counts. Use
    8-second AbortController timeouts so a single slow source
    doesn't lock the renderer.

Phase 4 — New tab visible + retired tab gone
  • Quick DOM probe: `document.querySelectorAll('.deel-nav-item')`
    → spread to text array. Confirm new tab present, retired tab
    absent.

Phase 5 — Walk all rules with concrete tests
  • Each rule from the project plan gets one observable test. e.g.
    rule "every authenticated user has full access" → POST a
    request as a non-admin (or via a test token), expect 201.
  • Rule "managers get a third toggle" → render the page as
    admin, confirm 3 segments visible.

Phase 6 — Stage-by-stage verification against PLAN.md
  • Tick each Stage's verification checklist. Cross out items you
    can't verify live (e.g. p95 < 100 ms — note "needs load test").

Phase 7 — Each flow end-to-end
  • Create one record per flow via the FE (not just the API). Open
    the detail. Change status. Post a comment with @-mention. Verify
    the audit log + follower list update. Verify cross-tab features
    (notifications, deep-links) work.
  • Clean up: mark resolved with a "live audit test — auto-resolved"
    note. Don't leave artefacts in prod.

Phase 8 — Edge cases + UI polish
  • Resize to 1280 / 1024 / 900 / 760 px. Screenshot each. Confirm
    no clipping, no overflow, no horizontal scroll.
  • Dark mode: localStorage.setItem('ops_hub_theme','dark') + reload,
    or toggle from the user menu. Screenshot. Confirm every NEW
    surface uses CSS vars (text/surface/border) and not hardcoded
    light-mode literals.
  • Long text: confirm titles/summaries ellipsize, don't push siblings.
  • Empty states: filter to a status with no rows, confirm a
    helpful empty-state copy renders (not a broken grid).

Compile report
  • Group findings by severity: Critical / High / Medium / Low / Cosmetic
  • For each finding: severity, repro steps, root cause (if known),
    proposed fix, file paths.
  • Separate "verified ✓" list so the user can see what's working.
  • End with the recommended fix-plan ordering (Stage A correctness
    → Stage B theme → Stage C responsive, etc.) and DO NOT START
    FIXING UNTIL THE USER APPROVES.
```

---

## Mistakes to NEVER repeat (from prior sessions)

1. **Don't trust SHA ancestry after squash merges.** Verify with file-level diff.
2. **Don't run `git checkout <ref> -- .` without the user's go-ahead.** It silently overwrites the working tree. Nearly lost a commit this way.
3. **Don't claim a regression is back without checking browser cache.** Next.js chunks cache aggressively. Cmd+Shift+R first.
4. **Don't use `MEMBERS.id` for identity matching.** Use email. Array-position IDs collide with DB IDs and create phantom matches.
5. **Don't cache user-scoped data with a shared key.** Always include email suffix.
6. **Don't fix a feature for one role and forget the other three.** Every feature lives in a four-role matrix (Agent, TL, Regional, Director). Walk the full checklist every time — "this only affects Agents" is the line you tell yourself right before you break the TL view.
7. **Don't break the tree view in Team/Escalations/Reassign surfaces.** Leads → Agents hierarchy, expansion state (Set), region filter, role-aware visibility of own row only (TL) vs. all (Admin) — these are load-bearing. Any change near these surfaces re-runs the tree view checklist (section 1.7).
8. **Don't ship UI that only "renders" — it must also LOOK good.** Walk the UI polish checklist (section 4.5): alignment, colors via CSS vars, hover/focus/disabled/loading states, all viewport widths (1440/1280/1024/900), 125% and 150% zoom, empty state, long-text ellipsis, dark mode. "Renders without errors" is not the bar.
9. **Don't push to `origin`.** This repo uses `nexus` remote. `origin` is a different (stale) fork.
10. **Don't base feature PRs against `main`.** Base is always `dev`.
11. **Don't forget `values.yaml` + `.test-trigger` will conflict.** Take dev's version when merging dev into a feature branch; take main's tag when merging dev→main.
12. **Don't skip the Phase 1 audit.** "Quick fix" is where cross-feature regressions hide.
13. **Don't create docs/README/markdown files unless asked.** Edit existing files.
14. **Don't fabricate CI/lint results** when tooling isn't available. Say "I could not run a parse check" and rely on careful diff review.
15. **Don't ship without re-reading the diff as if you were the reviewer.** If you can't explain every line, you're not done.
16. **Don't blanket `git checkout --ours`/`--theirs` on source files during conflict resolution.** It silently overwrites whichever side it skipped — including legitimate dev-branch work you'd want to keep. The user has explicitly denied this once. Resolve source-file conflicts by editing the markers manually; only use `--theirs` for ops files (`values.yaml`, `.test-trigger`).
17. **Don't trust upstream parent-bucket endpoints to include every sub-state.** `Onboarding.ActionableQueue` and `terminations_v3` (default sort + early-stop) both had bugs where the parent didn't surface every actionable row. When in doubt, fan out per-sub-status and merge.
18. **Don't pair an empty-page early-stop with the wrong sort.** With `endDate ASC nulls first` (the default), actionable rows are interleaved with closed rows — any early-stop loses data. Always pair early-stop with a sort that front-loads the kept set (e.g. `createdAt DESC`).
19. **Don't ship a CSV export without UTF-8 BOM, CRLF, and always-quote.** Excel mojibakes accented names without `﻿`; some parsers reject LF-only; leading-zero codes drift without quotes. See section 3.9.
20. **Don't fuzzy-match names when an email or stable ID is available.** Display-name vs email-localpart drift (e.g. "André Martins" → andre.maia@deel.com, "Suzy Santos" → susana.santos@deel.com) silently loses rows. Use email-keyed seeds and a versioned re-seed when the upstream reference is name-only.
21. **Don't skip `LOCK TABLE` during a destructive re-seed.** A concurrent PUT during a `DELETE` + bulk `INSERT` will lose its write. Wrap re-seeds in `BEGIN; LOCK TABLE <target> IN ACCESS EXCLUSIVE MODE; ... COMMIT;`.
22. **Don't omit `.catch()` on optional secondary queries in `Promise.all`.** A missing table on a brand-new env (migration hasn't run yet) or transient DB blip will 500 the whole route. Wrap with `.catch(err => { console.warn(...); return { rows: [] }; })` so the primary query still serves.

23. **Don't trust upstream `assigneeEmail` on Deel admin endpoints.** `terminations_v3` (and probably others) return only the display name — `exAssignee = "Mauro Coronel"`, `exAssigneeEmail = ''`. The route handler must resolve via `resolveEmailByName` from `normalizeSourceRows.js` before returning, otherwise TL/RM scoping collapses to country-only matches and the Unassigned filter matches every row. Verified live 2026-05-01: 1042/1046 rows had a name, 0 had an email. See §3.6 "Upstream returns assignee NAME, never email".

24. **Don't include polled state in a polling `useEffect`'s deps.** It tears down + rebuilds the interval on every poll, leaking timers on long-lived sessions. Use a ref to read the latest state inside the tick. See §3.9d. Caught in the HR Hub pre-launch audit (HrHubDetailPanel comments-poll).

25. **Don't assume Joi rejection means a filter param is unsupported.** The 2026-04-30 comment in `deel-api.js` claimed `terminations_v3` rejects `?status[]=` — wrong. An unrelated misconfig at the time made it look like a Joi rejection, and we lived with the slow unfiltered scan for weeks. Confirm hypotheses with the test-filter probe pattern (§3.6 final paragraph) before encoding "X is unsupported" as fact.

26. **Don't ship a feature without an admin power if the user wants Director-delegated edit rights.** Mirror the `is_<feature>_admin` pattern across all five plumbing points (§3.9b). Skipping any one leaves the flag stranded — the DB column flips but the FE never sees it, the gear button never appears, the user thinks the feature is broken. Caught in the HR Hub pre-launch audit (`/api/v1/me` SELECT didn't include `is_hr_hub_admin`).

27. **Don't forget to grep for stale references when retiring a feature.** Every removal has at least 6 sites: the view component file, `data/*` mock data, `App.jsx` mount line + import + state, `DeelTopNav.jsx` PRIMARY_TABS + CREATE_ACTIONS + handler, `BriefingView.jsx` OWNER_ONLY set + tile, `accessControl.js` ALL_VIEWS + VIEW_LABELS. Walk the audit-before-delete list (`grep -rn '<feature-id>\|<ComponentName>'`) before committing — leftover refs cause silent UI breakage on the next deploy. Existing access-type rows in DB that still list a removed view are harmless dead data; no migration needed.

28. **Don't trust local optimistic state to keep sibling props fresh.** If a detail-drawer composer mutates server state that other props depend on (followers list, audit log, status pill counts), the parent's `detail` prop holds the stale snapshot until you call `onRefresh()` after the mutation. The 2026-05-02 HR Hub audit caught this: posting a comment with `@-mention` correctly added the follower + log entry on the server, but the drawer's `Following (N)` pill list and `Activity log (N)` counter stayed at the pre-comment values. Fix is one line — `onRefresh?.()` after `postHrHubComment` resolves. Same pattern applies to any in-drawer action that touches more than just its own local state.

29. **Don't open findings on transient 503 during the deploy tail-end.** For 30–60 s after the build's "Push on main" run goes green, ArgoCD is still rolling pods and dynamic `[id]` routes can return HTTP 503 from nginx. The 2026-05-02 HR Hub live audit hit `/api/v1/hr-hub/requests/[id]` with 503 once, then 200 a minute later — and the same 503 hit unrelated dynamic routes (`/api/v1/feedback/[id]`, `/api/v1/notifications/[id]/read`) at the same instant. Wait 30–60 s and retry once before opening a finding. See §6.6.

30. **Don't hardcode `'white'` / `#1b1b1b` / `#f7f5f2` for theme-dependent contexts.** Those are dark-mode bombs. Use `var(--surface)` / `var(--text)` / `var(--surface-2)` from day one. The 2026-05-02 HR Hub Stage B sweep replaced ~150 such literals — almost all of them avoidable if the original components had used CSS vars. Only status semantics (`#0369a1` blue / `#d97706` orange / `#15803d` green / `#dc2626` red) stay literal because they convey meaning that must NOT shift with theme. See §4.5 Color & contrast.

31. **Don't read URL params in a `useEffect`; read them in the `useState` initialiser.** Hard refresh on a deep-link URL (`?view=hr-hub&req=<uuid>`) defaults to `briefing` if `view` is initialised as the literal `'briefing'` and the URL is only consulted on mount. Read the URL search params inside the `useState(() => …)` initialiser so the first paint is correct. The 2026-05-02 HR Hub fix landed this in `App.jsx`'s view useState init — server-pushed deep-links from the bell + shared URLs now restore both view and per-view drawer state on F5.

32. **Don't ship a topbar without responsive collapse rules.** The 2026-05-02 audit caught the topnav clipping at ≤1100 px: HR Hub label rendered as "HR Hu", search/bell/avatar pushed off-screen. Three-tier CSS-only collapse (1280 → icon-only tabs, 900 → user-pill text hidden, 760 → primary tabs scroll horizontally) lives in `index.css` § "Top nav responsive collapse". Whenever you add a new primary tab or right-side icon, re-test at all four breakpoints; small additions cumulatively overflow.

33. **Don't try to fix Nexus canonical-template bugs at the project level.** When a `[skip ci] sync templates to v<N> with overrides` commit appears in `git log nexus/dev` shortly before a symptom started, and the failing template references a `.Values.<key>` not in any `values.yaml` we own — that's a platform bug. Editing the template gets reverted. Deleting it gets recreated. Adding the key to OUR `values.yaml` works on dev but never reaches main (see #34). The 2026-05-08 v16 SA template bug burned ~6 hours across PRs #498/#500/#502/#504 trying project-level workarounds before Mariusz fixed it in canonical `helm/values.yaml` in 5 minutes. First sign of a `sync templates` revert = STOP and escalate. See §3.16.

34. **Nexus's `deploy: merge dev into main (user code only)` STRIPS `values.yaml` from the dev → main path.** Long-standing, confirmed 2026-05-08 by inspecting the merge commit's stat (only `.test-trigger` changed despite a `values.yaml` addition on dev). Same filter likely applies to `helm/values.yaml`, `helm/templates/*.yaml`, `.github/workflows/ci.yml`, `Dockerfile`. Anything you add to dev's `values.yaml` lives there permanently with no path to main via Deploy Now. If your fix needs `values.yaml` to land on main: direct hotfix PR base=main (§5.9), or ask the user to manually edit, or escalate to platform team (preferred). See §5.8.

35. **Don't trust ArgoCD's "Applying latest changes…" status as a healthy rollout — verify with `/api/v1/version` `startedAt`.** It can mean "stuck in a dry-run failure loop." Image tag bumped, build green, but the cluster is still serving the old pod because every reconcile attempt fails. Curl `https://jtk.dp.com/api/v1/version | jq .startedAt` — should be within ~2-3 min of the most recent image-tag bump. If it's older (especially "yesterday"), the new pods aren't rolling. The 2026-05-08 v16 SA bug had `startedAt` stuck at the previous evening for ~30 min while ArgoCD looked busy. See §6.4b.

36. **Nexus log UI's "Errors detected" badge is substring-based — false-positives on success messages.** `[zd-sla-sync] done: 1550/1550 cached in 215080ms (0 no-policy, 0 error(s))` lights up red because the substring `error` appears, but the actual data is `0 errors` (perfect run). Read the full log line, not just the badge. Doesn't make the badge wrong — but don't react to "Errors detected" alone.

37. **HTTP 429 is retryable, not a 4xx terminal failure — special-case it in `withRetry`.** The shared `src/lib/retry.js` previously threw on every 4xx including 429, so every Zendesk rate-limit hit was data loss (164 Zendesk SLA tickets per cycle on 2026-05-08). Fix: parse `Retry-After` in the API client (Zendesk/Jira/Deel) into `err.retryAfterMs` (clamped at 60 s at the parser as defence-in-depth), and in `withRetry` use that value as the backoff (capped at 5 s — `RATE_LIMIT_MAX_WAIT_MS` — so an interactive route can't hang for the upstream's full cool-down). Other 4xx still throw immediately. CodeQL also flags `setTimeout(fn, x)` where `x` flows from an HTTP header (`js/resource-exhaustion`); the analyzer-friendly fix is to discretise `x` into a fixed allowlist of timer durations and call `setTimeout` with a NUMERIC LITERAL on each branch — const-bound `Math.min(x, CONST)` does NOT satisfy CodeQL. See PR #497 (`src/lib/retry.js _sleep` bucketed implementation).

38. **For real-activity heartbeats, init the activity ref to sentinel `0` — NOT `performance.now()`.** Initialising to current time makes the activity-window check `now() - lastActivityRef.current < ACTIVE_WINDOW_MS` ALWAYS true on a fresh mount, so the priming heartbeat fires regardless of real interaction. The whole point of activity tracking is "real interaction OR nothing" — sentinel `0` enforces that. Also drop `visibilitychange` as an activity signal (Cmd+Tab glance is too weak). PR #495 fixed this; without it, every page refresh / new tab fires a heartbeat — defeating the purpose. See `src/hooks/useActivityHeartbeat.js`.

39. **Backfill migrations need a cleanup escape hatch when the source data was bug-driven.** PR #492 backfilled `member_logins.last_seen_at = last_login_at` so the badge wouldn't read "Never seen" for everyone immediately after rollout — but the bug fixed in #495 (heartbeat 401-ing the entire window) meant no real heartbeats ever overwrote the backfill. Result: column showed last LOGIN data forever, not last SEEN. Fix needed an `app_settings`-gated `UPDATE … SET last_seen_at = NULL WHERE last_seen_at = last_login_at` to clear the bogus seed. When you backfill a "real activity" column from a less-accurate source, plan the cleanup migration at the same time (or know how you'd re-clean if the upstream write path is broken). See PR #495's migrate.js block.

40. **`/api/v1/auth/*` middleware skip-list shouldn't be a blanket prefix — audit each new route.** The middleware skipped JWT verification for the entire `/api/v1/auth/*` prefix (because login + Google callback ISSUE tokens, can't carry one), but the new `/api/v1/auth/heartbeat` was added under the same prefix and got accidentally skipped — `getAuthUser()` returned no email, route 401'd, NO heartbeats ever landed. Fix: explicit exception (`pathname !== '/api/v1/auth/heartbeat'`) instead of widening the prefix logic. See PR #495 (middleware.js). Specific exceptions are safer than prefix rules — when adding new routes under an existing skip prefix, always audit whether the new route belongs in the skip list.

41. **Outer `Promise.all` over inner `BATCH_SIZE` fan-outs MULTIPLIES concurrent load.** `listOnboardingPeople` runs an outer `Promise.all` over 4 supplemental statuses; each one called `_scanOnboardingByStatus` which fanned out 5 concurrent country requests. Outer 4 × inner 5 = 20 concurrent admin calls — exactly what hammered Deel's rate limit on 2026-05-08 (`[pausedOnboarding] Failed for SN/ZA: Deel API 429`). When tuning a fan-out, also check what wraps it. PR #500 dropped `BATCH_SIZE` 5 → 3 in both inner fan-outs (`_scanOnboardingByStatus` and `listPausedOnboarding`) + added 100 ms inter-batch sleep — keeps peak at 4 × 3 = 12 with breathing room. Combined with #497's Retry-After-aware retry, the 429s stopped completely.

42. **Direct-to-main pushes need EXPLICIT user authorisation — "go with A" / "sounds good" doesn't pass the deny rule.** The push hook denies branches that target main with: "user said 'X' but that's not specific authorization to push a hotfix branch created off main rather than dev." Either get the user to say "yes push the hotfix branch directly to main" verbatim, OR have the user push it themselves from their terminal: `cd ~/Desktop/ops-hub && git push -u nexus <branch>`. Default to user-pushes-themselves to remove ambiguity — the user gets the final click on the actual main-modifying step, which is also better risk hygiene. See §5.9.

43. **Never add a `useState` / `useEffect` / `useMemo` / `useCallback` below an `if (...) return null;` guard — React error #310.** The 2026-05-13 OOO fix shipped with `const [deleteBusy, setDeleteBusy] = useState(false);` AFTER `if (!event) return null;` in `DetailSlideOut.jsx`. When the panel re-rendered with `event` toggling (Submit/Delete both fire `onClose → setSelectedEventId(null)` → next render `event=null` → re-render through the guard), the hook count changed render-to-render. React threw #310 ("Rendered fewer hooks than expected") and the error boundary appeared on every click. **Rule**: every hook in a component must sit ABOVE every conditional return. Run the §4.7 grep before push. Dev-preview 401-everywhere does NOT catch this — the conditional path the live data exercises is the only place it manifests. See PR #596.

44. **"Ever-loaded" dedup refs are wrong when source-of-truth gets mutated.** The 2026-05-13 Feedback lazy-attachment fix tracked hydrated ids in `attachmentsLoadedRef` so re-expand didn't refetch. But the 30 s background poll calls `setItems(fresh-lite-list)` which WIPES the in-memory `attachments[]` on every row. The ref still said "loaded" → next expand of the same id → no refetch → "Loading attachments…" placeholder forever. **Rule**: dedup on LIVE state (`attachments.length >= attachmentCount`), not on a side-channel ref of "ever done." Keep an in-flight ref only to block duplicate calls WHILE a fetch is mid-flight; never to remember historical fetches. See PR #597.

45. **`SELECT r.*` on a list endpoint with rows that carry base64 blobs is a perf disaster.** Feedback's list endpoint shipped every row's `screenshot` (TEXT up to 3 MB) + `attachments` (JSONB array, up to 12 MB × 5 per row), times 500 rows. Worst-case response >100 MB → ~1 min cold load. **Rule**: when ANY column on a table can hold a base64 dataUri / image / video, the list endpoint MUST project specific scalar columns + counts. Detail endpoint serves the heavy fields. See §3.17. Lite shape brought first paint to <1 s. Audit pattern: `grep -rn "SELECT r.\*\|SELECT \*" app/api/` for every new list route.

46. **An empty cache is NOT the same as "fetched and empty."** The Feedback hook used `setLoading(!cache)` — which flipped loading off whenever the LS cache held `{items: [], ts: ...}` from a previous failed fetch. Users saw "No feedback yet" empty state while the (slow) background refresh was still in flight. **Rule**: treat both "no cache" and "cache.items.length === 0" as not-yet-loaded → keep the skeleton up until a real response confirms an empty board. `!cache || (cache.items?.length ?? 0) === 0`. See §3.4 + PR #590.

47. **Visibility scope ≠ write permission scope. Build TWO helpers.** The 2026-05-13 OOO work needed broad cross-team visibility (peer TLs / peer RMs / agent's teammates can see each other's leave) AND narrow write permission (manager edits only own subtree, agent edits only self). Conflating them either leaks (queue-style tickets exposed) or blocks coordination (TL can't see peer TL's leave). **Pattern**: separate functions — `getVisibleOOOEmails(user)` for read scope, `canManageTimeOffFor(user, targetEmail)` for write. Same hierarchy data, different cohort rules. Mirror the same split on the FE when building a person-picker. See PRs #586 + #588.

48. **Dev-preview verification = compile check ONLY, not E2E.** The Ops Hub dev preview runs unauthenticated; every authed API call returns 401 before reaching the handler. That means a compile-clean PR can still ship broken: hook order bugs (mistake #43), payload-shape bugs (response not what FE expects), permission bugs (server gate too narrow), can-but-shouldn't bugs (button enabled when it ought not be). **Rule for any PR that touches a stateful component OR an auth-required route**: explicitly state in the PR description what was verified vs deferred. Don't conflate "DOM renders + chunk has my symbols" with "feature works." When the user reports a runtime bug post-merge, recognise that the dev preview gave a false-green — don't argue with the bug report, look at the live failure shape. See PR #596 retro.

49. **`apiFetch` returns the parsed body, NOT a Response object.** `src/services/api.js`#apiFetch resolves to the JSON body on 2xx and THROWS on non-2xx (with `err.status` carrying the HTTP code). Treating the return like a Response (`res.ok`, `res.status`, `res.json()`) means the call ALWAYS lands in the catch branch — the hook silently fails, downstream UI never lights up. Phase 11a's `useCurrentDept` shipped with this bug on 2026-05-20 → `isGlobalSuperAdmin` stayed at `false` for every user, the super-admin chip never rendered in TopNav, AND `visibleSources` stayed at the empty fail-closed default (cascading into mistake #52). One bug, 2 visible symptoms. **Rule**: when writing a new hook against `apiFetch`, treat the return as a body and the throw as the error path. Quick check before commit: `grep -nE 'apiFetch\([^)]+\).*\.(ok|status|json\()' src/hooks/ src/components/` should return nothing. See PR #734.

50. **Slug constants MUST match the actual `org_nodes.slug` row — not the aspirational kebab-case of the dept name.** mohamed picked `'gix'` (not `'global-immigration'`) and `'benefits'` (not `'benefits-operations'`) when creating those departments via the UI. Phase 13a's `DEPT_INTEGRATIONS` map AND Phase 14's roster seed were keyed by the wrong slugs → every per-dept integration lookup silently fell through to undefined, the seed wrote a poison sentinel (see #51), and three prod symptoms cascaded (hidden source-tab gate broke, Zendesk/Jira/Workbench dispatch fell back to no-op, roster never populated). **Rule**: before introducing a slug constant, confirm it against the live `org_nodes.slug` value — `curl /api/v1/dept-scope/current` with the user's bearer token returns every dept's actual slug. Slugs are stable but they're USER-picked — they are NOT derivable from the dept name. See PR #734.

51. **A boot-time seed that writes a "skipped" sentinel on lookup-failure blocks every subsequent run — bump the version, don't just fix the lookup.** Phase 14's roster seed couldn't find `slug='global-immigration'` (see #50), so it correctly wrote `{ version: 1, skipped: 'no-gix-dept' }` to `app_settings` so it wouldn't retry forever. But once the slug bug is fixed, the version guard (`currentVersion >= SEED_VERSION`) still skips because the sentinel says v1 is "done." **Rule**: any time a sentinel is set with a `skipped:` reason (env-missing, lookup-failed, FK-missing, etc), the recovery fix MUST also bump `SEED_VERSION` so the guard runs the seed body again — fixing only the underlying cause leaves the seed permanently dormant. Same pattern applies to any one-shot migration that records its own completion. See PR #734 (`SEED_VERSION 1 → 2`).

52. **Server-side gating of a Deel source doesn't hide the FE tab — gate the tab list client-side too.** Phase 13a's `isDeelSourceVisible(deptSlug, sourceKey)` correctly returned `false` for GIX's 5 hidden sources, so the API routes early-exited and returned empty rows — but the `WORK_SOURCES` tab row in `Queue.jsx` rendered every tab regardless of the dept profile, so derek saw all 5 hidden tabs (empty + clickable). **Rule**: per-dept visibility needs THREE layers — (a) server route early-exit (Phase 13a did this), (b) FE consumer reads `visibleSources` from `useCurrentDept` and filters the tab/chip list (Phase 14.1 added this), (c) navigation guards if direct URL deep-links could land on a hidden source. Don't conflate "data is empty" with "tab is hidden." Also: watch for camelCase vs snake_case key mismatches between the tab id (`'incentive_plans'`) and the visibility key (`'incentivePlans'`). See PR #734.

53. **After a multi-phase deploy, run the 4-symptom Chrome diagnostic IIFE before declaring it shipped.** The 2026-05-20 deploy went green, every commit was on `main`, the dev preview compiled clean — and four user-visible bugs landed simultaneously (chip missing, GIX 2/68 members, hidden tabs visible, integrations not dispatching). The fastest signal is a Chrome DevTools async IIFE — NOT top-level await (fails with "await is only valid in async functions"):

    ```js
    (async () => {
      const token = localStorage.getItem('ops_hub_token');
      const h = { Authorization: `Bearer ${token}` };
      const out = {};
      out.deptScope = await (await fetch('/api/v1/dept-scope/current', { headers: h })).json();
      const tm = await (await fetch('/api/v1/team-members?limit=500', { headers: h })).json();
      const items = tm.items ?? tm;
      const byOrg = {};
      items.forEach(m => { const k = m.org_node_id || 'NULL'; byOrg[k] = (byOrg[k]||0)+1; });
      out.teamMembers = { total: items.length, byOrgId: byOrg };
      return JSON.stringify(out, null, 2);
    })()
    ```

    Run via `mcp__Claude_in_Chrome__javascript_tool` after navigating to `https://jtk.dp.com`. The dept-scope payload reveals slugs, `isGlobalSuperAdmin`, `visibleSources`, dept list — catching slug-mismatch (#50), hook-contract-fail (#49), and seed-skip (#51) in one call. The team-members breakdown by `org_node_id` immediately flags an unrun seed (expected count vs actual per dept UUID). **Rule**: post-deploy for any tenancy or integration-config change, run this IIFE before reporting "shipped." Two minutes of diagnostic beats a round of "i deployed but…" messages. See PR #734.

54. **The executive Command Center aggregates EVERY department — treat it as a downstream consumer of everything dept-scoped.** Built in the 2026-06-03 Command Center initiative (view id `command-center`, `src/lib/command-center-aggregator.js`, `app/api/v1/command-center/*`, Source Registry `src/data/commandCenterSources.js`, exec gate `src/lib/command-center-access.js`). It INVERTS dept-scope isolation (loops all `org_nodes` instead of filtering to one), so two standing rules: (a) gate it server-side ONLY to exec viewers via `canViewCommandCenter()` (super-admin / `COMMAND_CENTER_SEED_VIEWERS` roster / full admin / `is_command_center_viewer` grant), kept in EXACT lockstep with FE `perms.canViewCommandCenter`; NEVER gate on `can_manage_settings` (Regional Managers hold it) and NEVER on the access-type power alone (the server can't see the FE access-type map, so the tab would show while data 403s — a UX + trust bug). (b) On ANY change to a dept-scoped source, metric, permission, or the dept model, run the §3.18 Command Center cross-impact check and update `commandCenterSources.js` + the matching rollup — or the exec view silently goes stale. See COMMAND_CENTER_PLAN.md.

---

## Quick command reference

```bash
# Start work
cd /Users/mohamed.tantawy/Desktop/ops-hub
git fetch nexus
git checkout -b <branch> nexus/main

# During work
Grep: <symbol> in src/                     # cross-consumer audit
Glob: src/hooks/use*Data.js                # all data hooks (cache pattern sites)
Glob: src/components/views/*.jsx           # all views (role-view check)

# Finish
git add src/<files>
git commit -m "$(cat <<'EOF'
...
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push -u nexus <branch>
gh pr create --repo Deel-Playground/jtk-ops-hub-v2 --base dev --head <branch> --title "..." --body "..."
gh pr checks <n> --repo Deel-Playground/jtk-ops-hub-v2 --watch
gh pr merge <n> --repo Deel-Playground/jtk-ops-hub-v2 --squash --delete-branch

# Verify after user deploys
git fetch nexus
git log nexus/main --oneline -5
gh run list --repo Deel-Playground/jtk-ops-hub-v2 --branch main --limit 5 --json databaseId,conclusion,status,displayTitle
git show nexus/main:<path> | grep <expected>
```

---

## Role-aware test plan template

For every PR body's `## Test plan`, include these rows:

```
## Test plan

### Role matrix (ALL FOUR — no exceptions)
- [ ] Agent (at_agent): <specific check>
- [ ] Team Lead (at_lead): <specific check>
- [ ] Regional Manager (at_regional_mgr): <specific check>
- [ ] Director/Admin (at_admin): <specific check>

### Tree view integrity (if Team/hierarchy/EscalModal/Reassign touched)
- [ ] Team.jsx: leads list + expansion works for each role
- [ ] BriefingView Team Leads card: consistent with Team.jsx data
- [ ] Region filter narrows correctly
- [ ] Lead → Agent hierarchy preserved
- [ ] Expand/collapse state persists across re-renders

### Cross-feature
- [ ] Every view that consumes the changed data was re-checked
- [ ] Cache key is user-scoped (email suffix)
- [ ] BroadcastChannel messages are user-scoped
- [ ] No dead imports left in edited files

### UI polish (if visual change)
- [ ] Matches existing Deel design tokens (colors, radii, typography)
- [ ] Hover / focus / disabled / loading states all present
- [ ] Wide viewport (≥1440px): layout check
- [ ] Mid viewport (1024–1200px): layout check
- [ ] Narrow viewport (<980px): stacks / doesn't clip
- [ ] 125% / 150% zoom: still usable
- [ ] Long text ellipsizes (no overflow)
- [ ] Empty state: sensible fallback
- [ ] Dark mode: no hardcoded light-only colors

### Identity & data safety
- [ ] Email used for matching, not MEMBERS.id
- [ ] User-scoped cache prevents cross-user data bleed
- [ ] No destructive server operations without explicit confirmation
```

Not every row applies to every change. Delete rows that don't. But **always consider each one** before deleting. A good PR has more checked boxes than bullet-points in its Summary.
