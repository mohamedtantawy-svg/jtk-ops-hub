import { Pool } from 'pg';
import { IEscalationRepository, EscalationFilter, EscalationPage } from '../../domain/escalation/IEscalationRepository';
import { Escalation, EscalationProps, EscalationStatus, EscalationSeverity, EscalationSource, ManagerResponseStatus } from '../../domain/escalation/Escalation';

export class PostgresEscalationRepository implements IEscalationRepository {
  constructor(private readonly pool: Pool) {}

  // ── Mapping ────────────────────────────────────────────────────────────────

  private rowToEscalation(row: Record<string, any>): Escalation {
    const props: EscalationProps = {
      id:                   row.id,
      taskId:               row.task_id ?? null,
      subject:              row.subject,
      reason:               row.reason,
      escalatedBy:          row.escalated_by,
      escalatedAt:          new Date(row.escalated_at),
      managerId:            row.manager_id ?? null,
      managerName:          row.manager_name ?? null,
      status:               row.status as EscalationStatus,
      severity:             row.severity as EscalationSeverity,
      escalationSource:     row.escalation_source as EscalationSource,
      slackChannel:         row.slack_channel ?? null,
      slackUser:            row.slack_user ?? null,
      slackMessageUrl:      row.slack_message_url ?? null,
      managerResponse:      row.manager_response ?? null,
      managerResponseStatus: row.manager_response_status as ManagerResponseStatus,
      managerRespondedAt:   row.manager_responded_at ? new Date(row.manager_responded_at) : null,
      managerRespondedBy:   row.manager_responded_by ?? null,
      slaDeadline:          row.sla_deadline ? new Date(row.sla_deadline) : null,
      createdAt:            new Date(row.created_at),
      updatedAt:            new Date(row.updated_at),
    };
    return Escalation.reconstitute(props);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Escalation | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM escalations WHERE id = $1',
      [id],
    );
    return rows[0] ? this.rowToEscalation(rows[0]) : null;
  }

  async findAll(filter: EscalationFilter): Promise<EscalationPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.status?.length) {
      conditions.push(`status = ANY($${p++})`);
      params.push(filter.status);
    }
    if (filter.severity?.length) {
      conditions.push(`severity = ANY($${p++})`);
      params.push(filter.severity);
    }
    if (filter.source?.length) {
      conditions.push(`escalation_source = ANY($${p++})`);
      params.push(filter.source);
    }
    if (filter.managerId != null) {
      conditions.push(`manager_id = $${p++}`);
      params.push(filter.managerId);
    }
    if (filter.taskId) {
      conditions.push(`task_id = $${p++}`);
      params.push(filter.taskId);
    }

    // Cursor-based pagination: rows before (created_at, id) pair
    // NOTE: escalated_at is TIMESTAMPTZ (see migration 003) — cursor uses created_at which is also TIMESTAMPTZ.
    if (filter.cursor) {
      const p1 = p++; const p2 = p++;
      conditions.push(`(created_at, id) < ($${p1}, $${p2})`);
      params.push(filter.cursor.createdAt, filter.cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = (filter.limit ?? 50) + 1; // fetch one extra to determine hasMore

    const { rows } = await this.pool.query(
      `SELECT * FROM escalations ${where} ORDER BY created_at DESC, id DESC LIMIT $${p}`,
      [...params, limit],
    );

    const hasMore = rows.length === limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(r => this.rowToEscalation(r)),
      hasMore,
      nextCursor: hasMore && last
        ? { createdAt: new Date(last.created_at), id: last.id }
        : null,
    };
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async save(escalation: Escalation): Promise<void> {
    const s = escalation.toSnapshot();
    await this.pool.query(
      `INSERT INTO escalations (
        id, task_id, subject, reason, escalated_by, escalated_at,
        manager_id, manager_name, status, severity, escalation_source,
        slack_channel, slack_user, slack_message_url,
        manager_response, manager_response_status, manager_responded_at,
        manager_responded_by, sla_deadline, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )`,
      [
        s.id, s.taskId, s.subject, s.reason, s.escalatedBy, s.escalatedAt,
        s.managerId, s.managerName, s.status, s.severity, s.escalationSource,
        s.slackChannel, s.slackUser, s.slackMessageUrl,
        s.managerResponse, s.managerResponseStatus, s.managerRespondedAt,
        s.managerRespondedBy, s.slaDeadline, s.createdAt, s.updatedAt,
      ],
    );
  }

  async update(escalation: Escalation): Promise<void> {
    const s = escalation.toSnapshot();
    await this.pool.query(
      `UPDATE escalations SET
        status=$2, severity=$3, manager_response=$4,
        manager_response_status=$5, manager_responded_at=$6,
        manager_responded_by=$7, updated_at=$8
      WHERE id=$1`,
      [
        s.id, s.status, s.severity, s.managerResponse,
        s.managerResponseStatus, s.managerRespondedAt,
        s.managerRespondedBy, s.updatedAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM escalations WHERE id = $1', [id]);
  }
}
