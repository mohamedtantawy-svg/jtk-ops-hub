import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { TaskStatus } from '../../../domain/task/TaskStatus';
import { UpdateTaskStatusCommand } from '../commands/UpdateTaskStatusCommand';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../domain/shared/EventBus';

export class UpdateTaskStatusHandler {
  constructor(private readonly taskRepo: ITaskRepository) {}

  async execute(cmd: UpdateTaskStatusCommand): Promise<void> {
    const task = await this.taskRepo.findById(cmd.taskId);
    if (!task) throw new NotFoundError('Task', cmd.taskId);

    task.changeStatus(TaskStatus.of(cmd.status), cmd.actorId);
    await this.taskRepo.update(task);
    await eventBus.dispatch(task.pullDomainEvents());

    logger.info('Task status updated', { taskId: cmd.taskId, status: cmd.status, actor: cmd.actorId });
  }
}
