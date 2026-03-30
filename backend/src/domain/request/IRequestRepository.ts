import { OpsRequest, RequestStatus, RequestToTeam } from './Request';

export interface RequestFilter {
  fromMemberId?: string;
  toTeam?: RequestToTeam;
  status?: RequestStatus[];
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}

export interface RequestPage {
  items: OpsRequest[];
  hasMore: boolean;
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface IRequestRepository {
  findById(id: string): Promise<OpsRequest | null>;
  findAll(filter: RequestFilter): Promise<RequestPage>;
  save(request: OpsRequest): Promise<void>;
  update(request: OpsRequest): Promise<void>;
  delete(id: string): Promise<void>;
}
