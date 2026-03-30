import { Pool } from 'pg';
import { IActivityRepository } from '../../domain/activity/IActivityRepository';
import { Activity, ActivityProps, ActivityEventType } from '../../domain/activity/Activity';

export class PostgresActivityRepository implements IActivityRepository {
  constructor(private readonly pool: Pool) {}

  private rowToActivity(row: Record<string, any>): Activity {
    const props: ActivityProps = {
      id: String(row.id),
      taskId: row.task_id,
      actorId: row.actor_id ? String(row.actor_id) : '',
      actorName: row.actor_name,
      eventType: row.event_type as ActivityEventType,
      eventText: row.event_text,
      metadata: row.metadata ?? null,
      occurredAt: new Date(row.occurred_at),
    };
    return Activity.reconstitute(props);
  }

  async findByTaskId(taskId: string): Promise<Activity[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM task_activity WHERE task_id = $1 ORDER BY occurred_at DESC',
      [taskId],
    );
    return rows.map(r => this.rowToActivity(r));
  }

  async save(activity: Activity): Promise<void> {
    const s = activity.toSnapshot();
    await this.pool.query(
      `INSERT INTO task_activity (task_id, actor_id, actor_name, event_type, event_text, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.taskId, s.actorId || null, s.actorName, s.eventType, s.eventText, s.metadata ? JSON.stringify(s.metadata) : null, s.occurredAt],
    );
  }
}
