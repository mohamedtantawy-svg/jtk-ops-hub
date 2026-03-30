-- 011_fix_member_id_type.sql
-- Align member IDs to TEXT across all tables for consistency with domain model.
-- The domain uses string IDs (e.g., 'm-001') but some FKs reference INTEGER.

-- Step 1: Drop all foreign key constraints referencing members(id)
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_lead_id_fkey;
ALTER TABLE task_notes DROP CONSTRAINT IF EXISTS task_notes_author_id_fkey;
ALTER TABLE task_activity DROP CONSTRAINT IF EXISTS task_activity_actor_id_fkey;
ALTER TABLE escalations DROP CONSTRAINT IF EXISTS escalations_manager_id_fkey;
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_from_member_id_fkey;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_author_id_fkey;
ALTER TABLE announcement_reads DROP CONSTRAINT IF EXISTS announcement_reads_member_id_fkey;
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_member_id_fkey;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_owner_id_fkey;

-- Step 2: Alter members.id from SERIAL to TEXT
ALTER TABLE members ALTER COLUMN id DROP DEFAULT;
ALTER TABLE members ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Step 2b: Alter members.lead_id from INTEGER to TEXT
ALTER TABLE members ALTER COLUMN lead_id TYPE TEXT USING lead_id::TEXT;

-- Step 3: Alter all referencing columns to TEXT
ALTER TABLE task_notes ALTER COLUMN author_id TYPE TEXT USING author_id::TEXT;
ALTER TABLE task_activity ALTER COLUMN actor_id TYPE TEXT USING actor_id::TEXT;
ALTER TABLE escalations ALTER COLUMN manager_id TYPE TEXT USING manager_id::TEXT;
ALTER TABLE requests ALTER COLUMN from_member_id TYPE TEXT USING from_member_id::TEXT;
ALTER TABLE announcements ALTER COLUMN author_id TYPE TEXT USING author_id::TEXT;
ALTER TABLE announcement_reads ALTER COLUMN member_id TYPE TEXT USING member_id::TEXT;
ALTER TABLE project_members ALTER COLUMN member_id TYPE TEXT USING member_id::TEXT;
ALTER TABLE projects ALTER COLUMN owner_id TYPE TEXT USING owner_id::TEXT;

-- Step 4: Re-add foreign key constraints
ALTER TABLE members ADD CONSTRAINT members_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE task_notes ADD CONSTRAINT task_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE task_activity ADD CONSTRAINT task_activity_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE escalations ADD CONSTRAINT escalations_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE requests ADD CONSTRAINT requests_from_member_id_fkey FOREIGN KEY (from_member_id) REFERENCES members(id);
ALTER TABLE announcements ADD CONSTRAINT announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id);
ALTER TABLE announcement_reads ADD CONSTRAINT announcement_reads_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE project_members ADD CONSTRAINT project_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE projects ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES members(id) ON DELETE SET NULL;
