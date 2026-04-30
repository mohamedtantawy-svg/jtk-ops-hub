---
name: ops-hub-improvement
description: Use this skill whenever the user asks for ANY improvement, fix, feature, bug fix, refactor, or UI change in the ops-hub project. It enforces the full workflow — deep cross-feature audit, multi-role consideration (Agent/TL/Regional/Director), tree-view preservation, UI polish verification, implementation, commit, push, PR, CI wait, merge to dev — so the user only has to "go to Nexus and deploy". Also encodes every mistake-avoidance rule learned from prior sessions. Triggers: any ops-hub code change request, anything touching /Users/mohamed.tantawy/Desktop/ops-hub/, any mention of Queue/Briefing/Announcements/Escalations/ACK/cache/sync/TL/Regional/Agent/Team/hierarchy/tree view.
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

If the change touches data that multiple views consume, enumerate every consumer. The eight top-level views are: **Briefing (Home), Queue, Team, Analytics, Escalations, Announcements, Calendar, Projects, HR Reports, Settings, Knowledge Hub**. Audit grep:
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

### 3.5 No new files unless necessary

**Never create new files (especially .md) unless explicitly requested.** Edit existing files. The only exception is when the user asks for a new component/view or when a brand new hook is structurally the right answer.

### 3.6 Deel admin API — pagination + filter quirks

The `api-prod-admin.letsdeel.com` admin endpoints have non-obvious behaviour that's bitten us multiple times. Read this before adding or modifying any scan:

**Cursor pagination**: every paginated admin endpoint (`/admin/eor/terminations_v3`, `/admin/eor/employee-manager/list/...`, etc.) returns a `cursor` token. The cursor encodes the FILTER + SORT state from the first request. Subsequent calls must send ONLY `cursor=...` — sending `limit` or any filter param alongside an existing cursor returns 400.

**Server-side filter rejection (Joi)**: the terminations_v3 endpoint rejects `status[]=` as a query param with a Joi error like:
```
"value does not match any of the allowed types"
"cursor required (alt 1) | limit not allowed (alt 2) | status not allowed (alt 3) | status[2] must... (alt 4)"
```
Read every alternative — alt N+1 with a value-level constraint hint (e.g. `status[2] must be one of [...]`) often reveals which alternative the request was CLOSEST to matching. Don't blindly retry with random param names; if status[] is rejected, filter client-side and use a smart sort.

**Smart sort for huge upstreams**: when the upstream queue dwarfs the actionable subset (e.g. terminations_v3 returns ~30k records of which ~1.1k are actionable), pass `sortBy=createdAt&sort=DESC` on the FIRST request. The cursor preserves it, so the entire walk is newest-first. Actionable records cluster in recent createdAt; closed records dominate the long tail. An empty-page early-stop at ~200 pages reliably catches the actionable set without walking all 600 pages.

**Sort vs early-stop interaction** — never early-stop against the default `endDate ASC nulls first` sort: actionable PROCESSING / AWAITING_HRX_ACTION rows interleave with closed rows across the entire walk and a 50-page heuristic loses two-thirds of them (Mohamed reported 327 visible vs ~1100 expected). Always pair early-stop with a sort that front-loads the kept set.

**Track raw status counts** as you scan and surface them in the route response (`upstreamStatusCounts: { AWAITING_TRIAGE: ..., COMPLETED: ..., ... }`). Without this you can't debug "why isn't the count what I expect" — you have no visibility into what the upstream actually contains.

**Parent-bucket endpoints can be incomplete**: `/admin/eor/employee-manager/list/Onboarding.ActionableQueue` does NOT consistently surface every sub-status (we explicitly fan out to `Onboarding.ComplianceDocs.AwaitingReview`, `Onboarding.EA.EASigning.AwaitingToSendEA`, `Onboarding.EA.EAAdditionalDetails.AwaitingReview`, `Onboarding.PayrollComplianceDetails.AwaitingReview`). When in doubt, fan out per-status and merge by `onboardingId || oid`.

**Per-country fan-out for paged sub-statuses**: most sub-status list endpoints return ~50 rows per call without a country filter. To pull every actionable row, hit `/admin/eor/employee-manager/countries/list/<status>` first to get country totals, then call `/admin/eor/employee-manager/list/<status>?countries[]=<CC>` per country. Mirror the Paused-onboarding pattern in `_scanOnboardingByStatus` for any new sub-status scan.

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

### 3.9 CSV export format hardening

Any new CSV download route must:
- **Prefix the body with `﻿`** (UTF-8 BOM) so Excel on Windows recognises encoding and doesn't mojibake accented HRX names.
- **Use `\r\n` line endings** per RFC 4180. LF-only breaks Numbers' import wizard and a few CSV parsers.
- **Always-quote every field** (`"value"`) including numbers and codes — handles leading-zero ISO codes, comma-bearing names, and embedded quotes uniformly.
- **ASCII-safe filename** in `Content-Disposition` (Safari drops the header on non-ASCII).
- **`.catch()` on optional secondary queries** in `Promise.all` so a missing table on a brand-new env serves with empty counts instead of 500ing the whole download.

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

**Color & contrast:**
- [ ] Uses CSS variables where available (`var(--text)`, `var(--text-secondary)`, `var(--text-muted)`, `var(--surface)`, `var(--surface-2)`, `var(--border)`, `var(--purple)`, etc.) — never hardcode `#1b1b1b` unless consistent with the surrounding block
- [ ] Matches the existing Deel design tokens (fonts: Inter; body 12–13px; headings 16px; small 10–11px)
- [ ] Dark mode intact — if the change adds hardcoded colors, they must have a dark-mode equivalent via `data-theme="dark"` CSS vars

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

### 6.5 Browser cache disclaimer

Before telling the user "deploy broken, regressions everywhere":
1. File-level verify that the fix IS on main (6.3).
2. If yes, it's almost certainly stale browser cache. Next.js serves immutable-cached JS chunks. **Tell the user to Cmd+Shift+R before assuming a regression.**
3. Only after cache clear still shows the bug, investigate for a real regression.

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
