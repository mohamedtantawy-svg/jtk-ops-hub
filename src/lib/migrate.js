import { query } from './db';

const SCHEMA_SQL = `
-- Members
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  initials VARCHAR(4),
  role VARCHAR(50) DEFAULT 'agent',
  team VARCHAR(100),
  region VARCHAR(100),
  country VARCHAR(10),
  lead_id INTEGER,
  email VARCHAR(255) UNIQUE NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(100) UNIQUE,
  source VARCHAR(50) DEFAULT 'manual' NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  status VARCHAR(30) DEFAULT 'open' NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium' NOT NULL,
  assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  country_code VARCHAR(10),
  tags TEXT[] DEFAULT '{}',
  external_url TEXT,
  reporter_id VARCHAR(255),
  snoozed_until TIMESTAMPTZ,
  source_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task notes
CREATE TABLE IF NOT EXISTS task_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  author_name VARCHAR(255),
  body TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task activity
CREATE TABLE IF NOT EXISTS task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  event_type VARCHAR(50),
  event_text TEXT,
  actor_name VARCHAR(255),
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- Escalations
CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  subject TEXT,
  reason TEXT NOT NULL,
  escalated_by VARCHAR(255),
  escalated_at TIMESTAMPTZ DEFAULT NOW(),
  manager_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  manager_name VARCHAR(255),
  status VARCHAR(30) DEFAULT 'pending' NOT NULL,
  manager_response_status VARCHAR(50) DEFAULT 'pending_response',
  manager_response TEXT,
  manager_responded_at TIMESTAMPTZ,
  manager_responded_by VARCHAR(255),
  escalation_source VARCHAR(50) DEFAULT 'ticket',
  slack_channel VARCHAR(255),
  slack_user VARCHAR(255),
  slack_message_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  type VARCHAR(100) DEFAULT 'general',
  status VARCHAR(50) DEFAULT 'active' NOT NULL,
  priority VARCHAR(50) DEFAULT 'medium' NOT NULL,
  owner_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  team_id VARCHAR(100),
  deadline DATE,
  description TEXT,
  progress INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Requests
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  description TEXT,
  to_team VARCHAR(100),
  status VARCHAR(50) DEFAULT 'open' NOT NULL,
  priority VARCHAR(50) DEFAULT 'medium',
  from_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  task_id UUID,
  external_ref VARCHAR(255),
  notes TEXT,
  due_date DATE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) DEFAULT 'general' NOT NULL,
  title VARCHAR(500) NOT NULL,
  body TEXT,
  target VARCHAR(100) DEFAULT 'all',
  priority VARCHAR(50) DEFAULT 'normal',
  is_popup BOOLEAN DEFAULT false,
  image_url TEXT,
  link TEXT,
  status VARCHAR(50) DEFAULT 'draft' NOT NULL,
  author_id INTEGER,
  pinned BOOLEAN DEFAULT false,
  read_by JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcement comments
CREATE TABLE IF NOT EXISTS announcement_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  author_id INTEGER,
  author_name VARCHAR(255),
  body TEXT NOT NULL,
  parent_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcement reactions
CREATE TABLE IF NOT EXISTS announcement_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  user_id INTEGER,
  emoji VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id, emoji)
);

-- Announcement links (linking two announcements)
CREATE TABLE IF NOT EXISTS announcement_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  target_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id)
);

-- Project milestones
CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  due_date DATE,
  sort_order INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Project members (join table)
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  role VARCHAR(100) DEFAULT 'contributor',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, member_id)
);

-- Project tasks (join table)
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, task_id)
);

-- App settings (key-value store for shared config like Manager on Call)
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations tracking
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Performance indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
CREATE INDEX IF NOT EXISTS idx_tasks_country ON tasks(country_code);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_snoozed_until ON tasks(snoozed_until) WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_manager ON escalations(manager_id);
CREATE INDEX IF NOT EXISTS idx_escalations_created ON escalations(created_at DESC);

-- Escalations identity + audit columns (additive, preserves all existing rows)
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS escalated_by_email VARCHAR(255);
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS escalated_by_id    INTEGER REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS resolved_by        VARCHAR(255);
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS severity           VARCHAR(20) DEFAULT 'medium';

CREATE INDEX IF NOT EXISTS idx_escalations_escalated_by_email ON escalations(escalated_by_email);
CREATE INDEX IF NOT EXISTS idx_escalations_escalated_by_id    ON escalations(escalated_by_id);

-- Best-effort backfill for historical rows whose escalated_by happens to match a members.name
UPDATE escalations e
   SET escalated_by_email = m.email,
       escalated_by_id    = m.id
  FROM members m
 WHERE e.escalated_by_email IS NULL
   AND e.escalated_by = m.name;

-- ── Announcements: additive columns for existing tables ─────────────────────
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS read_by   JSONB DEFAULT '[]'::jsonb;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sound_key VARCHAR(32) DEFAULT 'chime';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sent_at   TIMESTAMPTZ;

-- ── Announcement acks: source-of-truth per-user ack rows (never deleted) ────
CREATE TABLE IF NOT EXISTS announcement_acks (
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL,
  user_email      VARCHAR(255),
  acked_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ann_acks_user ON announcement_acks(user_id);
CREATE INDEX IF NOT EXISTS idx_ann_acks_ann  ON announcement_acks(announcement_id);

-- Idempotent backfill from legacy read_by JSONB → announcement_acks rows
-- Only runs if the read_by column exists (it may not on fresh installs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='announcements' AND column_name='read_by') THEN
    INSERT INTO announcement_acks (announcement_id, user_id, acked_at)
    SELECT a.id, (uid)::int, a.updated_at
      FROM announcements a, jsonb_array_elements_text(COALESCE(a.read_by, '[]'::jsonb)) uid
     WHERE NOT EXISTS (SELECT 1 FROM announcement_acks x WHERE x.announcement_id = a.id AND x.user_id = (uid)::int)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Backfill user_email for legacy ack rows that were recorded before we started
-- storing the email on each ack. The frontend prefers email matching (drift-
-- proof vs member-id re-seeds), so every row needs one. Safe to re-run: we
-- only update rows where user_email is NULL and the member lookup succeeds.
UPDATE announcement_acks aa
   SET user_email = LOWER(m.email)
  FROM members m
 WHERE aa.user_email IS NULL
   AND m.id = aa.user_id
   AND m.email IS NOT NULL;

-- ── 2026-04-24: promote user_email to the canonical ack identity ────────────
-- The previous PK was (announcement_id, user_id). That broke for every user
-- whose JWT sub=0 — which is what the email/Google login paths issue for
-- anyone authenticated only via team_member_overrides (i.e. most of the
-- 104-person roster, since the seed members table only has 20 rows). These
-- users' acks all collided on (announcement_id, 0) and either silently
-- dropped (ON CONFLICT DO NOTHING) or, when user_id couldn't be resolved at
-- all, the /read endpoint returned 400 and the ack was never persisted.
--
-- New scheme: user_email is the PK. It's the identity the frontend already
-- matches on anyway (see ackEmails source-of-truth comments in the hook),
-- it's case-normalised on write and read, and it doesn't depend on a
-- members.id ever being resolvable.
DO $$
DECLARE
  old_pk_on_user_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'announcement_acks'::regclass
      AND c.contype = 'p'
      AND a.attname = 'user_id'
  ) INTO old_pk_on_user_id;

  IF old_pk_on_user_id THEN
    -- Make sure every surviving row has a usable email before we promote
    -- user_email to NOT NULL.
    UPDATE announcement_acks aa
       SET user_email = LOWER(m.email)
      FROM members m
     WHERE aa.user_email IS NULL
       AND m.id = aa.user_id
       AND m.email IS NOT NULL;

    -- Rows that still have NULL user_email are pre-fix ghost acks (user_id=0
    -- with no corresponding member). Synthesise a placeholder so the new
    -- NOT NULL + PK hold; these synthetic emails will never match a real
    -- caller, so ack checks behave exactly as they did before (the user
    -- simply stays "pending" against those rows, which is already the
    -- correct answer).
    UPDATE announcement_acks
       SET user_email = 'legacy-' || COALESCE(user_id, 0) || '@unknown.local'
     WHERE user_email IS NULL;

    -- Case-normalise existing values so new inserts' lowercased emails
    -- conflict correctly with legacy rows.
    UPDATE announcement_acks
       SET user_email = LOWER(user_email)
     WHERE user_email <> LOWER(user_email);

    -- Defensive dedup in case historical writes produced two rows for the
    -- same (announcement, email). Keeps the oldest by ctid.
    DELETE FROM announcement_acks aa
     USING announcement_acks bb
     WHERE aa.ctid > bb.ctid
       AND aa.announcement_id = bb.announcement_id
       AND aa.user_email = bb.user_email;

    ALTER TABLE announcement_acks DROP CONSTRAINT announcement_acks_pkey;
    ALTER TABLE announcement_acks ALTER COLUMN user_email SET NOT NULL;
    ALTER TABLE announcement_acks ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE announcement_acks ADD CONSTRAINT announcement_acks_pkey
      PRIMARY KEY (announcement_id, user_email);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ann_acks_user_email ON announcement_acks(user_email);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_to_team ON requests(to_team);
CREATE INDEX IF NOT EXISTS idx_requests_from_member ON requests(from_member_id);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);

-- ── Google Calendar integration ─────────────────────────────────────────────
-- One row per user that has connected a Google Calendar. The refresh_token is
-- encrypted at rest with AES-256-GCM (key: CALENDAR_TOKEN_ENCRYPTION_KEY env
-- var; see src/lib/token-crypto.js). The cleartext access_token is stored as
-- an optimization — it's already short-lived (1h) and Google treats it as a
-- bearer credential we have to send over the wire every request anyway, so
-- encrypting it in the DB adds no real protection. The refresh_token, by
-- contrast, is long-lived (until user revokes) and MUST be encrypted.
--
-- Connection lifecycle:
--   1. User clicks "Connect Google Calendar" → OAuth start route generates a
--      signed state JWT (5min TTL) containing their email, returns Google
--      auth URL.
--   2. User consents → Google redirects to /api/v1/calendar/oauth/callback
--      with code + state. Callback verifies state JWT, exchanges code for
--      refresh_token + access_token, upserts this row.
--   3. Subsequent API calls (listEvents etc.) pull the row, refresh the
--      access_token if expired, update expires_at.
--   4. Disconnect → DELETE /api/v1/calendar/connection drops the row.
--
-- If the user later revokes access at myaccount.google.com, the next refresh
-- attempt returns invalid_grant and we mark last_error so the UI can prompt
-- the user to reconnect.
CREATE TABLE IF NOT EXISTS calendar_tokens (
  user_email              VARCHAR(255) PRIMARY KEY,
  refresh_token_encrypted BYTEA        NOT NULL,
  refresh_token_iv        BYTEA        NOT NULL,
  access_token            TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scopes                  TEXT         NOT NULL,
  calendar_id             TEXT         DEFAULT 'primary',
  google_email            VARCHAR(255),
  connected_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  DEFAULT NOW(),
  last_error              TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_tokens_google_email ON calendar_tokens(google_email);

-- Local-only calendar events — user-created "quick reminders" that don't sync
-- back to Google. Keyed by (user_email, id) so every user owns their own set
-- and cross-device persistence comes for free (vs storing in localStorage).
-- start_at / end_at are UTC timestamps; the client renders in the user's
-- local timezone.
CREATE TABLE IF NOT EXISTS calendar_local_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  VARCHAR(255) NOT NULL,
  title       TEXT         NOT NULL,
  description TEXT,
  start_at    TIMESTAMPTZ  NOT NULL,
  end_at      TIMESTAMPTZ  NOT NULL,
  color       VARCHAR(16)  DEFAULT 'blue',
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_local_events_user_start
  ON calendar_local_events(user_email, start_at);

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned_created ON announcements(pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_comments_ann ON announcement_comments(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reactions_ann ON announcement_reactions(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_links_source ON announcement_links(source_id);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_members_role ON members(role);
CREATE INDEX IF NOT EXISTS idx_members_region ON members(region);
CREATE INDEX IF NOT EXISTS idx_members_active ON members(is_active);

-- ── Check constraints ────────────────────────────────────────────────────────
-- First: fix any rows with invalid data so constraints can be applied cleanly
UPDATE tasks SET status = 'open' WHERE status NOT IN ('open','new','pending','in_progress','escalated','snoozed','waiting','resolved','closed');
UPDATE tasks SET priority = 'medium' WHERE priority NOT IN ('critical','high','medium','low');
UPDATE escalations SET status = 'pending' WHERE status NOT IN ('pending','in_progress','resolved','dismissed');
UPDATE projects SET progress = LEAST(100, GREATEST(0, COALESCE(progress, 0))) WHERE progress < 0 OR progress > 100 OR progress IS NULL;

DO $$ BEGIN
  -- Drop and recreate check constraints to ensure they match current code
  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;
  ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status CHECK (status IN ('open','new','pending','in_progress','escalated','snoozed','waiting','resolved','closed'));

  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_priority;
  ALTER TABLE tasks ADD CONSTRAINT chk_tasks_priority CHECK (priority IN ('critical','high','medium','low'));

  ALTER TABLE escalations DROP CONSTRAINT IF EXISTS chk_escalations_status;
  ALTER TABLE escalations ADD CONSTRAINT chk_escalations_status CHECK (status IN ('pending','in_progress','resolved','dismissed'));

  ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_progress;
  ALTER TABLE projects ADD CONSTRAINT chk_projects_progress CHECK (progress >= 0 AND progress <= 100);
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_announcements_author') THEN
    ALTER TABLE announcements ADD CONSTRAINT fk_announcements_author FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ann_comments_author') THEN
    ALTER TABLE announcement_comments ADD CONSTRAINT fk_ann_comments_author FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ann_reactions_user') THEN
    ALTER TABLE announcement_reactions ADD CONSTRAINT fk_ann_reactions_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_members_lead') THEN
    ALTER TABLE members ADD CONSTRAINT fk_members_lead FOREIGN KEY (lead_id) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Announcement approval flow (2026-04-23) ─────────────────────────────────
-- All new tables/columns are additive so redeploys never destroy existing
-- announcements, acks, comments, reactions, or links.
--
-- Scheduling:
--   * announcements.scheduled_for is populated when an approver picks a future
--     send time. The GET handler lazy-promotes past-scheduled rows to 'sent'
--     before returning, so no cron worker is strictly required.
--   * status values: 'draft' | 'scheduled' | 'sent' | 'archived'. Older
--     announcements without scheduled_for behave exactly as before.
-- Approval:
--   * Any user can create an announcement_requests row; approvers
--     (src/data/approvers.js) approve/reject/edit before the request becomes
--     a real announcements row. The join is one-to-one via published_id.
-- Audit log:
--   * announcement_request_audit captures every state change - creation,
--     edits, comments, approvals, rejections, scheduling, publishing - so
--     approvers see a full timeline per request. Never deleted.
-- Comments:
--   * announcement_request_comments is the clarification thread, separate
--     from the public announcement_comments table. Visible to the requester
--     and all approvers.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled_for ON announcements(scheduled_for) WHERE scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS announcement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Requester identity (every authenticated user can create)
  requested_by_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
  requested_by_email    VARCHAR(255) NOT NULL,
  requested_by_name     VARCHAR(255),
  -- Lifecycle
  status                VARCHAR(20) DEFAULT 'pending' NOT NULL,
  --   'pending'   | 'approved' | 'rejected' | 'withdrawn' | 'needs_info'
  rejection_reason      TEXT,
  -- Approver identity (set on approve/reject/needs_info)
  decided_by_id         INTEGER REFERENCES members(id) ON DELETE SET NULL,
  decided_by_email      VARCHAR(255),
  decided_by_name       VARCHAR(255),
  decided_at            TIMESTAMPTZ,
  -- Scheduling (null = send immediately on approval)
  scheduled_for         TIMESTAMPTZ,
  urgent_override       BOOLEAN DEFAULT false,
  -- Announcement payload — same shape as announcements. Approvers can edit
  -- any of these until the request is decided.
  type                  VARCHAR(50) DEFAULT 'announce' NOT NULL,
  title                 VARCHAR(500) NOT NULL,
  body                  TEXT,
  target                VARCHAR(100) DEFAULT 'global',
  priority              VARCHAR(50) DEFAULT 'medium',
  is_popup              BOOLEAN DEFAULT false,
  image_url             TEXT,
  link                  TEXT,
  sound_key             VARCHAR(32) DEFAULT 'chime',
  -- If approved and published, this points at the resulting announcements row
  published_id          UUID REFERENCES announcements(id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_ann_requests_status CHECK (status IN ('pending','approved','rejected','withdrawn','needs_info'))
);
CREATE INDEX IF NOT EXISTS idx_ann_requests_status ON announcement_requests(status);
CREATE INDEX IF NOT EXISTS idx_ann_requests_requested_by ON announcement_requests(requested_by_email);
CREATE INDEX IF NOT EXISTS idx_ann_requests_created ON announcement_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_request_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES announcement_requests(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  actor_name  VARCHAR(255),
  action      VARCHAR(40) NOT NULL,
  --   'created' | 'edited' | 'comment_added' | 'requested_info' |
  --   'approved' | 'rejected' | 'withdrawn' | 'scheduled' | 'published'
  meta        JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ann_request_audit_req ON announcement_request_audit(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_request_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES announcement_requests(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  author_email VARCHAR(255),
  author_name VARCHAR(255),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ann_request_comments_req ON announcement_request_comments(request_id, created_at);

-- ── Team-tab overrides (2026-04-24) ─────────────────────────────────────────
-- The Team view historically sourced its data from the static TEAM_MEMBERS
-- array in src/data/members.js (104 hardcoded people). That worked for a
-- read-only org chart but meant *every* edit (add member, re-assign, change
-- manager, mark on-leave, remove) lived in React state and vanished on
-- refresh. This table layers per-email overrides on top of the baseline so
-- edits persist with zero data loss.
--
-- Keyed by email (PK) - one row per person. Fields are nullable: NULL means
-- "fall back to the baseline TEAM_MEMBERS value". is_new=true marks rows
-- for people not in the baseline (newly onboarded); their fields are the
-- full source of truth. is_deleted=true hides a baseline row from the
-- merged list without destroying it (undo-able). last_login_at is bumped
-- on every successful auth so the Team UI can badge "Never logged in" or
-- "Last seen X ago".
CREATE TABLE IF NOT EXISTS team_member_overrides (
  email         VARCHAR(255) PRIMARY KEY,
  name          VARCHAR(255),
  initials      VARCHAR(8),
  title         TEXT,
  access        VARCHAR(50),       -- admin | regional_manager | team_lead | agent
  manager_email VARCHAR(255),
  team          VARCHAR(100),
  region        VARCHAR(100),
  service       VARCHAR(100),      -- EOR | LifeCycle | New Services | All
  country       VARCHAR(10),
  avatar_url    TEXT,
  start_date    DATE,
  is_new        BOOLEAN DEFAULT FALSE,
  is_deleted    BOOLEAN DEFAULT FALSE,
  on_leave      BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  login_count   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tmo_manager ON team_member_overrides(manager_email);
CREATE INDEX IF NOT EXISTS idx_tmo_is_new ON team_member_overrides(is_new) WHERE is_new = true;
CREATE INDEX IF NOT EXISTS idx_tmo_is_deleted ON team_member_overrides(is_deleted) WHERE is_deleted = true;
CREATE INDEX IF NOT EXISTS idx_tmo_last_login ON team_member_overrides(last_login_at DESC NULLS LAST);

-- ── Per-user capabilities (2026-04-27) ─────────────────────────────────────
-- Additive permission grants on top of the four-tier access model. Stored on
-- team_member_overrides so a Director can grant/revoke them from the Team
-- tab without giving someone full admin. First capability:
--   • is_announcements_admin — manage the Announcements feature end to end
--     (compose, approve, archive, override, send acknowledgements). Treated
--     as if the user had 'admin' for the announcements domain only — every
--     other route still respects their normal access tier.
ALTER TABLE team_member_overrides ADD COLUMN IF NOT EXISTS is_announcements_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_announcements_admin
  ON team_member_overrides(is_announcements_admin) WHERE is_announcements_admin = true;

-- ── Personal Checklist (My To-Do) snapshots (2026-04-27) ───────────────────
-- The My To-Do list lives in PersonalChecklist.jsx and historically stored
-- items only in localStorage + IndexedDB on the client. That covers refresh
-- and deploy churn but NOT browser data wipes, quota eviction, incognito,
-- or device switches — any of which would destroy a user's personal task
-- list silently. Snapshot persistence makes the list durable across all of
-- those.
--
-- Shape: one row per user, keyed by user_email. items is the full JSON
-- payload of the client-side items array (id, title, description, due_date,
-- priority, done, created_at, updated_at). The server is treated as
-- last-write-wins by updated_at: client writes its full snapshot on
-- mutation (debounced); the next mount reconciles by comparing timestamps
-- and adopting whichever side is newer. Local cache (localStorage+IDB)
-- continues to provide instant paint + offline writes; the server is the
-- durable backstop that survives browser-data wipes.
CREATE TABLE IF NOT EXISTS personal_checklist_snapshots (
  user_email VARCHAR(255) PRIMARY KEY,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Feedback / improvement board ────────────────────────────────────────────
-- The team posts bugs and improvement requests here. Anyone authenticated
-- can submit + vote; only admin / regional_manager can change status,
-- priority, and assignee. Screenshots are stored as base64 data URIs in
-- the column directly — pragmatic for the small expected volume (a few
-- hundred attachments). Switch to S3 if it ever outgrows this.
CREATE TABLE IF NOT EXISTS feedback_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                VARCHAR(200) NOT NULL,
  issue                TEXT NOT NULL,
  proposed_resolution  TEXT,
  screenshot           TEXT,                     -- base64 data URI (data:image/png;base64,...)
  status               VARCHAR(30) DEFAULT 'new' NOT NULL,        -- new | triaged | in_progress | done | wont_do | duplicate
  priority             VARCHAR(20) DEFAULT 'medium' NOT NULL,      -- low | medium | high | critical
  category             VARCHAR(50),               -- 'queue' | 'briefing' | 'announcements' | 'team' | 'auth' | 'perf' | 'other' (free-form, not constrained)
  type                 VARCHAR(20) DEFAULT 'bug' NOT NULL,         -- bug | improvement | question
  submitter_id         INTEGER REFERENCES members(id) ON DELETE SET NULL,
  submitter_email      VARCHAR(255),
  submitter_name       VARCHAR(255),
  assignee_id          INTEGER REFERENCES members(id) ON DELETE SET NULL,
  resolution_note      TEXT,                      -- explanation when status -> done | wont_do | duplicate
  duplicate_of         UUID REFERENCES feedback_requests(id) ON DELETE SET NULL,
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_status        ON feedback_requests(status);
CREATE INDEX IF NOT EXISTS idx_feedback_priority      ON feedback_requests(priority);
CREATE INDEX IF NOT EXISTS idx_feedback_submitter     ON feedback_requests(submitter_id);
CREATE INDEX IF NOT EXISTS idx_feedback_assignee      ON feedback_requests(assignee_id);
CREATE INDEX IF NOT EXISTS idx_feedback_category      ON feedback_requests(category);
CREATE INDEX IF NOT EXISTS idx_feedback_created       ON feedback_requests(created_at DESC);

-- One vote per user per request, value ∈ {-1, +1}. The composite primary
-- key enforces uniqueness so we never have to dedupe in app code; updating
-- a vote uses ON CONFLICT (request_id, user_id) DO UPDATE.
CREATE TABLE IF NOT EXISTS feedback_votes (
  request_id  UUID NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  user_email  VARCHAR(255),
  vote        SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_votes_request ON feedback_votes(request_id);
CREATE INDEX IF NOT EXISTS idx_feedback_votes_user    ON feedback_votes(user_id);

-- Discussion thread on each request — keep the design open even if the
-- first FE only renders a count badge. Devs / triagers / requesters can
-- ask follow-up questions without leaving the board.
CREATE TABLE IF NOT EXISTS feedback_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
  author_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  author_email  VARCHAR(255),
  author_name   VARCHAR(255),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_request ON feedback_comments(request_id, created_at);

-- ── @-mentions on announcement comments (2026-04-30) ───────────────────────
-- mention_emails captures every user tagged in a comment body. The comment
-- POST handler resolves typed @firstname.lastname tokens against the live
-- roster, lowercases each email, and persists the array on the row. The GET
-- echoes the array back so the FE can render mention chips. Rows seen by
-- earlier client builds default to '{}' so legacy comments stay valid.
ALTER TABLE announcement_comments
  ADD COLUMN IF NOT EXISTS mention_emails TEXT[] DEFAULT '{}'::text[];

-- ── Per-user notifications (2026-04-30) ────────────────────────────────────
-- Server-persisted notification feed so mentions reach the recipient even
-- if their app wasn't open at the time of mention, and so read-state is
-- consistent across tabs / devices. Indexed for the two hot reads:
--   • unread count + recent list per recipient (top of bell)
--   • lookup by source (so the FE can dedupe "this comment already
--     produced a notification for me" if a comment is re-broadcast).
CREATE TABLE IF NOT EXISTS user_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email VARCHAR(255) NOT NULL,
  type            VARCHAR(40)  NOT NULL,      -- 'mention' (extensible)
  title           VARCHAR(500) NOT NULL,
  body            TEXT         DEFAULT '',
  link_view       VARCHAR(40)  NOT NULL,      -- which client view to open ('announcements')
  link_id         VARCHAR(255) NOT NULL,      -- announcement id (string for portability)
  source_type     VARCHAR(40)  NOT NULL,      -- 'announcement_comment'
  source_id       VARCHAR(255) NOT NULL,      -- comment id
  actor_email     VARCHAR(255),
  actor_name      VARCHAR(255),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_recipient_created
  ON user_notifications (recipient_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications (recipient_email, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifications_source
  ON user_notifications (source_type, source_id);
`;

export async function runMigrations() {
  console.log('[db] Running schema migrations...');
  try {
    await query(SCHEMA_SQL);
    console.log('[db] Schema migrations complete.');
  } catch (err) {
    console.error('[db] Migration error:', err.message);
    throw err;
  }
}
