import { IRequestRepository } from '../../../domain/request/IRequestRepository';
import { OpsRequest } from '../../../domain/request/Request';
import { NotFoundError } from '../../../shared/errors';

export class GetRequestByIdHandler {
  constructor(private readonly requestRepo: IRequestRepository) {}

  async execute(query: { requestId: string }): Promise<OpsRequest> {
    const request = await this.requestRepo.findById(query.requestId);
    if (!request) throw new NotFoundError('Request', query.requestId);
    return request;
  }
}
