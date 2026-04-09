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
  source VARCHAR(50) DEFAULT 'manual',
  subject TEXT NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'open',
  priority VARCHAR(50) DEFAULT 'medium',
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
  status VARCHAR(50) DEFAULT 'pending',
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
  status VARCHAR(50) DEFAULT 'active',
  priority VARCHAR(50) DEFAULT 'medium',
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
  status VARCHAR(50) DEFAULT 'open',
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
  type VARCHAR(50) DEFAULT 'info',
  title VARCHAR(500) NOT NULL,
  body TEXT,
  target VARCHAR(100) DEFAULT 'all',
  priority VARCHAR(50) DEFAULT 'normal',
  is_popup BOOLEAN DEFAULT false,
  image_url TEXT,
  link TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  author_id INTEGER,
  pinned BOOLEAN DEFAULT false,
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

-- Migrations tracking
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
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
