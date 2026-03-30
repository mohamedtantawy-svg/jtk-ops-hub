-- 003_create_escalations.sql

CREATE TABLE IF NOT EXISTS escalations (
  id                        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  task_id                   TEXT        REFERENCES tasks(id) ON DELETE SET NULL,
  subject                   TEXT        NOT NULL,
  reason                    TEXT        NOT NULL,
  escalated_by              TEXT        NOT NULL,
  escalated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  manager_id                INTEGER     REFERENCES members(id) ON DELETE SET NULL,
  manager_name              TEXT,
  status                    TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','responded','resolved','dismissed')),
  severity                  TEXT        NOT NULL DEFAULT 'medium'
                              CHECK (severity IN ('low','medium','high','critical')),
  escalation_source         TEXT        NOT NULL DEFAULT 'ticket'
                              CHECK (escalation_source IN ('ticket','slack','manual')),
  slack_channel             TEXT,
  slack_user                TEXT,
  slack_message_url         TEXT,
  manager_response          TEXT,
  manager_response_status   TEXT        NOT NULL DEFAULT 'pending_response'
                              CHECK (manager_response_status IN ('pending_response','responded')),
  manager_responded_at      TIMESTAMPTZ,
  manager_responded_by      TEXT,
  sla_deadline              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_task_id  ON escalations(task_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status   ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_severity ON escalations(severity);
CREATE INDEX IF NOT EXISTS idx_escalations_source   ON escalations(escalation_source);
CREATE INDEX IF NOT EXISTS idx_escalations_created  ON escalations(created_at DESC);
