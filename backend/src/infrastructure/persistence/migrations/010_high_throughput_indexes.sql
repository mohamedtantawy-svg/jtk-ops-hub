-- High-throughput indexes for 500K+ webhook events/month
-- Optimizes the hot paths: dedup lookup, batch insert, and queue filtering

-- ── Dedup lookup (critical path for every webhook) ──────────────────────────
-- The combo (external_id, source) is already UNIQUE, but add a covering index
-- that includes 'id' so the dedup SELECT can be satisfied from the index alone
-- without a heap lookup (index-only scan).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_dedup_covering
  ON tasks (external_id, source) INCLUDE (id);

-- ── Partial index for open tasks (queue view) ───────────────────────────────
-- Most queue queries filter for open/in_progress/waiting — this partial index
-- keeps only the ~15% of rows that matter, making the B-tree much smaller.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_open_cursor
  ON tasks (source_created_at DESC, id DESC)
  WHERE status IN ('open', 'in_progress', 'pending', 'snoozed', 'escalated');

-- ── Assignee + status compound for "my queue" ──────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assignee_status
  ON tasks (assignee_id, status, source_created_at DESC)
  WHERE assignee_id IS NOT NULL;

-- ── Source + created_at for per-source analytics ────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_source_created
  ON tasks (source, source_created_at DESC);

-- ── BRIN index on created_at for time-range bulk queries (reports) ──────────
-- BRIN is extremely compact for monotonically increasing timestamps.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_created_brin
  ON tasks USING brin (created_at) WITH (pages_per_range = 32);

-- ── Table tuning ────────────────────────────────────────────────────────────
-- Reduce autovacuum threshold for tasks table since it receives frequent inserts
ALTER TABLE tasks SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  fillfactor = 90
);
