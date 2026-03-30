-- 005_create_notes_activity.sql

CREATE TABLE IF NOT EXISTS task_notes (
  id          SERIAL      PRIMARY KEY,
  task_id     TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   INTEGER     REFERENCES members(id) ON DELETE SET NULL,
  author_name TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  is_internal BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_activity (
  id          SERIAL      PRIMARY KEY,
  task_id     TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    INTEGER     REFERENCES members(id) ON DELETE SET NULL,
  actor_name  TEXT        NOT NULL,
  event_type  TEXT        NOT NULL
                CHECK (event_type IN (
                  'created','assigned','status','escalated',
                  'snoozed','resolved','note','reassigned','updated'
                )),
  event_text  TEXT        NOT NULL,
  metadata    JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_task     ON task_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_notes_author   ON task_notes(author_id);
CREATE INDEX IF NOT EXISTS idx_activity_task  ON task_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON task_activity(actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_time  ON task_activity(occurred_at DESC);
