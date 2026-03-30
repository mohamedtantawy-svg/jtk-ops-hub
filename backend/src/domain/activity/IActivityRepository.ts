import { Activity } from './Activity';

export interface IActivityRepository {
  findByTaskId(taskId: string): Promise<Activity[]>;
  save(activity: Activity): Promise<void>;
}
