import { Pool } from 'pg';
import { IRequestRepository, RequestFilter, RequestPage } from '../../domain/request/IRequestRepository';
import { OpsRequest, RequestProps, RequestToTeam, RequestStatus, RequestPriority } from '../../domain/request/Request';

export class PostgresRequestRepository implements IRequestRepository {
  constructor(private readonly pool: Pool) {}

  private rowToRequest(row: Record<string, any>): OpsRequest {
    const props: RequestProps = {
      id: row.id,
      taskId: row.task_id ?? null,
      subject: row.subject,
      description: row.description ?? null,
      fromMemberId: String(row.from_member_id),
      toTeam: row.to_team as RequestToTeam,
      priority: row.priority as RequestPriority,
      status: row.status as RequestStatus,
      externalRef: row.external_ref ?? null,
      linkedTaskId: row.linked_task_id ?? null,
      dueDate: row.due_date ? new Date(row.due_date) : null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
    return OpsRequest.reconstitute(props);
  }

  async findById(id: string): Promise<OpsRequest | null> {
    const { rows } = await this.pool.query('SELECT * FROM requests WHERE id = $1', [id]);
    return rows[0] ? this.rowToRequest(rows[0]) : null;
  }

  async findAll(filter: RequestFilter): Promise<RequestPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.fromMemberId) { conditions.push(`from_member_id = $${p++}`); params.push(filter.fromMemberId); }
    if (filter.toTeam) { conditions.push(`to_team = $${p++}`); params.push(filter.toTeam); }
    if (filter.status?.length) { conditions.push(`status = ANY($${p++})`); params.push(filter.status); }
    if (filter.cursor) {
      const p1 = p++; const p2 = p++;
      conditions.push(`(created_at, id) < ($${p1}, $${p2})`);
      params.push(filter.cursor.createdAt, filter.cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = (filter.limit ?? 50) + 1;

    const { rows } = await this.pool.query(
      `SELECT * FROM requests ${where} ORDER BY created_at DESC, id DESC LIMIT $${p}`,
      [...params, limit],
    );

    const hasMore = rows.length === limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(r => this.rowToRequest(r)),
      hasMore,
      nextCursor: hasMore && last ? { createdAt: new Date(last.created_at), id: last.id } : null,
    };
  }

  async save(request: OpsRequest): Promise<void> {
    const s = request.toSnapshot();
    await this.pool.query(
      `INSERT INTO requests (id, task_id, subject, description, from_member_id, to_team, priority, status, external_ref, linked_task_id, due_date, resolved_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.taskId, s.subject, s.description, s.fromMemberId, s.toTeam, s.priority, s.status, s.externalRef, s.linkedTaskId, s.dueDate, s.resolvedAt, s.createdAt, s.updatedAt],
    );
  }

  async update(request: OpsRequest): Promise<void> {
    const s = request.toSnapshot();
    await this.pool.query(
      `UPDATE requests SET subject=$2, description=$3, to_team=$4, priority=$5, status=$6, external_ref=$7, linked_task_id=$8, due_date=$9, resolved_at=$10, updated_at=$11 WHERE id=$1`,
      [s.id, s.subject, s.description, s.toTeam, s.priority, s.status, s.externalRef, s.linkedTaskId, s.dueDate, s.resolvedAt, s.updatedAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM requests WHERE id = $1', [id]);
  }
}
