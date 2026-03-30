CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS tasks (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id      TEXT NOT NULL,
  source           TEXT NOT NULL,
  subject          TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open',
  priority         TEXT NOT NULL DEFAULT 'medium',
  assignee_id      TEXT,
  reporter_id      TEXT,
  country_code     CHAR(2),
  tags             TEXT[]    NOT NULL DEFAULT '{}',
  external_url     TEXT,
  snoozed_until    TIMESTAMPTZ,
  escalated_to     TEXT,
  resolved_at      TIMESTAMPTZ,
  source_created_at TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (external_id, source)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee     ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source       ON tasks(source);
CREATE INDEX IF NOT EXISTS idx_tasks_country      ON tasks(country_code);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at   ON tasks(source_created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_sla_deadline ON tasks(source_created_at, priority);

-- Migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
