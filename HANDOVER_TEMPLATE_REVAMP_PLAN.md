# Handover Template Revamp — Plan

**Drafted 2026-05-18 (in response to Jessica's feedback "Add field so we can add a link to our Handover Doc" + Mohamed's broader ask "revamp the handover to be around the team's actual template + SOP, fillable directly in the app").**

**Locked decisions (Mohamed 2026-05-18):**
1. **Clean fields per section** — owners re-type into structured form fields; no one-shot Google Doc importer.
2. **No manager approval step** — collapses the state machine, simplifies the wizard, removes the approver lens.
3. **HR Hub scope only for this revamp** — single global SOP checklist; Payroll / GIX teams use their own surfaces in their workspaces.
4. **Coverer sees all 10 sections** — full country doc visibility regardless of role.

**UX bar (verbatim from Mohamed):** "Make sure the UI/UX is perfect there, cannot be a stupid UI."

That bar locks in:
- Feedback board layout pattern (skill §3.13) — hero + segmented scope + 4-up status cards + filter bar + row list.
- Every field gets a proper input type (URL inputs validated, dropdowns for enums, repeaters with drag-reorder for lists, markdown for descriptions, mention-textarea for stakeholder tags).
- Hover / focus / disabled / loading states on every interactive element.
- 1440 / 1280 / 1024 / 900 px viewport checks + 125% / 150% zoom.
- CSS variables for theme contexts (mistake #30); status colours stay literal.
- Long text ellipsizes; null / empty / overflow states handled.
- Save state is unambiguous ("Saved 2s ago" → "Unsaved" → "Saving…" → "Saved 2s ago").
- Print-friendly reader view (max-width 720px, serif body, page break per numbered section).
- Empty country docs show actionable empty state, not "—".

This extends [HANDOVERS_PLAN.md](./HANDOVERS_PLAN.md) which delivered Phase 1 (read-only OOO surface + schema). The current handover wizard ships a generic 12-item checklist that doesn't match what the HRX team actually uses. This plan replaces it with the team's real two-part workflow:

1. **Country Handover Doc** — the 10-section "Handover Document for HRX Operations - COUNTRY NAME" template the team currently fills in Google Docs. One per country. Long-lived. Owned by country owner(s).
2. **OOO Handover** — the per-vacation event. SOP checklist replaces today's default. Links to the relevant Country Handover Docs.

The current Slack hand-off pattern (`#hrx-just-the-kids` archived per Jessica's feedback) is what we're absorbing — the Ops Hub becomes the single source of truth.

---

## 1. Goal

Replace the placeholder handover content with the team's real workflow. Concretely:

- A team member going OOO doesn't write a fresh handover doc each time — they **point** the coverer to the country handover docs they own, plus run through the SOP checklist for the OOO process itself.
- Country handover docs live IN the Ops Hub, not in Google Docs. Filled with structured fields the template specifies. Searchable, version-tracked, country-owner-editable.
- Coverer view shows the country docs they need to read, the SOP checklist the requester completed, plus the OOO-event-specific notes.
- Approver (TL) view shows the same plus a "doc staleness" indicator (any country doc not updated in 90 d for the handed-off set surfaces a warning).
- Everything is rendered inline — no leaving the app.

---

## 2. Why two entities (and not one big form)

Reading the team's own SOP closely:

> "Create a vacation handover document (You can COPY THIS TEMPLATE) outlining ongoing cases, key contacts, and access information for critical resources."

The current pattern copies the template per vacation, which means the same country information is rewritten by hand every time someone in that country goes OOO. The template itself is country-scoped (every section is "for COUNTRY NAME"). When France's owner goes OOO this month and the same owner goes OOO again in three months, the doc content is ~95% identical.

Decoupling solves three problems:
- **Reuse**: the country owner edits the doc once; every OOO that hands off that country re-uses it.
- **Knowledge retention**: if the owner leaves, the next owner inherits a populated doc instead of a blank Google Doc template.
- **Discoverability**: any team member can read the country doc on demand (e.g. an agent who needs to cover for an unexpected sick day). Not gated on "is there a handover event tied to it."

The OOO event adds the dynamic data on top: dates, urgent items, who's covering which countries, and the SOP-checklist completion record.

---

## 3. The Country Handover Doc — data model

10 sections, each modelled with field types appropriate for what the template asks for (not free-form rich text).

### 3.1 New table: `country_handover_docs`

```sql
CREATE TABLE IF NOT EXISTS country_handover_docs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code        CHAR(2) NOT NULL UNIQUE,            -- ISO-2
  -- ── Section 1: Overview of HR Operations ──
  scope_responsibilities  TEXT,                            -- pre-filled default
  prepared_by_email       VARCHAR(255),                    -- pointer to members.email
  signatory               TEXT,
  official_languages      TEXT[],                          -- ['EN','FR']
  wet_ink_required        BOOLEAN,                         -- NULL = not yet specified
  payroll_cycle           VARCHAR(20),                     -- 'on_cycle' | 'off_cycle' | NULL
  payroll_cutoff_date     TEXT,                            -- free text — "15th of the month", "5 business days before EOM" etc.
  stakeholders            JSONB DEFAULT '[]'::jsonb,
    -- [{ role: 'PRM'|'Legal'|'CFM'|'Other', label: '...', name: '...', email: '...' }]
  -- ── Section 2: Payroll & Key Stakeholders ──
  slack_channel_name      TEXT,                            -- '#country-fr' or 'NONE'
  country_validation_url  TEXT,                            -- link
  onboarding_buffer       TEXT,                            -- free text
  -- ── Section 3: Onboarding process ──
  pre_onboarding_steps    JSONB DEFAULT '[]'::jsonb,       -- ordered [{ text }]
  manual_start_date_push  TEXT,
  onboarding_team_handles BOOLEAN,
  onboarding_guide_url    TEXT,
  country_specific_onboarding TEXT,
  -- ── Section 4: Post-Onboarding ──
  post_onboarding_steps   TEXT,
  -- ── Section 5: Amendments Review Process ──
  legal_amendment_handover_url TEXT,
  amendments_country_notes      TEXT,
  -- ── Section 6: Offboarding Process ──
  termination_process     TEXT,
  termination_handover_url TEXT,
  resignation_process     TEXT,
  -- ── Section 7: Benefits Management — repeating ──
  benefits                JSONB DEFAULT '[]'::jsonb,
    -- [{ benefit_type, provider_name, slack_channel, pocs, sop_url, country_process }]
  -- ── Section 8: Employment Verification ──
  evl_template_url        TEXT,
  evl_process_description TEXT,
  evl_sop_urls            TEXT[],
  -- ── Section 9: Country-specific processes ──
  visas_supported         BOOLEAN,
  pto_sop_urls            TEXT[],
  pto_key_aspects         TEXT,
  pto_carry_over_rules    TEXT,
  other_country_processes TEXT,
  -- ── Section 10: FAQ — repeating ──
  faqs                    JSONB DEFAULT '[]'::jsonb,
    -- [{ question, answer }]
  -- ── Misc ──
  docs_folder_url         TEXT,                            -- "Folder with Documents & Drafts Per Country"
  -- ── Metadata ──
  status                  VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- draft | published — 'draft' on first save; 'published' on first deliberate Save & Publish.
    -- Coverer view only renders published docs (with a "Draft — last edited X ago" pill
    -- for the owner so they know it's not yet shareable).
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_email        VARCHAR(255),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_country_handover_docs_status ON country_handover_docs(status, updated_at DESC);
```

**Why JSONB for repeating sections (stakeholders / benefits / FAQs / pre_onboarding_steps)?**
Each row is unbounded — Latvia might have 5 stakeholders, Brazil 12. Splitting into child tables triples the migration + API surface for no analytics value (these are read inline, never aggregated). JSONB with a known shape per index gives us the same DX as nested fields without the join cost.

**Why per-column scalars for the rest?**
Search + filter — e.g. "show every country where payroll_cycle = off_cycle" or "every country with no signatory yet". Free-text JSON blobs don't support that.

### 3.2 New table: `country_handover_doc_history` (audit log)

```sql
CREATE TABLE IF NOT EXISTS country_handover_doc_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id              UUID NOT NULL REFERENCES country_handover_docs(id) ON DELETE CASCADE,
  country_code        CHAR(2) NOT NULL,
  edited_by_email     VARCHAR(255) NOT NULL,
  edited_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  diff                JSONB NOT NULL,
    -- { field_key: { from: <old>, to: <new> } } — only changed fields
  comment             TEXT
);
CREATE INDEX idx_chd_history_doc ON country_handover_doc_history(doc_id, edited_at DESC);
```

Powers the "Updated on: DATE" footer + a "View history" affordance in the editor. Same pattern as `leader_alert_settings_history`.

### 3.3 Backfill — `team_member_countries` already gives us ownership

The picker (`MultiCountryPicker.jsx` per skill §3.7) writes to `team_member_countries` via the Team tab. The `OWNER_COUNTRIES` / `COUNTRY_OWNERS` live-binding (skill §3.7) means we already know who owns which countries.

When `country_handover_docs.prepared_by_email` is empty, the editor defaults it to the first member with that country in `team_member_countries`. If the country owner changes (via the picker), the doc isn't reassigned automatically — the existing `prepared_by_email` stays as a historical record. The "Edit" gating uses `team_member_countries` at request time, not the stored `prepared_by_email`.

### 3.4 Seed: pre-populate one row per country we know about

On first boot (`SEED_VERSION` pattern per skill §3.8), insert a `status = 'draft'` row for every country code currently present in `team_member_countries`. All sections start empty — the owner fills them. This gives a stable URL per country (`/handover-docs/FR`) even before the doc is written.

---

## 4. The OOO Handover changes

### 4.1 Replace the default checklist with the SOP checklist

The SOP gives the exact list. Translating verbatim into checklist items (one per actionable step the team member must do BEFORE going on vacation):

```js
const HRX_SOP_CHECKLIST = [
  // a) Backup Awareness
  { id: 'backup_identified',      label: 'Backup team member identified',                                              required: true,  hint: 'Communicate the specific countries you are handing over' },
  { id: 'country_faq_shared',     label: 'Country FAQ doc(s) shared with backup',                                      required: true,  hint: 'See your Country Handover Doc — section 10' },
  { id: 'critical_tasks_flagged', label: 'Critical tasks / deadlines flagged to backup',                               required: true,  hint: 'Urgent terminations, project deadlines, outstanding client comms' },
  // b) Google Calendar
  { id: 'google_calendar_ooo',    label: 'Marked OOO in Google Calendar',                                              required: true },
  // c) Workbench
  { id: 'workbench_offline',      label: 'Workbench status set to Offline',                                            required: true,  hint: 'Profile → Status (top right) → Offline' },
  // d) Zendesk
  { id: 'zendesk_ooo',            label: 'Zendesk profile toggled to Out of Office',                                   required: true,  hint: 'Profile icon → View profile → Toggle OOO' },
  // e) Jira & Slack visibility
  { id: 'jira_ooo',               label: 'Jira OOO set via Out-of-Office Assistant',                                   required: true },
  { id: 'hrx_workflow_submitted', label: 'HRX / GIX handover request submitted in the Slack workflow',                 required: true,  hint: 'Submit at least 1 hour before your follower logs off' },
  { id: 'slack_status',           label: 'Slack status updated with backup details',                                   required: true },
  { id: 'calendar_meetings',      label: 'Calendar meetings rescheduled or coverer added',                             required: true,  hint: 'Including Cal.com bookings' },
  { id: 'country_channels_backup',label: 'Backup added to country Slack channels',                                     required: true },
  { id: 'email_autoresponder',    label: 'Email autoresponder set with backup contact',                                required: true },
  // 3. Task Management
  { id: 'tickets_reassigned',     label: 'Open / on-hold / pending Zendesk + Workbench tickets reassigned to backup',  required: true },
  { id: 'jira_reassigned',        label: 'Open / on-hold / pending Jira tickets reassigned (incl. HRX responsible)',   required: true,  hint: 'Offboarding tickets: update the HRX responsible field on the right' },
  { id: 'tickets_notes_added',    label: 'Internal notes / context added to handed-over tickets',                      required: true },
  // 4. Country team notification
  { id: 'country_team_notified',  label: 'Country Slack channel(s) notified of vacation + backup',                     required: true },
];
```

That's 16 items vs today's 12 — most are 1:1 mappable; we drop the generic ones (`escalations`, `hr_hub_followups`) since the SOP doesn't ask for them, but keep them as optional template overrides for non-HRX teams later. The OPTIONAL items the team can add: `escalations_shared`, `hr_hub_followups`.

Migration path:
- `HANDOVER_DEFAULTS_VERSION` bump triggers re-seed with the new items.
- Existing in-flight `handover_checklist_items` rows are kept as-is (they snapshot at submit-time).
- Any `handovers` already submitted with the old checklist remain valid history.

### 4.2 State machine — TL approval removed

Today: `draft → pending_coverage_acceptance → pending_manager_approval → approved → active → completed`.

Revamped (no TL approval per locked decision #2): `draft → pending_coverage_acceptance → accepted → active → completed`.

This drops:
- `manager_approval_required`, `manager_decision_at`, `manager_decision_note` columns on `handovers` (kept for historical rows but stop writing).
- `pending_manager_approval` status — any in-flight row in this state on deploy gets auto-transitioned to `accepted` if at least one coverer has accepted, else back to `pending_coverage_acceptance`.
- `approvals` lens chip + `approvalsCount` from auto-lens.
- Approval emails / bell notifications.
- `LENS_IDS.APPROVALS` in handover-helpers.

`auto-lens` simplifies to: covering-pending > 0 → COVERING; mine-missing > 0 → MINE; manager → TEAM; else MINE.

The visible-scope clip exemption added in fix #3 (PR #651) for `APPROVALS` becomes dead code — Phase A removes it.

Side effect: managers can still SEE their team's handovers via the TEAM lens, just can't approve/reject. The detail slide-out's approver-only buttons (Approve / Reject) get hidden. They retain the "Question for the requester" affordance from §4.3.

### 4.3 Wizard step changes

Today's wizard: `(1) pick event → (2) pick coverers + countries → (3) checklist → (4) review`.

Revamped wizard: `(1) event → (2) coverer + countries → (3) country docs verification → (4) SOP checklist → (5) review`.

**Step 3 new — Country docs verification**

For each country in the handed-off set, render a strip:

```
🇫🇷 FR — France
   Country Handover Doc · Updated 12 days ago · 3 stakeholders, 2 benefits, 4 FAQs
   [ Open & review ]  [ Edit ]
```

If the doc is `status = 'draft'` or stale (> 90 d since update) or has unfilled required fields, show an amber warning:
```
⚠️ Slovakia (SK) — Country Handover Doc is a draft. Coverer won't see it until you publish.
   [ Open & complete ]
```

Submit gated: a country with NO published doc blocks step 3 unless the requester explicitly checks "I will brief the coverer directly for SK".

This is the bridge: the OOO event is the moment we audit the country doc state. Owners are incentivised to keep their docs fresh.

**Step 4 — SOP checklist** (renamed from "Checklist"; content as above).

### 4.4 Coverer view (DetailSlideOut / "Read handover" tab)

When a coverer opens an invitation, the slide-out has 3 stacked sections:

1. **OOO event** — dates, requester, urgent items the requester flagged. (No manager line — TL approval removed.)
2. **Country handover docs** — one collapsed card per country they're covering. Click expands to render the 10 sections inline (read-only, nicely formatted with the same field layout as the template). Includes the "Updated on: DATE" footer.
3. **SOP checklist status** — what the requester ticked / left unticked. Plus the "I'll brief directly for X" overrides if any.

The coverer can Accept / Decline from this view (existing flow). New affordance: "Question for the requester" — posts a comment back to them via the existing handover_log + bell notification.

### 4.5 Team Lead view (read-only oversight, no gate)

TLs / RMs see their team's handovers via the TEAM lens. The detail slide-out renders the same 3 sections as the coverer view. No Approve / Reject buttons (TL approval was removed). Doc-health pills + checklist completion % still surface so the TL has visibility, but the handover proceeds the moment the coverer accepts.

TLs retain the "Question for the requester" comment thread if they want to flag something pre-OOO.

---

## 5. UI surfaces — what to build

### 5.1 `CountryHandoverDocView.jsx` (new, full-page)

Accessible from:
- OOO tab → "Country docs" sub-tab (managers + country owners).
- Settings → Handover docs (admins).
- Deep-link from the wizard's Step 3 "Open & Edit" button.

Layout:
- Left rail: country list (filtered to user's editable countries by default; "All" toggle for admins).
- Main area: 10-section form, one section per accordion. Save button + status indicator ("Saved 2s ago" / "Unsaved changes").
- Right rail: history (last 10 edits), stakeholder quick-jump, "Open in print view" affordance for offline reading.

Field types:
- TEXT inputs for short strings (Signatory, Slack channel).
- RICH TEXTAREA (markdown-rendered) for descriptions (Termination process, Resignation process, PTO key aspects, etc.). Reuse `MentionTextarea` from the HR Hub for tagging stakeholders.
- URL inputs for "[Provide link]" fields with `https://` validation.
- SELECT for enum fields (payroll_cycle, wet_ink_required).
- TAG INPUT for `official_languages`, `pto_sop_urls`.
- REPEATER for stakeholders, benefits, FAQs, pre_onboarding_steps (add / remove rows, drag to reorder).

### 5.2 Reader view (used by coverer + approver)

Same JSX as the editor with `readOnly` prop — toggles inputs to display-only blocks, hides Save button, hides empty optional fields, keeps required-but-empty fields visible with a "—" placeholder so reviewers know they're missing.

### 5.3 Wizard Step 3 strip

New component `CountryDocStatusStrip.jsx`. Reads a list of country codes, fetches doc statuses, renders the per-country cards described in §4.2.

### 5.4 Briefing/Home banner: "Country docs needing attention"

For country owners: a banner card on Home if any owned country has:
- Status = draft, OR
- Last updated > 90 d ago, OR
- Required fields unfilled (signatory, payroll_cycle, stakeholders empty)

Click → CountryHandoverDocView jumped to the worst-offender country.

---

## 6. APIs

```
GET    /api/v1/country-handover-docs                  → list + status per country
GET    /api/v1/country-handover-docs/:countryCode     → full doc
PATCH  /api/v1/country-handover-docs/:countryCode     → partial update (audited)
POST   /api/v1/country-handover-docs/:countryCode/publish    → flip draft → published
GET    /api/v1/country-handover-docs/:countryCode/history    → audit trail
GET    /api/v1/handovers/:id/country-docs             → resolves which country docs apply to the handover
```

Auth:
- GET routes: any authed user can read PUBLISHED docs (skip-scope — coverers may not be in the country owner's reporting tree, same logic as PR #651 covering lens).
- PATCH/publish: country owner per `team_member_countries` OR `is_hr_hub_admin` OR `admin`.
- History: same gates as PATCH (it can carry sensitive notes).

Rate limits + caching:
- List endpoint cached 60 s server-side (Redis-style in-memory; same pattern as `useTeamMembers`).
- Detail endpoint not cached — edits land quickly.

---

## 7. Permissions

Build TWO helpers per skill mistake #47 (visibility scope ≠ write permission scope):

```js
// READ — anyone with a covered country, or admins, or anyone (for the cross-team coverage case)
function canReadCountryHandoverDoc(user, doc) {
  if (isAdminUser(user)) return true;
  if (doc.status !== 'published') return canEditCountryHandoverDoc(user, doc.country_code);
  return true; // published docs are org-readable
}

// WRITE — own the country, are HR Hub admin, or full admin
function canEditCountryHandoverDoc(user, countryCode) {
  if (isAdminUser(user)) return true;
  if (isHrHubAdmin(user)) return true;
  const owned = (user.countries || []).map(c => c.toUpperCase());
  return owned.includes(countryCode.toUpperCase());
}
```

Add to the `is_hr_hub_admin` patterns already documented in skill §3.9b — same five plumbing points.

---

## 8. Phases (one PR each, all targeting `dev`)

Estimating 1–2 days of focused work per phase. Each phase is self-contained — could ship and stop without breaking anything.

### Phase A — Foundation + TL-approval removal (1 PR)
- Add `country_handover_docs` + `country_handover_doc_history` tables to `migrate.js`.
- Seed one `draft` row per known country (from `team_member_countries`).
- Backend: list / read / patch / publish / history routes (auth gated per §7).
- **Remove TL approval (§4.2):**
  - Backfill in `migrate.js`: any `handovers` row with `status = 'pending_manager_approval'` → set to `accepted` if any coverer has `acceptance_status = 'accepted'`, else back to `pending_coverage_acceptance`.
  - Drop `APPROVALS` from `LENS_IDS` and from `autoLens`.
  - Drop the `/handovers/lens-counts` approval count.
  - Drop the approver lens query in `/time-off-events`.
  - Remove the lens chip + ActionBanner branch.
  - (PR #651's visible-scope exemption for `APPROVALS` becomes dead code — remove it in the same PR.)
- No new UI yet for country docs.
- **Done = `curl /api/v1/country-handover-docs` returns ~50 stub rows; lens chips on OOO drop "Approvals"; no in-flight handover regresses.**

### Phase B — Country Handover Doc editor (1 PR)
- New `CountryHandoverDocView.jsx` accessible from OOO tab's "Country docs" sub-tab.
- 10 sections rendered as collapsible accordions; one section per accordion.
- Field-type matrix (no free-form rich text where structured data is asked for):
  | Section field                  | Input type                                       |
  |---                              |---                                               |
  | Scope of Responsibilities       | Markdown textarea (preview tab)                  |
  | Prepared By                     | Member picker (typeahead, members.email)         |
  | Signatory                       | Text input + optional email link                 |
  | Official Languages              | Tag input (ISO-639 list typeahead)               |
  | Wet Ink Required                | Toggle Yes / No / Unknown                        |
  | Payroll Cycle for Termination   | Segmented control: On-cycle / Off-cycle          |
  | Payroll Cut-off Date            | Text input ("e.g. 15th of the month")            |
  | Stakeholders                    | Repeater: role select + name + email + Slack DM  |
  | Slack Country Channel Name      | Text input prefixed with `#` (autocomplete)      |
  | Link to Country Validation      | URL input (validated, `https://` required)       |
  | Onboarding Buffer Time          | Text input + helper sentence                     |
  | Pre-Onboarding Steps            | Repeater of ordered text lines                   |
  | Manual Start Date Push          | Text input                                       |
  | Does Onboarding Team Handle…    | Toggle Yes / No                                  |
  | Onboarding Guide Link           | URL input                                        |
  | Country-Specific Onboarding…    | Markdown textarea                                |
  | Post-Onboarding Steps           | Markdown textarea                                |
  | Legal Amendment Handover URL    | URL input                                        |
  | Amendments country notes        | Markdown textarea                                |
  | Termination Process             | Markdown textarea + URL input for handover link  |
  | Resignation Process             | Markdown textarea                                |
  | Benefits                        | Repeater: type + provider + Slack + POCs + SOP   |
  | EVL Template                    | URL input                                        |
  | EVL Process Description         | Markdown textarea + multi-URL SOP list           |
  | Visas Supported                 | Toggle Yes / No                                  |
  | PTO Policies                    | Markdown textarea + multi-URL list + carry-over  |
  | Other Country-Specific          | Markdown textarea                                |
  | FAQs                            | Repeater: question + answer (markdown)           |
  | Docs Folder URL                 | URL input                                        |
- Save state machine: idle → "Unsaved" badge → autosave to `/api/v1/country-handover-docs/:cc PATCH` (debounced 800ms) → "Saving…" → "Saved 2s ago".
- Publish flow: explicit "Save & Publish" button (only when status=draft); confirmation dialog ("Coverers will be able to read this doc until you unpublish — proceed?"); audit-logged.
- History pane: right rail collapsible. Shows last 20 edits with "Edited by · 2h ago · 4 fields changed". Click → diff overlay.
- Country owner gating per `team_member_countries`; HR Hub admins + admins always edit. Read-only for everyone else (with helpful banner: "Only Aitor & Marta can edit this doc — talk to them or HR Hub admins").
- **Done = a country owner can fill the FR doc end-to-end, publish it, and re-edit; history records the changes; non-owner gets a read-only view with the explanation.**

### Phase C — SOP checklist swap (1 PR)
- Bump `HANDOVER_DEFAULTS_VERSION`, re-seed the default template with the SOP items (HR-Hub scope; not surfaced in Payroll / GIX wizards since those workspaces don't use this surface).
- In-place migration: any unsubmitted draft handovers get their `handover_checklist_items` rows refreshed to the new items (preserve `completed` state via `item_id` match where a prior item maps to a new one; retire items with no match by adding `note: 'retired in v2'`).
- Submitted handovers untouched.
- Wizard Step 3 (today's "Checklist" step) gets the new copy + new helper sentences from the SOP.
- **Done = a fresh handover draft surfaces the 16 SOP items + 2 optional override items.**

### Phase D — Wizard integration (1 PR)
- New wizard Step 3 ("Country docs verification"): `CountryDocStatusStrip.jsx` — one card per handed-off country with status pill (Fresh / Stale / Draft / Missing required fields).
- Step gating: a country with NO published doc blocks Step 3 unless the requester explicitly toggles "I will brief the coverer directly for SK" + types a one-line reason.
- "Edit doc" affordance jumps to the editor (Phase B) in a new tab so the requester doesn't lose wizard state.
- Doc-state computed at request time (fresh / stale / draft / missing fields).
- Wire up the Briefing Home banner for owners with stale docs.
- **Done = creating a handover with country FR + SK either shows two fresh docs OR forces the requester to handle SK's missing doc before submit.**

### Phase E — Coverer reader view (1 PR)
- DetailSlideOut for coverer: 3 stacked sections (event / country docs / checklist status).
- Country docs render inline using the same JSX as the Phase B editor in `readOnly` mode.
- Doc-health pills surface for the section header so a coverer knows what they're looking at.
- "Question for requester" comment thread on the handover (reuses `handover_log` polymorphism, `event_type = 'coverer_question'`).
- **Done = a coverer can read the full France handover doc inline + see the SOP completion status without leaving the OOO tab.**

### Phase F — Polish (1 PR, can ship anytime after E)
- Stale-doc banner on Home for country owners.
- Print/PDF export from reader view (CSS @media print + a "Print" button — useful for offline OOO prep).
- Audit log surface in Settings → Handovers.
- Country doc search (typeahead by country / stakeholder / FAQ keyword).
- Bulk-edit helper for "set benefits info across all countries with same provider".

---

## 9. Three Pillars considerations

### Pillar 1 — Four roles

- **Agent**: read access to published country docs they touch as a coverer. No edit unless `is_hr_hub_admin` or they own the country via the Team-tab picker.
- **Team Lead**: read all team's country docs + handovers via the TEAM lens (oversight, no approval gate). Doc-health pills + checklist completion % visible. Can post "Question for requester" comments.
- **Regional Manager**: read all docs in region; same oversight visibility as TL across multiple teams.
- **Director / Admin**: full read/write on all docs; can re-assign `prepared_by_email`; sees the cross-region stale-doc dashboard; full audit log in Settings.

### Pillar 2 — Tree view

Untouched. Country handover docs are keyed on country, not on team. The `country owner` taxonomy from `team_member_countries` is reused but the existing Team tree view rendering (Team.jsx / Briefing Team Leads card / EscalationsView grouping) stays as-is.

One UX consideration for Phase F: the country-docs list should *optionally* offer a Team-tree filter ("show me only countries owned by people in my team") for managers. That's polish, not core.

### Pillar 3 — UI polish

- Match the existing HR Hub / Feedback board pattern (skill §3.13): hero header, segmented scope toggle (Mine / All), 4-up status cards (Fresh / Stale / Draft / Outdated), filter bar, row list.
- Use CSS variables exclusively for theme-aware contexts (mistake #30). Status colors stay literal (✓ green, ⚠ amber, ❌ red).
- Editor form fields lift directly from the HR Hub composer + Leader Alerts settings panel — same field components for free-text, URL, select, repeater.
- Reader view print-friendly: max-width 720px, serif body, page breaks before each numbered section.

---

## 10. Edge cases + open questions

1. **Country owner changes mid-OOO**: the wizard's Step 3 reads `team_member_countries` at request time, so if Aitor takes over France from someone else, his next handover surfaces the existing FR doc. The doc's `prepared_by_email` stays historical until he edits + saves.
2. **Multiple owners per country**: skill §3.7 says "live-binding `let` exports populated on every roster hydration". The schema supports it. UI shows "Owners: A, B" and either can edit.
3. **Coverer NOT in country owners**: handled by §7 read auth — published docs are org-readable.
4. **Country with no `team_member_countries` row**: the seed skips it. First time someone is assigned the country, the seed runs again? No — seed is version-based + idempotent. We add an "Add new country" affordance in the editor that inserts a fresh row on demand (admins only).
5. **Doc deletion**: never. Country owners change; docs persist. Admin-only soft-delete via `status = 'archived'` if a country is no longer covered.
6. **Backward compat with current OOO handovers in flight**: see Phase C. Submitted handovers keep their original checklist. Drafts get refreshed.
7. **Question for the requester** thread: reuse `handover_log` polymorphism rather than a new comments table. `event_type = 'coverer_question'`, content in the metadata column.

**Decisions locked 2026-05-18 (see top of doc):**
- ~~Q1: Google Doc import vs re-type~~ → **Owners re-type** into clean per-section fields.
- ~~Q2: TL approval / draft visibility~~ → **No TL approval at all** (§4.2). Draft docs visible to owners + admins only; published docs org-readable.
- ~~Q3: Single vs per-team checklist~~ → **Single global SOP checklist for HR Hub only.** Other workspaces (Payroll / GIX / Command Center) keep their own surfaces and are out of scope for this revamp.
- ~~Q4: Coverer doc sections~~ → **All 10 sections shown to every coverer.** Sections with empty optional fields collapse by default but are expandable.

---

## 11. Risk + dependencies

- **No DB migration risk** if I follow the Phase A pattern (additive tables only, no FK to existing tables — except `country_handover_doc_history.doc_id`). Reseeds are idempotent.
- **`handover_checklist_items` migration in Phase C** is the only risky touch — drafts get their items refreshed by `item_id` match. Items with the same `item_id` keep their `completed` state; items with retired IDs (the dropped `escalations` / `hr_hub_followups`) get archived to `note: 'retired in v2'`. Submitted handovers (status != 'draft') are not touched.
- **No external API dependencies** — entirely Ops-Hub internal.
- **No HR data wipe risk** — additive schema, no DROP / TRUNCATE.

---

## 12. Order of operations to start (after user sign-off)

1. **Confirm the 4 open questions** in §10.
2. **Sign off on the phase order** (or request reordering — Phases B+C could swap if user wants the SOP checklist live before the editor).
3. **Phase A first PR** — schema + seed. Lands invisible.
4. **Phase B second PR** — editor goes live for country owners only. Soft-launch.
5. **Phase C third PR** — SOP checklist swap. Visible change in the existing wizard.
6. **Phase D fourth PR** — wizard integration. Country owners must publish before they can hand off.
7. **Phase E fifth PR** — coverer + approver reader views. The "delight" phase.
8. **Phase F** — polish + reporting.

Per skill §3.10 (long-running multi-stage builds): direct commits to `nexus/dev` with rebase-on-fetch authorised by the user's batch-deploy directive. Each phase ticks the boxes in this plan's §8 in the same commit; this plan doc is the living source of truth.
