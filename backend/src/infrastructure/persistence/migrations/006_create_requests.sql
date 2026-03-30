-- 006_create_requests.sql
-- Outbound requests to other teams (Legal, Finance, IT, etc.)

CREATE TABLE IF NOT EXISTS requests (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  task_id         TEXT        REFERENCES tasks(id) ON DELETE SET NULL,
  subject         TEXT        NOT NULL,
  description     TEXT,
  from_member_id  INTEGER     NOT NULL REFERENCES members(id),
  to_team         TEXT        NOT NULL
                    CHECK (to_team IN ('legal','finance','it','payroll','hr','compliance','other')),
  priority        TEXT        NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','critical')),
  status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','waiting','resolved','cancelled')),
  external_ref    TEXT,
  linked_task_id  TEXT        REFERENCES tasks(id) ON DELETE SET NULL,
  due_date        TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_status    ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_to_team   ON requests(to_team);
CREATE INDEX IF NOT EXISTS idx_requests_from      ON requests(from_member_id);
CREATE INDEX IF NOT EXISTS idx_requests_task      ON requests(task_id);
CREATE INDEX IF NOT EXISTS idx_requests_created   ON requests(created_at DESC);
