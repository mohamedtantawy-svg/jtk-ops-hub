import { v4 as uuidv4 } from 'uuid';
import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { Task } from '../../../domain/task/Task';
import { TaskStatus } from '../../../domain/task/TaskStatus';
import { TaskSource } from '../../../domain/task/TaskSource';
import { TaskPriority } from '../../../domain/task/TaskPriority';
import { CreateTaskCommand } from '../commands/CreateTaskCommand';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../domain/shared/EventBus';

export class CreateTaskHandler {
  constructor(private readonly taskRepo: ITaskRepository) {}

  async execute(cmd: CreateTaskCommand): Promise<string> {
    // Idempotency — skip if already imported
    const existing = await this.taskRepo.findByExternalId(cmd.externalId, cmd.source as any);
    if (existing) {
      logger.debug('Task already exists, skipping', { externalId: cmd.externalId, source: cmd.source });
      return existing.id;
    }

    const task = Task.create({
      id: uuidv4(),
      externalId: cmd.externalId,
      source: TaskSource.of(cmd.source),
      subject: cmd.subject,
      description: cmd.description,
      status: TaskStatus.open(),
      priority: TaskPriority.of(cmd.priority),
      assigneeId: cmd.assigneeId,
      reporterId: cmd.reporterId,
      countryCode: cmd.countryCode,
      tags: cmd.tags,
      externalUrl: cmd.externalUrl,
      snoozedUntil: null,
      escalatedTo: null,
      resolvedAt: null,
      sourceCreatedAt: cmd.sourceCreatedAt,
    });

    await this.taskRepo.save(task);
    await eventBus.dispatch(task.pullDomainEvents());
    logger.info('Task created', { taskId: task.id, source: cmd.source, externalId: cmd.externalId });
    return task.id;
  }
}
