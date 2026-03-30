-- Add foreign key constraint on announcement_comments.author_id → members(id)
-- Uses ON DELETE CASCADE so deleting a member removes their comments
ALTER TABLE announcement_comments
  ADD CONSTRAINT fk_comment_author
  FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE CASCADE;
