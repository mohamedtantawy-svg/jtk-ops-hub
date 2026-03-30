import { v4 as uuidv4 } from 'uuid';
import { IEscalationRepository } from '../../../domain/escalation/IEscalationRepository';
import { Escalation } from '../../../domain/escalation/Escalation';
import { CreateEscalationCommand } from '../commands/CreateEscalationCommand';
import { logger } from '../../../shared/logger';

export class CreateEscalationHandler {
  constructor(private readonly escalationRepo: IEscalationRepository) {}

  async execute(cmd: CreateEscalationCommand): Promise<string> {
    const now = new Date();
    const slaMinutes = cmd.slaMinutes ?? 120;
    const slaDeadline = new Date(now.getTime() + slaMinutes * 60 * 1000);

    const escalation = Escalation.create({
      id: uuidv4(),
      taskId: cmd.taskId,
      subject: cmd.subject,
      reason: cmd.reason,
      escalatedBy: cmd.escalatedBy,
      escalatedAt: now,
      managerId: cmd.managerId,
      managerName: cmd.managerName,
      severity: cmd.severity,
      escalationSource: cmd.escalationSource,
      slackChannel: cmd.slackChannel ?? null,
      slackUser: cmd.slackUser ?? null,
      slackMessageUrl: cmd.slackMessageUrl ?? null,
      slaDeadline,
    });

    await this.escalationRepo.save(escalation);
    logger.info('Escalation created', { escalationId: escalation.id, severity: cmd.severity });
    return escalation.id;
  }
}
