import { BaseDomainEvent } from '../../shared/DomainEvent';

export class ProjectCreated extends BaseDomainEvent {
  constructor(projectId: string) {
    super('project.created', projectId);
  }
}
