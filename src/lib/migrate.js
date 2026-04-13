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

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_to_team ON requests(to_team);
CREATE INDEX IF NOT EXISTS idx_requests_from_member ON requests(from_member_id);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);

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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_status') THEN
    ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status CHECK (status IN ('open','in_progress','escalated','snoozed','resolved','closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_priority') THEN
    ALTER TABLE tasks ADD CONSTRAINT chk_tasks_priority CHECK (priority IN ('critical','high','medium','low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_escalations_status') THEN
    ALTER TABLE escalations ADD CONSTRAINT chk_escalations_status CHECK (status IN ('pending','in_progress','resolved','dismissed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_projects_progress') THEN
    ALTER TABLE projects ADD CONSTRAINT chk_projects_progress CHECK (progress >= 0 AND progress <= 100);
  END IF;
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
