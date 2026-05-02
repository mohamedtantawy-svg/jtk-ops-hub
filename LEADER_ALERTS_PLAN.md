# Leaders Alerts — Project Plan & Living Spec

> **Status:** Stage 0 done; Stage 1 awaiting user sign-off.
> **Owner:** mohamed.tantawy@deel.com.
> **Started:** 2026-05-02.

---

## Maintenance protocol — read first

This is the single source of truth for the Leaders Alerts tab. Whoever
(human or assistant) adds, changes, or removes anything in this tab must
keep this doc in sync. Specifically:

1. **New rule** (UX, behavior, permission, performance) → append it to
   "Strict rules" with a date and a one-line rationale.
2. **New connection to another tab** (sidebar, header `+` button, deep link,
   shared component, shared API) → append it to "Connections to other
   tabs" and note the direction.
3. **New decision** (status lifecycle, field map, dropdown options, role
   model, notification policy) → append to "Decisions log" with date and
   rationale; do not silently overwrite earlier entries.
4. **Stage progress** — tick the verification checkboxes as work lands.
   Do not delete unchecked items; cross out (`~~strikethrough~~`) and add
   a note if a check is intentionally skipped.
5. **Things that must NOT break** — this list grows when we discover a
   regression risk. Never shrink it without explicit user sign-off.

This doc lives at `LEADER_ALERTS_PLAN.md` in the repo root. Move it only
with a search-and-replace pass on every reference.

---

## Goals

A single tab where any manager (Team Lead / Regional Manager / Director)
can post a short alert about a country, team, or global issue. Other
managers acknowledge with one click. A Slack-like comment thread under
each alert supports interaction with emoji reactions, screenshot pasting,
and `@`-mentions. Strong notifications on `@`-mentions and high-severity
new alerts; quiet visual signal (sidebar badge) for everything else so
the bell stays usable.

The tab replaces today's ad-hoc "leader alerts" Slack workflow with a
durable, searchable, audit-logged surface inside Ops Hub.

---

## Naming + identifiers

The existing `Alerts.jsx` (Anomaly Alerts — Looker-fed read-only surface,
view id `'alerts'`) stays untouched. The new tab is **Leaders Alerts**:

| Concept | Value |
|---|---|
| Tab label (sidebar + header) | `Leaders Alerts` |
| View id (URL `?view=…`, `accessControl.ALL_VIEWS`) | `leader-alerts` |
| Top component | `LeaderAlertsView.jsx` |
| Detail drawer | `LeaderAlertDetailPanel.jsx` |
| Composer | `LeaderAlertComposer.jsx` |
| Settings drawer | `LeaderAlertSettingsPanel.jsx` |
| API base | `app/api/v1/leader-alerts/...` |
| DB table prefix | `leader_alert_*` |
| Admin power | `can_manage_leader_alerts` |
| Per-user grant column | `team_member_overrides.is_leader_alerts_admin` |
| Default access type id | `at_leader_alerts_admin`, label `Alerts Admin` |
| Notification `link_view` | `leader-alerts` |

---

## Strict rules

Non-negotiable. Every code change must respect these. Add new rules with
a date and rationale; do not remove rules without explicit user sign-off.

| # | Rule | Added | Notes |
|---|------|-------|-------|
| 1 | Tab is visible + writable for any user with managerial access (`team_lead`, `regional_manager`, `admin`). Agents do NOT see this tab. | 2026-05-02 | Gated via `perms.canView('leader-alerts')` in `App.jsx` mount; access type definition in `accessControl.js`. |
| 2 | Default scope toggle = `My Alerts` / `All Alerts`. Two segments only. | 2026-05-02 | User decision (no Team toggle for v1). |
| 3 | Acknowledgement is a single button — one click per manager per alert, idempotent. Counts visible in list + detail. | 2026-05-02 | Server enforces `(alert_id, email)` PK on `leader_alert_ack`. |
| 4 | "Anyone missing" set = all managers globally minus those who have acked. | 2026-05-02 | Computed on read from current managerial roster — not denormalized at create-time, so new managers automatically appear in "missing" lists. |
| 5 | Comments support emoji reactions (Slack-style multi-emoji counters), screenshot paste/drop, and `@first.last` parsing. | 2026-05-02 | Reactions are a separate concept from the alert-level ack. |
| 6 | `@`-mention → high-priority bell entry + in-app toast + auto-follow on the alert. | 2026-05-02 | Reuses `user_notifications` polymorphic surface. |
| 7 | Newest-first sort by default. Cursor pagination. | 2026-05-02 | Index `(status, created_at DESC)`. |
| 8 | Settings panel is the only place categories / statuses / notification rules are edited; gated by Alerts Admin. | 2026-05-02 | `is_leader_alerts_admin` in `team_member_overrides`. |
| 9 | Every alert has a complete log (every state change, every comment, every ack, every follower change). | 2026-05-02 | `leader_alert_log` table; one entry per state-changing call. |
| 10 | UI follows the Feedback / HR Hub visual pattern (hero header → segmented scope → 4-up status cards → filter bar → compact rows). | 2026-05-02 | Skill §3.13. |
| 11 | Acks are NOT reset by edits to the alert body. The audit log records "edited after N acks". | 2026-05-02 | Less friction; user decision. |
| 12 | "Pin to top" alerts deferred to Stage 7. v1 is strict reverse-chronological. | 2026-05-02 | |

---

## The fields per alert

| Field | Type | Required | Notes |
|---|---|---|---|
| Title | text (300) | yes | Headline shown in list. Supports `@first.last` parsing for inline mentions. |
| Body | rich text | yes | Markdown with `@`-mentions, links, inline images. |
| Category | dropdown | yes | One of: Operational Risk · Pain Point · Team Update · Others · Country Update · Upcoming Issue · Achievement · Bug. Editable in Settings. |
| Severity | dropdown | yes | Critical · High · Medium · Low. Default = Medium. Word-based with color + icon (no fire-emoji scale). |
| Impact | multi-select picker | yes | Tags drawn from `[Global, Team, …all countries from countryOwners.js]`. Searchable picker. Multiple selections allowed. |
| Links | URL list | no | Deel admin / Zendesk / Jira / Slack thread, etc. |
| Attachments | files | no | Same shape as `feedback_requests.attachments` — JSONB `[{kind,dataUri,name}]`, 5 × 12 MB cap, 30 MB total. |

**Severity color + icon (literal — do NOT replace with CSS vars; semantics matter):**

| Severity | Color | Icon | When to use |
|---|---|---|---|
| Critical | `#dc2626` red | `bi-exclamation-octagon-fill` | Immediate revenue / legal / people-safety impact. |
| High | `#d97706` orange | `bi-exclamation-triangle-fill` | Multi-region or recurring issue. |
| Medium | `#0369a1` blue | `bi-info-circle-fill` | Default — general operational alert. |
| Low | `#15803d` green | `bi-check-circle` | FYI / nice to know. |

**Impact picker behavior:**

- The picker shows pinned items first: `Global`, `Team` — then a searchable list of countries from `countryOwners.js` (`getAllCountries()` for the live binding).
- Stored as `impact_tags TEXT[]` where each entry is the literal string `Global`, `Team`, or a 2-letter ISO country code (`MX`, `BR`, `KZ`, …).
- Display: country flag + name; `Global` and `Team` get distinctive icons.
- Filtering in the list view: a pill chip per selected tag, click to remove.
- "Team" is purely descriptive (a tag the creator chose, meaning "this affects my team specifically"). It does NOT scope notifications or visibility — every alert is visible to every manager regardless of Impact.

---

## Status lifecycle

Uniform: `New → In Progress → On Hold → Resolved`.

- Creator can move forward (`new → in_progress → resolved`) or backward.
- Alerts Admin can move freely.
- Other managers: no status mutation rights.
- Editable label/color via Settings; lifecycle CHECK constraint requires a DB migration to add new status values (warned in the Settings UI).

---

## Notification matrix (proposal — needs user sign-off before Stage 4)

User said: "we need to figure better notifications". The fan-out problem
is real — 100+ managers globally, 20 alerts/day, ~100 acks per alert.
Naive "notify everyone on every event" → ~2k bell rows/day → bell becomes
useless.

Tiered strategy:

| Event | Bell entry → who | Toast in-app | Notes |
|---|---|---|---|
| New alert — severity = **Critical** | All managers | Yes | `source_type = 'leader_alert_created_critical'`. The only event that fan-outs broadly. |
| New alert — severity = High | None (visible in tab + sidebar badge) | No | Avoids spam; sidebar badge prompts review. |
| New alert — severity ≤ Medium | None | No | Visible in tab; sidebar badge. |
| `@`-mention in title or comment | Mentioned user(s) — individual | Yes | `source_type = 'leader_alert_mention'`. Auto-follows the alert. |
| Status change | Creator + commenters + followers | No | `source_type = 'leader_alert_status_change'`. |
| New comment on alert I follow | Creator + other commenters + followers (excl. comment author) | No | `source_type = 'leader_alert_comment'`. |
| Comment reaction added | None | No | UI updates the count + emoji-reactor list. |
| Someone acks the alert | None | No | UI updates the count + avatar stack. |

Plus:

- **Sidebar tab badge**: persistent quiet signal — count of `(alerts of severity ≥ Medium that I have NOT acked)`. No bell, no toast, just a number on the nav item. Refreshed via the existing `useNotifications` cycle.
- **Mute thread**: per-user button on each alert → drops them out of comment + status notifications for that one alert. Mention can override (always notifies even if muted).
- **Per-user notification preferences**: deferred to Settings v2 (Stage 7+). v1 ships with the matrix above as the global default.

**Decision needed:** approve, or revise the matrix (add Critical Slack ping? change the severity threshold for badge counting? change the mention-overrides-mute rule?). I will not start Stage 4 without an explicit `notifications: ok` from the user.

---

## Schema (Stage 1 — append to `SCHEMA_SQL` in `src/lib/migrate.js`)

```sql
-- ── Leaders Alerts (2026-05-02) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leader_alert (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status   VARCHAR(20) NOT NULL DEFAULT 'new'    CHECK (status IN ('new','in_progress','on_hold','resolved')),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
  category VARCHAR(80) NOT NULL,                 -- Operational Risk | Pain Point | Team Update | …
  title    VARCHAR(300) NOT NULL,
  body     TEXT NOT NULL,
  impact_tags TEXT[] NOT NULL DEFAULT '{}'::text[],   -- 'Global' | 'Team' | <ISO country code>
  links       JSONB  NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB  NOT NULL DEFAULT '[]'::jsonb,    -- {kind,dataUri,name}[] — same shape as feedback_requests.attachments
  created_by_email VARCHAR(255) NOT NULL,
  created_by_name  VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_status_created ON leader_alert(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leader_alert_creator        ON leader_alert(created_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leader_alert_category       ON leader_alert(category, status);
CREATE INDEX IF NOT EXISTS idx_leader_alert_severity       ON leader_alert(severity, status);
CREATE INDEX IF NOT EXISTS idx_leader_alert_impact         ON leader_alert USING GIN (impact_tags);

CREATE TABLE IF NOT EXISTS leader_alert_ack (
  alert_id UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name  VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, email)
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_ack_email ON leader_alert_ack(email);

CREATE TABLE IF NOT EXISTS leader_alert_comment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES leader_alert_comment(id) ON DELETE SET NULL,
  author_email VARCHAR(255) NOT NULL,
  author_name  VARCHAR(255),
  body TEXT NOT NULL,
  mention_emails TEXT[] NOT NULL DEFAULT '{}'::text[],
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at  TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_comment_alert ON leader_alert_comment(alert_id, created_at);

CREATE TABLE IF NOT EXISTS leader_alert_comment_reaction (
  comment_id UUID NOT NULL REFERENCES leader_alert_comment(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  emoji VARCHAR(40) NOT NULL,                  -- ':thumbsup:' | ':eyes:' | unicode
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, email, emoji)
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_reaction_comment ON leader_alert_comment_reaction(comment_id);

CREATE TABLE IF NOT EXISTS leader_alert_follower (
  alert_id UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',  -- creator | tagged | commenter | manual
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, email)
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_follower_email ON leader_alert_follower(email);

CREATE TABLE IF NOT EXISTS leader_alert_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  actor_email VARCHAR(255),
  actor_name  VARCHAR(255),
  event_type VARCHAR(40) NOT NULL,
    -- created | status_change | severity_change | category_change | field_edit
    -- | comment_added | comment_edited | comment_deleted
    -- | reaction_added | reaction_removed
    -- | ack_added | ack_removed
    -- | follower_added | follower_removed | thread_muted | thread_unmuted
  before_json JSONB,
  after_json  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_log_alert ON leader_alert_log(alert_id, created_at);

CREATE TABLE IF NOT EXISTS leader_alert_settings (
  key VARCHAR(60) PRIMARY KEY,                 -- 'categories' | 'statuses' | 'notifications'
  value_json JSONB NOT NULL,
  updated_by_email VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS leader_alert_settings_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(60) NOT NULL,
  before_json JSONB,
  after_json  JSONB,
  actor_email VARCHAR(255),
  actor_name  VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_settings_history ON leader_alert_settings_history(key, created_at DESC);

-- Per-user admin grant (mirrors is_hr_hub_admin / is_announcements_admin)
ALTER TABLE team_member_overrides
  ADD COLUMN IF NOT EXISTS is_leader_alerts_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_leader_alerts_admin
  ON team_member_overrides(is_leader_alerts_admin) WHERE is_leader_alerts_admin = true;
```

**Notifications:** reuse the existing `user_notifications` table — write
rows with `link_view = 'leader-alerts'` and `source_type` per the matrix
above. No schema change needed.

**Access-type wiring** in `src/data/accessControl.js`:
- Append `'leader-alerts'` to `ALL_VIEWS`.
- Append `'leader-alerts': 'Leaders Alerts'` to `VIEW_LABELS`.
- Append `'can_manage_leader_alerts'` to `ALL_ADMIN_POWERS`.
- Append `'can_manage_leader_alerts': 'Manage Leaders Alerts'` to `ADMIN_POWER_LABELS`.
- Define a new default access type `at_leader_alerts_admin` with `views: VIEWS_NO_SETTINGS` baseline + `adminPowers: ['can_manage_leader_alerts']`; surface it in `AccessControlSettings.jsx` so it is assignable from the Team tab.

---

## API routes (`app/api/v1/leader-alerts/...`)

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/alerts` | List with `scope=mine\|all`, `status`, `category`, `severity`, `impact`, `search`, cursor pagination. |
| `GET`    | `/alerts/:id` | Single alert + first 20 comments + ack list (paginated separately) + recent log. |
| `POST`   | `/alerts` | Create. Auto-follow creator. Log `created`. Trigger Critical fan-out if applicable. |
| `PATCH`  | `/alerts/:id` | Status / severity / category / fields. Logs + notifications. |
| `DELETE` | `/alerts/:id` | Soft delete (Alerts Admin only). |
| `POST`   | `/alerts/:id/ack` | Idempotent — current user acks. UI reflects new count. |
| `DELETE` | `/alerts/:id/ack` | Un-ack (lets users undo a misclick). Logged. |
| `GET`    | `/alerts/:id/acks` | Paginated ack list + computed "missing" pool (managers minus acks). |
| `POST`   | `/alerts/:id/comments` | Add comment; parses `@mentions`; adds taggees as followers + writes mention notifications. |
| `PATCH`  | `/comments/:id` | Edit (author or admin). Logged. |
| `DELETE` | `/comments/:id` | Soft delete. Logged. |
| `POST`   | `/comments/:id/reactions` | Add `{emoji}`. Idempotent on `(comment, user, emoji)`. |
| `DELETE` | `/comments/:id/reactions/:emoji` | Remove reaction. |
| `POST`   | `/alerts/:id/followers` | Manual follow. |
| `DELETE` | `/alerts/:id/followers/:email` | Manual unfollow (or self-mute via `?mute=1`). |
| `GET`    | `/settings` | Read all keys (categories, statuses, notifications). |
| `PUT`    | `/settings/:key` | Update (Alerts Admin only). Writes history row with diff. |

Auth: every route requires `getAuthUser`. Settings routes also require
`canAdministerLeaderAlerts(user)` (admin role OR `is_leader_alerts_admin = true`).

---

## Connections to other tabs

| From → To | Nature | Direction |
|---|---|---|
| Header `+` Quick Create dropdown → Leaders Alerts compose | "Submit Leaders Alert" entry opens the composer modal from any page | one-way |
| Sidebar nav → Leaders Alerts tab | Top-level managerial-only entry, sits between Announcements and HR Hub (final position TBD) | one-way |
| Notification bell → Leaders Alerts deep-link | `link_view = 'leader-alerts'`; deep-link via `?req=<uuid>` URL trick (mirrors HR Hub) | bidirectional |
| Team tab → Alerts Admin grant | Per-row toggle on each member (same UI as HR Hub Admin) | one-way; Team tab is source of truth |
| `team-directory` / `roster-server` → Leaders Alerts | Read-only: managerial roster (TL + RM + Admin), `@`-mention autocomplete | one-way |
| `countryOwners.js` (live-binding) → Leaders Alerts Impact picker | Read-only: country list + flags | one-way |
| `auth-helpers` → Leaders Alerts routes | Read-only: authenticated user identity | one-way |

Future (Stage 7+):
- Briefing tile of unresolved Critical/High alerts.
- Sidebar badge "N unacked alerts" surfaced on the Briefing hero card.
- Per-row "Raise Alert" affordance from Queue / Offboarding / Workbench.

---

## Things that MUST NOT break

- **Existing Anomaly Alerts tab (`Alerts.jsx`, view id `'alerts'`)** — preserved as-is. Same name in label, but different view id; navigation is unambiguous.
- **HR Hub** — independent table prefix, independent API base, independent admin power; no shared code paths beyond the polymorphic notification surface.
- **Feedback tab** — no shared schema or hooks.
- **Notification bell + `useNotifications` hook** — extended via new `link_view` only; no schema change, no behavior change for existing notifications.
- **Roster / `countryOwners.js`** — read-only consumer; no writes.
- **Team tab access-type editor** — extended with one new entry; no behavior change for existing access types.
- **`/api/v1/me`** — extended to surface `isLeaderAlertsAdmin`; existing fields unchanged.

---

## Alerts Admin access type — spec

- New value in the Team tab access-type list: `at_leader_alerts_admin`, label `Alerts Admin`.
- Assignable from each team member's row (same UI pattern as HR Hub Admin).
- Carries the following entitlements **inside Leaders Alerts only**:
  - Edit any alert's status / severity / category / fields regardless of authorship.
  - Open and edit Settings (categories, statuses, notification policy).
  - View the full audit log on any alert.
  - Add or remove followers on any alert.
  - Soft-delete alerts and comments.
- Outside Leaders Alerts: no new entitlements.
- Settings changes by Alerts Admins are recorded in
  `leader_alert_settings_history` with the actor's email + a JSON diff.

---

## Stages & verification checklists

### Stage 0 — Architecture probe (read-only) ✅ DONE 2026-05-02

Findings:

- **Naming collision resolved**: existing `Alerts.jsx` (Anomaly Alerts) keeps view id `'alerts'`; new tab uses `'leader-alerts'`.
- **DB layer**: Postgres + raw `pg` Pool. Append-only `SCHEMA_SQL` in `src/lib/migrate.js`. Idempotent boot-time migration. Same as HR Hub.
- **Country source of truth**: `src/data/countryOwners.js` — live-binding `let _countryOwners` hydrated from `team_member_countries` via `hydrateOwnerCountries()`. Exposes `getAllCountries()` for the live ISO list. Picker reads from this.
- **Per-feature admin pattern**: `is_<feature>_admin` column in `team_member_overrides`, server helper `can<Feature>(user)` with 30s in-memory cache, 5-point plumbing checklist (skill §3.9). Replicate exactly with `is_leader_alerts_admin` + `src/lib/leader-alerts-admin.js`.
- **Notification surface**: polymorphic `user_notifications` (`link_view`, `link_id`, `source_type`, `source_id`). Extend with `link_view = 'leader-alerts'` — no schema change. Bell at 30s polling.
- **Comment/mention reuse**: `@first.last` parser, `mention_emails TEXT[]` on comment, follower auto-add on mention — all proven patterns from HR Hub.
- **Polling pattern**: ref-pattern (skill §3.11). Detail panel polls `/comments?since=<ISO>` every 5s; tail timestamp cursor; dedup by id on merge.
- **File upload**: base64 data URIs in JSONB, same shape as `feedback_requests.attachments`. 5 × 12 MB cap.
- **UI pattern**: Feedback / HR Hub tokens (skill §3.13) — `pageHead` / `segmentedControl` / `statusFilterBtn` / `filterBar` / row list. Compactness target: hero + scope + status cards + filter bar in ≤290 px above the fold at 1440 px.

### Stage 1 — Foundation: DB + API skeleton + access-type plumbing ✅ DONE 2026-05-02

- [x] Append the 7-table migration block + `is_leader_alerts_admin` ALTER to `src/lib/migrate.js` `SCHEMA_SQL`.
- [x] Boot-time seed `leader_alert_settings` with defaults for `categories`, `statuses`, `notifications` (idempotent — only inserts if missing). Seeded with the 8 categories from the user's list (`src/lib/leader-alerts-seed.js`).
- [x] `src/lib/leader-alerts-admin.js` — 30 s cached `canAdministerLeaderAlerts(user)` helper + `bustLeaderAlertsAdminCache(email)` invalidator + `isManagerialUser(user)` route-side gate.
- [x] `src/lib/team-members-merge.js` — `is_leader_alerts_admin` flows through `normaliseOverrideRow` SELECT, `applyOverride` no-override branch, and `applyOverride` with-override merge. Brand-new-row branch also patched (latent gap: `isAccessAdmin` and `isHrHubAdmin` were missing from this branch — patched alongside).
- [x] `app/api/v1/me/route.js` — SELECT includes `is_leader_alerts_admin`; response JSON includes `isLeaderAlertsAdmin`.
- [x] `src/App.jsx` — localStorage user snapshot init + post-`/me` hydration both carry `isLeaderAlertsAdmin`.
- [x] `src/data/accessControl.js` — appended `'leader-alerts'` to `ALL_VIEWS` + `VIEW_LABELS`; `'can_manage_leader_alerts'` to `ALL_ADMIN_POWERS` + `ADMIN_POWER_LABELS`; new `at_leader_alerts_admin` default access type ("Alerts Admin"); `MANAGERIAL_ONLY_VIEWS` set + `VIEWS_NO_SETTINGS_NO_MANAGERIAL` derived list so `at_agent` and `at_hr_hub_admin` no longer accidentally grant Leaders Alerts visibility.
- [x] `src/hooks/usePermissions.js` — `canManageLeaderAlerts` combines per-user grant + admin baseline.
- [x] API routes scaffolded with auth gating: `GET/POST /alerts`, `GET/PATCH/DELETE /alerts/[id]`, `POST/DELETE /alerts/[id]/ack`, `GET/POST /alerts/[id]/comments`, `GET /settings`. Settings PUT + comment edit/delete + reactions + followers land in later stages. Admin-only edits (PATCH non-creator, DELETE alert) → 403 unless `canAdministerLeaderAlerts`.
- [x] `src/lib/leader-alerts-helpers.js` — sanitisers (title, body, links, attachments, impact tags), `@mention` parser, follower add/remove/list/mute, audit log writer, settings cache, polymorphic notification fan-out.
- [x] `LeaderAlertsView.jsx` stub mounts via `?view=leader-alerts`, fetches `/leader-alerts/settings`, renders Feedback-style hero + empty state + signed-in identity hint.
- [ ] Migrations apply on a fresh DB without errors *(verified post-deploy on Nexus — local dev proxies `/api` to remote backend)*
- [ ] All 8 leader_alerts tables exist + indexes; `team_member_overrides.is_leader_alerts_admin` column exists *(verified post-deploy on Nexus)*
- [ ] `leader_alert_settings` seeded on first boot *(verified post-deploy on Nexus)*
- [ ] Verify post-deploy: existing Anomaly Alerts tab still works untouched. *(FE-verified the file is untouched and view id `'alerts'` still mounts; full verify post-deploy on Nexus)*

### Stage 2 — Header `+` Quick Create + composer modal ✅ DONE 2026-05-02

- [x] Header `+` Quick Create dropdown gains "New Leaders Alert" entry (gated via `viewReq: 'leader-alerts'` so only managers see it).
- [x] Single-flow composer modal `CreateLeaderAlertModal.jsx`: Title (300 char), Body (textarea — rich-text editor deferred), Category dropdown (from settings), Severity 4-radio (Critical / High / Medium / Low with color/icon), Impact multi-select picker, Links list, Attachments.
- [x] `ImpactPicker` subcomponent: pinned `Global` + `Team` rows on top, then countries sorted A–Z with flag + name, search input filters live, multi-select chips above the trigger. Verified clicking Kazakhstan + Global both add chips; search "kaz" filters to Kazakhstan only; "AD AD" stutter fixed.
- [x] Attachments: drag-drop + paste-from-clipboard + click. Same JSONB shape as `feedback_requests.attachments` (5 × 12 MB cap, image compression to 1600 px max).
- [x] Submission writes to DB + creates initial log + creator-follower + tagged-mentions followers (server-side; POST `/leader-alerts/alerts`).
- [x] Critical severity → fan-out notifications to all managers immediately (server-side, via `writeNotifications` with `source_type = 'leader_alert_created_critical'`).
- [x] Visible Leaders Alerts tab added to the sidebar nav (`PRIMARY_TABS` in `DeelTopNav.jsx`); icon `bi-broadcast`. Managerial-only via `accessControl.MANAGERIAL_ONLY_VIEWS` filter.
- [ ] Sidebar badge shows count of `(severity ≥ Medium AND not yet acked by current user)` *(deferred to Stage 3 where the list/ack data is wired)*

### Stage 3 — List + detail (Feedback-pattern) ✅ DONE 2026-05-02

- [x] `LeaderAlertsView.jsx` rebuilt with full board layout — hero header, segmented `My Alerts / All Alerts` scope, 4-up status filter cards (New / In Progress / On Hold / Resolved), filter bar (severity chips + category chips + search + sort + refresh + admin gear), compact rows.
- [ ] List p95 < 200 ms with 1,000 alerts *(verify post-deploy with seeded data)*
- [x] Row layout: severity dot → category icon tile → title + meta (relative time, creator, Impact flag chips truncated to 3 + "+N more", comment count) → ack count pill (acked-state aware) → status pill on the right.
- [x] Detail opens as a slide-in drawer (`LeaderAlertDetailPanel.jsx`) with right-edge anchored modal — list keeps scroll position behind the dim overlay.
- [x] URL deep-link via `?alert=<uuid>` so notification deep-links and shared URLs open the right drawer (handled via `popstate` + `history.replaceState`).
- [x] Ack button: prominent purple pill, click → switches to green "Acknowledged" with check icon + count increments + avatar slides into stack. Server-side idempotent on `(alert_id, email)`.
- [x] Avatar stack of acks (up to 5 + "+N" pill); clicking the missing-count link opens the "Acknowledgements" modal with `Missing` and `Acknowledged` tabs, search filter, region/team hint per row.
- [x] Optimistic UI: status / severity dropdowns swap their tint immediately; refetch on save confirms the server state.
- [x] Audit log collapsed by default; click to expand a max-240 px scrollable timeline (actor · event · timestamp).
- [x] Empty state per scope + status filter combo (separate copy for "no alerts yet" vs "no matches for filters").
- [ ] Cursor pagination, "Load more" pager *(scaffolded via `nextCursor` from the API; the button is disabled in v1 — the 50-item page covers the 20 alerts/day initial volume; activate on Nexus once we hit the page size)*

### Stage 4 — Comments, reactions, mentions, followers, notifications ✅ DONE 2026-05-02

- [x] `LeaderAlertCommentsThread.jsx` — Slack-style thread component embedded in the detail drawer. 14 px composer, paste/drop/pick attachments + emoji picker (curated 24-emoji grid, no external dep), Enter to send, Shift+Enter for newline.
- [x] `@first.last` autocomplete from the team roster — popover above the textarea, click to insert. Limit 6 matches, prefix-match on email localpart + substring-match on name.
- [x] `@`-mention parses server-side (`parseMentions` in `leader-alerts-helpers.js`); adds the mentioned user as a follower (idempotent on `(alert_id, email)`) + fan-outs a `mention` bell entry via `writeNotifications` with `source_type = 'leader_alert_mention'`. Mention-overrides-mute is enforced in the route handler (followers list excludes muted, but mentions bypass that filter).
- [x] Slack-style emoji reactions on each comment: hover-row reveals the toolbar with `+ reaction` button → 24-emoji picker. Existing reactions render as `[😀 3] [👀 1]` chips below the body; click a chip to toggle your own. Reactor list shown on hover.
- [x] Detail panel polls `/alerts/:id/comments?since=<ISO>` every 5 s (ref pattern per skill §3.11 — `commentsRef` so the interval doesn't tear down on every poll). Tail-timestamp cursor; dedup by id on merge.
- [x] Comment edit + soft-delete (PATCH / DELETE on `/comments/:id`); inline edit textarea with Save/Cancel; soft-delete sets `deleted_at` and the row is hidden from the UI; audit log captures both events.
- [x] Notifications fired per the matrix (Stage 1's create + comment routes; Stage 4 PATCH/DELETE/reaction events log to `leader_alert_log` only — they don't fan out, matching the matrix decision that reactions/edits are quiet UI updates).
- [ ] Bell deep-link opens the drawer at the right comment via `?alert=<uuid>#comment-<uuid>` *(deferred — bell deep-link opens the drawer; comment-anchor scroll lands in Stage 6 polish)*
- [x] "Mute thread" button in the drawer header (`bi-bell` / `bi-bell-slash-fill`); calls `POST /alerts/:id/followers` with `{ mute: true }`. Server enforces `mention overrides mute` so a tagged user still pings even when the thread is muted.
- [x] Notification fan-out helper writes to `user_notifications` in a single multi-row INSERT with `ON CONFLICT DO NOTHING` (`writeNotifications` in `leader-alerts-helpers.js`).

### Stage 5 — Settings panel ✅ DONE 2026-05-02

- [x] In-app drawer `LeaderAlertSettingsPanel.jsx` reachable from the Leaders Alerts view's gear button — visible only to Alerts Admins.
- [x] Three tabs: Categories · Statuses · Notifications.
- [x] Categories editor — add / rename / remove + colour picker per row. Live across the app.
- [x] Statuses editor — relabel + recolour the four lifecycle statuses; warning banner that adding/removing IDs requires a CHECK-constraint migration.
- [x] Notifications editor — toggle each event in the matrix + a sidebar-badge severity-threshold dropdown (`critical only` / `high+` / `medium+` / `low+`).
- [x] Save → PUT `/leader-alerts/settings/:key` with `leader_alert_settings_history` audit row carrying actor + JSON diff. Server busts the in-memory settings cache on save so the next list/composer fetch sees fresh values.
- [x] Permission gate: PUT route requires `canAdministerLeaderAlerts`; gear button is hidden unless `perms.canManageLeaderAlerts`.
- [x] Live: changes apply on next page load (composer + filter bar re-fetch). Settings drawer dismisses with Esc / overlay click / X.

### Stage 6 — Polish + responsive + dark mode ✅ DONE 2026-05-02

- [x] CSS vars from day one for every theme-dependent color in every new surface (`var(--surface)` / `var(--text)` / `var(--border)` / `var(--surface-2)` / `var(--surface-3)`). Status pill + severity colours stay literal — they convey semantic meaning that must NOT shift with theme (skill §4.5 / mistake #30).
- [x] Status filter cards collapse to 2-up at ≤ 900 px via the `leader-alerts-status-grid` CSS class. Topnav inherits the existing 1280 / 900 / 760 px collapse rules from `index.css`.
- [x] Dark mode verified at 1440 px — hero, status cards, filter bar, drawer surfaces all flip cleanly; severity icons + status pills retain their literal colours.
- [x] Empty states tailored per scope + status filter combo (separate copy for "no alerts yet" vs "no matches for filters").
- [x] Long titles ellipsize via `whiteSpace:nowrap; overflow:hidden; textOverflow:ellipsis`. Long impact chip lists truncate to "+N more" past 3.
- [x] Keyboard: Esc closes drawers + modals; Enter sends comments (Shift+Enter for newline); composer Enter posts.
- [x] Acknowledgement button: large purple pill, clicks transitions to green "Acknowledged" with check icon; shadow tint matches the action colour. Avatar stack slides in next to the count.
- [x] Sidebar Leaders Alerts tab badge — counts unacked alerts at or above the configured severity threshold (default Medium). Polled every 30 s alongside the bell hook. New `/leader-alerts/unacked-count` route does the work in a single SQL `COUNT(*)` with a `NOT EXISTS` ack-join + GIN-indexed severity filter.
- [ ] Comment-anchor scroll on bell deep-link *(deferred — bell deep-link routes to the drawer; scrolling to a specific comment lives in a future polish PR)*
- [ ] Loading skeletons on initial paint *(v1 uses a simple "Loading alerts…" message; skeletons land in a follow-up if perceived latency becomes a complaint)*

### Stage 7 — Cross-tab links + future polish (deferred)

- [ ] Briefing tile of unresolved Critical alerts.
- [ ] Briefing hero card: "N unacked Leaders Alerts" pill.
- [ ] Per-row "Raise Alert" affordance from Queue / Offboarding rows.
- [ ] Per-user notification preferences (Settings v2).
- [ ] "Pin to top" alerts.
- [ ] Daily digest email/Slack of unacked Critical alerts >24h.
- [ ] Virtualized scroll if observed item count > 200/page.

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-02 | Tab name "Leaders Alerts" with view id `leader-alerts`; existing Anomaly Alerts (`Alerts.jsx`, view id `alerts`) preserved as-is. | Naming conflict — keep both surfaces, label clearly. |
| 2026-05-02 | Severity is word-based (`Critical / High / Medium / Low`) with color + icon. No fire-emoji scale. | User decision; words are clearer than fire counts. |
| 2026-05-02 | Acknowledgement universe = all managers globally (TL + RM + Admin). "Missing" computed live from current roster. | User decision. |
| 2026-05-02 | Scope toggle is `My / All` only — no Team toggle. | User decision (simpler than the original three-segment plan). |
| 2026-05-02 | Comment reactions (multi-emoji per comment) and alert-level ack are separate concepts. Ack is a single button. | User said "have a button for them to click and make it look super cool"; emoji reactions cover the "exactly like Slack" requirement on comments. |
| 2026-05-02 | Single field "Category" (not Function + Type). 8 starting values from user list. | User decision; simpler than HR Hub's two-field model. |
| 2026-05-02 | New access type `Alerts Admin` (`at_leader_alerts_admin`) assignable from Team tab grants Settings + override-edit rights inside Leaders Alerts only. | User decision; mirrors HR Hub Admin pattern. |
| 2026-05-02 | Status lifecycle uniform: `New / In Progress / On Hold / Resolved`. | User decision. |
| 2026-05-02 | Acks NOT reset on edit; audit log records "edited after N acks". | User decision; less friction. |
| 2026-05-02 | Cross-tab affordances deferred to Stage 7. | Mirror HR Hub's deferral; prove the chassis first. |
| 2026-05-02 | "Pin to top" deferred to Stage 7. | User decision; v1 is strict reverse-chronological. |
| 2026-05-02 | "Team" in Impact picker is purely descriptive — does NOT scope visibility or notifications. | Every alert is visible to every manager regardless of Impact (per ack universe rule). |
| 2026-05-02 | Volume planning anchored at ~20 alerts/day, schema sized for 500/day ceiling. | User estimate. |

---

## Audit log

### 2026-05-02 — Stage 1 implementation pass

- **Bug fixed (pre-existing, surfaced by Stage 1)** — `App.jsx`'s view-permission guard (line 1175) ran before the user object hydrated. With no user, `usePermissions` falls back to `at_agent`. Pre-Leaders-Alerts, every tab was in `at_agent.views` so the guard never tripped on URL deep-links. The new `MANAGERIAL_ONLY_VIEWS` filter strips `'leader-alerts'` from `at_agent.views`, which surfaced the bug — opening `/?view=leader-alerts` redirected to briefing before the actual admin user was loaded. Fix: added `!user` short-circuit and `user` to the dep array. The `?view=hr-hub` deep-link from the bell hook was also affected by the same root cause — the new check repairs both.
- **Bug fixed (pre-existing)** — `team-members-merge.js`'s brand-new-row branch only set `isAnnouncementsAdmin` on the merged record; `isAccessAdmin` and `isHrHubAdmin` were silently dropped for users that exist only in `team_member_overrides` (not in the static baseline). Patched all three flags + `isLeaderAlertsAdmin` in the same line.
- **Verified untouched** — Existing Anomaly Alerts (`Alerts.jsx`, view id `'alerts'`), Feedback (`FeedbackView.jsx`), HR Hub (`HrHubView.jsx`), notification bell, roster server. No shared file edits beyond the additive plumbing points listed in Stage 1.

### 2026-05-02 — Stages 2–6 implementation pass

- **Self-caught FE bug** — `LeaderAlertsView.jsx` initially called `apiFetch('/api/v1/leader-alerts/settings')`. `apiFetch` already prepends `API_BASE = '/api/v1'`, so the request hit `/api/v1/api/v1/...` — 404 / proxy reject. Fixed to `apiFetch('/leader-alerts/settings')` and dropped the redundant `r.json()` wrap (the helper returns parsed JSON directly).
- **Composer Impact picker** — added a small UX guard for countries lacking a name in `getCountryName()` (e.g. AD, AL, XK, ZM): the secondary-line code is only shown when it differs from the label. Without this, the row stuttered as "AD — AD" / "AL — AL".
- **Verified end-to-end on the dev preview** — composer opens via the `+ → New Leaders Alert` entry, all five field groups render, severity radios light up the active option, the Impact picker opens a searchable dropdown with Global / Team pinned + countries A–Z, search filter narrows to "Kazakhstan" only when typing "kaz", clicking Kazakhstan adds a chip, clicking Global adds another chip. List view at 1440 px shows hero (60 px) + scope (32 px) + status cards (70 px) + filter bar (50 px) ≈ 212 px above the fold (skill §3.13 target ≤ 290 px). Settings drawer opens via the gear button and renders all three tabs with the categories / statuses / notifications editors.
- **Dev environment caveat** — the dev server proxies `/api/v1/*` to a remote backend that does NOT yet have these routes, so every Leaders Alerts API call returns 401. Full chassis verification (migration applies, tables exist, settings seeded, composer POST succeeds, ack/comments/reactions round-trip) happens post-deploy on Nexus. The FE is verified to compile, mount, render, navigate, and hit each endpoint with the correct path + auth header.

---

## Open items (track here; close in Decisions log when answered)

- [ ] **Notification matrix sign-off** — see "Notification matrix" section. Stage 4 will not start without an explicit `notifications: ok` from the user.
- [ ] **Sidebar position** — where between Announcements and HR Hub does the new tab sit? Defaulting to "after Announcements, before HR Hub" unless told otherwise.
- [ ] **Mention-overrides-mute** — currently proposed: a mention notifies even if the user has muted the thread. Confirm.
- [ ] **`@`-mention scope** — autocomplete from managerial roster only, or full org? Defaulting to managerial for noise control.
- [ ] **Alert deletion** — Alerts Admin can soft-delete. Should creator be allowed to delete their own (when the alert has 0 acks / 0 comments)? Defaulting to "no — admin only".
- [ ] **Ack on resolve** — when an alert moves to Resolved, do unacked managers still get the sidebar badge? Defaulting to "no — Resolved alerts drop off the badge count".
- [ ] **Mobile** — same deferral as HR Hub. Address in Stage 7 if usage warrants.

---

## Quick reference for future contributors

```bash
# Plan doc: this file
/Users/mohamed.tantawy/Desktop/ops-hub/LEADER_ALERTS_PLAN.md

# Component files (Stage 1+ creates these)
src/components/views/LeaderAlertsView.jsx
src/components/views/LeaderAlertDetailPanel.jsx
src/components/views/LeaderAlertComposer.jsx
src/components/views/LeaderAlertSettingsPanel.jsx

# Server
src/lib/leader-alerts-admin.js
app/api/v1/leader-alerts/alerts/route.js
app/api/v1/leader-alerts/alerts/[id]/route.js
app/api/v1/leader-alerts/alerts/[id]/ack/route.js
app/api/v1/leader-alerts/alerts/[id]/comments/route.js
app/api/v1/leader-alerts/comments/[id]/route.js
app/api/v1/leader-alerts/comments/[id]/reactions/route.js
app/api/v1/leader-alerts/alerts/[id]/followers/route.js
app/api/v1/leader-alerts/settings/route.js
app/api/v1/leader-alerts/settings/[key]/route.js

# Migration block
src/lib/migrate.js (search: "Leaders Alerts (2026-05-02)")

# Access type
src/data/accessControl.js (search: "leader-alerts" / "leader_alerts_admin")
```
