import { IEscalationRepository } from '../../../domain/escalation/IEscalationRepository';
import { ResolveEscalationCommand } from '../commands/ResolveEscalationCommand';
import { NotFoundError, ConflictError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class ResolveEscalationHandler {
  constructor(private readonly escalationRepo: IEscalationRepository) {}

  async execute(cmd: ResolveEscalationCommand): Promise<void> {
    const escalation = await this.escalationRepo.findById(cmd.escalationId);
    if (!escalation) throw new NotFoundError('Escalation', cmd.escalationId);

    if (escalation.status === 'resolved') {
      throw new ConflictError('Escalation is already resolved');
    }
    try {
      escalation.resolve();
    } catch (err) {
      throw new ConflictError((err as Error).message);
    }
    await this.escalationRepo.update(escalation);
    logger.info('Escalation resolved', { escalationId: cmd.escalationId, actorId: cmd.actorId });
  }
}
