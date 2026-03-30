import { v4 as uuidv4 } from 'uuid';
import { IRequestRepository } from '../../../domain/request/IRequestRepository';
import { OpsRequest, RequestToTeam, RequestPriority } from '../../../domain/request/Request';

export interface CreateRequestCommand {
  taskId?: string;
  subject: string;
  description?: string;
  fromMemberId: string;
  toTeam: RequestToTeam;
  priority?: RequestPriority;
  externalRef?: string;
  linkedTaskId?: string;
  dueDate?: Date;
}

export class CreateRequestHandler {
  constructor(private readonly requestRepo: IRequestRepository) {}

  async execute(cmd: CreateRequestCommand): Promise<OpsRequest> {
    const request = OpsRequest.create({
      id: uuidv4(),
      taskId: cmd.taskId ?? null,
      subject: cmd.subject,
      description: cmd.description ?? null,
      fromMemberId: cmd.fromMemberId,
      toTeam: cmd.toTeam,
      priority: cmd.priority ?? 'medium',
      externalRef: cmd.externalRef ?? null,
      linkedTaskId: cmd.linkedTaskId ?? null,
      dueDate: cmd.dueDate ?? null,
    });
    await this.requestRepo.save(request);
    return request;
  }
}
