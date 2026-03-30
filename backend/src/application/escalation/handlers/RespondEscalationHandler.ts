import { IEscalationRepository } from '../../../domain/escalation/IEscalationRepository';
import { Escalation } from '../../../domain/escalation/Escalation';
import { RespondEscalationCommand } from '../commands/RespondEscalationCommand';
import { NotFoundError, ConflictError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class RespondEscalationHandler {
  constructor(private readonly escalationRepo: IEscalationRepository) {}

  async execute(cmd: RespondEscalationCommand): Promise<Escalation> {
    const escalation = await this.escalationRepo.findById(cmd.escalationId);
    if (!escalation) throw new NotFoundError('Escalation', cmd.escalationId);

    try {
      escalation.respond(cmd.respondedBy, cmd.response);
    } catch (err) {
      throw new ConflictError((err as Error).message);
    }
    await this.escalationRepo.update(escalation);
    logger.info('Escalation responded', { escalationId: cmd.escalationId, respondedBy: cmd.respondedBy });
    return escalation;
  }
}
