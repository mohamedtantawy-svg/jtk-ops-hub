import { query } from './db';
import { seedCountryOwnersIfEmpty } from './country-owners-seed';
import { seedHrHubSettingsIfNeeded } from './hr-hub-seed';
import { seedLeaderAlertsSettingsIfNeeded } from './leader-alerts-seed';
import { seedTimeOffEventsIfNeeded } from './time-off-seed';
import { seedHandoverDefaultsIfNeeded } from './handover-defaults-seed';
import { seedWorkspaceMembersIfNeeded } from './workspace-members-seed';
import { seedCountryHandoverDocsIfNeeded } from './country-handover-docs-seed';
import { seedOrgDefaultIfNeeded } from './org-default-seed';
import { backfillHrExperienceTenancyIfNeeded } from './dept-backfill';
import { seedGlobalImmigrationRosterIfNeeded } from './global-immigration-roster-seed';

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

-- Cached per-ticket SLA from Zendesk's policy_metrics. The queue route
-- joins this on ticket_id so per-row pills reflect Zendesk's actual SLA
-- breach times (factoring business hours, paused/on-hold time, and the
-- specific policy attached to each ticket) instead of our local 24h
-- default applied to a metric_set anchor. Refreshed by a background job
-- (see src/lib/zendesk-sla-sync.js) so the queue route stays cheap.
-- All breach_at values are absolute UTC timestamps from Zendesk.
CREATE TABLE IF NOT EXISTS zendesk_ticket_sla (
  ticket_id BIGINT PRIMARY KEY,
  active_stage TEXT,                    -- 'frt' | 'nrt' | 'rwt' | 'put' | null (clock currently running)
  active_breach_at TIMESTAMPTZ,         -- breach_at of the active stage
  frt_breach_at TIMESTAMPTZ,            -- First Reply Time breach
  frt_minutes INT,                      -- FRT target minutes (business or calendar)
  nrt_breach_at TIMESTAMPTZ,            -- Next Reply Time breach
  nrt_minutes INT,                      -- NRT target minutes
  rwt_breach_at TIMESTAMPTZ,            -- Requester Wait Time breach (paused-status anchor)
  rwt_minutes INT,                      -- RWT target minutes
  put_breach_at TIMESTAMPTZ,            -- Periodic Update Time breach (long-running ticket cadence)
  put_minutes INT,                      -- PUT target minutes
  policy_id BIGINT,                     -- Zendesk SLA policy id
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive columns for existing installs (2026-05-19, Track B SLA extension).
-- RWT (requester_wait_time) ticks for paused statuses (pending/hold) — the
-- canonical "waiting on requester" SLA from Zendesk's policy engine.
-- PUT (periodic_update_time) ticks for long-running tickets that need a
-- regular agent update cadence regardless of replies. Both stay null on
-- tickets without an attached Zendesk policy; queue route falls back to
-- local-computed anchors in that case.
ALTER TABLE zendesk_ticket_sla ADD COLUMN IF NOT EXISTS rwt_breach_at TIMESTAMPTZ;
ALTER TABLE zendesk_ticket_sla ADD COLUMN IF NOT EXISTS rwt_minutes   INT;
ALTER TABLE zendesk_ticket_sla ADD COLUMN IF NOT EXISTS put_breach_at TIMESTAMPTZ;
ALTER TABLE zendesk_ticket_sla ADD COLUMN IF NOT EXISTS put_minutes   INT;

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

-- zendesk_ticket_sla — used by the cron sweeper (filter by fetched_at to find
-- stale rows) and by the queue route (point lookups via ticket_id PK already
-- indexed). active_breach_at index supports "approaching breach" surfaces.
CREATE INDEX IF NOT EXISTS idx_zd_sla_fetched_at ON zendesk_ticket_sla(fetched_at);
CREATE INDEX IF NOT EXISTS idx_zd_sla_active_breach_at ON zendesk_ticket_sla(active_breach_at) WHERE active_breach_at IS NOT NULL;

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
-- 2026-05-12: extend the lifecycle with the awaiting_post stage so the
-- approver can split approval from publication. Laura reported that
-- the old one-shot approve also published immediately, which forced
-- her to DM the requester separately to confirm post-on-Slack-first.
-- The new state sits between pending and the terminal approved: the
-- approver decides to release the announcement to the requester for
-- the Slack-first post, and the requester (or the approver as an
-- override) drives the final publish through
-- /announcement-requests/:id/publish.
--
-- All SQL identifiers stay in single quotes below — the whole
-- SCHEMA_SQL is a JS template literal, and stray backticks would
-- close it (skill mistake #6).
DO $$ BEGIN
  ALTER TABLE announcement_requests DROP CONSTRAINT IF EXISTS chk_ann_requests_status;
  ALTER TABLE announcement_requests ADD CONSTRAINT chk_ann_requests_status
    CHECK (status IN ('pending','approved','rejected','withdrawn','needs_info','awaiting_post'));
END $$;
ALTER TABLE announcement_requests ADD COLUMN IF NOT EXISTS awaiting_post_at TIMESTAMPTZ;

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

-- ── Access Admin grant (2026-04-30) ────────────────────────────────────────
-- Per-user grant for managing the Team roster — add / edit / remove members,
-- toggle on-leave, edit allocations, grant other per-user permissions. Mirrors
-- the announcements-admin pattern: orthogonal to the four-tier access model
-- so a Director can delegate roster maintenance without giving someone full
-- admin. Until now this was implicitly gated to admin/regional_manager which
-- forced Team Leads who actually manage their teams (e.g. Olga) to bounce
-- requests off Mohamed for every new hire.
ALTER TABLE team_member_overrides ADD COLUMN IF NOT EXISTS is_access_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_access_admin
  ON team_member_overrides(is_access_admin) WHERE is_access_admin = true;

-- ── HR Hub Admin per-user grant (2026-05-02) ───────────────────────────────
-- Stackable on any base access type. Mirrors the is_access_admin /
-- is_announcements_admin pattern: a Director assigns the grant from the
-- Team-tab access modal; server-side helpers (src/lib/hr-hub-admin.js)
-- read it with a 30 s in-memory cache. Carries the entitlements listed
-- in HR_HUB_PLAN.md → "HR Hub Admin access type — spec".
ALTER TABLE team_member_overrides ADD COLUMN IF NOT EXISTS is_hr_hub_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_hr_hub_admin
  ON team_member_overrides(is_hr_hub_admin) WHERE is_hr_hub_admin = true;

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
  status               VARCHAR(30) DEFAULT 'new' NOT NULL,        -- new | triaged | in_progress | paused | done(Deployed) | wont_do(Rejected) | duplicate
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

-- ── Feedback multi-attachment column (2026-04-30) ───────────────────────────
-- The original feedback_requests.screenshot was a single TEXT column holding
-- one base64 data URI. Submitters needed to paste multiple screenshots OR a
-- short video clip to explain repro steps that span more than one frame.
-- attachments is a JSONB array of { kind, dataUri, name } where kind is
-- either image or video. Legacy rows (screenshot column populated,
-- attachments empty) are normalised to a single-image attachment on read so
-- the FE only consults the attachments column.
ALTER TABLE feedback_requests
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Feedback audience scoping (2026-05-07, Sarah Suge feedback) ─────────────
-- Submitters can now restrict a feedback request's visibility to a region
-- (emea / apac / americas / nam / latam) or to managers-only. Backwards
-- compatible: existing rows default to 'global' so the board behaves as
-- before. Index is partial — only non-global rows need lookup acceleration;
-- the global-default common case stays index-free.
ALTER TABLE feedback_requests
  ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'global';
CREATE INDEX IF NOT EXISTS idx_feedback_audience
  ON feedback_requests(audience) WHERE audience <> 'global';

-- ── Escalation Zero kind partition (2026-05-21) ─────────────────────────────
-- Feedback board now hosts two distinct workflows:
--   • ops_hub_feedback — original feature: bug/improvement on Ops Hub itself.
--   • escalation_zero  — the migrated HRX Escalation Zero workflow (was a
--     HR Hub flow before this PR; the Slack #hrx-escalations-zero channel
--     is the historical primary intake). Strategic improvements, process
--     gaps, product feedback reviewed by leadership. Each escalation
--     carries extra structured fields the ops_hub_feedback shape doesn't
--     need (HRX function category, ideal solution, multi-country, linked
--     Zendesk / Jira URLs) — stored in `extras` JSONB so we don't pollute
--     the column list with kind-specific nullable fields.
--
-- All existing rows default to 'ops_hub_feedback' (the original Feedback
-- board content). New escalation_zero rows are created via the new picker
-- modal; the team starts from zero — no historical migration from the
-- HR Hub escalation_zero flow per Mohamed's spec.
ALTER TABLE feedback_requests
  ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'ops_hub_feedback',
  ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;
-- CHECK constraint added as a separate idempotent DO block (ALTER TABLE
-- ADD CONSTRAINT IF NOT EXISTS isn't supported pre-PG 9.6, but a catalog
-- lookup is portable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'feedback_requests_kind_check'
       AND conrelid = 'feedback_requests'::regclass
  ) THEN
    ALTER TABLE feedback_requests
      ADD CONSTRAINT feedback_requests_kind_check
      CHECK (kind IN ('ops_hub_feedback','escalation_zero'));
  END IF;
END $$;
-- Partial index — most reads filter by kind. Without this every list query
-- would table-scan ~hundreds of feedback rows to surface ~10 escalations.
CREATE INDEX IF NOT EXISTS idx_feedback_kind
  ON feedback_requests(kind, created_at DESC);

-- ── Country-ownership junction (2026-04-30) ─────────────────────────────────
-- Replaces the static src/data/countryOwners.js map with a DB-backed source
-- of truth. Each row says "this email owns this country" — the Queue's
-- country-OR-assignee scoping reads the resulting Map<email, Set<CC>> when
-- deciding what an Agent / TL / Regional / Admin can see.
--
-- Edits flow through PUT /api/v1/team-members/:email/countries (TL,
-- Regional, Admin, or anyone with is_access_admin = true). On every write
-- we invalidate the roster cache so the next scoped Queue request reflects
-- the new map immediately. The same junction also feeds the export route
-- so admins can audit "who owns what" against the Deel HRX spreadsheet.
CREATE TABLE IF NOT EXISTS team_member_countries (
  email        VARCHAR(255) NOT NULL,
  country_code VARCHAR(10)  NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (email, country_code)
);
CREATE INDEX IF NOT EXISTS idx_tmc_country ON team_member_countries(country_code);
CREATE INDEX IF NOT EXISTS idx_tmc_email   ON team_member_countries(email);

-- ── Country Handover Doc (2026-05-18) ──────────────────────────────────────
-- Long-lived per-country knowledge doc that the HRX team currently maintains
-- in Google Docs. One row per ISO-2 country. Owned by whoever has the
-- country in team_member_countries; coverers / org members read the
-- published version. Replaces the per-vacation copy-paste pattern in the
-- legacy template. See HANDOVER_TEMPLATE_REVAMP_PLAN.md §3 for the field
-- rationale (why JSONB for repeating sections, why per-column scalars
-- elsewhere).
CREATE TABLE IF NOT EXISTS country_handover_docs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code                CHAR(2) NOT NULL UNIQUE,
  -- §1 Overview of HR Operations
  scope_responsibilities      TEXT,
  prepared_by_email           VARCHAR(255),
  signatory                   TEXT,
  official_languages          TEXT[],
  wet_ink_required            BOOLEAN,
  payroll_cycle               VARCHAR(20),
  payroll_cutoff_date         TEXT,
  stakeholders                JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- §2 Payroll & Key Stakeholders
  slack_channel_name          TEXT,
  country_validation_url      TEXT,
  onboarding_buffer           TEXT,
  -- §3 Onboarding process
  pre_onboarding_steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual_start_date_push      TEXT,
  onboarding_team_handles     BOOLEAN,
  onboarding_guide_url        TEXT,
  country_specific_onboarding TEXT,
  -- §4 Post-Onboarding
  post_onboarding_steps       TEXT,
  -- §5 Amendments review process
  legal_amendment_handover_url TEXT,
  amendments_country_notes     TEXT,
  -- §6 Offboarding
  termination_process         TEXT,
  termination_handover_url    TEXT,
  resignation_process         TEXT,
  -- §7 Benefits management — repeating
  benefits                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- §8 Employment verification
  evl_template_url            TEXT,
  evl_process_description     TEXT,
  evl_sop_urls                TEXT[],
  -- §9 Country-specific processes
  visas_supported             BOOLEAN,
  pto_sop_urls                TEXT[],
  pto_key_aspects             TEXT,
  pto_carry_over_rules        TEXT,
  other_country_processes     TEXT,
  -- §10 FAQ — repeating
  faqs                        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Misc
  docs_folder_url             TEXT,
  -- Metadata
  status                      VARCHAR(20) NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','published','archived')),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_email            VARCHAR(255),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_country_handover_docs_status
  ON country_handover_docs(status, updated_at DESC);

-- Audit log for country_handover_docs edits. One row per PATCH that
-- changes >=1 field. The diff JSONB has shape
--   { field_key: { from: <old>, to: <new> } }
-- limited to changed fields so the surface can render "Edited by - 4
-- fields changed" without recomputing diffs at read time. Same shape as
-- leader_alert_settings_history.
CREATE TABLE IF NOT EXISTS country_handover_doc_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id          UUID NOT NULL REFERENCES country_handover_docs(id) ON DELETE CASCADE,
  country_code    CHAR(2) NOT NULL,
  edited_by_email VARCHAR(255) NOT NULL,
  edited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  diff            JSONB NOT NULL,
  comment         TEXT
);
CREATE INDEX IF NOT EXISTS idx_chd_history_doc
  ON country_handover_doc_history(doc_id, edited_at DESC);

-- ── HR Hub: unified intake for HR Request / HR Reporting / Escalation Zero
--    / Ops Hub Feedback (2026-05-02). See HR_HUB_PLAN.md for the full spec
--    and any rule changes — this schema is the storage layer for that plan.
--
-- Status lifecycle is uniform across all flows: new → in_progress →
-- on_hold → resolved (decision 2026-05-02). Any future status additions
-- update both this CHECK constraint and HR_HUB_PLAN.md.
--
-- Attachments use the same JSONB-of-data-URIs shape as feedback_requests
-- (kind, dataUri, name) so the Stage 5 Feedback merge is a straight
-- INSERT … SELECT, no shape conversion.
CREATE TABLE IF NOT EXISTS hr_hub_request (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow              VARCHAR(32)  NOT NULL CHECK (flow IN ('hr_request','hr_reporting','escalation_zero','feedback')),
  status            VARCHAR(20)  NOT NULL DEFAULT 'new'      CHECK (status IN ('new','in_progress','on_hold','resolved')),
  priority          VARCHAR(20)  NOT NULL DEFAULT 'medium'   CHECK (priority IN ('low','medium','high','critical')),
  function_area     VARCHAR(80),                              -- "Onboarding" / "Amendments" / …
  request_type      VARCHAR(80),                              -- HR Request: "Countersign EA" / "Deposit Increase" / …
  report_type       VARCHAR(80),                              -- HR Reporting: "Bug" / "Escalation" / …
  title             VARCHAR(300),
  summary           TEXT NOT NULL,
  ideal_solution    TEXT,                                     -- Escalation Zero only
  resolution_note   TEXT,
  links             JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [string, string, …]
  attachments       JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{kind,dataUri,name}, …] — same as feedback_requests.attachments
  created_by_email  VARCHAR(255) NOT NULL,
  created_by_name   VARCHAR(255),
  assignee_email    VARCHAR(255),
  assignee_name     VARCHAR(255),
  team_lead_email   VARCHAR(255),                             -- denormalized at create-time so the Team toggle can index-scan
  cc_email          VARCHAR(255),                             -- HR Reporting auto-cc (submitter's manager)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_flow_status ON hr_hub_request(flow, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_assignee   ON hr_hub_request(assignee_email, status);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_creator    ON hr_hub_request(created_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_team_lead  ON hr_hub_request(team_lead_email, status);
-- Extend the hr_hub_request status taxonomy with 'rejected' (2026-05-12).
-- Megan reported HR requests/reporting sometimes get declined, not
-- resolved — closing them with 'resolved' was inaccurate. The
-- anonymous inline CHECK from CREATE TABLE becomes
-- hr_hub_request_status_check; drop and re-add idempotently with the
-- expanded value set. Existing rows (only the four legacy values) all
-- continue to satisfy the new constraint, so the migration is
-- non-destructive. (SQL identifiers in this comment are deliberately
-- single-quoted, not backticked — the whole SCHEMA_SQL is a JS
-- template literal and stray backticks close it. Skill mistake #6.)
DO $$ BEGIN
  ALTER TABLE hr_hub_request DROP CONSTRAINT IF EXISTS hr_hub_request_status_check;
  ALTER TABLE hr_hub_request ADD CONSTRAINT hr_hub_request_status_check
    CHECK (status IN ('new','in_progress','on_hold','resolved','rejected'));
END $$;

CREATE TABLE IF NOT EXISTS hr_hub_comment (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL REFERENCES hr_hub_request(id) ON DELETE CASCADE,
  parent_comment_id  UUID REFERENCES hr_hub_comment(id) ON DELETE SET NULL,   -- nullable for top-level
  author_email       VARCHAR(255) NOT NULL,
  author_name        VARCHAR(255),
  body               TEXT NOT NULL,
  mention_emails     TEXT[] NOT NULL DEFAULT '{}'::text[],
  attachments        JSONB  NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at          TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_comment_request ON hr_hub_comment(request_id, created_at);

CREATE TABLE IF NOT EXISTS hr_hub_follower (
  request_id  UUID         NOT NULL REFERENCES hr_hub_request(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  source      VARCHAR(20)  NOT NULL DEFAULT 'manual' CHECK (source IN ('creator','assignee','tagged','manual')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, email)
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_follower_email ON hr_hub_follower(email);

CREATE TABLE IF NOT EXISTS hr_hub_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES hr_hub_request(id) ON DELETE CASCADE,
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  event_type   VARCHAR(40) NOT NULL,
    -- created | status_change | assignee_change | priority_change | field_edit
    -- | comment_added | comment_edited | comment_deleted
    -- | attachment_added | follower_added | follower_removed
  before_json  JSONB,
  after_json   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_log_request ON hr_hub_log(request_id, created_at);

-- Per-flow, per-key configuration so HR Hub Admins can tweak statuses,
-- field labels, dropdown options and auto-assign rules without a code
-- deploy. Every write also lands in hr_hub_settings_history with the
-- actor + a JSON diff, per rule 9 (proper audit trail).
CREATE TABLE IF NOT EXISTS hr_hub_settings (
  flow              VARCHAR(32)  NOT NULL,
  key               VARCHAR(60)  NOT NULL,    -- statuses | fields | dropdowns | auto_assign
  value_json        JSONB        NOT NULL,
  updated_by_email  VARCHAR(255),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (flow, key)
);
CREATE TABLE IF NOT EXISTS hr_hub_settings_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow         VARCHAR(32)  NOT NULL,
  key          VARCHAR(60)  NOT NULL,
  before_json  JSONB,
  after_json   JSONB,
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_hub_settings_history ON hr_hub_settings_history(flow, key, created_at DESC);

-- ── HR Hub: traceability columns for the Stage 5 Feedback merge.
--   external_id stores the source row's id (e.g. feedback_requests.id)
--   so a future migration can copy old Feedback rows into hr_hub_request
--   idempotently via ON CONFLICT (flow, external_id) DO NOTHING.
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
ALTER TABLE hr_hub_comment ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hr_hub_request_flow_external
  ON hr_hub_request(flow, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hr_hub_comment_external
  ON hr_hub_comment(external_id) WHERE external_id IS NOT NULL;

-- ── Leaders Alerts (2026-05-02) ────────────────────────────────────────────
-- Tab where any manager (TL / RM / Admin) posts a short alert about a
-- country, team, or global issue. Other managers ack with one click.
-- Slack-like comment thread underneath with emoji reactions, screenshot
-- paste, @-mentions, and per-thread mute. Plan doc: LEADER_ALERTS_PLAN.md.
CREATE TABLE IF NOT EXISTS leader_alert (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       VARCHAR(20)  NOT NULL DEFAULT 'new'    CHECK (status   IN ('new','in_progress','on_hold','resolved')),
  severity     VARCHAR(20)  NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
  category     VARCHAR(80)  NOT NULL,                              -- editable via Settings
  title        VARCHAR(300) NOT NULL,
  body         TEXT         NOT NULL,
  impact_tags  TEXT[]       NOT NULL DEFAULT '{}'::text[],         -- 'Global' | 'Team' | <ISO country code>
  links        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  attachments  JSONB        NOT NULL DEFAULT '[]'::jsonb,          -- {kind,dataUri,name}[] — same shape as feedback_requests.attachments
  created_by_email VARCHAR(255) NOT NULL,
  created_by_name  VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_status_created ON leader_alert(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leader_alert_creator        ON leader_alert(created_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leader_alert_category       ON leader_alert(category, status);
CREATE INDEX IF NOT EXISTS idx_leader_alert_severity       ON leader_alert(severity, status);
CREATE INDEX IF NOT EXISTS idx_leader_alert_impact         ON leader_alert USING GIN (impact_tags);

CREATE TABLE IF NOT EXISTS leader_alert_ack (
  alert_id    UUID         NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  name        VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, email)
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_ack_email ON leader_alert_ack(email);

CREATE TABLE IF NOT EXISTS leader_alert_comment (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id           UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  parent_comment_id  UUID REFERENCES leader_alert_comment(id) ON DELETE SET NULL,
  author_email       VARCHAR(255) NOT NULL,
  author_name        VARCHAR(255),
  body               TEXT NOT NULL,
  mention_emails     TEXT[] NOT NULL DEFAULT '{}'::text[],
  attachments        JSONB  NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at          TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_comment_alert ON leader_alert_comment(alert_id, created_at);

CREATE TABLE IF NOT EXISTS leader_alert_comment_reaction (
  comment_id  UUID NOT NULL REFERENCES leader_alert_comment(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  emoji       VARCHAR(40)  NOT NULL,                  -- ':thumbsup:' | unicode | shortcode
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, email, emoji)
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_reaction_comment ON leader_alert_comment_reaction(comment_id);

CREATE TABLE IF NOT EXISTS leader_alert_follower (
  alert_id    UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  source      VARCHAR(20)  NOT NULL DEFAULT 'manual' CHECK (source IN ('creator','tagged','commenter','manual')),
  muted       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, email)
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_follower_email ON leader_alert_follower(email);

CREATE TABLE IF NOT EXISTS leader_alert_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id     UUID NOT NULL REFERENCES leader_alert(id) ON DELETE CASCADE,
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  event_type   VARCHAR(40) NOT NULL,
    -- created | status_change | severity_change | category_change | field_edit
    -- | comment_added | comment_edited | comment_deleted
    -- | reaction_added | reaction_removed
    -- | ack_added | ack_removed
    -- | follower_added | follower_removed | thread_muted | thread_unmuted
  before_json  JSONB,
  after_json   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_log_alert ON leader_alert_log(alert_id, created_at);

CREATE TABLE IF NOT EXISTS leader_alert_settings (
  key               VARCHAR(60) PRIMARY KEY,                 -- 'categories' | 'statuses' | 'notifications'
  value_json        JSONB       NOT NULL,
  updated_by_email  VARCHAR(255),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS leader_alert_settings_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          VARCHAR(60) NOT NULL,
  before_json  JSONB,
  after_json   JSONB,
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leader_alert_settings_history ON leader_alert_settings_history(key, created_at DESC);

-- Leaders Alerts admin grant — mirrors is_hr_hub_admin / is_announcements_admin
-- pattern. Per-user override on team_member_overrides; carries the
-- entitlements listed in LEADER_ALERTS_PLAN.md → "Alerts Admin access type".
ALTER TABLE team_member_overrides ADD COLUMN IF NOT EXISTS is_leader_alerts_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_leader_alerts_admin
  ON team_member_overrides(is_leader_alerts_admin) WHERE is_leader_alerts_admin = true;

-- ── Urgent Assist (2026-05-03) ─────────────────────────────────────────────
-- New tab that consolidates "HRX Urgent Assist Request" / "HRX Urgent Assist"
-- workbench tasks with manually-created urgent assists. Workbench rows are
-- read-only mirrors of the Deel-side task; manual rows live in this table
-- with full CRUD. SLA is 6 biz hours from createdAt for both sources.
CREATE TABLE IF NOT EXISTS urgent_assist_request (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           VARCHAR(300) NOT NULL,
  request_type      VARCHAR(120) NOT NULL DEFAULT 'HRX Urgent Assist Request',
  country           VARCHAR(8),                                  -- ISO-2 code; nullable for cross-country requests
  assignee_email    VARCHAR(255),
  assignee_name     VARCHAR(255),
  created_by_email  VARCHAR(255) NOT NULL,
  created_by_name   VARCHAR(255),
  team_lead_email   VARCHAR(255),                                -- denormalised at create-time for Team toggle scope
  link_url          TEXT,                                        -- user-supplied "Link to task"
  description       TEXT,
  status            VARCHAR(20)  NOT NULL DEFAULT 'new'   CHECK (status IN ('new','in_progress','on_hold','resolved')),
  priority          VARCHAR(20)  NOT NULL DEFAULT 'high'  CHECK (priority IN ('low','medium','high','critical')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_urgent_assist_status_created ON urgent_assist_request(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_urgent_assist_assignee       ON urgent_assist_request(assignee_email, status);
CREATE INDEX IF NOT EXISTS idx_urgent_assist_creator        ON urgent_assist_request(created_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_urgent_assist_team_lead      ON urgent_assist_request(team_lead_email, status);
CREATE INDEX IF NOT EXISTS idx_urgent_assist_country        ON urgent_assist_request(country, status);

CREATE TABLE IF NOT EXISTS urgent_assist_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES urgent_assist_request(id) ON DELETE CASCADE,
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  event_type   VARCHAR(40) NOT NULL,
    -- created | status_change | assignee_change | priority_change | field_edit | deleted
  before_json  JSONB,
  after_json   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_urgent_assist_log_request ON urgent_assist_log(request_id, created_at);

-- ── Hide Task (2026-05-03) ─────────────────────────────────────────────────
-- Lets a team member request to hide a queue row that "shouldn't be there"
-- (Internal Deel Employee, Test Task, Other). Request goes to the user's
-- TL via the existing HR Hub flow ('hide_task_request'); on approval, the
-- (task_source, task_id) lands in hidden_task and every queue surface
-- filters it out from then on.
--
-- Phase 1 — extend hr_hub_request.flow to allow the new flow value, and
-- add four nullable columns that carry the queue task identity (only used
-- when flow='hide_task_request'). Idempotent across re-runs: drop any
-- pre-existing CHECK + add the v2 with the wider enum.
--
-- 2026-05-14: the same enum is extended again (v3) to include
-- 'sla_extension_request' for the SLA Extensions feature
-- (SLA_EXTENSIONS_PLAN.md). The v2 constraint is dropped + replaced with
-- v3 in the same idempotent block below.
ALTER TABLE hr_hub_request DROP CONSTRAINT IF EXISTS hr_hub_request_flow_check;
ALTER TABLE hr_hub_request DROP CONSTRAINT IF EXISTS hr_hub_request_flow_check_v2;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'hr_hub_request'::regclass
       AND conname  = 'hr_hub_request_flow_check_v3'
  ) THEN
    ALTER TABLE hr_hub_request
      ADD CONSTRAINT hr_hub_request_flow_check_v3
      CHECK (flow IN ('hr_request','hr_reporting','escalation_zero','feedback','hide_task_request','sla_extension_request'));
  END IF;
END $$;

ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS task_source   VARCHAR(40);
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS task_id       VARCHAR(200);
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS task_url      TEXT;
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS task_subject  VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_task_pair
  ON hr_hub_request(task_source, task_id) WHERE task_source IS NOT NULL;

-- SLA Extension request flow (2026-05-14) — additional columns populated
-- only when flow='sla_extension_request'. See SLA_EXTENSIONS_PLAN.md.
--   sla_ext_requested_days — team-member pick: 1 | 2 | 3 | 4 | 5 | 6 | 7 (2026-05-19)
--   sla_ext_reason_code    — immigration | client_unresponsive | employee_unresponsive | long_process (2026-05-19)
--   sla_ext_acknowledged   — required true at submit (the employee/client
--                            has been informed about the hold)
--   sla_ext_approved_days  — manager-chosen on approval (1-7); null until then
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS sla_ext_requested_days SMALLINT;
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS sla_ext_reason_code    VARCHAR(40);
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS sla_ext_acknowledged   BOOLEAN;
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS sla_ext_approved_days  SMALLINT;

-- Team Lead On Call (2026-05-14) — auto-assignment hand-off marker.
-- When an HR Request or HR Reporting row is auto-assigned to the current
-- Team Lead On Call at create time, assignee_manually_set stays FALSE.
-- Any subsequent explicit assignee change (via the request detail panel)
-- flips it to TRUE. The /settings/team-lead-on-call PUT handler reads
-- this flag during rotation: it bulk-reassigns all FALSE rows that were
-- assigned to the previous TLOC, but leaves manually-changed rows alone.
ALTER TABLE hr_hub_request ADD COLUMN IF NOT EXISTS assignee_manually_set BOOLEAN DEFAULT FALSE;
-- Partial index for the rotation bulk-update query (cheap because the
-- false set is the common case and we filter on flow + assignee_email
-- before this).
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_auto_assign
  ON hr_hub_request(flow, assignee_email) WHERE assignee_manually_set = FALSE;

-- Phase 2 — the active hide list. Manager-approved entries land here and
-- every queue's render path checks (task_source, task_id) against this
-- table. UNIQUE so a duplicate approval can't double-insert.
CREATE TABLE IF NOT EXISTS hidden_task (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_source          VARCHAR(40)  NOT NULL,                  -- zendesk | jira | workbench | onboarding | offboarding | amendments | redlines | incentive_plans | urgent_assist
  task_id              VARCHAR(200) NOT NULL,                  -- source-side id (zd ticket id, jira key, deel uuid)
  task_url             TEXT,                                   -- the link the user attached (per spec: identifier could be the task link)
  task_subject         VARCHAR(500),                           -- denormalised for display in admin list
  request_id           UUID REFERENCES hr_hub_request(id) ON DELETE SET NULL,
  reason_code          VARCHAR(40)  NOT NULL CHECK (reason_code IN ('internal_deel_employee','test_task','other')),
  reason_text          TEXT,                                   -- required when reason_code = 'other'
  hidden_by_email      VARCHAR(255) NOT NULL,                  -- original requester
  hidden_by_name       VARCHAR(255),
  approved_by_email    VARCHAR(255) NOT NULL,                  -- manager who approved
  approved_by_name     VARCHAR(255),
  hidden_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unhidden_at          TIMESTAMPTZ                              -- soft-undo (admin can unhide later)
);
-- Active hides are unique per task. Soft-unhidden rows (unhidden_at IS NOT NULL)
-- are kept for audit but excluded from the unique constraint via the partial.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hidden_task_active
  ON hidden_task(task_source, task_id) WHERE unhidden_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hidden_task_request ON hidden_task(request_id);
CREATE INDEX IF NOT EXISTS idx_hidden_task_hidden_by ON hidden_task(hidden_by_email, hidden_at DESC);

-- ── SLA Extension (2026-05-14) ─────────────────────────────────────────────
-- Active SLA-extension list. Manager-approved extensions land here and the
-- queue routes / SLA math read them on every fetch so the row's SLA window
-- is overridden by the extension while it's active and reverts to normal
-- (red, breached) once expires_at passes. See SLA_EXTENSIONS_PLAN.md.
--
-- The unique partial index enforces "only one active extension per task at
-- a time": both the not-yet-expired window AND a not-revoked row count as
-- active. Expired rows stay in the table for audit but don't block a fresh
-- request.
CREATE TABLE IF NOT EXISTS sla_extension (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_source          VARCHAR(40)  NOT NULL,                  -- zendesk | jira | onboarding | offboarding | amendments | redlines | workbench | incentive_plans
  task_id              VARCHAR(200) NOT NULL,                  -- source-side id
  task_url             TEXT,
  task_subject         VARCHAR(500),
  request_id           UUID REFERENCES hr_hub_request(id) ON DELETE SET NULL,
  reason_code          VARCHAR(40)  NOT NULL CHECK (reason_code IN ('immigration','client_unresponsive','employee_unresponsive','long_process')),
  requested_by_email   VARCHAR(255) NOT NULL,
  requested_by_name    VARCHAR(255),
  approved_by_email    VARCHAR(255) NOT NULL,
  approved_by_name     VARCHAR(255),
  approved_days        SMALLINT     NOT NULL CHECK (approved_days BETWEEN 1 AND 7),
  effective_from       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ  NOT NULL,
  revoked_at           TIMESTAMPTZ
);
-- Active extensions are unique per task. The predicate is purely
-- revoked_at IS NULL only, because Postgres rejects non-IMMUTABLE functions
-- (NOW()) in partial index predicates; the natural-expiry case is
-- handled at write time by the Phase 2 approve handler, which marks any
-- expired-but-unrevoked row as revoked just-in-time before inserting a
-- fresh row. See SLA_EXTENSIONS_PLAN.md "State machine" section.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sla_extension_unrevoked
  ON sla_extension(task_source, task_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sla_extension_request ON sla_extension(request_id);

-- Reason-code CHECK constraint widened on 2026-05-19 to allow
-- 'long_process' alongside the original three values. Existing installs
-- still carry the older inline CHECK constraint named
-- sla_extension_reason_code_check (auto-generated by Postgres when the
-- column was defined inline in CREATE TABLE). DROP IF EXISTS + re-ADD
-- mirrors the pattern already used for tasks.status / tasks.priority
-- a few hundred lines up. Fresh installs get the wider list directly
-- from the CREATE TABLE definition.
ALTER TABLE sla_extension DROP CONSTRAINT IF EXISTS sla_extension_reason_code_check;
ALTER TABLE sla_extension ADD CONSTRAINT sla_extension_reason_code_check
  CHECK (reason_code IN ('immigration','client_unresponsive','employee_unresponsive','long_process'));

-- Source-row reassignments. The Onboarding / Amendments / Redlines /
-- Incentive Plans queues come from the Deel admin API and we cannot push an
-- assignee change back upstream. This table stores override assignments
-- keyed by (task_source, task_id); each source's API route overlays the
-- override on the row's assigneeEmail before scoping so the new assignee
-- (and their manager chain) immediately sees the row in their Workspace.
-- task_url is stored alongside the source/id pair as a stable identifier
-- the user can recognise (per Jose's spec: "remember it using the task
-- link"). The original assignee is captured so we never lose the upstream
-- attribution — re-assigning to NULL "unsets" the override and the row
-- reverts to whatever Deel currently says.
CREATE TABLE IF NOT EXISTS queue_reassignments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_source             VARCHAR(40)  NOT NULL,                  -- onboarding | amendments | redlines | incentive_plans
  task_id                 VARCHAR(200) NOT NULL,                  -- upstream id (matches normalized row.id)
  task_url                TEXT,                                   -- stable link the user reassigned against
  task_subject            VARCHAR(500),
  task_country            VARCHAR(8),
  original_assignee_email VARCHAR(255),                           -- captured at reassign time
  original_assignee_name  VARCHAR(255),
  assignee_email          VARCHAR(255) NOT NULL,                  -- new assignee (lowercased)
  assignee_name           VARCHAR(255),
  reassigned_by_email     VARCHAR(255) NOT NULL,
  reassigned_by_name      VARCHAR(255),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_queue_reassignments_pair
  ON queue_reassignments(task_source, task_id);
CREATE INDEX IF NOT EXISTS idx_queue_reassignments_source
  ON queue_reassignments(task_source);
CREATE INDEX IF NOT EXISTS idx_queue_reassignments_assignee
  ON queue_reassignments(LOWER(assignee_email));

-- Mention groups: Slack-style @-handles that expand to a list of members.
-- Used by every comment surface that runs the @mention parser (HR Hub,
-- Leaders Alerts, Feedback). Mentioning a group in a comment body, e.g.
-- @hrxtools, fans out a notification to every member and adds them as
-- followers of the request, exactly as if each member had been tagged
-- individually. Anyone authenticated can create or edit groups (matches
-- the openness of HR Hub creation). Handle is the lowercased token typed
-- after the @, kept distinct from any users email localpart to avoid
-- ambiguity (server-side parser tries group first, falls back to user).
CREATE TABLE IF NOT EXISTS mention_group (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle            VARCHAR(80)  NOT NULL,                        -- lowercase, hyphen-or-dot-separated; the @-token
  name              VARCHAR(200),                                  -- human label, optional
  description       TEXT,
  created_by_email  VARCHAR(255) NOT NULL,
  created_by_name   VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mention_group_handle
  ON mention_group(LOWER(handle));

CREATE TABLE IF NOT EXISTS mention_group_member (
  group_id      UUID NOT NULL REFERENCES mention_group(id) ON DELETE CASCADE,
  member_email  VARCHAR(255) NOT NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, member_email)
);
CREATE INDEX IF NOT EXISTS idx_mention_group_member_email
  ON mention_group_member(LOWER(member_email));

-- ── Announcements: tag-group targeting (2026-05-11) ──────────────────────────
-- Announcements can now target a custom Tag Group in addition to the
-- region-based 'target' enum. The string column stays as-is for region
-- audiences ('global', 'emea', 'apac', 'americas', 'nam', 'latam', and
-- the new 'leaders' rollup). When the composer picks a Tag Group, we
-- store the group id here and set target='group' as a discriminator.
-- NOTE: backticks are FORBIDDEN inside this SQL block (SKILL §3.7,
-- trap #6) — they close the surrounding JS template literal and break
-- the Turbopack build. Use single quotes or plain text instead.
-- Audience filter at /api/v1/announcements joins against
-- mention_group_member to expand the group to its members on read.
-- ON DELETE SET NULL so deleting a group leaves historical announcements
-- visible (degrades to "no audience" — still reachable to author + admins).
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_group_id UUID
  REFERENCES mention_group(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_target_group
  ON announcements(target_group_id) WHERE target_group_id IS NOT NULL;

-- Same column on the approval-queue request rows so target_group_id
-- survives the request -> approve -> publish round-trip.
ALTER TABLE announcement_requests
  ADD COLUMN IF NOT EXISTS target_group_id UUID
  REFERENCES mention_group(id) ON DELETE SET NULL;

-- ── Member logins (2026-05-06) ───────────────────────────────────────────────
-- Dedicated login-tracking table. Replaces writing login_count/last_login_at
-- to team_member_overrides (which used to create "shell rows" — bare emails
-- with NULL name/access/manager — for every authenticated user, even those
-- not in the static TEAM_MEMBERS baseline).
--
-- Why a separate table: when a backup restore runs INSERT ... ON CONFLICT
-- (email) DO NOTHING against team_member_overrides, those shell rows are
-- preserved over the backup data -- exactly what bit the May 5 wipe
-- recovery (Olga + 22 others appearing missing because their shell rows
-- shadowed backup curated rows). Splitting login tracking off keeps
-- team_member_overrides as a roster-state-only table — easier to reason
-- about during disaster recovery.
--
-- For now this table is dual-written by the auth flows (auth/login,
-- auth/google/callback, me) alongside the existing team_member_overrides
-- writes. A follow-up PR will migrate the read paths
-- (team-members route, team-members/[email], countries/export,
-- roster-server) to JOIN against member_logins, then drop the
-- team_member_overrides write side.
CREATE TABLE IF NOT EXISTS member_logins (
  email          VARCHAR(255) PRIMARY KEY,
  last_login_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  login_count    INTEGER     NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_member_logins_last_login
  ON member_logins(last_login_at DESC NULLS LAST);

-- ── last_seen_at — real activity, not just session start (2026-05-07) ──
-- The Team-tab badge needs to answer "did this person actually work today?"
-- last_login_at is bumped on auth and previously /me-on-mount, which made
-- it conflate "logged in" with "tab open at all" — a user who reloaded at
-- 9 AM and walked away showed "9 AM" all day. last_seen_at is bumped only
-- by:
--   • Actual auth events (login, SSO callback) — initial seed
--   • The /api/v1/auth/heartbeat route, which the FE only calls when the
--     user is genuinely active (mouse / keyboard / scroll / touch in the
--     last 90 s AND tab is visible). Idle tabs in the background never
--     bump it.
-- Backfill seeds last_seen_at from the existing last_login_at so the badge
-- doesn't read "Never seen" for everyone immediately after deploy.
ALTER TABLE member_logins ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
UPDATE member_logins
   SET last_seen_at = last_login_at
 WHERE last_seen_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_member_logins_last_seen
  ON member_logins(last_seen_at DESC NULLS LAST);

-- One-time backfill from team_member_overrides — capture all historical
-- login activity so member_logins is the complete record from day 1.
-- Idempotent via ON CONFLICT (email) DO NOTHING; subsequent boots no-op
-- because the canonical write path is the auth endpoints, not this seed.
-- Conditional on the source columns existing so the migration is safe to
-- re-run on environments where team_member_overrides hasn't been created
-- yet (fresh installs running the schema in one shot).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_member_overrides' AND column_name = 'last_login_at'
  ) THEN
    INSERT INTO member_logins (email, last_login_at, login_count, created_at, updated_at)
    SELECT email,
           last_login_at,
           COALESCE(login_count, 1),
           COALESCE(created_at, NOW()),
           COALESCE(updated_at, NOW())
      FROM team_member_overrides
     WHERE last_login_at IS NOT NULL
    ON CONFLICT (email) DO NOTHING;
  END IF;
END $$;

-- ── One-shot backfill cleanup (2026-05-08) ────────────────────────────
-- The 2026-05-07 last_seen_at backfill set last_seen_at = last_login_at
-- for every existing row, so the badge "looked populated" on launch.
-- We then discovered POST /api/v1/auth/heartbeat had been returning 401
-- for the entire post-deploy window (the middleware skipped JWT
-- verification for the whole /api/v1/auth/* prefix, including the new
-- heartbeat route). Net result: every row STILL had last_seen_at exactly
-- equal to last_login_at — confirmed by a live probe showing 85/85 rows
-- equal, 0 diverged.
--
-- Now that the middleware bug is fixed and the FE hook only fires on
-- real interaction, this UPDATE wipes the bogus backfilled values so the
-- badge starts honest. Inactive users will read "Never seen" until they
-- actually use the app — which is the correct truth, not "X hr ago"
-- inferred from a stale tab they had open last week.
--
-- Gated by an app_settings sentinel so it runs ONCE on this deploy and
-- never again. Only matches rows where the two timestamps are byte-equal,
-- which is the proof-of-backfill signature: a real heartbeat would have
-- moved last_seen_at strictly after last_login_at by definition (auth
-- writes both, heartbeat writes only last_seen_at).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_settings WHERE key = 'member_logins_backfill_v2_cleared'
  ) THEN
    UPDATE member_logins
       SET last_seen_at = NULL
     WHERE last_seen_at IS NOT NULL
       AND last_seen_at = last_login_at;
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES ('member_logins_backfill_v2_cleared', 'true'::jsonb, 'migrate.js', NOW())
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- OOO & Handovers (2026-05-11) — Phase 1
-- ══════════════════════════════════════════════════════════════════════════
-- Single OOO surface (one primary nav tab, no sub-tabs). Two view modes
-- (Calendar Gantt + Table), six lenses (Mine / Covering me / My team /
-- Approvals / Drafts / All). Workspace merges while a handover is active
-- via getVisibleEmails/getVisibleCountries cache extension in
-- src/lib/queue-scoping.js (Phase 3). Full spec in HANDOVERS_PLAN.md.
-- Phase 1 lands schema + CSV seed + read-only OOO surface only; write
-- paths and lifecycle cron arrive in Phases 2-4.
-- All new tables — nothing existing is destructively altered.
-- is_handover_admin is added to team_member_overrides as a stackable
-- per-user grant mirroring is_announcements_admin / is_hr_hub_admin.

-- Source-of-truth list of OOO ranges per person. Seeded from the May 11
-- 2026 HRX CSV via src/lib/time-off-seed.js; refreshed day-to-day via the
-- "Sync from Deel API" admin action (Phase 5) which writes source='deel_api'
-- with external_id set. The (work_email, start_date, end_date, source)
-- unique constraint makes re-imports dedupe automatically.
CREATE TABLE IF NOT EXISTS time_off_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_email      VARCHAR(255) NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  source          VARCHAR(20) NOT NULL DEFAULT 'csv',
  external_id     VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'approved',
  reason          VARCHAR(80),
  imported_batch  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_email, start_date, end_date, source)
);
CREATE INDEX IF NOT EXISTS idx_too_email   ON time_off_events(LOWER(work_email));
CREATE INDEX IF NOT EXISTS idx_too_window  ON time_off_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_too_active  ON time_off_events(end_date) WHERE status = 'approved';

-- CSV / Deel API import provenance. One row per import batch; per-row
-- parse failures collected in error_log so we never silently drop data
-- without a trace.
CREATE TABLE IF NOT EXISTS time_off_import_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            VARCHAR(20) NOT NULL,
  filename          VARCHAR(500),
  uploaded_by_email VARCHAR(255),
  rows_total        INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_skipped      INTEGER NOT NULL DEFAULT 0,
  rows_invalid      INTEGER NOT NULL DEFAULT 0,
  error_log         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_to_import_batches_uploaded
  ON time_off_import_batches(uploaded_at DESC);

-- Handovers lifecycle table. State machine (HANDOVERS_PLAN.md §8):
--   draft → pending_coverage_acceptance → pending_manager_approval
--   → approved → active → completed
-- with rejected / cancelled / expired terminals. Only the lifecycle cron
-- (Phase 4) writes active / completed / expired; everything else is
-- user-driven. settings_id pins the configuration preset that drove this
-- handover so a later edit to settings does not retroactively change
-- in-flight rows.
CREATE TABLE IF NOT EXISTS handovers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email           VARCHAR(255) NOT NULL,
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  time_off_event_id         UUID REFERENCES time_off_events(id) ON DELETE SET NULL,
  reason                    TEXT,
  status                    VARCHAR(30) NOT NULL DEFAULT 'draft',
  manager_email             VARCHAR(255),
  manager_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  manager_decision_at       TIMESTAMPTZ,
  manager_decision_note     TEXT,
  checklist_template_id     UUID,
  settings_id               UUID,
  submitted_at              TIMESTAMPTZ,
  activated_at              TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  cancelled_by              VARCHAR(255),
  cancel_reason             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_handover_requester ON handovers(LOWER(requester_email), start_date);
CREATE INDEX IF NOT EXISTS idx_handover_manager   ON handovers(LOWER(manager_email), status);
CREATE INDEX IF NOT EXISTS idx_handover_active    ON handovers(status, start_date, end_date) WHERE status IN ('approved','active');
CREATE INDEX IF NOT EXISTS idx_handover_event     ON handovers(time_off_event_id);

-- Multi-coverer rows. country_codes='{}' means full coverage of the
-- requester's countries; a non-empty array narrows the cover to those
-- ISO-2 codes. Per-coverer acceptance state lets one decline without
-- nuking the rest of the handover.
CREATE TABLE IF NOT EXISTS handover_coverers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id        UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  coverer_email      VARCHAR(255) NOT NULL,
  country_codes      TEXT[] NOT NULL DEFAULT '{}'::text[],
  acceptance_status  VARCHAR(20) NOT NULL DEFAULT 'pending',
  accepted_at        TIMESTAMPTZ,
  declined_at        TIMESTAMPTZ,
  decline_reason     TEXT,
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handover_id, coverer_email)
);
CREATE INDEX IF NOT EXISTS idx_hcover_email ON handover_coverers(LOWER(coverer_email));

-- Reusable checklist template (config). items is an ordered JSONB array
-- of { id, label, required, hint } objects. is_default picks the template
-- inserted into a new handover when no scope-specific template matches.
CREATE TABLE IF NOT EXISTS handover_checklist_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  scope             VARCHAR(20)  NOT NULL DEFAULT 'global',
  scope_value       VARCHAR(100),
  items             JSONB        NOT NULL DEFAULT '[]'::jsonb,
  is_default        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by_email  VARCHAR(255),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_handover_templates_scope
  ON handover_checklist_templates(scope, scope_value);

-- Per-handover instance of template items (snapshot at submit-time so a
-- later template edit never alters historical checklists).
CREATE TABLE IF NOT EXISTS handover_checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id   UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  item_id       VARCHAR(80) NOT NULL,
  label         TEXT NOT NULL,
  required      BOOLEAN NOT NULL DEFAULT TRUE,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  completed_at  TIMESTAMPTZ,
  completed_by  VARCHAR(255),
  UNIQUE (handover_id, item_id)
);

-- Audit log: every state transition writes exactly one row. Never
-- auto-pruned. Surfaced via GET /handovers/:id/audit-trail and the
-- admin CSV export in Phase 5.
CREATE TABLE IF NOT EXISTS handover_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id  UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  event_type   VARCHAR(40) NOT NULL,
  actor_email  VARCHAR(255),
  actor_name   VARCHAR(255),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_handover_log_handover ON handover_log(handover_id, created_at);

-- Handback summary: coverer logs this on return-day so the workspace
-- merge can flip to completed. open_items is a JSONB array of stable
-- pointers (source/id pairs or URLs) the requester needs to pick up.
CREATE TABLE IF NOT EXISTS handover_handback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id     UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  ack_email       VARCHAR(255) NOT NULL,
  summary         TEXT,
  open_items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handover_id, ack_email)
);

-- Configuration presets ("setups") — global / region / team. Resolution
-- rule when multiple match: team > region > global. is_default picks the
-- global fallback when no scope-specific row applies. Phase 5 ships the
-- Settings UI; Phase 1 only needs the table so foreign keys resolve.
CREATE TABLE IF NOT EXISTS handover_settings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        VARCHAR(200) NOT NULL,
  scope                       VARCHAR(20) NOT NULL DEFAULT 'global',
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
CREATE INDEX IF NOT EXISTS idx_handover_settings_scope
  ON handover_settings(scope, scope_value);

-- Idempotency ledger for reminders. The composite primary key means the
-- cron (Phase 4) can fire as often as it wants without ever double-sending
-- a notification for the same event/type pair.
CREATE TABLE IF NOT EXISTS time_off_reminders_sent (
  time_off_event_id UUID NOT NULL REFERENCES time_off_events(id) ON DELETE CASCADE,
  reminder_type     VARCHAR(20) NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (time_off_event_id, reminder_type)
);

-- Per-user grant for the Handover Settings panel. Stackable on any base
-- access type, mirrors is_announcements_admin / is_hr_hub_admin /
-- is_access_admin. Without this grant only admin / regional_manager can
-- reach the Handovers section of Settings.
ALTER TABLE team_member_overrides
  ADD COLUMN IF NOT EXISTS is_handover_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tmo_is_handover_admin
  ON team_member_overrides(is_handover_admin) WHERE is_handover_admin = true;

-- ── Workspace memberships (2026-05-12) ─────────────────────────────────────
-- DB-backed roster + role for the non-HR workspaces (Command Center, Payroll
-- Hub, GIX Hub). Replaces the file-based allowlists under
-- src/workspaces/<team>/data/allowlist.js so admins can add/remove users
-- through the UI without a code deploy.
--
-- HR Hub does NOT use this table — its membership is implicit (any @deel.com
-- via SSO) and its admin model is the legacy is_hr_hub_admin / is_access_admin
-- flags on team_member_overrides. This table is for the new workspaces only.
--
-- Status='removed' rows are kept for audit (who removed whom, when). The
-- UNIQUE constraint scoped by status='active' allows the same email to be
-- re-added after removal.
CREATE TABLE IF NOT EXISTS workspace_members (
  id              SERIAL PRIMARY KEY,
  workspace_id    VARCHAR(50)  NOT NULL,
  email           VARCHAR(255) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'member',
  status          VARCHAR(20)  NOT NULL DEFAULT 'active',
  added_by        VARCHAR(255),
  added_at        TIMESTAMPTZ  DEFAULT NOW(),
  removed_by      VARCHAR(255),
  removed_at      TIMESTAMPTZ,
  CONSTRAINT chk_wm_role   CHECK (role   IN ('member', 'admin')),
  CONSTRAINT chk_wm_status CHECK (status IN ('active', 'removed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workspace_member_active
  ON workspace_members(workspace_id, LOWER(email))
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_workspace_members_email_status
  ON workspace_members(LOWER(email), status);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_status
  ON workspace_members(workspace_id, status);

-- ── Comment Reactions (2026-05-14) ───────────────────────────────────
-- Polymorphic emoji-reaction table used by every comment surface that
-- isn't leader_alert (leader_alert keeps its own bespoke table — it
-- shipped earlier with the same shape; not migrated to avoid churn).
-- Sarah Suge feedback: "Add the ability to react to messages with
-- emojis" applied to "all places where we have comments and replies"
-- (Mohamed). Each row is one user reacting with one emoji on one
-- comment. Unique on (type, id, email, emoji) so the same user can't
-- double-react with the same emoji. The PK on email is lowercased via
-- the index instead of by storage so we keep the original casing for
-- audit while still matching deterministically.
CREATE TABLE IF NOT EXISTS comment_reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_type  VARCHAR(40) NOT NULL,        -- hr_hub | feedback | announcement | announcement_request
  comment_id    VARCHAR(200) NOT NULL,       -- comment's own id (UUID or numeric, stringified)
  emoji         VARCHAR(64) NOT NULL,
  user_email    VARCHAR(255) NOT NULL,
  user_name     VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_comment_reaction
  ON comment_reactions(comment_type, comment_id, LOWER(user_email), emoji);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_lookup
  ON comment_reactions(comment_type, comment_id);

-- ── HRX Urgent Assist Schedule (2026-05-14) ────────────────────────────
-- Duygu Cakalli feedback: "we don't have HRX Urgent Assist MOC Schedule
-- on the Ops hub". Mirrors the team's Google Sheet schedule: one row per
-- calendar date with three regions (EMEA / NAM / APAC), each region
-- having a main MOC and a backup. Names + emails denormalised so the
-- table renders without joining against the members roster (members
-- come and go; the schedule preserves the historical assignment).
-- Managers-only access enforced at the view level.
CREATE TABLE IF NOT EXISTS urgent_assist_schedule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date       DATE NOT NULL UNIQUE,
  emea_main_email     VARCHAR(255),
  emea_main_name      VARCHAR(255),
  emea_backup_email   VARCHAR(255),
  emea_backup_name    VARCHAR(255),
  nam_main_email      VARCHAR(255),
  nam_main_name       VARCHAR(255),
  nam_backup_email    VARCHAR(255),
  nam_backup_name     VARCHAR(255),
  apac_main_email     VARCHAR(255),
  apac_main_name      VARCHAR(255),
  apac_backup_email   VARCHAR(255),
  apac_backup_name    VARCHAR(255),
  notes               TEXT,
  updated_by_email    VARCHAR(255),
  updated_by_name     VARCHAR(255),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Read path: list current + upcoming dates fast.
CREATE INDEX IF NOT EXISTS idx_urgent_assist_schedule_date
  ON urgent_assist_schedule(schedule_date);

-- ── Workbench resolution tracking (2026-05-14) ─────────────────────────
-- Per-task snapshot of every Workbench row Ops Hub has ever seen, with
-- last-seen timestamp + optional resolved-at. Backs the diff-based
-- resolution model that replaces the 5-page COMPLETED+CLOSED upstream
-- walk that was timing out at 30s+ in prod (2026-05-14 log audit).
--
-- Why DB-backed (vs in-memory): single replica today (replicas: 1,
-- autoscaling.enabled: false), but the helm chart has autoscaling
-- configured for 2-5 replicas. An in-memory snapshot would silently
-- drift between pods if autoscaling ever turns on. The DB makes the
-- snapshot a shared source of truth — works for N replicas.
--
-- Lifecycle:
--   - Every Workbench sync UPSERTs every observed row with
--     last_seen_at = NOW. Active statuses clear resolved_at. Terminal
--     statuses (COMPLETED/CLOSED) set resolved_at = upstream
--     completedAt (or NOW if missing).
--   - Rows that were active but disappeared from the active set get
--     resolved_at = NOW (the "derived" resolution).
--   - Rows with resolved_at older than 24h get hard-deleted; that's
--     the natural prune.
--   - Rows still active (resolved_at IS NULL) get a separate
--     "stale-active" sweep: anything not seen in the last 30 min is
--     also pruned, since the worker likely missed a status change.
CREATE TABLE IF NOT EXISTS workbench_known_tasks (
  task_id        TEXT PRIMARY KEY,
  task_data      JSONB NOT NULL,
  status         TEXT NOT NULL,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workbench_known_tasks_resolved_at
  ON workbench_known_tasks(resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workbench_known_tasks_last_seen
  ON workbench_known_tasks(last_seen_at);

-- ────────────────────────────────────────────────────────────────────────────
-- Org Structure (Phase 0 — 2026-05-20)
--
-- Hierarchical org chart: a single recursive node table holds departments and
-- teams. A department can be the child of nothing (root) or another department
-- (= sub-department). A team can be the child of a department or another team
-- (= sub-team). Members attach to any node via team_member_overrides.org_node_id.
-- Soft-delete only — never DELETE from these tables via UI, only set is_archived.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES org_nodes(id) ON DELETE RESTRICT,
  kind            VARCHAR(20) NOT NULL CHECK (kind IN ('department','team')),
  name            VARCHAR(120) NOT NULL,
  slug            VARCHAR(160) NOT NULL UNIQUE,
  description     TEXT,
  lead_email      VARCHAR(255),
  color           VARCHAR(20),
  icon            VARCHAR(60),
  slack_channel   VARCHAR(120),
  country_codes   TEXT[],
  sort_order      INT NOT NULL DEFAULT 0,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(255),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_nodes_parent ON org_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_nodes_kind ON org_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_org_nodes_active ON org_nodes(is_archived) WHERE is_archived = false;
-- Unique active name within siblings under same parent (root nodes share parent_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_nodes_sibling_name
  ON org_nodes (COALESCE(parent_id::text, ''), LOWER(name))
  WHERE is_archived = false;

-- Vacant role placeholders — shown as ghost cards on the chart.
CREATE TABLE IF NOT EXISTS org_vacant_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_org_vacant_roles_node ON org_vacant_roles(node_id);

-- Delegated team-admins — per-node grant (a team lead can administer their
-- subtree). Global admins / regional managers are NOT listed here; their
-- power comes from access type. This table is for delegation only.
CREATE TABLE IF NOT EXISTS org_node_admins (
  node_id         UUID NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by      VARCHAR(255),
  PRIMARY KEY (node_id, email)
);
CREATE INDEX IF NOT EXISTS idx_org_node_admins_email ON org_node_admins(LOWER(email));

-- Append-only audit log for every org mutation. UPDATE/DELETE on this table
-- is never performed by application code — admins can only INSERT.
CREATE TABLE IF NOT EXISTS org_audit (
  id              BIGSERIAL PRIMARY KEY,
  actor_email     VARCHAR(255) NOT NULL,
  action          VARCHAR(60) NOT NULL,
  target_kind     VARCHAR(20),
  target_id       VARCHAR(255),
  before_json     JSONB,
  after_json      JSONB,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_audit_target ON org_audit(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_actor  ON org_audit(LOWER(actor_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_created ON org_audit(created_at DESC);

-- Member assignment FK — additive, nullable. The legacy "team" column on the
-- same row stays populated through Phase 5 for backwards-compat; Phase 6
-- drops it after all consumers migrate. ON DELETE SET NULL so an archived
-- node doesn't orphan rows (archiving forces a manual reassignment first).
ALTER TABLE team_member_overrides
  ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tmo_org_node ON team_member_overrides(org_node_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Multi-tenant isolation tagging (Phase 11a — 2026-05-20)
--
-- Every surface that hosts dept-scoped data gets a nullable org_node_id
-- FK to org_nodes. Nullable on ADD so the migration succeeds even on rows
-- that pre-date isolation; the boot-time backfillHrExperienceTenancyIfNeeded
-- (called below from runMigrations) stamps every NULL row with HR Experience
-- UUID right after the schema lands.
--
-- HRX-no-impact contract: after backfill, every existing row has
-- org_node_id = HR Experience. Read filters added in Phase 11b+ use
-- WHERE org_node_id = currentDeptId. HRX users resolve to HRX (via the
-- recursive CTE in src/lib/dept-scope.js) so the filter matches every
-- existing row exactly — zero data shifts for the ~100 HRX agents.
-- The legacy team column is never touched.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE announcements          ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_org_node           ON announcements(org_node_id);

ALTER TABLE hr_hub_request         ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hr_hub_request_org_node          ON hr_hub_request(org_node_id);

ALTER TABLE leader_alert           ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leader_alert_org_node            ON leader_alert(org_node_id);

ALTER TABLE urgent_assist_request  ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_urgent_assist_request_org_node   ON urgent_assist_request(org_node_id);

ALTER TABLE urgent_assist_schedule ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_urgent_assist_schedule_org_node  ON urgent_assist_schedule(org_node_id);

ALTER TABLE time_off_events        ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_time_off_events_org_node         ON time_off_events(org_node_id);

ALTER TABLE handovers              ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_handovers_org_node               ON handovers(org_node_id);

ALTER TABLE tasks                  ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_node                   ON tasks(org_node_id);

ALTER TABLE workspace_members      ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES org_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_members_org_node       ON workspace_members(org_node_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Phase 11j (2026-05-20) — fix urgent_assist_schedule unique constraint
--
-- The original CREATE TABLE declares schedule_date UNIQUE at column level,
-- generating constraint urgent_assist_schedule_schedule_date_key. With
-- Phase 11f isolation, two depts MUST be able to own their own (date, dept)
-- row independently — the column-level UNIQUE blocks that, causing the ON
-- CONFLICT in /urgent-assist-schedule POST to silently overwrite dept A's
-- slots with dept B's writes on a same-date INSERT collision.
--
-- Fix: drop the legacy single-column UNIQUE; add a composite UNIQUE on
-- (schedule_date, org_node_id) so each dept has its own per-date row.
-- Partial WHERE org_node_id IS NOT NULL because the brief boot-time
-- window between this schema landing and the dept-backfill running has
-- NULL rows; the backfill stamps them within the same runMigrations call.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE urgent_assist_schedule
  DROP CONSTRAINT IF EXISTS urgent_assist_schedule_schedule_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_urgent_assist_schedule_date_dept
  ON urgent_assist_schedule(schedule_date, org_node_id)
  WHERE org_node_id IS NOT NULL;
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

  // Versioned re-seed: when SEED_VERSION (in country-owners-seed.js) is
  // bumped, the next boot wipes team_member_countries and re-inserts from
  // the email-keyed JSON. The version marker lives in app_settings so
  // multiple pods don't double-write — every boot reads the marker first
  // and no-ops if the deploy already reseeded. Manual Team-tab edits are
  // preserved across deploys that don't bump SEED_VERSION.
  try {
    const seedResult = await seedCountryOwnersIfEmpty();
    if (seedResult?.reseeded) {
      console.log(`[db] Country-ownership re-seeded to v${seedResult.version}: ${seedResult.inserted} rows`);
    }
  } catch (err) {
    // Don't throw — the rest of the app should boot even if the seed fails.
    console.warn('[db] Country-ownership seed failed:', err?.message);
  }

  // HR Hub: insert per-flow defaults (statuses / fields / dropdowns /
  // auto_assign rules) for the 4 flows on first boot. Idempotent — see
  // hr-hub-seed.js for the version-marker mechanism. Manual edits via
  // Settings panel are preserved across deploys.
  try {
    const seedResult = await seedHrHubSettingsIfNeeded();
    if (!seedResult?.skipped) {
      console.log(`[db] HR Hub settings seeded to v${seedResult.version}: ${seedResult.inserted} rows inserted, ${seedResult.updated || 0} dropdown row(s) merged`);
    }
  } catch (err) {
    console.warn('[db] HR Hub settings seed failed:', err?.message);
  }

  // Leaders Alerts: insert defaults for categories / statuses / notification
  // policy on first boot. Idempotent via the same version-marker pattern as
  // HR Hub. Settings panel writes are preserved across deploys.
  try {
    const seedResult = await seedLeaderAlertsSettingsIfNeeded();
    if (!seedResult?.skipped) {
      const painNote = seedResult.painPointIconUpdated ? ', pain_point icon migrated' : '';
      console.log(`[db] Leaders Alerts settings seeded to v${seedResult.version}: ${seedResult.inserted} rows${painNote}`);
    }
  } catch (err) {
    console.warn('[db] Leaders Alerts settings seed failed:', err?.message);
  }

  // OOO: bootstrap time_off_events from the bundled HRX snapshot
  // (src/data/time_off_seed.json). Additive — never deletes manual
  // imports or Deel-API rows. Bump SEED_VERSION in time-off-seed.js
  // to roll out a newly regenerated snapshot.
  try {
    const seedResult = await seedTimeOffEventsIfNeeded();
    if (seedResult?.reseeded) {
      console.log(`[db] Time-off events seeded to v${seedResult.version}: ${seedResult.inserted} inserted, ${seedResult.skipped} already present`);
    }
  } catch (err) {
    console.warn('[db] Time-off seed failed:', err?.message);
  }

  // Handover defaults: one global handover_settings + checklist template
  // so the Phase 2 wizard's checklist step pre-fills from day 1. Admin
  // edits via Settings → Handovers (Phase 5) are preserved across boots.
  try {
    const seedResult = await seedHandoverDefaultsIfNeeded();
    if (seedResult?.reseeded) {
      console.log(`[db] Handover defaults seeded to v${seedResult.version}: template=${seedResult.template_id} settings=${seedResult.settings_id}`);
    }
  } catch (err) {
    console.warn('[db] Handover defaults seed failed:', err?.message);
  }

  // Workspace memberships (2026-05-12): seed workspace_members from the
  // file-based allowlists under src/workspaces/<team>/data/allowlist.js.
  // Idempotent + version-marked — runs once per deployed SEED_VERSION,
  // ON CONFLICT preserves any rows admins added/changed via the UI.
  // Failing the seed must not block boot: HR Hub doesn't depend on this
  // table and the other workspaces fall back to the file-based check.
  try {
    const seedResult = await seedWorkspaceMembersIfNeeded();
    if (!seedResult?.skipped) {
      console.log(`[db] Workspace members seeded to v${seedResult.version}: ${seedResult.inserted}/${seedResult.totalCandidates} rows`);
    }
  } catch (err) {
    console.warn('[db] Workspace members seed failed:', err?.message);
  }

  // Country Handover Docs (Phase A 2026-05-18): pre-create a draft row per
  // ISO-2 country we already know about so the editor (Phase B) always
  // edits an existing row. Idempotent + version-marked — manual edits via
  // the Phase B editor are preserved across boots.
  try {
    const seedResult = await seedCountryHandoverDocsIfNeeded();
    if (seedResult?.reseeded) {
      console.log(`[db] Country handover docs seeded to v${seedResult.version}: ${seedResult.inserted}/${seedResult.candidates} draft rows`);
    }
  } catch (err) {
    console.warn('[db] Country handover docs seed failed:', err?.message);
  }

  // Org Default (Phase 0 — 2026-05-20): seed HR Experience department +
  // EOR Operations + Next-Gen HR teams on first boot, then backfill every
  // existing override row with org_node_id = EOR Operations. Idempotent via
  // a version sentinel; renames done via the Org tab are preserved.
  try {
    const seedResult = await seedOrgDefaultIfNeeded();
    if (!seedResult?.skipped) {
      console.log(`[db] Org default seeded to v${seedResult.version}: HRX dept + 2 teams, ${seedResult.backfilled_overrides} member overrides backfilled`);
    }
  } catch (err) {
    console.warn('[db] Org default seed failed:', err?.message);
  }

  // Dept-tenancy backfill (Phase 11a — 2026-05-20): stamps every existing
  // row in every isolated surface table with HR Experience's UUID, so
  // Phase 11b+ read filters match every legacy row when HRX users resolve
  // to HRX. Runs AFTER seedOrgDefaultIfNeeded so the HRX node exists.
  // Version-sentinelled; idempotent.
  try {
    const backfillResult = await backfillHrExperienceTenancyIfNeeded();
    if (!backfillResult?.skipped) {
      const summary = Object.entries(backfillResult.perTable || {})
        .map(([t, n]) => `${t}=${n}`).join(' ');
      console.log(`[db] Dept-tenancy backfilled to v${backfillResult.version}: ${summary}`);
    }
  } catch (err) {
    console.warn('[db] Dept-tenancy backfill failed:', err?.message);
  }

  // Global Immigration roster seed (Phase 14 — 2026-05-20): mohamed's
  // 67-person Global Immigration team from "Deelers Information May 20 2026"
  // CSV. UPSERTs team_member_overrides rows + assigns tiers (1 RM, 7 team
  // leads, 58 agents) per the locked rule. Runs AFTER the dept-tenancy
  // backfill so org_node_id stays consistent on each row from creation.
  // Idempotent via global_immigration_roster_seed_version sentinel.
  try {
    const rosterResult = await seedGlobalImmigrationRosterIfNeeded();
    if (!rosterResult?.skipped) {
      console.log(`[db] Global Immigration roster seeded to v${rosterResult.version}: inserted=${rosterResult.inserted} failed=${rosterResult.failed} roster_size=${rosterResult.roster_size}`);
    }
  } catch (err) {
    console.warn('[db] Global Immigration roster seed failed:', err?.message);
  }

  // Phase C 2026-05-18: when HANDOVER_DEFAULTS_VERSION bumps, refresh the
  // `handover_checklist_items` rows for every *draft* handover so they
  // surface the v2 SOP items. Submitted handovers (status != 'draft') are
  // left untouched — their snapshot is historical record. The strategy
  // per the plan §4.1 + §11:
  //   • For each draft handover, replace its checklist_items rows with the
  //     v2 default items. Preserve `completed` state where the item_id
  //     survives both versions (currently only `hr_hub_followups`).
  //   • Items that disappeared (`active_tickets`, `escalations`, …) are
  //     dropped — they no longer exist on the template, and a stale row
  //     would render a non-existent item the wizard can't reason about.
  // Idempotent: we only run when the version marker says we need to and
  // each row is rebuilt deterministically. Failure is logged but doesn't
  // block boot.
  try {
    const { DEFAULT_CHECKLIST_ITEMS_V2, HANDOVER_DEFAULTS_VERSION } = await import('./handover-defaults-seed');
    const { rows: marker } = await query(
      `SELECT value FROM app_settings WHERE key = 'handover_defaults_checklist_migration_version'`,
    );
    const lastMigrationVersion = Number(marker[0]?.value?.version) || 0;
    if (lastMigrationVersion < HANDOVER_DEFAULTS_VERSION) {
      const { rows: drafts } = await query(
        `SELECT id FROM handovers WHERE status = 'draft'`,
      );
      let updatedCount = 0;
      for (const draft of drafts) {
        const { rows: existing } = await query(
          `SELECT item_id, completed, completed_at, completed_by, note
             FROM handover_checklist_items
            WHERE handover_id = $1`,
          [draft.id],
        );
        const oldById = new Map(existing.map(r => [r.item_id, r]));
        await query('BEGIN');
        try {
          await query(`DELETE FROM handover_checklist_items WHERE handover_id = $1`, [draft.id]);
          for (const it of DEFAULT_CHECKLIST_ITEMS_V2) {
            const carried = oldById.get(it.id) || null;
            await query(
              `INSERT INTO handover_checklist_items
                 (handover_id, item_id, label, required, completed, completed_at, completed_by, note)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (handover_id, item_id) DO NOTHING`,
              [
                draft.id, it.id, it.label, it.required ?? true,
                carried?.completed === true,
                carried?.completed_at || null,
                carried?.completed_by || null,
                carried?.note || null,
              ],
            );
          }
          await query('COMMIT');
          updatedCount += 1;
        } catch (innerErr) {
          try { await query('ROLLBACK'); } catch {}
          console.warn(`[db] Phase C: draft ${draft.id} migration failed:`, innerErr?.message);
        }
      }
      await query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
           VALUES ('handover_defaults_checklist_migration_version', $1::jsonb, 'phase-c-migration', NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [JSON.stringify({ version: HANDOVER_DEFAULTS_VERSION })],
      );
      if (updatedCount > 0 || drafts.length > 0) {
        console.log(`[db] Phase C checklist migration v${HANDOVER_DEFAULTS_VERSION}: ${updatedCount}/${drafts.length} draft handovers refreshed (was v${lastMigrationVersion})`);
      }
    }
  } catch (err) {
    console.warn('[db] Phase C checklist migration failed:', err?.message);
  }

  // Phase A 2026-05-18: TL approval is removed from the handover state
  // machine. Any in-flight row sitting in pending_manager_approval gets
  // auto-transitioned at boot:
  //   • → 'accepted'                          when ≥1 coverer has accepted
  //   • → 'pending_coverage_acceptance'       otherwise
  // 'accepted' isn't a status today (we use 'approved' as the post-coverage
  // ready state), but the revamp plan adopts 'accepted' as the new label
  // for that bucket — we map to 'approved' on the way through so the rest
  // of the pipeline (cron + UI) keeps working unchanged. The backfill is
  // idempotent: once no row is in pending_manager_approval, subsequent
  // boots do nothing.
  try {
    const backfillRes = await query(
      `WITH coverer_state AS (
         SELECT h.id,
                BOOL_OR(hc.acceptance_status = 'accepted') AS any_accepted
           FROM handovers h
      LEFT JOIN handover_coverers hc ON hc.handover_id = h.id
          WHERE h.status = 'pending_manager_approval'
          GROUP BY h.id
       )
       UPDATE handovers h
          SET status = CASE
                         WHEN cs.any_accepted IS TRUE THEN 'approved'
                         ELSE 'pending_coverage_acceptance'
                       END,
              updated_at = NOW()
         FROM coverer_state cs
        WHERE cs.id = h.id
        RETURNING h.id, h.status`,
    );
    if (backfillRes.rowCount > 0) {
      console.log(`[db] TL-approval teardown: ${backfillRes.rowCount} pending_manager_approval row(s) re-bucketed`);
    }
  } catch (err) {
    console.warn('[db] TL-approval backfill failed:', err?.message);
  }
}
