import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { ISlackPort } from '../../ports/ISlackPort';
import { EscalateTaskCommand } from '../commands/EscalateTaskCommand';
import { NotFoundError } from '../../../shared/errors';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/logger';

export class EscalateTaskHandler {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly slack: ISlackPort,
  ) {}

  async execute(cmd: EscalateTaskCommand): Promise<void> {
    const task = await this.taskRepo.findById(cmd.taskId);
    if (!task) throw new NotFoundError('Task', cmd.taskId);

    task.escalate(cmd.managerId, cmd.actorId);
    await this.taskRepo.update(task);

    // Notify manager via Slack
    const channelIds = config.SLACK_CHANNEL_IDS.split(',').filter(Boolean);
    if (channelIds.length > 0) {
      const reason = cmd.reason ? ` — ${cmd.reason}` : '';
      await this.slack.postMessage(
        channelIds[0],
        `:rotating_light: *Task Escalated* — <@${cmd.managerId}>\n*${task.subject}*${reason}\nTask ID: ${task.id}`,
      ).catch(err => logger.warn('Slack notification failed', { err }));
    }

    logger.info('Task escalated', { taskId: cmd.taskId, managerId: cmd.managerId });
  }
}
