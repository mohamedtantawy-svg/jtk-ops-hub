-- 002_create_members.sql
-- HR Ops agents, team leads, regional managers, and admins

CREATE TABLE IF NOT EXISTS members (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  initials      CHAR(2)     NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('agent','lead','regional_mgr','admin')),
  team          TEXT        NOT NULL DEFAULT 'ALL',
  region        TEXT        NOT NULL DEFAULT 'ALL',
  country       CHAR(2)     NOT NULL DEFAULT 'AE',
  lead_id       INTEGER     REFERENCES members(id) ON DELETE SET NULL,
  email         TEXT        UNIQUE,
  avatar_url    TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_role   ON members(role);
CREATE INDEX IF NOT EXISTS idx_members_team   ON members(team);
CREATE INDEX IF NOT EXISTS idx_members_region ON members(region);
CREATE INDEX IF NOT EXISTS idx_members_lead   ON members(lead_id);
