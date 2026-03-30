import { ITaskRepository, TaskPage } from '../../../domain/task/ITaskRepository';
import { GetTasksQuery } from '../queries/GetTasksQuery';

export class GetTasksHandler {
  constructor(private readonly taskRepo: ITaskRepository) {}

  async execute(query: GetTasksQuery): Promise<TaskPage> {
    return this.taskRepo.findAll(query);
  }
}
