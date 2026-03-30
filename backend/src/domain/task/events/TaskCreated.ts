import { BaseDomainEvent } from '../../shared/DomainEvent';

export class TaskCreated extends BaseDomainEvent {
  constructor(
    taskId: string,
    public readonly source: string,
    public readonly assigneeId: string | null,
  ) {
    super('task.created', taskId);
  }
}
