-- 007_create_announcements.sql

CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  type        TEXT        NOT NULL DEFAULT 'update'
                CHECK (type IN ('alert','announce','update','guidance','kudos')),
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  author_id   INTEGER     NOT NULL REFERENCES members(id),
  target      TEXT        NOT NULL DEFAULT 'all'
                CHECK (target IN ('all','EMEA','APAC','AMER')),
  status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','archived')),
  priority    TEXT        NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low','medium','high','critical')),
  is_pinned   BOOLEAN     NOT NULL DEFAULT FALSE,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Read receipts
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT        NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  member_id       INTEGER     NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY     (announcement_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_type     ON announcements(type);
CREATE INDEX IF NOT EXISTS idx_announcements_status   ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_target   ON announcements(target);
CREATE INDEX IF NOT EXISTS idx_announcements_author   ON announcements(author_id);
CREATE INDEX IF NOT EXISTS idx_announcements_created  ON announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ann_reads_ann          ON announcement_reads(announcement_id);
CREATE INDEX IF NOT EXISTS idx_ann_reads_member       ON announcement_reads(member_id);
