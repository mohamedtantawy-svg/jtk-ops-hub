import { IEscalationRepository } from '../../../domain/escalation/IEscalationRepository';
import { DismissEscalationCommand } from '../commands/DismissEscalationCommand';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class DismissEscalationHandler {
  constructor(private readonly escalationRepo: IEscalationRepository) {}

  async execute(cmd: DismissEscalationCommand): Promise<void> {
    const escalation = await this.escalationRepo.findById(cmd.escalationId);
    if (!escalation) throw new NotFoundError('Escalation', cmd.escalationId);

    escalation.dismiss();
    await this.escalationRepo.update(escalation);
    logger.info('Escalation dismissed', { escalationId: cmd.escalationId, actorId: cmd.actorId });
  }
}
