import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { AssignTaskCommand } from '../commands/AssignTaskCommand';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../domain/shared/EventBus';

export class AssignTaskHandler {
  constructor(private readonly taskRepo: ITaskRepository) {}

  async execute(cmd: AssignTaskCommand): Promise<void> {
    const task = await this.taskRepo.findById(cmd.taskId);
    if (!task) throw new NotFoundError('Task', cmd.taskId);

    task.assign(cmd.assigneeId);
    await this.taskRepo.update(task);
    await eventBus.dispatch(task.pullDomainEvents());

    logger.info('Task assigned', { taskId: cmd.taskId, assigneeId: cmd.assigneeId, actor: cmd.actorId });
  }
}
