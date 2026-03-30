import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { SnoozeTaskCommand } from '../commands/SnoozeTaskCommand';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class SnoozeTaskHandler {
  constructor(private readonly taskRepo: ITaskRepository) {}

  async execute(cmd: SnoozeTaskCommand): Promise<void> {
    const task = await this.taskRepo.findById(cmd.taskId);
    if (!task) throw new NotFoundError('Task', cmd.taskId);

    task.snooze(cmd.until);
    await this.taskRepo.update(task);

    logger.info('Task snoozed', { taskId: cmd.taskId, until: cmd.until, actor: cmd.actorId });
  }
}
