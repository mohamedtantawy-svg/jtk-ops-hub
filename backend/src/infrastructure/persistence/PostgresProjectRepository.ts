import { Pool } from 'pg';
import { IProjectRepository, ProjectFilter, ProjectPage } from '../../domain/project/IProjectRepository';
import { Project, ProjectProps, ProjectStatus, ProjectPriority } from '../../domain/project/Project';

export class PostgresProjectRepository implements IProjectRepository {
  constructor(private readonly pool: Pool) {}

  private rowToProject(row: Record<string, any>): Project {
    const props: ProjectProps = {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      status: row.status as ProjectStatus,
      priority: row.priority as ProjectPriority,
      ownerId: row.owner_id,
      teamId: row.team_id ?? null,
      deadline: row.deadline ? new Date(row.deadline) : null,
      progress: row.progress ?? 0,
      tags: row.tags ?? [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
    return Project.reconstitute(props);
  }

  async findById(id: string): Promise<Project | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [id],
    );
    return rows[0] ? this.rowToProject(rows[0]) : null;
  }

  async findAll(filter: ProjectFilter): Promise<ProjectPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.ownerId) {
      conditions.push(`owner_id = $${p++}`);
      params.push(filter.ownerId);
    }
    if (filter.teamId) {
      conditions.push(`team_id = $${p++}`);
      params.push(filter.teamId);
    }
    if (filter.status?.length) {
      conditions.push(`status = ANY($${p++})`);
      params.push(filter.status);
    }
    if (filter.priority?.length) {
      conditions.push(`priority = ANY($${p++})`);
      params.push(filter.priority);
    }
    if (filter.cursor) {
      const p1 = p++; const p2 = p++;
      conditions.push(`(created_at, id) < ($${p1}, $${p2})`);
      params.push(filter.cursor.createdAt, filter.cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = (filter.limit ?? 50) + 1;

    const { rows } = await this.pool.query(
      `SELECT * FROM projects ${where} ORDER BY created_at DESC, id DESC LIMIT $${p}`,
      [...params, limit],
    );

    const hasMore = rows.length === limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(r => this.rowToProject(r)),
      hasMore,
      nextCursor: hasMore && last
        ? { createdAt: new Date(last.created_at), id: last.id }
        : null,
    };
  }

  async save(project: Project): Promise<void> {
    const s = project.toSnapshot();
    await this.pool.query(
      `INSERT INTO projects (id, title, description, status, priority, owner_id, team_id, deadline, progress, tags, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.title, s.description, s.status, s.priority, s.ownerId, s.teamId, s.deadline, s.progress, s.tags, s.createdAt, s.updatedAt],
    );
  }

  async update(project: Project): Promise<void> {
    const s = project.toSnapshot();
    await this.pool.query(
      `UPDATE projects SET title=$2, description=$3, status=$4, priority=$5, team_id=$6, deadline=$7, progress=$8, tags=$9, updated_at=$10
       WHERE id=$1`,
      [s.id, s.title, s.description, s.status, s.priority, s.teamId, s.deadline, s.progress, s.tags, s.updatedAt],
    );
  }

  async delete(id: string): Promise<void> {
    // TODO: migrate to soft delete with deleted_at column
    await this.pool.query('DELETE FROM projects WHERE id = $1', [id]);
  }
}
