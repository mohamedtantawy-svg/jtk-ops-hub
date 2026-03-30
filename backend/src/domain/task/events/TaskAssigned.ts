import { BaseDomainEvent } from '../../shared/DomainEvent';

export class TaskAssigned extends BaseDomainEvent {
  constructor(
    taskId: string,
    public readonly assigneeId: string,
    public readonly previousAssigneeId: string | null,
  ) {
    super('task.assigned', taskId);
  }
}
