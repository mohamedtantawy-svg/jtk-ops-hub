-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
CREATE INDEX IF NOT EXISTS idx_tasks_country_code ON tasks(country_code);
CREATE INDEX IF NOT EXISTS idx_tasks_source_created_at ON tasks(source_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_task_id ON escalations(task_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_manager_id ON escalations(manager_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_role ON members(role);
CREATE INDEX IF NOT EXISTS idx_members_team ON members(team);
-- Composite cursor index for pagination
CREATE INDEX IF NOT EXISTS idx_tasks_cursor ON tasks(source_created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_cursor ON escalations(escalated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_projects_cursor ON projects(created_at DESC, id DESC);
