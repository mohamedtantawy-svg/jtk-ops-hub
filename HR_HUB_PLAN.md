# HR Hub — Project Plan & Living Spec

> **Status:** Stage 0 in progress.
> **Owner:** mohamed.tantawy@deel.com.
> **Started:** 2026-05-02.

---

## Maintenance protocol — read first

This is the single source of truth for the HR Hub. Whoever (human or assistant)
adds, changes, or removes anything in the HR Hub must keep this doc in sync.
Specifically:

1. **New rule** (UX, behavior, permission, performance) → append it to
   "Strict rules" with a date and a one-line rationale.
2. **New connection to another tab** (sidebar, header `+` button, deep link,
   shared component, shared API) → append it to "Connections to other tabs"
   and note the direction of the connection.
3. **New decision** (status lifecycle, field map, dropdown options, role
   model) → append to "Decisions log" with date and rationale; do not
   silently overwrite earlier entries.
4. **Stage progress** — tick the verification checkboxes as work lands. Do
   not delete unchecked items; cross out (`~~strikethrough~~`) and add a
   note if a check is intentionally skipped.
5. **Things that must NOT break** — this list grows when we discover a
   regression risk. Never shrink it without explicit user sign-off.

This doc lives at `HR_HUB_PLAN.md` in the repo root. Move it only with a
search-and-replace pass on every reference.

---

## Goals

Build a single tab that consolidates four request flows currently scattered
across Slack workflows and the existing Feedback tab:

- **HR Request** — operational requests that need GM/MOC actioning
  (countersign EA, deposit increase, cancel offboarding, etc.)
- **HR Reporting** — bugs, escalations, mass events, quality issues
- **Escalation Zero** — strategic improvement / process feedback
- **Ops Hub Feedback** — feedback on the Ops Hub app itself (existing
  tab, will be merged in)

---

## Strict rules

These are non-negotiable. Every code change must respect them. Add new
rules with a date and rationale; do not remove rules without explicit
user sign-off.

| # | Rule | Added | Notes |
|---|------|-------|-------|
| 1 | Every authenticated user has full access to the HR Hub tab (read + write). | 2026-05-01 | Edit-the-schema actions are gated by the `HR Hub Admin` access type (see Decisions log). |
| 2 | Default scope toggle = `My Requests` / `All Requests` (mirrors Feedback tab). | 2026-05-01 | |
| 3 | The plan doc and tab must capture every connection to other tabs. | 2026-05-01 | See "Connections to other tabs" below. |
| 4 | DB + BE wiring must guarantee zero data loss and fast loads. | 2026-05-01 | Migration is idempotent; reads use indexes covering hot-path queries. |
| 5 | Managers (TL / RM) get a third middle toggle: `Team Requests`. | 2026-05-01 | Roles read from existing `team-directory` / `roster-server`. |
| 6 | Comments / messaging / replies behave like Slack and feel instant. | 2026-05-01 | Polling first; upgrade to SSE/WebSocket if latency >5s p95 for active threads. |
| 7 | Smart loading at scale (~200 requests/day + comments + screenshots). | 2026-05-01 | Cursor pagination, lazy attachments, virtualized scroll. |
| 8 | Status updates and new comments notify requester + handler with deep link and in-app popup preview. | 2026-05-01 | Reuse + upgrade the existing notification bell. |
| 9 | Every request has a complete log (every state change, every comment, every follower). | 2026-05-01 | `hr_hub_log` table; one entry per state-changing call. |
| 10 | UI must stay simple. | 2026-05-01 | Final pass with user before each stage closes. |
| 11 | Comments and request body use comfortable font size and support emoji. | 2026-05-01 | ≥14px composer, emoji picker. |
| 12 | `@`-tagging adds the tagged user as a follower; followers receive notifications. | 2026-05-01 | Followers are de-duplicated; "tagged" is one of the source values. |

---

## The 4 flows

### HR Request — operational requests
Mirrors the Slack `HRX Request` workflow.

| Field | Type | Required | Notes |
|---|---|---|---|
| Related Function | dropdown | yes | Onboarding · Amendments · Termination · Resignation · Country Specific · Collaboration with Teams · Looker |
| Request Type | cascading dropdown | yes | Options depend on Related Function (see Slack workflow doc for full mapping) |
| Summary | rich text | yes | |
| Relevant Links | URL list | no | Deel admin / Zendesk / Jira / Slack thread |
| Attachments | files | no | Optional during create, also addable in comments |

### HR Reporting — bugs, escalations, mass events
Mirrors the Slack `HR Reporting` workflow.

| Field | Type | Required | Notes |
|---|---|---|---|
| Report Type | dropdown | yes | Bug · Escalation · Quality Issue · Collaboration · Mass Onboarding · Mass Off-boarding · Urgent Termination Follow-up · Other |
| Related Function | dropdown | yes | Onboarding · Amendments · Termination · Resignation · Workbench · Redlines · Zendesk · Benefits · Data · Suspicious Amendment · Collaboration |
| Link | URL | no (yes in practice) | |
| Report Summary | rich text | yes | |
| `cc` | user mention | auto | Submitter's manager from `team-directory` |
| Attachments | files | no | |

### Escalation Zero — strategic improvements
Mirrors the Slack `HRX Project Escalation Zero` workflow.

| Field | Type | Required | Notes |
|---|---|---|---|
| Summary | rich text | yes | |
| Ideal Solution | rich text | yes | |
| Related Function | dropdown | yes | Master taxonomy: Onboarding, Amendments, Termination, Resignation, Contract Ending, EOR Quotes, Redlines, Time Off, Time Tracking, Health Benefits, Benefits, Country Compliance, Employment Letters, Proof of Employment, Incentive Plans, Internal Tools, Knowledge Management, Quality Control, Reporting & SLAs, Risk & Escalations, Announcements, Project Management (MHR) |
| Attachments | files | no | |

### Ops Hub Feedback — existing
The current Feedback tab. Migrated in Stage 5 with zero downtime. Field
schema preserved as-is from the existing implementation; will be
captured here once Stage 0 finishes the read of the existing tab.

---

## Status lifecycle

Uniform across all four flows (Decision, 2026-05-02):

`New → In Progress → On Hold → Resolved`

Transitions are free (any → any) for HR Hub Admins; non-admins can move
their own requests forward but only Hub Admins or assignees can move
backwards. (Specific role model finalized in Stage 1.)

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-02 | Status lifecycle is `New / In Progress / On Hold / Resolved` for all 4 flows. | User chose uniform lifecycle over per-flow variation; reduces cognitive load and settings complexity. |
| 2026-05-02 | New access type `HR Hub Admin` assignable from the Team tab grants full edit rights inside the HR Hub (statuses, fields, dropdowns, auto-assign rules, etc.). | Rule 1 (every user has full access to the tab) is preserved; schema-edit actions need a guardrail; mirrors how access types are already managed on the Team tab. |
| 2026-05-02 | Plan doc lives at `HR_HUB_PLAN.md` in the repo root and must be auto-updated whenever new rules or cross-tab connections are introduced. | Single source of truth that survives across sessions and contributors. |
| 2026-05-02 | Cross-tab connections (e.g. "Raise HR Request from this offboarding row") deferred to Stage 7. | Stage 1–6 prove the chassis first; deep links bolt on cleanly afterwards. |
| 2026-05-01 | Entry point is the header `+` button → modal picker with 4 cards. Direct creation from queue rows comes later. | User wants one consistent intake before adding source-specific shortcuts. |

---

## Connections to other tabs

| From → To | Nature | Direction |
|---|---|---|
| Header `+` button (every page) → HR Hub create modal | UI affordance | one-way; opens picker; submits to HR Hub backend |
| Sidebar nav → HR Hub tab | Top-level tab next to Feedback | one-way |
| Existing Feedback tab → HR Hub `flow=feedback` | Data merge in Stage 5 | one-way; Feedback reads from new schema after migration |
| Notification bell (top-right) → HR Hub notifications | Bell extends to surface HR Hub events | bidirectional (HR Hub writes notifications; bell reads them) |
| Team tab → HR Hub | Adds `HR Hub Admin` access type, assignable on each member's row | one-way; Team tab is the source of truth for the access type |
| `team-directory` / `roster-server` → HR Hub | Read-only: roles, manager mapping, country ownership | one-way |
| `auth-helpers` → HR Hub routes | Read-only: authenticated user identity | one-way |

Future (Stage 7+):
- Offboarding row → "Raise HR Request" prefilled with case context
- Onboarding / Amendments / Workbench rows → same pattern

---

## Things that MUST NOT break

- Existing **Feedback tab** behavior — preserved exactly until Stage 5
  migration; merge is zero-downtime.
- Existing **notification bell** — extended in place, not replaced.
- **Offboarding queue**, **Sync badge**, **Onboarding**, **Workbench**,
  **Amendments**, **Redlines**, **Incentive Plans**, **Jira/Zendesk
  ingest** — no shared code paths touched.
- **Authentication / roster** — reuse, do not fork.

---

## HR Hub Admin access type — spec

- A new value in the Team tab's access-type list, e.g. `at_hr_hub_admin`.
- Assignable from each team member's row in the Team tab UI (same pattern
  as existing access-type assignment).
- Carries the following entitlements inside the HR Hub:
  - Edit any request's status / assignee / fields regardless of authorship
  - Open and edit Settings (statuses, fields, dropdowns, auto-assign rules)
  - View the full audit log
  - Add or remove followers on any request
- Outside the HR Hub: no new entitlements; existing app permissions unchanged.
- Settings changes by HR Hub Admins are recorded in `hr_hub_settings_history`
  with the actor's email + a JSON diff.

---

## Stages & verification checklists

### Stage 0 — Architecture probe (read-only, no commits) ✅ DONE 2026-05-02

Findings:

- **DB**: Postgres + raw `pg` Pool (`src/lib/db.js`). No ORM. Migrations are an
  idempotent `SCHEMA_SQL` template literal in `src/lib/migrate.js` — append-only
  via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
  Runs on app boot. `withTransaction()` helper available for multi-statement work.
- **Existing Feedback tab**: tables `feedback_requests`, `feedback_votes`,
  `feedback_comments`. Status enum `new | triaged | in_progress | done |
  wont_do | duplicate`. `attachments JSONB` (base64 data URIs in row, max
  5 × 12 MB, total 30 MB). HR Hub will mirror the attachments shape exactly
  for a smooth migration.
- **Notification bell**: `user_notifications` table already exists and is
  designed to be polymorphic (`link_view`, `link_id`, `source_type`,
  `source_id`). `useNotifications` hook polls `/api/v1/notifications` every
  30s with localStorage SWR + cross-tab BroadcastChannel sync. We extend by
  writing rows with `link_view = 'hr_hub'` — no new bell needed; the visual
  upgrade is a separate UX pass.
- **Real-time transport**: pure polling. No SSE / WebSocket usage anywhere
  in `src/` or `app/`. Bell polls 30s; data hooks poll on their own TTLs.
  HR Hub will polling-first (5s on the active request detail), upgrade only
  if observed latency demands it.
- **File upload**: base64 data URIs stored in JSONB columns. Same caps as
  Feedback (5 attachments × 12 MB, 30 MB total). No S3 / Cloudinary
  integration — keep it for Stage 7 if volume demands.
- **`@mention` source**: existing pattern — comments parse `@firstname.lastname`
  against `MEMBERS` from `src/data/members.js` (hydrated from DB by
  `roster-server.js`); resolved emails persist as `mention_emails TEXT[]` on
  the comment row. Reusing this pattern verbatim.
- **Auth**: `getAuthUser(req)` returns `{ id, email, role, name }` from
  middleware-set headers. `requireRole(req, ...roles)` for role gating.
- **Access-type system**: `src/data/accessControl.js` defines `ALL_VIEWS`,
  `ALL_ACTIONS`, `ALL_ADMIN_POWERS`, `DATA_SCOPES`. Access types are stored
  as records with these capability arrays. The Team tab's
  `AccessControlSettings.jsx` is the UI that assigns access types to people.
  HR Hub Admin lands as: new view `hr-hub`, new admin power
  `can_manage_hr_hub`, new access type `hr_hub_admin` bundling them.
- **Header `+` button**: `DeelTopBar.jsx` currently has a "New Task" button
  via `onCreateTask`. Stage 2 replaces (or extends) this with a 4-flow
  picker modal. The "New Task" flow stays reachable so we don't break it.

Stage 0 deliverable: this section + the concrete Stage 1 schema below.

### Stage 1 — Foundation: DB + API skeleton (behind feature flag)

**Tables (append to `SCHEMA_SQL` in `src/lib/migrate.js`):**

```sql
-- ── HR Hub: unified intake (2026-05-02) ────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_hub_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow VARCHAR(32) NOT NULL CHECK (flow IN ('hr_request','hr_reporting','escalation_zero','feedback')),
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','on_hold','resolved')),
  priority VARCHAR(20) DEFAULT 'medium',
  function_area VARCHAR(80),         -- Onboarding | Amendments | …
  request_type VARCHAR(80),          -- HR Request: Countersign EA | Deposit Increase | Other
  report_type VARCHAR(80),           -- HR Reporting: Bug | Escalation | …
  title VARCHAR(300),
  summary TEXT NOT NULL,
  ideal_solution TEXT,                 -- Escalation Zero only
  resolution_note TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,    -- {kind,dataUri,name}[] — same shape as feedback_requests.attachments
  created_by_email VARCHAR(255) NOT NULL,
  created_by_name  VARCHAR(255),
  assignee_email   VARCHAR(255),
  assignee_name    VARCHAR(255),
  team_lead_email  VARCHAR(255),       -- denormalized at create-time for fast Team filter
  cc_email         VARCHAR(255),       -- HR Reporting auto-cc
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_flow_status ON hr_hub_request(flow, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_assignee   ON hr_hub_request(assignee_email, status);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_creator    ON hr_hub_request(created_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_team_lead  ON hr_hub_request(team_lead_email, status);

CREATE TABLE IF NOT EXISTS hr_hub_comment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES hr_hub_request(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES hr_hub_comment(id) ON DELETE SET NULL,
  author_email VARCHAR(255) NOT NULL,
  author_name  VARCHAR(255),
  body TEXT NOT NULL,
  mention_emails TEXT[] NOT NULL DEFAULT '{}'::text[],
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at  TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_comment_request ON hr_hub_comment(request_id, created_at);

CREATE TABLE IF NOT EXISTS hr_hub_follower (
  request_id UUID NOT NULL REFERENCES hr_hub_request(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',  -- creator | assignee | tagged | manual
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, email)
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_follower_email ON hr_hub_follower(email);

CREATE TABLE IF NOT EXISTS hr_hub_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES hr_hub_request(id) ON DELETE CASCADE,
  actor_email VARCHAR(255),
  actor_name  VARCHAR(255),
  event_type VARCHAR(40) NOT NULL,
    -- created | status_change | assignee_change | field_edit
    -- | comment_added | comment_edited | comment_deleted
    -- | attachment_added | follower_added | follower_removed
  before_json JSONB,
  after_json  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_log_request ON hr_hub_log(request_id, created_at);

CREATE TABLE IF NOT EXISTS hr_hub_settings (
  flow VARCHAR(32) NOT NULL,
  key  VARCHAR(60) NOT NULL,           -- statuses | fields | dropdowns | auto_assign
  value_json JSONB NOT NULL,
  updated_by_email VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (flow, key)
);
CREATE TABLE IF NOT EXISTS hr_hub_settings_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow VARCHAR(32) NOT NULL,
  key  VARCHAR(60) NOT NULL,
  before_json JSONB,
  after_json  JSONB,
  actor_email VARCHAR(255),
  actor_name  VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_settings_history ON hr_hub_settings_history(flow, key, created_at DESC);
```

**Notifications:** reuse the existing `user_notifications` table with new
values: `link_view = 'hr_hub'`; `source_type ∈ {hr_hub_comment,
hr_hub_status_change, hr_hub_assignment, hr_hub_mention}`. The bell hook
displays them automatically — no schema change needed.

**Access-type wiring:** in `src/data/accessControl.js`:
- Append `'hr-hub'` to `ALL_VIEWS`
- Append `'can_manage_hr_hub'` to `ALL_ADMIN_POWERS`
- Define a default access-type record `hr_hub_admin` with the new power +
  baseline agent capabilities; surface it in `AccessControlSettings.jsx` so
  it is assignable from the Team tab.

**API routes (`app/api/v1/hr-hub/...`):**
- `GET  /requests` — list with `flow`, `scope` (`mine|team|all`), `status`, `function`, `search`, cursor pagination
- `GET  /requests/:id` — single request + comments (initial 20) + followers + recent log
- `POST /requests` — create; auto-creates creator-follower + log
- `PATCH /requests/:id` — status / assignee / fields; writes log + notifications
- `POST /requests/:id/comments` — add comment; parses `@mentions`; adds taggees as followers + writes notifications
- `PATCH /comments/:id` — edit
- `DELETE /comments/:id` — soft delete
- `POST /requests/:id/followers` — manual follow
- `DELETE /requests/:id/followers/:email` — manual unfollow
- `GET  /settings/:flow` — read config
- `PUT  /settings/:flow` — update config (HR Hub Admin only)

**Verification:**

- [ ] Migrations apply on a fresh DB without errors
- [ ] All 7 HR Hub tables exist + indexes present
- [ ] `hr_hub_settings` seeded with defaults for the 4 flows (statuses, fields, dropdowns) on first boot
- [ ] `'hr-hub'` view + `can_manage_hr_hub` admin power present in `accessControl.js`
- [ ] Default `hr_hub_admin` access type renders in Team tab → Access Type Editor
- [ ] Every HR Hub API route requires auth (`getAuthUser`); settings PUT → 403 unless caller has `can_manage_hr_hub`
- [ ] `GET /requests` p95 < 100 ms with 10 k seeded rows (load-test locally)
- [ ] Log entry written on every state-changing call
- [ ] Tab nav entry added + `/hr-hub` route stub (feature-flagged off by default)
- [ ] **Existing Feedback tab still works untouched** (hit it post-deploy and confirm)

### Stage 2 — `+` button popup + create flow

- [ ] Header `+` modal opens from every page with 4 cards (HR Request / HR Reporting / Escalation Zero / Ops Hub Feedback)
- [ ] Each flow's composer renders correct fields with validation
- [ ] Cascading dropdowns (HR Request: Function → Type)
- [ ] Attachments upload during create (drag-drop + paste from clipboard)
- [ ] Submission writes to DB + creates initial log + creator-follower
- [ ] On success: redirect to the new request's detail view
- [ ] Every authenticated user can submit any flow

### Stage 3 — List + detail (HR Request first)

- [ ] List p95 < 200ms with 1,000 requests
- [ ] Toggle: `My` / `All` for everyone; `My` / `Team` / `All` for managers
- [ ] Filters: status, function, type, assignee, date, full-text
- [ ] Detail view (drawer or full-page — UX decision in Stage 3)
- [ ] Lazy-load comments (initial 20, "Load earlier" button)
- [ ] Lazy-load attachments (thumbnail → full size)
- [ ] Virtualized scroll if >200 items
- [ ] Optimistic UI on comment post / status change / follower add

### Stage 4 — Comments, mentions, followers, notifications

- [ ] Composer ≥14px, emoji picker, `@` user autocomplete, drag-drop / paste attach, markdown
- [ ] `@mention` adds follower exactly once (de-duplicated)
- [ ] Notification fires on: status change, new comment, mention, assignment change
- [ ] Bell badge accurate; click opens grouped popup with avatars + snippets + actions
- [ ] Notification deep link opens detail popup without losing current tab
- [ ] Comment latency: <5s p95 to other watchers (start with 5s polling, upgrade if needed)

### Stage 5 — Other 3 flows + Feedback merge

- [ ] HR Reporting list/detail/composer wired
- [ ] Escalation Zero list/detail/composer wired
- [ ] Migration script: existing Feedback rows → `hr_hub_request` with `flow='feedback'` (idempotent, re-runnable)
- [ ] Old Feedback tab keeps working: rewrite data layer to read from new schema; UI untouched
- [ ] Data integrity check: every old Feedback row has a corresponding new row; comments + attachments preserved
- [ ] Old Feedback URLs continue to work (or redirect)

### Stage 6 — Settings panel

- [ ] `/hr-hub/settings` route, gated to HR Hub Admins
- [ ] Per-flow editor: statuses, fields, dropdown options
- [ ] Auto-assignment rules (e.g. flow=HR Request AND function=Onboarding → assignee=trish.lee@deel.com)
- [ ] Settings history with actor email + JSON diff
- [ ] Live: changes apply on next page load, no app restart

### Stage 7 — Polish + cross-tab links

- [ ] Per-request log view UI (collapsible timeline)
- [ ] Loading skeletons, error boundaries, retry-on-failure
- [ ] Mobile responsive
- [ ] Bundle size audit
- [ ] Real-time latency target: comment-to-watcher under 5s p95
- [ ] Cross-tab affordances: "Raise HR Request from this Offboarding row" (Onboarding, Amendments, Workbench similarly)
- [ ] Final UX pass with user

---

## Open items (track here; close in Decisions log when answered)

- [ ] Detail view UX: drawer overlay vs full-page route — decide in Stage 3 with user.
- [ ] Real-time upgrade trigger: at what latency does polling become unacceptable? Default 5s p95; revisit after Stage 4.
- [ ] Notification bell visual: full redesign vs incremental upgrade.
- [ ] Mobile scope: what % of HRX team uses the app on mobile today?
- [ ] Existing Feedback tab schema: documented in Stage 0 probe.
