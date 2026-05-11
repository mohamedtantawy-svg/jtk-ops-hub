# Ops Hub — OOO & Handovers Plan (Final Draft)

**Owner:** mohamed.tantawy@deel.com
**Date opened:** 2026-05-11
**Status:** Final draft — awaiting sign-off before Phase 1 implementation
**Source data:** `HRX Time Off Report May 11 2026.csv` (1,245 rows: `Start Date,End Date,Work Email`)

This is the design + execution plan for the OOO surface and the
end-to-end handover workflow on Ops Hub. Lives next to `HR_HUB_PLAN.md`
and `LEADER_ALERTS_PLAN.md` so it serves as both the spec during build
and the audit checklist after launch.

---

## 1. Goals

1. Every Deel HRX team member has a frictionless way to hand their work
   over before going OOO and a structured way to receive it back.
2. The OOO surface is **one tab, one screen, no sub-tabs** — a person
   landing on it instantly understands: (a) what they personally need to
   action, (b) what's been handed over to them, and (c) what their team
   has going on.
3. Managers see, at a glance, every active handover, every upcoming
   handover, and every coverage gap across their tree.
4. While a handover is **active**, the coverer's workspace is **merged**
   with the OOO person's — same queues, same counts, same breach math.
   Two people, one workspace.
5. The OOO calendar is sourced from a database table (seeded from the
   provided CSV, refreshable from the Deel API), never hardcoded.
6. Reminders push the requester to submit a handover **48 h** before they
   leave, and escalate to **the manager 24 h** before if the handover is
   still missing.
7. Every state change is logged. Anyone with admin access can audit who
   handed what to whom, when, and what was checked off.

---

## 2. The surface — one tab, two view modes, smart lenses

### 2.1 Primary nav

A new primary tab **OOO** between **HR Hub** and **Leaders Hub** in
`DeelTopNav.jsx`. Icon: `bi-airplane`. Visible to **every** authenticated
user. No managerial gate — visibility is scoped by the reporting tree
(§6) and the lenses themselves (§3).

### 2.2 No sub-tabs

The page is a single screen. The header layout is:

```
┌──────────────────────────────────────────────────────────────────────┐
│  OOO & Handovers                                  [⚙]  [+ New]       │
│                                                                      │
│  [ Calendar | Table ]   ← view mode                                  │
│                                                                      │
│  ◉ Mine (2)  ○ Covering me (1)  ○ My team (8)  ○ Approvals (3)       │
│  ○ Drafts (1)   ○ All                              ← lens chips      │
│                                                                      │
│  🔍 Search   [Country ▾] [Status ▾] [Missing handover ☐]             │
│                                                                      │
│  ⚠ Action required: 1 upcoming OOO without a handover. [Submit →]    │
└──────────────────────────────────────────────────────────────────────┘
│                       body — Calendar or Table                       │
└──────────────────────────────────────────────────────────────────────┘
```

The cog opens Settings deep-linked to the Handovers section
(`setView('settings')` + `?section=handovers`). The Settings UI itself
lives in `SettingsView.jsx`, not inside this page — there's only ever one
sub-surface in OOO at a time.

### 2.3 URL state

`?mode=calendar|table` + `?lens=auto|mine|covering|team|approvals|drafts|all`
+ `?from=YYYY-MM-DD&to=YYYY-MM-DD` so any view is shareable / deep-linkable
from a Slack DM or a notification.

---

## 3. The smart lenses

Lenses are the answer to "which of these rows is mine to deal with?".
Each lens is a server-side filter that the same `GET
/api/v1/time-off-events` endpoint accepts. The FE renders identical rows
across lenses — only the row set changes.

| Lens          | What it shows                                                                                       | Default action chip          |
|---------------|-----------------------------------------------------------------------------------------------------|------------------------------|
| **Mine**      | My upcoming OOO ranges + their handover status (none / draft / pending / approved / active / done). | **Submit handover** (when missing) |
| **Covering me**| OOO ranges where I'm listed as a coverer, regardless of acceptance state.                          | **Accept / Decline / Open**  |
| **My team**   | Every OOO event in my reporting tree (peers + direct & indirect reports under the same manager).    | **Open / Nudge requester**   |
| **Approvals** | Handovers awaiting **my** manager approval. *(Visible only when count > 0.)*                        | **Approve / Reject**         |
| **Drafts**    | Handovers I started but haven't submitted. *(Visible only when count > 0.)*                         | **Resume**                   |
| **All**       | Everything in my visible scope. Falls back to the full org for admins.                              | —                            |

### 3.1 Auto-lens (the smart bit)

On first mount with no `?lens=…` query param, pick the most actionable
lens for this user in this order:

1. **Approvals** (managers only) — if there are any pending approvals
2. **Covering me** — if there's a pending acceptance invitation
3. **Mine** — if any of my upcoming OOOs (next 14 d) lacks a handover
4. **My team** — managers default to this
5. **Mine** — everyone else defaults to this

The chosen lens is recorded in `localStorage` per-user so subsequent
visits remember the preference.

### 3.2 Counts on chips

Each chip shows a live count (e.g. *"Mine 2"*). Counts come from a single
`GET /api/v1/handovers/lens-counts` call cached for 30 s on the client.

---

## 4. View modes

### 4.1 Calendar mode (Gantt-style)

People × days grid.

- **Rows:** people in the current lens, alphabetised. Optional grouping
  toggle: *Flat · By team · By country.* Group header rows are
  collapsible.
- **Columns:** days. Range picker in the header: *This month*, *Next 30 d*,
  *Custom range.* Horizontal scroll for ranges > 31 days.
- **Bars** for each OOO range, colour-coded by handover state:
  | Colour | Meaning                                              |
  |--------|------------------------------------------------------|
  | 🟢 Green  | Handover **approved** or **active**                  |
  | 🟡 Amber  | Handover **submitted, pending** (acceptance or mgr)  |
  | 🔴 Red    | OOO with **no handover** (draft only counts as red)  |
  | ⚪ Slate  | OOO entirely in the past                              |
  | ⚫ Grey   | Cancelled / rejected (still rendered for audit recall)|

- **Today vertical line** + a soft band over the *next 7 d*.
- **Coverage-gap markers**: a small red dot on the day-header column for
  each day where ≥1 visible person is OOO without a handover. Lets a
  manager scan the date axis and spot holes.
- **Hover preview card**: name, dates, reason, coverer chips, status
  badge, country chips, "Open" CTA.
- **Click bar** → opens the **Detail slide-out** (§5) anchored to that
  handover, or the **Submit-Handover wizard** if the event has no
  handover yet.
- **Sticky person column** (frozen) + sticky day headers.
- **Density toggle**: compact (row h=28) vs. expanded (row h=44).
- **Empty state** (per lens): tasteful illustration + copy + next-action
  CTA. E.g. *Mine: "Nothing on the horizon — enjoy the focus. [Plan
  future OOO]"*.

### 4.2 Table mode

Virtualised rows. Columns:

| Person | Range | Days | Status | Coverer(s) | Countries | Updated | … |
|--------|-------|------|--------|------------|-----------|---------|---|

- Sortable by: start date (default), name, days, status, last-updated.
- Status column uses the same colour legend as Calendar bars + a pill
  label (e.g. *"Active · 3 d left"*).
- Row hover reveals quick actions (accept / decline / approve / open).
- Bulk-select checkbox column for managers: select N pending approvals →
  approve / reject in batch.
- Pinned "Action required" group at the top of the *Mine* and *Approvals*
  lenses so the must-do work is never below the fold.
- Same Detail slide-out on row click.

### 4.3 Mode toggle behaviour

- Switching modes preserves the current lens, filters, and date range.
- The toggle is a segmented control; defaults to **Calendar** on first
  visit, then sticky per-user via `localStorage`.

---

## 5. Detail slide-out (shared across modes)

Right-anchored panel mirroring the existing HR Hub / Leaders Alerts
detail panels. Opens on bar click or row click.

Sections, top to bottom:

1. **Header** — requester avatar + name, OOO window with day-of-week,
   status pill (colour-coded), reason chip.
2. **Coverers** — per-coverer row: avatar, name, country chips,
   acceptance state pill. Inline "Resend" / "Remove" / "Add another".
3. **Workspace merge preview** *(active only)* — live counts of what is
   currently merged into the coverer's workspace because of this
   handover: *+12 tickets · +3 onboardings · +2 breaches · +0
   amendments.*
4. **Checklist** — items grouped *Required / Optional*. Each item: a
   checkbox, label, optional inline note input, timestamp + author once
   complete. Progress bar at the top: *7 / 10 done.*
5. **Audit timeline** — reverse-chrono `handover_log` rendering, one row
   per event, with actor avatar + delta description.
6. **Actions footer** — context-aware buttons based on viewer role +
   handover state:
   - Requester in `draft`: [Save] [Submit for coverage]
   - Coverer in `pending_coverage_acceptance`: [Accept] [Decline]
   - Manager in `pending_manager_approval`: [Approve] [Reject]
   - Coverer in `active`: [Log handback]
   - Anyone with permission in any non-terminal: [Cancel]
   - Admin only: [Force-cancel]

The panel preserves URL state via `?handover=<id>` so it survives reloads
and is shareable.

---

## 6. Visibility & access

Visibility follows the existing reporting tree built by
`src/lib/queue-scoping.js`.

### 6.1 Read access (which rows show up)

- **Agent** — own handovers + handovers they cover + handovers in their
  team (peers under the same manager).
- **Team Lead** — every handover where requester is themselves or a
  direct report.
- **Regional Manager** — every handover in their region via
  `getAllReports(email)`.
- **Admin** — everything.

For **OOO Calendar events**, an event is visible if `work_email ∈
getVisibleEmails(user)`. Country owners do not auto-see OOO of people
outside their reporting chain — intentionally mirrors the queue scoping
behaviour the team already trusts.

### 6.2 Action gating

| Action                                       | Allowed by                                              |
|----------------------------------------------|---------------------------------------------------------|
| Create / edit / cancel own handover          | Requester (until terminal state)                        |
| Approve / reject                             | Requester's manager OR regional manager OR admin        |
| Accept / decline as coverer                  | Only the listed coverer                                 |
| Manage Settings (configs / templates / CSV)  | Admin, regional manager, or per-user **`is_handover_admin`** grant (new — mirrors `is_announcements_admin` / `is_hr_hub_admin` pattern) |
| Force-cancel another person's handover       | Admin only                                              |
| Audit export                                 | Admin only                                              |
| Bulk approve                                 | Manager / RM / admin                                    |

---

## 7. Data model

All new tables; nothing existing is destructively altered. Each goes into
`SCHEMA_SQL` in `src/lib/migrate.js` so it is created idempotently on
boot.

### 7.1 `time_off_events`

```sql
CREATE TABLE IF NOT EXISTS time_off_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_email      VARCHAR(255) NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,                 -- inclusive
  source          VARCHAR(20) NOT NULL DEFAULT 'csv', -- csv | deel_api | manual
  external_id     VARCHAR(255),                  -- Deel time-off id, nullable for CSV rows
  status          VARCHAR(20) NOT NULL DEFAULT 'approved', -- approved | pending | cancelled
  reason          VARCHAR(80),
  imported_batch  UUID,                          -- audit pointer
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_email, start_date, end_date, source)
);
CREATE INDEX idx_too_email   ON time_off_events(work_email);
CREATE INDEX idx_too_window  ON time_off_events(start_date, end_date);
CREATE INDEX idx_too_active  ON time_off_events(end_date) WHERE status = 'approved';
```

### 7.2 `time_off_import_batches`

```sql
CREATE TABLE IF NOT EXISTS time_off_import_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            VARCHAR(20) NOT NULL,        -- csv | deel_api
  filename          VARCHAR(500),
  uploaded_by_email VARCHAR(255),
  rows_total        INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_skipped      INTEGER NOT NULL DEFAULT 0,  -- already-existing duplicates
  rows_invalid      INTEGER NOT NULL DEFAULT 0,  -- date / email parse failures
  error_log         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.3 `handovers`

```sql
CREATE TABLE IF NOT EXISTS handovers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email           VARCHAR(255) NOT NULL,
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  time_off_event_id         UUID REFERENCES time_off_events(id) ON DELETE SET NULL,
  reason                    TEXT,
  status                    VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- draft | pending_coverage_acceptance | pending_manager_approval
    -- | approved | active | completed
    -- | rejected | cancelled | expired
  manager_email             VARCHAR(255),                -- denormalised at submit-time
  manager_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  manager_decision_at       TIMESTAMPTZ,
  manager_decision_note     TEXT,
  checklist_template_id     UUID,
  submitted_at              TIMESTAMPTZ,
  activated_at              TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  cancelled_by              VARCHAR(255),
  cancel_reason             TEXT,
  settings_id               UUID,                        -- which handover_settings row drove this
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_handover_requester ON handovers(requester_email, start_date);
CREATE INDEX idx_handover_manager   ON handovers(manager_email, status);
CREATE INDEX idx_handover_active    ON handovers(status, start_date, end_date)
  WHERE status IN ('approved','active');
CREATE INDEX idx_handover_event     ON handovers(time_off_event_id);
```

### 7.4 `handover_coverers`

```sql
CREATE TABLE IF NOT EXISTS handover_coverers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id        UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  coverer_email      VARCHAR(255) NOT NULL,
  country_codes      TEXT[] NOT NULL DEFAULT '{}'::text[],
    -- '{}'    = full coverage of the requester's countries
    -- '{ES}'  = covers only ES
  acceptance_status  VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  accepted_at        TIMESTAMPTZ,
  declined_at        TIMESTAMPTZ,
  decline_reason     TEXT,
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handover_id, coverer_email)
);
CREATE INDEX idx_hcover_email ON handover_coverers(coverer_email);
```

### 7.5 `handover_checklist_templates`

```sql
CREATE TABLE IF NOT EXISTS handover_checklist_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  scope             VARCHAR(20)  NOT NULL DEFAULT 'global', -- global | region | team
  scope_value       VARCHAR(100),
  items             JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- ordered array of { id, label, required, hint }
  is_default        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by_email  VARCHAR(255),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 7.6 `handover_checklist_items` (per-handover instance)

```sql
CREATE TABLE IF NOT EXISTS handover_checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id   UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  item_id       VARCHAR(80) NOT NULL,    -- stable key matching the template item.id
  label         TEXT NOT NULL,           -- snapshot at submit-time
  required      BOOLEAN NOT NULL DEFAULT TRUE,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  completed_at  TIMESTAMPTZ,
  completed_by  VARCHAR(255),
  UNIQUE (handover_id, item_id)
);
```

### 7.7 `handover_log`

```sql
CREATE TABLE IF NOT EXISTS handover_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id  UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  event_type   VARCHAR(40) NOT NULL,
    -- created | edited | submitted
    -- | coverer_invited | coverer_accepted | coverer_declined
    -- | coverer_added | coverer_removed
    -- | manager_approved | manager_rejected
    -- | activated | completed | extended | cancelled | expired | force_cancelled
    -- | checklist_item_completed | checklist_item_reopened
    -- | reminder_pre48h_sent | reminder_pre24h_sent | reminder_handback_sent
    -- | handback_logged | dates_drifted
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_handover_log_handover ON handover_log(handover_id, created_at);
```

### 7.8 `handover_handback`

```sql
CREATE TABLE IF NOT EXISTS handover_handback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id     UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  ack_email       VARCHAR(255) NOT NULL,
  summary         TEXT,
  open_items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handover_id, ack_email)
);
```

### 7.9 `handover_settings` (configuration presets)

```sql
CREATE TABLE IF NOT EXISTS handover_settings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        VARCHAR(200) NOT NULL,
  scope                       VARCHAR(20) NOT NULL DEFAULT 'global', -- global | region | team
  scope_value                 VARCHAR(100),
  reminder_48h_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_24h_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_handback_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  manager_approval_required   BOOLEAN NOT NULL DEFAULT TRUE,
  coverer_acceptance_required BOOLEAN NOT NULL DEFAULT TRUE,
  min_days_to_trigger         INTEGER NOT NULL DEFAULT 1,
  allow_country_split         BOOLEAN NOT NULL DEFAULT TRUE,
  default_template_id         UUID REFERENCES handover_checklist_templates(id) ON DELETE SET NULL,
  is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_handover_settings_scope ON handover_settings(scope, scope_value);
```

### 7.10 `time_off_reminders_sent` (idempotency ledger)

```sql
CREATE TABLE IF NOT EXISTS time_off_reminders_sent (
  time_off_event_id UUID NOT NULL REFERENCES time_off_events(id) ON DELETE CASCADE,
  reminder_type     VARCHAR(20) NOT NULL, -- pre_48h | pre_24h | handback_due
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (time_off_event_id, reminder_type)
);
```

### 7.11 Per-user grant column

```sql
ALTER TABLE team_member_overrides
  ADD COLUMN IF NOT EXISTS is_handover_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_handover_admin
  ON team_member_overrides(is_handover_admin) WHERE is_handover_admin = true;
```

### 7.12 Boot-wipe alarm

Append `'time_off_events'` and `'handovers'` to `WIPE_ALARM_TABLES` in
`instrumentation.js`. A silent wipe of either will scream in pod logs.

### 7.13 Legacy `on_leave` column

`team_member_overrides.on_leave` is the manual toggle the Team page
currently uses. After Phase 1 lands, the UI derives on-leave from
`time_off_events` and stops reading the column. The column itself stays
(no destructive drop) so any operator scripts that touch it still work;
a follow-up PR after a 30-day deprecation window removes the column and
the toggle UI.

### 7.14 CSV seed

A new `src/lib/time-off-seed.js` runs at boot, gated on a
`TIME_OFF_SEED_VERSION` marker in `app_settings` (same pattern as
`seedCountryOwnersIfEmpty`):

1. Copy the CSV into `data/seed/hrx_time_off_2026_05_11.csv` in the repo.
2. On first boot of a fresh env (or when `TIME_OFF_SEED_VERSION` bumps):
   parse the CSV, normalise dates (`"May 26, 2026"` → `'2026-05-26'`),
   lowercase emails, batch-insert with `ON CONFLICT DO NOTHING`.
3. Subsequent boots: skip.

The CSV path is the bootstrap. Day-to-day, the *Sync from Deel API*
admin button (§17) replaces it.

---

## 8. State machine

```
                          ┌──────────────┐
                          │    draft     │
                          └─────┬────────┘
                                │ submit
                                ▼
                  ┌────────────────────────────────┐
                  │ pending_coverage_acceptance    │
                  └────┬────────────────────┬──────┘
                       │ all accept          │ any decline
                       ▼                     ▼
       (settings.manager_approval_required ? )   requester re-edits
                       │
              yes ┌────┴────┐ no
                  ▼         ▼
        ┌──────────────────────────┐
        │ pending_manager_approval │
        └────┬─────────────────────┘
             │ approve            │ reject
             ▼                    ▼
        ┌────────┐            ┌──────────┐
        │approved│            │ rejected │  (terminal)
        └───┬────┘            └──────────┘
            │ start_date ≤ today  (lifecycle cron)
            ▼
        ┌────────┐
        │ active │
        └───┬────┘
            │ end_date < today AND handback ack received
            ▼
        ┌────────────┐
        │ completed  │  (terminal)
        └────────────┘

Any non-terminal → cancelled (terminal) via requester / manager / admin.
Any approved/active without handback after end_date + 14 d → expired (terminal).
```

The lifecycle cron (§11.4) is the only writer of `active`, `completed`,
and `expired`. Everything else is user-driven.

---

## 9. APIs

All routes under `app/api/v1/`. Every route validates the session via
`getAuthUser(req)` (returns 401 on missing JWT) and scopes reads/writes
via `getVisibleEmails` / `getVisibleCountries` / explicit role checks.

### 9.1 Handovers

| Method | Path                                              | Purpose                                              |
|--------|---------------------------------------------------|------------------------------------------------------|
| GET    | `/handovers?lens=…&from=&to=&status=`             | List handovers for the chosen lens                   |
| GET    | `/handovers/lens-counts`                          | Counts per lens for chip badges                      |
| GET    | `/handovers/:id`                                  | Full detail incl. coverers, checklist, log           |
| POST   | `/handovers`                                      | Create draft                                         |
| PATCH  | `/handovers/:id`                                  | Edit (allowed in `draft`, `pending_*`)               |
| DELETE | `/handovers/:id`                                  | Requester only, in `draft`                           |
| POST   | `/handovers/:id/submit`                           | draft → pending_coverage_acceptance                  |
| POST   | `/handovers/:id/accept`                           | Coverer accepts                                      |
| POST   | `/handovers/:id/decline`                          | Coverer declines (body: reason)                      |
| POST   | `/handovers/:id/approve`                          | Manager approves                                     |
| POST   | `/handovers/:id/reject`                           | Manager rejects (body: reason)                       |
| POST   | `/handovers/:id/cancel`                           | Requester / manager / admin                          |
| POST   | `/handovers/:id/handback`                         | Coverer logs handback summary                        |
| PATCH  | `/handovers/:id/checklist/:item_id`               | Toggle item complete (body: { completed, note })     |
| POST   | `/handovers/bulk/approve`                         | Manager bulk approve (body: { ids: [] })             |
| POST   | `/handovers/bulk/reject`                          | Manager bulk reject                                  |
| GET    | `/handovers/:id/audit-trail`                      | Full `handover_log` for audit                        |
| GET    | `/handovers/audit-export?from=&to=&format=csv`    | Admin CSV export                                     |

### 9.2 Time-off events

| Method | Path                                  | Purpose                                              |
|--------|---------------------------------------|------------------------------------------------------|
| GET    | `/time-off-events?lens=…&from=&to=`   | Calendar / table data — visible-scope events         |
| GET    | `/time-off-events/me`                 | Just my events                                       |
| GET    | `/time-off-events/coverage-gaps?from=&to=` | Returns event ids in the window with no submitted handover, for manager dashboards |
| POST   | `/time-off-events/import`             | Admin CSV upload (multipart)                         |
| POST   | `/time-off-events/sync-deel`          | Admin: pull from Deel API into events table          |

### 9.3 Settings

| Method | Path                                       | Purpose            |
|--------|--------------------------------------------|--------------------|
| GET    | `/handover-settings`                       | List configurations|
| POST   | `/handover-settings`                       | Admin create       |
| PATCH  | `/handover-settings/:id`                   | Admin edit         |
| DELETE | `/handover-settings/:id`                   | Admin delete       |
| GET    | `/handover-checklist-templates`            | List templates     |
| POST   | `/handover-checklist-templates`            | Admin create       |
| PATCH  | `/handover-checklist-templates/:id`        | Admin edit         |
| DELETE | `/handover-checklist-templates/:id`        | Admin delete       |

### 9.4 Cron

Both protected by `Authorization: Bearer ${CRON_SECRET}` (new env).

| Method | Path                            | Cadence    | Effect                                                                                          |
|--------|---------------------------------|------------|-------------------------------------------------------------------------------------------------|
| POST   | `/handovers/cron/reminders`     | every 15 m | Fires 48 h & 24 h reminders for events without a submitted handover (idempotent via ledger).    |
| POST   | `/handovers/cron/lifecycle`     | every 15 m | Flips `approved → active`, `active → completed`, `approved/active → expired`; refreshes cache.  |

Phase 4 ships both endpoints, the `CRON_SECRET` wiring, a
`helm/templates/cronjob-handovers.yaml` Kubernetes CronJob that curls
them, and a `scripts/run-handover-cron.mjs` for local dev.

---

## 10. Workspace merge — the killer feature

While a handover is `active`, the coverer should see the OOO person's
queues, counts, breaches **merged into their own totals** — as if two
people became one.

### 10.1 Mechanism

Extend `src/lib/queue-scoping.js`:

1. Add `getActiveHandoverDelegations(covererEmail)` — sync getter backed
   by an in-memory cache:
   `Map<covererEmail, Array<{ requesterEmail, countries:Set<CC> }>>`.
2. The cache is loaded at boot from one query:

   ```sql
   SELECT hc.coverer_email,
          h.requester_email,
          hc.country_codes
     FROM handover_coverers hc
     JOIN handovers h ON h.id = hc.handover_id
    WHERE h.status = 'active'
      AND hc.acceptance_status = 'accepted'
      AND h.start_date <= CURRENT_DATE
      AND h.end_date   >= CURRENT_DATE;
   ```

3. Refresh triggers:
   - Any API write that mutates `handovers` / `handover_coverers` calls
     `invalidateHandoverCache()` (local invalidation).
   - The lifecycle cron tick refreshes the cache at the end.
   - A safety 60 s TTL handles multi-pod stale-cache risk without
     needing `pg_notify` infra.
4. Patch `getVisibleEmails(user)`:
   ```js
   const base = ...; // existing logic
   for (const d of getActiveHandoverDelegations(user.email)) {
     base.add(d.requesterEmail);
   }
   return base;
   ```
5. Patch `getVisibleCountries(user)` similarly: for each delegation, if
   `d.countries.size === 0` (full coverage) add **all** of
   `OWNER_COUNTRIES.get(requesterEmail)`; otherwise add only
   `d.countries`.

### 10.2 Consequences (intentional)

- Every consumer of `getVisibleEmails` / `getVisibleCountries` — every
  scope helper, every Queue page, every Briefing aggregate — sees the
  merged scope **without further code changes**.
- Team Summary in `BriefingView.jsx` counts the coverer's totals
  *including* the OOO person's tickets and breaches.
- Workbench / Queue lists show the OOO person's rows alongside the
  coverer's own.
- The "Coverage" preview on the OOO detail panel surfaces exact merge
  counts via `/api/v1/handovers/:id/coverage-stats`.

### 10.3 Banner

A thin info banner appears on `BriefingView.jsx` and `Queue.jsx` for the
duration of any active handover the user is covering:

> *Covering Sofia López (May 5 → May 8). Her workspace is merged with
> yours; queues, breaches, and totals now include her work. [View
> handover]*

Dismissable per-session; reappears next mount until the handover ends.

### 10.4 Un-merge

The lifecycle cron flips `active → completed`. Next render the merge is
gone. Coverer sees a one-time toast: *"Sofia is back. Workspace returned
to normal."* — driven by the `handover_completed` notification.

---

## 11. Reminders & lifecycle

### 11.1 48 h pre-OOO (requester only)

- **Trigger:** a `time_off_events` row with `start_date` between **47 h
  and 49 h from now**, status `approved`, AND no `handovers` row with
  `time_off_event_id = …` AND `status NOT IN ('draft','cancelled','rejected')`.
- **Action:** insert a `user_notifications` row of type
  `handover_pre48h_reminder` for `work_email`. Mark `(event, pre_48h)` in
  `time_off_reminders_sent`.
- **Settings gate:** the matching `handover_settings.reminder_48h_enabled`
  must be `true`.

### 11.2 24 h pre-OOO (requester + manager alert)

- **Trigger:** same check, window **23 h–25 h**.
- **Action:** two notifications — `handover_pre24h_alert` for the
  requester, `handover_pre24h_manager_alert` for the manager (looked up
  via `team_member_overrides.manager_email`). Mark `(event, pre_24h)`.

### 11.3 Return-day reminder (coverer)

- **Trigger:** a handover with `status='active'` whose `end_date = today`.
- **Action:** `handover_handback_due` to each coverer. Idempotent via
  `(time_off_event_id, handback_due)` in the ledger.

### 11.4 Lifecycle cron

- `approved` rows with `start_date ≤ today` → `active`. Log
  `activated`. Notify requester + coverers. Refresh cache.
- `active` rows with `end_date < today` AND a `handover_handback` row
  exists → `completed`. Log `completed`. Notify scope. Refresh cache.
- `approved/active` rows with `end_date + 14 d < today` AND no handback
  → `expired`. Log `expired`. Notify manager.

---

## 12. UI specifications (detail)

### 12.1 OOOView.jsx — layout

```
<div class="ooo-view">
  <Header>
    Title + cog + [+ New handover]
    <ModeToggle value={mode} onChange={setMode} options={['calendar','table']}/>
    <LensChips lens={lens} counts={counts} onChange={setLens}/>
    <Filters search country status missingHandover/>
    <ActionBanner items={actionItems}/>
  </Header>
  <Body>
    {mode === 'calendar' ? <CalendarMode /> : <TableMode />}
  </Body>
  <DetailSlideOut handoverId={routeHandoverId}/>
  <CreateHandoverModal open={…}/>
</div>
```

### 12.2 CalendarMode component

- Built on a virtualised grid (custom — Tailwind grid + CSS subgrid for
  alignment). No new dependency.
- Sticky person column (frozen first column, `position: sticky; left: 0`).
- Day-header row uses sticky `top: 0` within the scroll container.
- Bars are absolutely positioned over their day cells; click handler on
  the bar opens the detail or wizard.
- Hover preview is a portal-rendered card pinned above the bar with a
  150 ms intent delay.
- Group toggle changes the row order + injects collapsible group header
  rows.

### 12.3 TableMode component

- Reuses the same row chrome as Queue / Workbench tables for
  consistency (`SourceTable.jsx` style).
- Virtualised via `useVirtualRows`.
- Bulk-action toolbar slides down from the header when any rows are
  selected. Toolbar buttons gated by role.

### 12.4 LensChips component

```jsx
<div role="tablist" aria-label="OOO views">
  {lenses.map(l => (
    <button role="tab" aria-selected={lens === l.id}>
      {l.label}{l.count > 0 && <span class="count">{l.count}</span>}
    </button>
  ))}
</div>
```

Empty-state lenses (Approvals, Drafts) hide themselves when count = 0.

### 12.5 ActionBanner component

Top-of-view banner that surfaces the single most actionable item:

- *"You have 2 upcoming OOO without a handover. [Submit handover]"*
- *"3 handovers are awaiting your approval. [Review]"*
- *"1 coverage invitation needs your response. [Open]"*

Dismissable per-session, recomputed on every mount.

### 12.6 CreateHandoverModal — 4-step wizard

| Step           | Content                                                                                          |
|----------------|--------------------------------------------------------------------------------------------------|
| 1. **Dates**   | Pick a `time_off_event` if one exists (preselected from the row that triggered the wizard), or enter custom dates. Reason dropdown.       |
| 2. **Coverers**| Multi-select people-picker (typeahead from MEMBERS, gated to people in roles that can see the requester's country). Per-coverer: optional country-split via `MultiCountryPicker.jsx`. Live validation: union of coverer countries must cover the requester's full set or warn. Block self-cover. Warn if coverer is themselves OOO during the cover window. |
| 3. **Checklist**| Pre-filled from the resolved `handover_settings.default_template_id`. Add/remove items. Mark required vs optional. Inline notes per item. |
| 4. **Review**  | Summary card with all decisions, then [Save draft] or [Submit].                                  |

Validation per-step + final. Submit performs:

- `POST /handovers` if id is null
- `PATCH /handovers/:id` if reopening a draft
- `POST /handovers/:id/submit`

The wizard exposes `?event=<time_off_event_id>` deep link so a
notification CTA can open it preselected.

### 12.7 OOOBadge utility component

A tiny shared component used wherever an avatar or name renders:

- Today is inside an OOO range → small calendar-x glyph overlay on the
  avatar **or** dated pill next to the name: *"OOO May 5 → May 8 ·
  Covered by Pedro R."*
- Tooltip lists coverer(s) when present.
- Used in:
  - `Avatar.jsx` (overlay ring + tooltip)
  - `Team.jsx` row (dated pill)
  - Queue / Workspace assignee chip
  - Briefing Team Summary
  - HR Hub / Leaders Hub assignee chips

### 12.8 Briefing "Coverage" card

When the viewer has any active coverages, append a "Coverage" card under
their PersonalChecklist:

```
┌─────────────────────────────────────────────────────┐
│  Coverage                                            │
│                                                      │
│  Sofia López · May 5 → May 8                         │
│  ES, PT · +12 tickets · +3 onboardings · +2 breaches │
│  [Open handover]                                     │
└─────────────────────────────────────────────────────┘
```

Live counts via `/handovers/:id/coverage-stats`.

---

## 13. Notifications taxonomy

All notifications go through the existing `user_notifications` table.
New `type` values:

| Type                                  | Recipient                  | When                                                   |
|---------------------------------------|----------------------------|--------------------------------------------------------|
| `handover_coverage_invited`           | each coverer               | submit                                                 |
| `handover_coverer_accepted`           | requester                  | per coverer accept                                     |
| `handover_coverer_declined`           | requester + manager        | per coverer decline                                    |
| `handover_pending_approval`           | manager                    | last coverer accepted (if approval required)           |
| `handover_approved`                   | requester + each coverer   | manager approve                                        |
| `handover_rejected`                   | requester                  | manager reject                                         |
| `handover_starting_tomorrow`          | coverer(s)                 | 24 h before start_date (lifecycle cron)                |
| `handover_active`                     | requester + coverers       | flip to `active`                                       |
| `handover_handback_due`               | coverer                    | end_date today                                         |
| `handover_completed`                  | requester + coverers       | flip to `completed`                                    |
| `handover_pre48h_reminder`            | OOO person                 | 48 h before start_date AND no handover submitted       |
| `handover_pre24h_alert`               | OOO person                 | 24 h before start_date AND no handover submitted       |
| `handover_pre24h_manager_alert`       | manager                    | same as above                                          |
| `handover_cancelled`                  | requester + coverers + mgr | cancel                                                 |
| `handover_expired`                    | manager                    | expired terminal                                       |
| `handover_dates_drifted`              | requester + coverers       | a CSV re-import changed the OOO dates on a submitted handover |

`link_view` = `'ooo'`. `link_id` = handover id, or the `time_off_event_id`
+ `?action=create` synthetic deep link for pre-handover reminders so the
CTA opens the wizard preselected.

---

## 14. Audit & observability

| Mechanism                           | Where                                                              |
|-------------------------------------|--------------------------------------------------------------------|
| Per-handover state log              | `handover_log` table                                               |
| Per-CSV-import provenance           | `time_off_import_batches` table                                    |
| Boot-wipe alarm                     | Append `time_off_events`, `handovers` to `WIPE_ALARM_TABLES`       |
| Admin audit export                  | `GET /handovers/audit-export?from=&to=&format=csv`                 |
| Reminder idempotency                | `time_off_reminders_sent` ledger                                   |
| Workspace-merge visibility          | Banner in `BriefingView.jsx` + Coverage card + Detail merge preview|
| Server logs                         | Every state transition logs `[handovers] event=… handover=… actor=…`|
| Per-handover audit endpoint         | `GET /handovers/:id/audit-trail` returns full timeline             |

`handover_log` is **never auto-pruned**. Retention is a manual admin
decision.

---

## 15. Performance & concurrency

- **Calendar query:** restricted to the user's `getVisibleEmails(user)`
  AND `[from, to]` window. With the `idx_too_email` + `idx_too_window`
  indexes, this is a small range scan even at 100 k events.
- **Cache:** `getActiveHandoverDelegations` cache is keyed by coverer
  email and refreshed via local invalidation on writes; 60 s TTL caps
  cross-pod staleness without needing `pg_notify`.
- **Concurrency:** every handover write uses `withTransaction` so the
  handover row + coverer rows + checklist instance rows + log entry land
  atomically. A unique constraint on `(handover_id, coverer_email)` plus
  `(handover_id, item_id)` prevents accidental duplicates under retries.
- **Bulk approvals** execute in a single transaction per request; on
  partial failure the whole batch rolls back and surfaces row-level
  errors to the FE.

---

## 16. Edge cases & guardrails

- **Self-cover blocked**: requester can't list themselves as a coverer.
- **Overlap warning**: if a candidate coverer is themselves OOO during
  the cover window, surface a warning (not a hard block — allows back-up
  chains during peak holidays).
- **Coverer departure**: if a coverer leaves the company (account
  removed) while a handover is approved/active, log
  `coverer_unavailable` and notify the requester + manager to amend.
- **Manager change mid-flight**: if the requester's manager changes
  while the handover is pending approval, look up the new manager on
  approval click rather than trusting the denormalised
  `manager_email`. (Background reconcile happens on lifecycle cron.)
- **Dates drift**: if a CSV re-import or Deel sync changes the
  underlying time-off event's dates, fire `handover_dates_drifted` and
  add an inline "Dates changed — confirm or update" banner on the
  detail panel.
- **Duplicate event** prevention: `UNIQUE (work_email, start_date,
  end_date, source)` on `time_off_events`. CSV reupload of the same
  rows results in `rows_skipped` not duplicates.
- **Invalid CSV input**: malformed rows are skipped with an entry in
  `time_off_import_batches.error_log`. The batch finishes regardless.
- **Cross-day boundary**: all `start_date`/`end_date` are inclusive
  date-only. Lifecycle decisions use the server's current calendar date
  in UTC. The CSV is treated as inclusive ranges.
- **Two overlapping handovers** by the same requester: blocked at
  submit time with a clear error. Drafts may overlap freely.
- **Approval after expiry**: if a manager opens the page hours after a
  handover already expired, the approve button is greyed out with a
  hover explainer.
- **Force-cancel** by admin always works and writes
  `force_cancelled` to the log with reason.
- **Read-after-write**: handover create returns the full hydrated
  object so the FE can render the detail panel without a round-trip.

---

## 17. Settings — in SettingsView, not in OOO tab

Per the rework, there are no sub-tabs in OOO. The configuration UI
lives in `SettingsView.jsx` under a new top-level **Handovers** section,
visible to admin / regional manager / `is_handover_admin`. The cog in
the OOO header deep-links here.

Three cards inside the section:

1. **Configurations** — table of `handover_settings`. Inline-edit
   booleans + `min_days_to_trigger`. "Set as default" toggle. Scope
   picker (Global / Region / Team). Resolution rule when multiple match:
   *team scope* > *region scope* > *global default*.
2. **Checklist templates** — list of `handover_checklist_templates` with
   an item editor: drag-reorder, required toggle, optional hint per
   item. One template can be marked the default for a scope.
3. **Time-off events** — CSV uploader with row-count preview + dedupe
   stats. **Sync from Deel API** button visible when `isDeelConfigured()`.
   Last 5 import batches table for audit.

---

## 18. Execution phases

Each phase = one PR opened against `dev`. Phases sized to ship and
verify independently per the existing Nexus deploy flow (feature branch
→ PR to dev → user clicks Deploy Now).

### Phase 1 — Foundation (schema + CSV ingest + OOO surface read-only)

- Schema: all 10 tables + `is_handover_admin` column + boot-wipe entries.
- Copy CSV into `data/seed/hrx_time_off_2026_05_11.csv`.
- `src/lib/time-off-seed.js` (version-marker pattern).
- `src/lib/handover-helpers.js` (parsers, scope helpers, state-machine
  contract).
- `src/services/handoversApi.js` + `src/services/timeOffApi.js`.
- API routes: `/time-off-events` + `/handovers/lens-counts`.
- Primary nav tab **OOO** (`bi-airplane`) + `src/components/views/OOOView.jsx`.
- Header (mode toggle + lens chips + filters + action banner) wired to
  read-only data.
- **CalendarMode** + **TableMode** rendering events + handover-status
  badges (no writes yet).
- `OOOBadge` utility integrated into `Avatar.jsx` and `Team.jsx`.
- Detail slide-out in read-only mode.

**Phase 1 ships:** anyone lands on OOO, picks Calendar or Table,
switches lenses, and sees every OOO range with its handover status —
including a clear "Missing handover" red bar. No writes possible yet,
but the surface is fully navigable and managers can already audit
coverage gaps from the calendar.

### Phase 2 — Handover core (write path)

- API routes for handovers CRUD + submit / accept / decline / approve /
  reject / cancel.
- `CreateHandoverModal.jsx` 4-step wizard.
- Detail slide-out gains the actions footer (approve, accept, etc.) +
  checklist editor.
- In-app notifications wired for every type listed in §13 *except*
  reminders & lifecycle.

**Phase 2 ships:** end-to-end create → coverer accept → manager approve
→ handover sitting in `approved`.

### Phase 3 — Workspace merge

- In-memory delegation cache in `queue-scoping.js`.
- Patch `getVisibleEmails` / `getVisibleCountries`.
- Banner in `BriefingView.jsx` + `Queue.jsx`.
- Briefing **Coverage** card.
- Detail panel's merge-preview counts via
  `/handovers/:id/coverage-stats`.
- Verify Team Summary counts merge correctly.

**Phase 3 ships:** while a handover is `active`, the coverer's whole app
shows the merged scope.

### Phase 4 — Reminders + lifecycle cron

- Cron routes `/handovers/cron/reminders` + `/handovers/cron/lifecycle`.
- `time_off_reminders_sent` table populated.
- `CRON_SECRET` env wiring + helm CronJob manifest.
- `scripts/run-handover-cron.mjs` for local dev.
- Reminder + activation + completion notifications.

**Phase 4 ships:** automatic notifications + state transitions without
human intervention. From this point on, the system is self-driving.

### Phase 5 — Settings, templates, handback, audit export, polish

- **Handovers** section in `SettingsView.jsx` with three cards
  (configurations, templates, CSV import).
- Checklist template editor (drag-reorder, required toggle).
- CSV reimport UI hitting `/time-off-events/import` with the multipart
  endpoint + dedupe stats.
- Handback summary form + `handover_handback` writes + un-merge UX.
- `/handovers/audit-export` endpoint + admin export button.
- Bulk approve / reject in Table mode.
- Polish pass: empty states per lens, loading skeletons, keyboard nav,
  responsive breakpoints, dark-mode parity, telemetry log lines.

**Phase 5 ships:** product is fully self-service. Admins configure
everything, audit anything, and the experience is polished end-to-end.

---

## 19. Post-launch audit checklist

```
[ ] Schema present (\dt):
    time_off_events
    time_off_import_batches
    time_off_reminders_sent
    handovers
    handover_coverers
    handover_checklist_templates
    handover_checklist_items
    handover_log
    handover_handback
    handover_settings
    team_member_overrides.is_handover_admin column

[ ] Seed:
    SELECT count(*) FROM time_off_events;  ≈ CSV row count (≤ 1245)
    Versioned marker present in app_settings

[ ] Boot-wipe alarm covers time_off_events + handovers

[ ] Visibility:
    [ ] Agent sees OOO tab, lens defaults to Mine (or Covering me / Approvals if applicable)
    [ ] Agent's calendar shows only their reporting tree
    [ ] Team Lead sees their direct reports' handovers under "My team"
    [ ] Regional manager sees their region's handovers
    [ ] Admin sees all on the All lens

[ ] Single-tab UI:
    [ ] No sub-tabs anywhere in the OOO view
    [ ] Mode toggle persists per-user
    [ ] Lens chips show live counts; empty-count lenses hide themselves
    [ ] URL state (?mode, ?lens, ?from, ?to, ?handover) round-trips on reload
    [ ] Action banner surfaces the single most actionable item

[ ] Calendar mode:
    [ ] Bars correctly colour-coded (green / amber / red / slate / grey)
    [ ] Coverage-gap markers on day headers
    [ ] Sticky person column + sticky day headers behave on scroll
    [ ] Hover preview opens after 150 ms intent delay
    [ ] Click bar opens detail or wizard preselected

[ ] Table mode:
    [ ] Sortable by all 5 columns
    [ ] Bulk approve / reject works and is transactional
    [ ] Pinned "Action required" rows appear at the top of Mine + Approvals

[ ] Create wizard:
    [ ] Dates step preselects a matching time_off_event
    [ ] Coverer step blocks self-cover
    [ ] Coverer step warns when coverer is themselves OOO in the window
    [ ] Country split is optional; full coverage when array is empty
    [ ] Checklist step pre-fills from the resolved default template
    [ ] Submit writes 1 handover + N coverer + M checklist items + 1 log entry atomically

[ ] State machine:
    [ ] Submit → pending_coverage_acceptance
    [ ] All coverers accept → pending_manager_approval (or approved if not required)
    [ ] Manager approve → approved
    [ ] Lifecycle cron flips approved → active at start_date
    [ ] Handback ack + end_date passed → completed
    [ ] Cancel from any non-terminal → cancelled
    [ ] Expired path triggers after 14 d grace with no handback
    [ ] Two overlapping submitted handovers by same requester are blocked

[ ] Workspace merge:
    [ ] Active coverer's Briefing Team Summary counts include OOO person's open + paused + breaches
    [ ] Workspace queues show OOO person's tickets, onboarding, amendments
    [ ] Banner present and dismissable
    [ ] Coverage card shows live counts
    [ ] After completion, scope returns to coverer-only within 1 cron tick
    [ ] Cache invalidates correctly on every handover write

[ ] Reminders:
    [ ] 48 h notification arrives for OOO person without a handover
    [ ] 24 h alert reaches both OOO person AND manager
    [ ] No duplicate reminders across multiple cron ticks (idempotency ledger)
    [ ] Handback-due notification on return day
    [ ] reminder_*_enabled flags in settings actually gate reminders

[ ] OOO indicators:
    [ ] Team table shows dated pill next to OOO names
    [ ] Avatar badge appears in Queue, Workspace, Briefing, HR Hub, Leaders Hub
    [ ] Tooltip lists coverer(s)

[ ] Settings:
    [ ] Admin can create / edit / delete configurations
    [ ] Admin can create / edit / delete checklist templates
    [ ] CSV re-import dedupes via UNIQUE constraint (rows_skipped > 0 on re-upload)
    [ ] Sync from Deel API populates rows with source='deel_api' and external_id set
    [ ] is_handover_admin grant lets a non-admin manage Settings
    [ ] Cog in OOO header deep-links to the Handovers section

[ ] Audit:
    [ ] handover_log has rows for every transition for every handover
    [ ] /handovers/:id/audit-trail returns full timeline
    [ ] CSV audit export downloads for a date range
    [ ] handover_log is never auto-pruned

[ ] Security:
    [ ] All routes require auth; 401 without JWT
    [ ] An agent cannot approve their own handover
    [ ] An agent cannot read a handover outside their tree
    [ ] An agent cannot accept on behalf of another coverer
    [ ] Cron routes require CRON_SECRET; 403 without
    [ ] CSV upload only accepts CSV mime type and trims to ≤ 5 MB
    [ ] All user-supplied strings are bound-parameterised, never interpolated

[ ] Edge cases:
    [ ] Self-cover blocked at the API
    [ ] Coverer OOO during cover window surfaces a warning, not a block
    [ ] Coverer account removal logs coverer_unavailable
    [ ] Manager change mid-flight re-resolves on approval click
    [ ] Dates drift after CSV reimport fires handover_dates_drifted
    [ ] Force-cancel by admin always succeeds with reason recorded

[ ] Performance:
    [ ] Calendar API responds in < 200 ms for a 30-day window at 1k events
    [ ] Lens-counts API responds in < 100 ms
    [ ] Bulk approve of 20 handovers completes in a single transaction
```

---

## 20. Decisions locked

1. **OOO as primary nav tab.** ✅
2. **In-app notifications only for v1.** Slack / WhatsApp / email is a
   v2 add-on once the core is stable. ✅
3. **Per-country split is optional.** Default = full coverage; the
   country picker is exposed per-coverer in the wizard. ✅
4. **48 h / 24 h reminder defaults.** Configurable per
   `handover_settings` row; those are the seeded defaults. ✅

---

## 21. Out of scope (v1)

- Slack / WhatsApp / email channels (in-app only)
- Auto-routing of newly assigned tickets to the coverer in
  Zendesk / Jira / Workbench (we don't rewrite source-of-truth
  assignment; the merge happens via scope, not via reassignment)
- Bulk handover for a whole team going OOO together (a single
  multi-handover wizard)
- Mobile-first UI optimisation — works at 1024 px+, mobile is a v2
  polish (the responsive collapse to "list of weeks" is the v2 work)
- Integration with the Deel HRX time-off approval flow *as approver*
  (we consume approved events; the approval itself stays in Deel admin)
- Long-term reminder pruning beyond 90 days (retention is a manual
  decision for now)
