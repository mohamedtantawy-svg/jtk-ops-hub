-- 008_add_task_columns.sql
-- Adds columns needed for the full Ops Hub task model

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS type            TEXT,
  ADD COLUMN IF NOT EXISTS requester_name  TEXT,
  ADD COLUMN IF NOT EXISTS channel         TEXT,
  ADD COLUMN IF NOT EXISTS sender          TEXT,
  ADD COLUMN IF NOT EXISTS is_alert        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sla_breached    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sla_at_risk     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolved_mins   INTEGER,
  ADD COLUMN IF NOT EXISTS snooze_label    TEXT,
  ADD COLUMN IF NOT EXISTS suggested_reply TEXT,
  ADD COLUMN IF NOT EXISTS minutes_ago     INTEGER     GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (NOW() - source_created_at)) / 60
  ) STORED;

-- Full-text search index on subject + description
CREATE INDEX IF NOT EXISTS idx_tasks_fts ON tasks
  USING GIN (to_tsvector('english', COALESCE(subject,'') || ' ' || COALESCE(description,'')));

-- Partial index: open tasks only (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks(assignee_id, source_created_at DESC)
  WHERE status NOT IN ('resolved');

-- Cursor pagination: (source_created_at, id) composite for stable ordering
CREATE INDEX IF NOT EXISTS idx_tasks_cursor ON tasks(source_created_at DESC, id DESC);
