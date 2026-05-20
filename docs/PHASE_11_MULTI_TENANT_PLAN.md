# Phase 11+ — Multi-Tenant Isolation Plan

**Status:** design doc, awaiting sign-off before Phase 11a code lands.
**Author:** session of 2026-05-20.
**Depends on:** Phases 0–9 (org tab core), Phase 10a (login-as-dept-admin),
Phase 10b (auto-seed lead as dept admin).

## Goal

Turn every new top-level department into a real tenant: its own pocket of
Announcements, HR Hub, Leaders Hub, OOO + Handovers, Urgent Assist,
Workspaces, Slack-sourced tasks, and Briefing/Home data. The HR Experience
department keeps every existing row; the three empty depts (Global
Immigration, Payroll Operations, Benefits Operations) start with nothing and
fill up over time.

## Locked decisions (2026-05-20, signed off)

1. **Hard isolation** across all surfaces. No per-row "share" toggles. Only
   **Feedback** and the **Org tab** itself stay cross-dept.
2. **Single global super-admin** = `mohamed.tantawy@deel.com`. He sees every
   dept via a dept-picker. No other access=admin user gets cross-dept reach.
3. **Backfill = stamp-on-deploy.** Every existing row gets HR Experience's
   `org_node_id` set at boot. After backfill, NULL `org_node_id` is invalid
   in the read path — no null-fallback semantics.
4. **One node per member rule HOLDS.** Moving a member to a new dept removes
   them from their previous dept entirely. The form drawer's `LeadMoveWarning`
   banner (Phase 10b) covers the lead-email path; member drag/move flows
   inherit the same one-per rule via the existing PATCH `orgNodeId` flow.
5. **Sub-teams don't isolate from each other.** Only the top-level dept
   boundary isolates. Sub-teams within a dept share the same data pool.
   Single carve-out: **Workspaces** may have per-team configuration within a
   dept (different queue setups), but the data inside each workspace is
   still dept-pool.

## Core primitive: `currentDeptId`

Every isolated read needs to know "which dept is this request scoped to."
Two options weighed; recommendation in **bold**.

| Option | Pros | Cons |
|---|---|---|
| **Derive at request time** from `team_member_overrides.org_node_id` → walk to top-level ancestor | No new column. Always fresh. Single source of truth | One extra DB lookup per request unless cached. Recursive CTE on every read. |
| Denormalize `dept_id` onto the session/JWT | Zero per-request lookup | Stale after a member move until JWT refresh; needs JWT version bump. |

**Recommendation: derive at request time, cache for 30 s** per session in
`src/lib/dept-scope.js`. Cache invalidated by any PATCH on
`team_member_overrides` (reuse the existing `invalidateRosterCache` plumbing
in the team-members route).

For the **global super-admin's dept-picker**:
- Add a cookie `ops_hub_super_admin_dept` (or sessionStorage) with the
  selected dept's UUID.
- Server-side `getCurrentDeptId(user, req)`:
  - If `user.email === GLOBAL_SUPER_ADMIN_EMAIL` AND a valid dept UUID is in
    the cookie → return that.
  - Otherwise → walk `team_member_overrides.org_node_id` to top-level.
- The picker is a small dropdown in the TopNav, visible only to mohamed.

## Per-surface playbook

Every Phase 11.x PR follows the same template:

1. **Schema migration.** `ALTER TABLE <surface> ADD COLUMN IF NOT EXISTS
   org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL`. Always
   nullable on add; backfill in step 4 makes it effectively NOT NULL.
2. **Write-path tagging.** Every INSERT/POST/CREATE handler stamps
   `org_node_id = await getCurrentDeptId(user, req)` on the new row. The
   submitter's resolved dept is authoritative; admins can't choose.
3. **Read-path filtering.** Every SELECT/GET handler appends
   `AND org_node_id = $currentDeptId`. The super-admin's picker swaps the
   filter for ALL/specific dept.
4. **Backfill.** Idempotent boot-time pass that stamps
   `org_node_id = <HR_EXPERIENCE_UUID>` on every existing row where it's
   NULL. Bumps a `<surface>_dept_backfill_version` sentinel in
   `app_settings`. After the bump, NULL is invalid — add a CHECK or a
   migration to set NOT NULL.
5. **UI dept-picker (super-admin only).** First PR introduces the picker
   in TopNav. Subsequent PRs only wire their surface to it.
6. **Verifier checks** + smoke checklist.

## Surface-by-surface plan

| # | Surface | Table(s) | Notes |
|---|---|---|---|
| 11a | **Foundation** — `getCurrentDeptId` helper + cookie + TopNav dept-picker (super-admin only) | none | No data isolation yet — this PR ships the primitive others depend on. |
| 11b | **Announcements** | `announcements`, `announcement_acks`, `announcement_comments`, `announcement_reactions`, `announcement_links`, `announcement_requests`, `announcement_request_audit`, `announcement_request_comments` | Tag at `announcements` level only; the *_acks/comments/etc. inherit via FK to the parent announcement. Filter at read on the parent. |
| 11c | **HR Hub** | `hr_hub_request`, `hr_hub_settings` | Each dept needs its own `hr_hub_settings` row(s) — workflow templates, statuses, dropdowns, auto-assign rules. Seed new depts with a fresh copy of HRX's settings on dept create (extend `ensureLeadIsDeptAdmin`?). |
| 11d | **Leaders Hub** | `leader_alert` | Single table — straightforward. Notification policy may need per-dept config (likely lives in `hr_hub_settings` style row). |
| 11e | **OOO + Handovers** | `time_off_events`, `handovers`, `handover_coverers`, `handover_log`, `handover_handback`, `handover_settings`, `handover_checklist_templates`, `handover_checklist_items` | Country-doc tables (`handover_country_docs` etc.) stay **shared** — they're HRX-wide reference. Templates: shared by default, per-dept override later. |
| 11f | **Urgent Assist** | `urgent_assist_request`, `urgent_assist_log`, `urgent_assist_schedule` | Schedule is per-dept (each dept's own MOC rotation). Request + log filter normally. |
| 11g | **Workspaces / My Queue** | `workspace_members` already keyed; queue surface = subset of `tasks` | Per-team workspace config allowed (the carve-out). Queue itself filters by dept. |
| 11h | **Tasks (Slack-sourced + others)** | `tasks` | Already has a `source` column. Add `org_node_id`. Slack sync stamps based on submitter's dept resolved via roster lookup. Audit `tasks.source` to confirm every path stamps. |
| 11i | **Briefing / Home** | reads everything above | No new tables. Wires `currentDeptId` into every existing query. Final integration pass. |

## Backfill strategy

Recommended pattern: **one combined backfill module** rather than per-surface.

```
src/lib/dept-backfill.js   (new)
  - exports backfillHrExperienceTenancyIfNeeded()
  - version-marked in app_settings.dept_backfill_version
  - for each surface table, UPDATE ... SET org_node_id = HRX_UUID
    WHERE org_node_id IS NULL
  - reports per-table row counts in a single audit row
```

Runs from `runMigrations()` in `src/lib/migrate.js` after the org default
seed. Idempotent. Single sentinel = single deploy = single sweep.

## Member-move flow

The locked one-node-per-member rule means every member move must be
opt-in and visible:

- **Existing PATCH /api/v1/team-members/[email]** with `orgNodeId` already
  does the move (single-row update). No change needed at API level.
- **`OrgMovePreviewModal`** (Phase 4) already shows what will move. Phase
  11 should extend its copy to say "X will lose access to <oldDept>
  data". Two-line patch.
- **`LeadMoveWarning`** (Phase 10b) covers the form-drawer path. No
  change needed.

No new endpoints; just sharper copy.

## Open questions to confirm BEFORE Phase 11a code lands

1. **Workflow template inheritance.** When a new dept is created, do we
   (a) copy HRX's `hr_hub_settings` rows verbatim, (b) start the dept with
   empty settings so the admin defines from scratch, or (c) inherit by
   reference with copy-on-write? **Recommendation: (a) — copy on dept
   create**, ensures the new dept is usable from minute one.
2. **Cross-dept Slack channels.** Phase 0 seeded `org_nodes.slack_channel`.
   When a Slack task is sourced from a channel that belongs to dept B but
   the submitter belongs to dept A, which dept gets the task? **Recommendation:
   submitter's dept** — keeps the rule "isolation follows the person."
3. **TopNav dept-picker placement.** Suggest a chip next to the org icon
   showing "Viewing: <Dept>" with a dropdown. Mockup needed?
4. **Audit retention across moves.** When derek.house moves from HRX →
   Global Immigration, do his existing `org_audit` entries get re-tagged?
   **Recommendation: no — `org_audit` is append-only and historical;
   it records the dept at action time** which is the right behavior.
5. **Test fixtures.** No automated end-to-end suite today. Phase 11
   PRs will rely on verifier static checks + manual smoke. OK or do we
   want one Playwright pass per surface?

## PR ordering and parallelism

Sequence (each is one PR):

```
11a (foundation)
  → 11b (announcements)  ─┐
  → 11c (hr hub)          ├ can ship in parallel after 11a lands
  → 11d (leaders hub)     ┘
  → 11e (ooo + handovers)
  → 11f (urgent assist)
  → 11g (workspaces)
  → 11h (tasks)
  → 11i (briefing / home — integration)
```

Estimated **9 PRs total**. The combined dept-backfill module ships in **11a**
so subsequent surface PRs only add their column + filter clauses.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Backfill mis-tags an HRX row as another dept (data leak) | Backfill ONLY targets `WHERE org_node_id IS NULL`. The HRX UUID is the only target. Verified by a verifier check that re-runs the backfill query in dry-run mode. |
| Read-path filter forgotten on one route → silent leak | Every Phase 11.x PR includes a verifier section listing the route paths it must filter. Audit at PR review. |
| The `team` column still scopes ~84 HRX agents until Phase 6 retires it. Mixed sources of truth. | Phase 11 does NOT touch `team`. Phase 12+ retires it once every surface reads `org_node_id`. |
| Super-admin picker leaks data to non-mohamed admins via cookie tampering | Server-side `getCurrentDeptId` checks `user.email === GLOBAL_SUPER_ADMIN_EMAIL` BEFORE honoring the cookie. Tampering yields the user's real dept. |
| `getCurrentDeptId` cache stale after a member move | Invalidate via existing `invalidateRosterCache` already called in team-members PATCH. |

## Out of scope for Phase 11

- Per-dept branding / themes.
- Cross-dept reporting dashboards (could land later as a super-admin-only
  view).
- Removing the legacy `team` column (= Phase 12+).
- Per-team workspace config UI inside a dept (= Phase 13+, the sub-team
  carve-out).
