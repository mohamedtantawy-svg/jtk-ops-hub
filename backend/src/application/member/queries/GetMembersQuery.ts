import { MemberRole, MemberRegion } from '../../../domain/member/Member';

export interface GetMembersQuery {
  role?: MemberRole[];
  region?: MemberRegion;
  isActive?: boolean;
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}
