import { IRequestRepository } from '../../../domain/request/IRequestRepository';
import { OpsRequest, RequestStatus } from '../../../domain/request/Request';
import { NotFoundError } from '../../../shared/errors';

export interface UpdateRequestCommand {
  requestId: string;
  status?: RequestStatus;
  subject?: string;
  description?: string;
  priority?: string;
  toTeam?: string;
  externalRef?: string;
  dueDate?: Date;
}

export class UpdateRequestHandler {
  constructor(private readonly requestRepo: IRequestRepository) {}

  async execute(cmd: UpdateRequestCommand): Promise<OpsRequest> {
    const request = await this.requestRepo.findById(cmd.requestId);
    if (!request) throw new NotFoundError('Request', cmd.requestId);

    if (cmd.status) {
      request.updateStatus(cmd.status as RequestStatus);
    }
    const { status, requestId, ...updateFields } = cmd;
    if (Object.keys(updateFields).length > 0) {
      request.update(updateFields as any);
    }

    await this.requestRepo.update(request);
    return request;
  }
}
