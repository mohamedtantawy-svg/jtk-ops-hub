-- 004_create_projects.sql

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  title         TEXT        NOT NULL,
  description   TEXT,
  owner_id      INTEGER     REFERENCES members(id) ON DELETE SET NULL,
  status        TEXT        NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning','active','on_hold','completed','cancelled')),
  priority      TEXT        NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low','medium','high','critical')),
  region        TEXT        NOT NULL DEFAULT 'ALL',
  start_date    DATE,
  deadline      DATE,
  progress      SMALLINT    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Milestones
CREATE TABLE IF NOT EXISTS project_milestones (
  id            SERIAL      PRIMARY KEY,
  project_id    TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  due_date      DATE,
  completed     BOOLEAN     NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  sort_order    SMALLINT    NOT NULL DEFAULT 0
);

-- Task linkage
CREATE TABLE IF NOT EXISTS project_tasks (
  project_id    TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id       TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY   (project_id, task_id)
);

-- Member linkage
CREATE TABLE IF NOT EXISTS project_members (
  project_id    TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id     INTEGER     NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL DEFAULT 'contributor'
                  CHECK (role IN ('owner','lead','contributor','observer')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY   (project_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_owner     ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_region    ON projects(region);
CREATE INDEX IF NOT EXISTS idx_projects_deadline  ON projects(deadline);
