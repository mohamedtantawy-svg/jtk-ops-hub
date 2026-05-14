# SLA Extensions — feature plan

## Maintenance protocol

This is the single source of truth for the SLA Extensions feature. Every
new rule, decision, file-touch, or cross-tab connection MUST be appended
here in the same commit that introduces it. Verification checkboxes are
ticked as items land. Items that get skipped or deferred stay in the doc
with a strikethrough + a one-line note so future-us knows why.

Origin: Sarah Suge feedback 2026-05-13 — "lots of manually paused EAs due
to immigration, add a dedicated flag that automatically extends the SLA
when selected." Mohamed expanded the spec to a full request-approval
workflow with cross-source SLA override.

## Overview

Team members can request to extend the SLA on any queue row across the
8 supported sources (onboarding, offboarding, amendments, redlines,
workbench, incentive_plans, zendesk, jira). The request goes to their
manager via HR Hub. On approval, an active extension overrides the
row's SLA window for 1-7 days; on expiry, the row reverts to normal
SLA math (red as breached again).

## Architecture

Mirrors the **Hide Task** flow (skill §3.13, hide-task-helpers.js,
hr_hub_request.flow='hide_task_request'). We reuse the HR Hub request
infrastructure for the manager-review side and add a small dedicated
table for the active extension state.

### Data model

**Extensions to `hr_hub_request`** — same shape as the existing
`hide_task_request` flow.

- Extend the flow CHECK enum: add `'sla_extension_request'`.
- Reuse the existing `task_source`, `task_id`, `task_url`, `task_subject`
  columns (already present from the hide-task migration).
- Add 3 new flow-specific columns (nullable, only populated when
  `flow='sla_extension_request'`):
  - `sla_ext_requested_days SMALLINT` — 3 | 5 | 7 (team-member pick)
  - `sla_ext_reason_code VARCHAR(40)` — `immigration` |
    `client_unresponsive` | `employee_unresponsive`
  - `sla_ext_acknowledged BOOLEAN` — required true at submit

**New `sla_extension` table** (mirrors `hidden_task`'s shape — one row
per active extension; on approval the manager-chosen days drive
`expires_at`):

```
sla_extension (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_source          VARCHAR(40)  NOT NULL,
  task_id              VARCHAR(200) NOT NULL,
  task_url             TEXT,
  task_subject         VARCHAR(500),
  request_id           UUID REFERENCES hr_hub_request(id) ON DELETE SET NULL,
  reason_code          VARCHAR(40)  NOT NULL,
  requested_by_email   VARCHAR(255) NOT NULL,
  requested_by_name    VARCHAR(255),
  approved_by_email    VARCHAR(255) NOT NULL,
  approved_by_name     VARCHAR(255),
  approved_days        SMALLINT     NOT NULL CHECK (approved_days BETWEEN 1 AND 7),
  effective_from       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ  NOT NULL,
  revoked_at           TIMESTAMPTZ
);
```

- `UNIQUE (task_source, task_id) WHERE revoked_at IS NULL` — only one
  non-revoked extension per task at a time. Postgres rejects non-IMMUTABLE
  functions (NOW()) in partial index predicates, so the time component
  has to live in application code: Phase 2's approve handler marks any
  expired-but-unrevoked row as revoked just-in-time before inserting a
  fresh one. Read-path lookups (`findActiveExtension`) additionally
  filter by `expires_at > NOW()` so expired rows are ignored even before
  the cleanup write fires.

### State machine

Per `(task_source, task_id)`:

```
[no request]
   │
   │ team-member submits request
   ▼
[hr_hub_request flow='sla_extension_request', status='new']  ◀── manager review
   │
   ├─ manager denies  →  status='rejected'  (no sla_extension row created)
   │
   ├─ manager approves with N days
   │    → status='resolved'
   │    → INSERT sla_extension(... approved_days=N, expires_at=NOW()+N days)
   │
   ▼
[active extension: expires_at > NOW()]   →  SLA window = expires_at - NOW()
   │
   │ time passes
   ▼
[expired: expires_at <= NOW()]    →  SLA reverts to normal math (red, breached)
```

A new request can only be submitted when there is no `pending` request
*and* no active extension for the same `(task_source, task_id)`. Server
enforces this with the partial unique index on `sla_extension` plus an
explicit pre-check on the HR Hub POST.

### Authorization

- **Request**: any authenticated user can submit on a row they can see
  (existing role-scoping). Server validates the row identity (source +
  id) but does not re-scope — the user already saw the row to click the
  button.
- **Approve / deny**: requester's manager (resolved via
  `team_member_overrides.manager_email`), with HR Hub admins as a
  fallback when the requester has no manager. Reuses the existing HR Hub
  request approval auth on `[id]` PATCH routes.
- **Self-approve**: blocked. If requester == assignee (manager-less
  admin), the request still goes through but requires a second admin to
  approve.

### SLA override math (Phase 3)

`slaInfo()` (tickets) and `computeSlaWindow()` (Deel sources) check for
an active extension on the row and replace the math:

```
if (row.slaExtension && Date.parse(row.slaExtension.expiresAt) > Date.now()) {
  const remainingMs = Date.parse(row.slaExtension.expiresAt) - Date.now();
  return { ok: true, atRisk: false, breach: false, remainingMs, ... };
}
// else fall through to existing math
```

After `expiresAt` passes, the extension is ignored and the existing
math takes over — naturally red because the original SLA window has
been gone for days.

Server-side enrichment: each queue route (and the helper functions in
`normalizeSourceRows.js`) hydrates `slaExtension` onto every row from
the `sla_extension` table on each fetch. This guarantees the extension
state survives every sync cycle without client-side cache merging.

### Sync robustness

- The row's `slaExtension` field is server-truth, NEVER persisted on the
  client cache. Every fetch returns the current state.
- The 30-second poll re-reads the field, so a manager approval shows up
  on the requester's queue within 30s.
- The SLA timer is computed from `expires_at - now` every render, so it
  ticks continuously without restart.

## Phases

### Phase 1 — Request side (this PR)

Plan doc + storage + request form + auto-routing. End-to-end flow:
team-member fills the form → request lands in HR Hub assigned to their
manager. No SLA override yet (Phase 3 wires that).

Files:
- `SLA_EXTENSIONS_PLAN.md` (this doc)
- `src/lib/migrate.js` — extend `hr_hub_request` enum + add 3 columns +
  new `sla_extension` table
- `src/lib/sla-extension-helpers.js` (NEW) — server-side helpers
  (canonical key, allowed reasons, active-extension lookup, manager
  resolution)
- `app/api/v1/hr-hub/requests/route.js` — extend POST to validate the
  new flow's payload (requested_days, reason_code, acknowledged)
- `src/services/hrHubApi.js` — no change (the existing
  `createHrHubRequest` already accepts arbitrary flow + payload)
- `src/components/modals/CreateSlaExtensionModal.jsx` (NEW) — request
  form (mirrors `CreateHideTaskRequestModal.jsx`)
- `src/components/queue/SourceTable.jsx` — new `onRequestSlaExtension`
  prop + action button mirroring `onHide`
- `src/components/queue/Queue.jsx` — wire the modal + handler across
  all 8 source tables

Verification:
- [ ] `npm run dev` compile-clean
- [ ] Dev preview: action button visible on every source row in
      SourceTable. Tickets (ZD/Jira) merged table + each Deel source
      panel — 8 places total.
- [ ] Modal opens with 3 duration chips, 3 reason options, ack checkbox.
      Submit disabled until reason + ack provided.
- [ ] Confirmation state after submit ("Sent to your manager…").
- [ ] Migration runs idempotently on next dev pod boot (re-run safe).

### Phase 2 — Manager review in HR Hub ✓ landed in PR

Per-flow approve / deny endpoints, modals, and HR Hub filter chip.

- `src/components/views/HrHubView.jsx` — registered new flow
  `'sla_extension_request'` with metadata (icon, label, color), added
  it to the FLOW_FILTERS chip rail, extended `canDecide` so the
  inline Approve/Deny buttons render for managers on pending SLA-ext
  rows, and wired both flow-specific modals at the view root.
- `src/components/modals/ApproveSlaExtensionModal.jsx` (NEW) —
  manager picks 1-7 days (1-day chips), preview of the requester /
  reason / requested days, calls `approveSlaExtension(id, days)`.
- `src/components/modals/DenySlaExtensionModal.jsx` (NEW) — required
  reason textarea, calls `denySlaExtension(id, reason)`.
- `app/api/v1/sla-extension/[id]/approve/route.js` (NEW) — txn:
  cleanup expired-unrevoked rows for the same (source, id), update
  hr_hub_request to resolved with `sla_ext_approved_days`, INSERT
  into `sla_extension` with `effective_from=NOW()` and
  `expires_at=NOW()+approved_days days`, writeLog, notify requester.
- `app/api/v1/sla-extension/[id]/deny/route.js` (NEW) — txn: update
  request to resolved with `resolution_note=reason`, writeLog, notify
  requester. No sla_extension row created.
- `src/services/slaExtensionApi.js` (NEW) — `approveSlaExtension` /
  `denySlaExtension` thin wrappers.
- `app/api/v1/hr-hub/requests/route.js` GET — project the new
  `sla_ext_*` columns into the list payload.
- `app/api/v1/hr-hub/requests/[id]/route.js` GET — same columns on
  the detail payload.

### Phase 3 — SLA override math ✓ landed in PR

Single override point: a global active-extensions list polled every
30s, plus a row-level `applySlaExtensionsToRows` helper that rewrites
`slaRemaining` / `slaBreachStatus` / `slaWindowMs` to the extended
timer. Every downstream consumer that already reads those fields gets
the override for free — no per-consumer logic change.

- `app/api/v1/sla-extension/list/route.js` (NEW) — global active list
  with 30s server cache, busted by approve.
- `app/api/v1/sla-extension/[id]/approve/route.js` — `cacheDel` on the
  list key after a successful approve so the FE picks up the new
  extension on the next 30s poll cycle.
- `src/services/slaExtensionApi.js` — adds `listSlaExtensions()`.
- `src/utils/applySlaExtensions.js` (NEW) — `applySlaExtensionsToRows`
  + `buildExtensionMap` helpers.
- `src/hooks/useSlaExtensions.js` (NEW) — SWR hook (LS cache,
  BroadcastChannel, 30s poll while visible).
- `src/utils/helpers.js` `slaInfo()` — extension short-circuit at the
  very top: while `now < expiresAt`, returns the "Extended · Nd left"
  ok-shape. Tickets benefit without normalizer changes.
- `src/App.jsx` — instantiates `useSlaExtensions(!!user)`, passes via
  `IntegrationsContext`.
- `src/components/queue/Queue.jsx` — destructures `slaExtensions` from
  context, applies the override to each scoped Deel-source row array
  AND attaches `slaExtension` to filtered tickets so the existing
  `rowSlaSeverity` / `slaTier` paths and the workspace-home aggregate
  all read the extended state.
- `src/components/views/BriefingView.jsx` — applies the override to
  the seven `*RowsAll` memos, so the Health Score, Org Breach ring,
  Team Summary, and Department Exec Summary all exclude actively-
  extended rows from breached counts.
- `src/components/views/Team.jsx` — applies the override to the three
  per-agent source arrays (onb / off / wb) so the per-agent SLA dot
  reads the extended state.
- `src/components/views/HrHubView.jsx` — after a successful approve,
  calls `integrations.slaExtensions.refresh()` so the new extension
  reaches every queue surface within seconds, not 30s.

Sync robustness contract (the user's spec said: "make sure that the
SLA countdown is active and doesn't restart after each sync"):
- `slaRemaining` is computed as `expiresAt - now` at render — the
  timer NATURALLY decreases as `now` advances. The expiresAt itself
  is server-stamped at approval and never changes.
- The active-extension list is fetched per-poll. A sync cycle just
  re-applies the same override; the saved timer doesn't restart.
- Once `expiresAt <= now`, the lookup returns no match and the row
  reverts to its natural normalized state — almost certainly red
  because the original SLA window was the reason for the extension.

Coverage gap (follow-up):
- `src/components/views/Analytics.jsx` — multi-cohort normalization
  paths weren't wired in this PR. Analytics typically aggregates
  historical data; current-state extensions matter less. Punt to a
  follow-up if the analytics SLA Compliance KPI drift causes
  confusion.
- `src/components/home/ApproachingBreach.jsx`,
  `src/components/home/DailySummary.jsx` — read `slaInfo` for
  tickets only and inherit the extension override there. Deel-source
  rows on these surfaces aren't yet plumbed; same follow-up bucket.

Cross-tab audit (§1.9 — each row verified):
- [x] Queue header SLA pills count extended rows as ok, not breached.
- [x] SourceTable per-row pill renders "On Track" while active (the
      green-pill copy is shared with normal in-SLA rows; per-row
      "Extended" wording is a v2 polish item).
- [x] WorkspaceHome "Clear all breaches" card via the
      `workspaceHomeSla` memo inherits the override.
- [x] BriefingView Health Score / Org Breach / Team Summary / Dept
      Exec Summary all read the overridden fields.
- [x] Team SLA dot reads the override on the three per-agent arrays.
- [ ] Analytics SLA Compliance KPI — deferred (see gap above).
- [x] After `expires_at`, every consumer reverts to red (breached)
      because the override no longer matches.
- [x] Sync survives — the list is server-truth, the override is
      re-applied every render off the cached map.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| SLA pill says "breached" but card says "extended" — consumer drift | Phase 3 audit walks every §1.9 consumer; PR description ticks each one off |
| Sync clobbers the extension | Server enrichment on every fetch, never client-cached |
| Requester has no manager (admin) | Fallback to HR Hub admins as approver pool |
| Multiple extensions stacked on the same task | Partial unique index `WHERE revoked_at IS NULL AND expires_at > NOW()` blocks at the DB level |
| Approval flips status to 'resolved' but extension already expired before manager looked | Approve handler refuses + surfaces "Extension would have already expired — submit a fresh request" |
| Manager OOO during request | Existing OOO/handover surface (HANDOVERS_PLAN.md) routes to coverer — same mechanism used by current HR Hub assignments |
| Action button on rows without an existing SLA breach is noisy | Render the button on every row; the modal's preamble explains the use case ("if your row is at risk of breach because of immigration / etc."). Easier than gating UI on per-row SLA state. |

## Open questions (revisit before Phase 3)

- Should the extension also affect Briefing's "Org breach" ring? Yes —
  excluded from breached, counted as on-track until expiry.
- Should the manager be able to revoke an active extension? Out of
  scope for v1; add a follow-up if requested.
- Email/Slack notifications? In-app only for v1 (matches the
  HANDOVERS_PLAN v1 scope).
