import { IEscalationRepository } from '../../../domain/escalation/IEscalationRepository';
import { Escalation } from '../../../domain/escalation/Escalation';
import { GetEscalationByIdQuery } from '../queries/GetEscalationByIdQuery';
import { NotFoundError } from '../../../shared/errors';

export class GetEscalationByIdHandler {
  constructor(private readonly escalationRepo: IEscalationRepository) {}

  async execute(query: GetEscalationByIdQuery): Promise<Escalation> {
    const escalation = await this.escalationRepo.findById(query.id);
    if (!escalation) throw new NotFoundError('Escalation', query.id);
    return escalation;
  }
}
