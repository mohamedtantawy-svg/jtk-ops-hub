import { BaseDomainEvent } from '../../shared/DomainEvent';

export class TaskEscalated extends BaseDomainEvent {
  constructor(
    taskId: string,
    public readonly managerId: string,
    public readonly actorId: string,
  ) {
    super('task.escalated', taskId);
  }
}
