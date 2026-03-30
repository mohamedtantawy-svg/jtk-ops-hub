import { Task } from './Task';
import { TaskStatusValue } from './TaskStatus';
import { TaskSourceValue } from './TaskSource';

export interface TaskCursor {
  createdAt: Date;
  id: string;
}

export interface TaskFilter {
  assigneeId?: string;
  status?: TaskStatusValue[];
  source?: TaskSourceValue[];
  countryCode?: string;
  slaStatus?: 'ok' | 'at_risk' | 'breached';
  search?: string;
  /** Cursor-based pagination — omit for first page */
  cursor?: TaskCursor;
  limit?: number;
  /** @deprecated use cursor instead */
  page?: number;
}

export interface TaskPage {
  items: Task[];
  hasMore: boolean;
  nextCursor: TaskCursor | null;
  /** @deprecated use hasMore + nextCursor */
  total: number;
  page: number;
  limit: number;
}

export interface ITaskRepository {
  findById(id: string): Promise<Task | null>;
  findByExternalId(externalId: string, source: TaskSourceValue): Promise<Task | null>;
  findAll(filter: TaskFilter): Promise<TaskPage>;
  save(task: Task): Promise<void>;
  update(task: Task): Promise<void>;
  delete(id: string): Promise<void>;
}
