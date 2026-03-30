import { Pool, QueryResult } from 'pg';
import { ITaskRepository, TaskFilter, TaskPage } from '../../domain/task/ITaskRepository';
import { Task, TaskProps } from '../../domain/task/Task';
import { TaskStatus } from '../../domain/task/TaskStatus';
import { TaskSource, TaskSourceValue } from '../../domain/task/TaskSource';
import { TaskPriority } from '../../domain/task/TaskPriority';

export class PostgresTaskRepository implements ITaskRepository {
  constructor(private readonly pool: Pool) {}

  // ── Mapping ───────────────────────────────────────────────────────────────

  private rowToTask(row: Record<string, any>): Task {
    const props: TaskProps = {
      id: row.id,
      externalId: row.external_id,
      source: TaskSource.of(row.source),
      subject: row.subject,
      description: row.description,
      status: TaskStatus.of(row.status),
      priority: TaskPriority.of(row.priority),
      assigneeId: row.assignee_id ?? null,
      reporterId: row.reporter_id ?? null,
      countryCode: row.country_code ?? null,
      tags: row.tags ?? [],
      externalUrl: row.external_url ?? null,
      snoozedUntil: row.snoozed_until ? new Date(row.snoozed_until) : null,
      escalatedTo: row.escalated_to ?? null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      sourceCreatedAt: new Date(row.source_created_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
    return Task.reconstitute(props);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Task | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id],
    );
    return rows[0] ? this.rowToTask(rows[0]) : null;
  }

  async findByExternalId(externalId: string, source: TaskSourceValue): Promise<Task | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM tasks WHERE external_id = $1 AND source = $2',
      [externalId, source],
    );
    return rows[0] ? this.rowToTask(rows[0]) : null;
  }

  async findAll(filter: TaskFilter): Promise<TaskPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.assigneeId) {
      conditions.push(`assignee_id = $${p++}`);
      params.push(filter.assigneeId);
    }
    if (filter.status?.length) {
      conditions.push(`status = ANY($${p++})`);
      params.push(filter.status);
    }
    if (filter.source?.length) {
      conditions.push(`source = ANY($${p++})`);
      params.push(filter.source);
    }
    if (filter.countryCode) {
      conditions.push(`country_code = $${p++}`);
      params.push(filter.countryCode);
    }
    if (filter.search?.trim()) {
      // Use parameterised full-text search to prevent injection.
      // Guard: plainto_tsquery throws on empty string, so only add filter when search is non-empty.
      conditions.push(`to_tsvector('english', COALESCE(subject,'') || ' ' || COALESCE(description,'')) @@ plainto_tsquery('english', $${p++})`);
      params.push(filter.search.trim());
    }

    // Cursor-based pagination: rows before (source_created_at DESC, id DESC) pair
    if (filter.cursor) {
      const p1 = p++; const p2 = p++;
      conditions.push(`(source_created_at, id) < ($${p1}, $${p2})`);
      params.push(filter.cursor.createdAt, filter.cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = (filter.limit ?? 50) + 1; // fetch one extra to determine hasMore

    const { rows } = await this.pool.query(
      `SELECT * FROM tasks ${where} ORDER BY source_created_at DESC, id DESC LIMIT $${p}`,
      [...params, limit],
    );

    const hasMore = rows.length === limit;
    const items = (hasMore ? rows.slice(0, -1) : rows).map(r => this.rowToTask(r));
    const last = rows[hasMore ? rows.length - 2 : rows.length - 1];

    // Apply SLA filter in memory (requires domain logic)
    const filtered = filter.slaStatus
      ? items.filter(t => t.slaStatus === filter.slaStatus)
      : items;

    return {
      items: filtered,
      hasMore,
      nextCursor: hasMore && last
        ? { createdAt: new Date(last.source_created_at), id: last.id }
        : null,
      // legacy offset fields kept for backwards compatibility
      total: -1, // use hasMore + nextCursor for pagination
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    };
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async save(task: Task): Promise<void> {
    const s = task.toSnapshot();
    await this.pool.query(
      `INSERT INTO tasks (
        id, external_id, source, subject, description, status, priority,
        assignee_id, reporter_id, country_code, tags, external_url,
        snoozed_until, escalated_to, resolved_at, source_created_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (external_id, source) DO NOTHING`,
      [
        s.id, s.externalId, s.source.toString(), s.subject, s.description,
        s.status.toString(), s.priority.toString(),
        s.assigneeId, s.reporterId, s.countryCode, s.tags, s.externalUrl,
        s.snoozedUntil, s.escalatedTo, s.resolvedAt, s.sourceCreatedAt,
        s.createdAt, s.updatedAt,
      ],
    );
  }

  async update(task: Task): Promise<void> {
    const s = task.toSnapshot();
    await this.pool.query(
      `UPDATE tasks SET
        subject=$2, description=$3, status=$4, priority=$5,
        assignee_id=$6, reporter_id=$7, country_code=$8, tags=$9,
        external_url=$10, snoozed_until=$11, escalated_to=$12,
        resolved_at=$13, updated_at=$14
      WHERE id=$1`,
      [
        s.id, s.subject, s.description, s.status.toString(), s.priority.toString(),
        s.assigneeId, s.reporterId, s.countryCode, s.tags,
        s.externalUrl, s.snoozedUntil, s.escalatedTo, s.resolvedAt, s.updatedAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
}
