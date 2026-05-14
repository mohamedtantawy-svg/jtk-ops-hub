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

### Phase 2 — Manager review in HR Hub

HR Hub category card + approve/deny modals + lifecycle endpoints.

- `src/components/views/HrHubView.jsx` — register new flow
  `'sla_extension_request'` with metadata (icon, label, color)
- `src/components/modals/ApproveSlaExtensionModal.jsx` (NEW) —
  manager picks 1-7 days, optional note, approve
- `src/components/modals/DenySlaExtensionModal.jsx` (NEW) — required
  deny reason
- `app/api/v1/hr-hub/requests/[id]/route.js` (PATCH) — extend approve
  branch to INSERT into `sla_extension` table with manager-chosen days
- Notification fan-out via `user_notifications` (skill §3.12) on
  approve/deny → requester

### Phase 3 — SLA override math (highest-risk)

Server enrichment + slaInfo/computeSlaWindow integration + audit walk
of every §1.9 consumer.

- `app/api/v1/queue/route.js` and per-source routes — enrich rows with
  active extension from `sla_extension` table
- `src/utils/helpers.js` — `slaInfo()` reads `row.slaExtension`
- `src/utils/normalizeSourceRows.js` — every source normalizer
  carries `slaExtension`; `computeSlaWindow()` reads it
- `src/components/queue/Queue.jsx` — `rowSlaSeverity` mirrors
- `src/components/queue/SourceTable.jsx` — `slaTier` mirrors + visible
  "Extended" pill on the row
- `src/components/views/BriefingView.jsx` — Health Score / Org Breach
  exclude actively-extended rows from breached counts
- `src/components/views/Team.jsx` — per-agent SLA dot
- `src/components/views/Analytics.jsx` — SLA Compliance KPI
- `src/components/home/ApproachingBreach.jsx` and `DailySummary.jsx`

Cross-tab audit (skill §1.9 — each row gets verified):
- [ ] Queue header SLA pills count extended rows as ok, not breached
- [ ] SourceTable per-row pill renders "Extended" badge while active
- [ ] BriefingView Health Score Compliance % excludes extended rows
- [ ] Team SLA dot reads extension
- [ ] Analytics SLA Compliance KPI reads extension
- [ ] ApproachingBreach + DailySummary read extension
- [ ] After `expires_at`, every consumer reverts to red (breached)
- [ ] Sync survives — extension persists across the 30s poll cycle

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
