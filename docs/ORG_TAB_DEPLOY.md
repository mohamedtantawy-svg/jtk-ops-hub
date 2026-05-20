# Org Tab — Deployment Checklist

Phases 0 through 8 shipped to `nexus/dev` between 2026-05-20 and 2026-05-20.
This file is the pre-deploy sanity sheet before merging `dev → main` and
hitting **Deploy Now**.

## What landed

| # | PR | Scope |
|---|----|-------|
| 0 | #701 | Schema (`org_nodes`, `org_vacant_roles`, `org_node_admins`, `org_audit`), FK on `team_member_overrides`, versioned seed (HR Experience → EOR Operations + Next-Gen HR), nav tab, view shell |
| 1 | #702 | Full CRUD API + admin tree UI (create/rename/move/archive/reorder/move nodes with audit) |
| 2 | #703 | Visual Slack-style chart with pan/zoom/fit, member chips, "+N more" tile |
| 3 | #704 | MemberDetailDrawer + AddMemberModal lift; Leaders Hub → Team sub-tab removed; `?view=team → ?view=org` alias |
| 4 | #705 | Drag-to-move members + cmd/ctrl/shift-click multi-select + BulkMoveBar + OrgMovePreviewModal |
| 5 | #706 | Per-node SLA cascade override, dashboard slugs, delegated admins, vacant roles |
| 6 | #707 | Dynamic `VALID_TEAMS` (legacy enum + active org_nodes.name), org-scope helpers, `orgConfig.js` deprecation |
| 7 | #708 | `/api/v1/org/audit` + OrgAuditDrawer + CSV export (structure + members) |
| 8 | this PR | `/restore` endpoint + "Show archived" toggle + deploy doc |

## Boot-time invariants

On first boot after this deploy, the migration block in
`src/lib/migrate.js` should:

1. `CREATE TABLE IF NOT EXISTS` for the four org tables — no-op on re-run.
2. `ALTER TABLE team_member_overrides ADD COLUMN IF NOT EXISTS org_node_id` — idempotent.
3. `seedOrgDefaultIfNeeded()` runs, logs:
   ```
   [db] Org default seeded to v1: HRX dept + 2 teams, N member overrides backfilled
   ```
   On subsequent boots, no log line (skipped via `app_settings.org_default_seed_version`).

## Smoke checklist (manual)

Run **after** the prod deploy lands. Each item should still work:

- [ ] **Org tab visible** — `https://jtk.dp.com/?view=org` opens the chart with HRX dept + EOR Ops + Next-Gen HR.
- [ ] **Existing surfaces unchanged**:
  - Briefing renders with team table + manager-on-call + KPIs.
  - Workspace (My Queue) lists tickets, filters work.
  - HR Hub list opens, assignee dropdown populates.
  - Leaders Hub now opens directly to Alerts (no sub-tab strip).
  - OOO + Handovers list renders, Urgent Assist + Schedule render.
  - Settings opens for admins.
  - Dark mode toggle still works site-wide.
- [ ] **CRUD round-trip** (any admin):
  - Create a new team under HR Experience → it appears on the chart.
  - Drag a member into the new team → impact modal → confirm → headcount updates.
  - Edit allocation through MemberDetailDrawer → confirm Home page team table reflects the change.
  - Archive the empty test team → "Show archived" toggle reveals it → Archive menu now reads "Restore" → restoring works.
- [ ] **CSV export**: Export → Structure (CSV) downloads a well-formed file with depth + path columns.
- [ ] **Audit drawer**: opens, lists the actions taken above with relative timestamps.
- [ ] **Permissions**:
  - Agent user sees the chart in read-only mode (no "+ New department" button, no per-node "..." menus).
  - Delegated admin grant (via the form drawer's Delegated admins section) gives the granted email edit power on that subtree only.

## Known carries / future cleanup

- **Legacy `team` column** stays dual-written through Phase 5+; the column drop is a follow-up migration after this deploy stabilizes.
- **`orgConfig.js`** carries `@deprecated`; sweeping remaining importers is a follow-up.
- **PDF/PNG chart export** deferred — CSV ships in Phase 7; the visual export is a future epic.
- **Manager-on-Call per department** is scoped via Phase 5's `config.moc` slot but the existing global MOC UI in Briefing is unchanged in this deploy. Future patch moves the MOC pill to read per-department settings.
- **Drag-to-move whole subtrees** ships only via the form drawer's Move endpoint today; visual drag of department/team cards is a follow-up to Phase 4.

## Rollback

If anything regresses post-deploy:

1. **UI regression only** — revert the most recent merge on `main` (the Phase commit is contained per-PR).
2. **DB corruption** — `seedOrgDefaultIfNeeded` is idempotent, so re-running is safe. To wipe the test data, manually `UPDATE app_settings SET value = '{"version":0}' WHERE key='org_default_seed_version'` and let the next boot re-seed.
3. **Worst case** — every Phase 0+ change is gated by `view==='org'` in App.jsx + the `useOrgNodes` hook. The other tabs read no org_nodes data; they're unaffected by org-side outages.

## Verifier

`node scripts/verify-org-backfill.mjs` runs the 145-check sanity suite end-to-end. It exercises:

- migrate.js schema declarations
- seed file shape + version sentinel
- merge function threads `orgNodeId`
- team-members API surfaces `org_node_id`
- accessControl registers the view + admin power
- nav + view mount
- Phase 1 CRUD + delegation walk
- Phase 2 layout + canvas pan/zoom
- Phase 3 MemberDetailDrawer + AddMemberModal + Leaders Hub change
- Phase 4 DnD + bulk move
- Phase 5 admins + vacancies + SLA resolver
- Phase 6 dynamic VALID_TEAMS + scope helpers
- Phase 7 audit + CSV
- Phase 8 restore + show-archived toggle

Should print `XX passed, 0 failed` from a clean repo.
