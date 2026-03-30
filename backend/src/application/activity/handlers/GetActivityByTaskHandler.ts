import { IActivityRepository } from '../../../domain/activity/IActivityRepository';
import { Activity } from '../../../domain/activity/Activity';

export class GetActivityByTaskHandler {
  constructor(private readonly activityRepo: IActivityRepository) {}

  async execute(query: { taskId: string }): Promise<Activity[]> {
    return this.activityRepo.findByTaskId(query.taskId);
  }
}
