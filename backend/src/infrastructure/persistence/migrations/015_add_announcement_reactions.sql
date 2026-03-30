-- Add persistent emoji reactions to announcements
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
