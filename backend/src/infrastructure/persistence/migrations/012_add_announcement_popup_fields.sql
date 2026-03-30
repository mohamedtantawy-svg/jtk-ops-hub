-- 011_add_announcement_popup_fields.sql
-- Adds isPopup, imageUrl, link columns to announcements table

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_popup   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url  TEXT    NOT NULL DEFAULT '';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS link       TEXT    NOT NULL DEFAULT '';
