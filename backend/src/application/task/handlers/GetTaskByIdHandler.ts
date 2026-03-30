import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { Task } from '../../../domain/task/Task';
import { GetTaskByIdQuery } from '../queries/GetTaskByIdQuery';
import { NotFoundError } from '../../../shared/errors';

export class GetTaskByIdHandler {
  constructor(private readonly taskRepo: ITaskRepository) {}

  async execute(query: GetTaskByIdQuery): Promise<Task> {
    const task = await this.taskRepo.findById(query.taskId);
    if (!task) throw new NotFoundError('Task', query.taskId);
    return task;
  }
}
