import { v4 as uuidv4 } from 'uuid';
import { IActivityRepository } from '../../../domain/activity/IActivityRepository';
import { Activity, ActivityEventType } from '../../../domain/activity/Activity';

export interface LogActivityCommand {
  taskId: string;
  actorId: string;
  actorName: string;
  eventType: ActivityEventType;
  eventText: string;
  metadata?: Record<string, any>;
}

export class LogActivityHandler {
  constructor(private readonly activityRepo: IActivityRepository) {}

  async execute(cmd: LogActivityCommand): Promise<void> {
    const activity = Activity.create({
      id: uuidv4(),
      taskId: cmd.taskId,
      actorId: cmd.actorId,
      actorName: cmd.actorName,
      eventType: cmd.eventType,
      eventText: cmd.eventText,
      metadata: cmd.metadata ?? null,
    });
    await this.activityRepo.save(activity);
  }
}
