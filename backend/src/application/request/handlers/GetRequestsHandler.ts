import { IRequestRepository, RequestFilter, RequestPage } from '../../../domain/request/IRequestRepository';

export class GetRequestsHandler {
  constructor(private readonly requestRepo: IRequestRepository) {}

  async execute(filter: RequestFilter): Promise<RequestPage> {
    return this.requestRepo.findAll(filter);
  }
}
