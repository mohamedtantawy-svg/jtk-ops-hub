-- Announcement comments (supports nested replies via parent_id)
CREATE TABLE IF NOT EXISTS announcement_comments (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES announcement_comments(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_announcement_comments_announcement ON announcement_comments(announcement_id, created_at);
CREATE INDEX idx_announcement_comments_parent ON announcement_comments(parent_id);

-- Announcement links (bidirectional)
CREATE TABLE IF NOT EXISTS announcement_links (
  source_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX idx_announcement_links_target ON announcement_links(target_id);
