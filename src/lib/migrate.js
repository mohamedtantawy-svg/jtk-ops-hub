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
