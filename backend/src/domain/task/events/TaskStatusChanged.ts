import { BaseDomainEvent } from '../../shared/DomainEvent';

export class TaskStatusChanged extends BaseDomainEvent {
  constructor(
    taskId: string,
    public readonly from: string,
    public readonly to: string,
    public readonly actorId: string,
  ) {
    super('task.status_changed', taskId);
  }
}
