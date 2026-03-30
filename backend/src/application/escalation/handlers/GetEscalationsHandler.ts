import { IEscalationRepository, EscalationPage } from '../../../domain/escalation/IEscalationRepository';
import { GetEscalationsQuery } from '../queries/GetEscalationsQuery';

export class GetEscalationsHandler {
  constructor(private readonly escalationRepo: IEscalationRepository) {}

  async execute(query: GetEscalationsQuery): Promise<EscalationPage> {
    return this.escalationRepo.findAll({
      status: query.status as any,
      severity: query.severity as any,
      source: query.source as any,
      managerId: query.managerId,
      taskId: query.taskId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
