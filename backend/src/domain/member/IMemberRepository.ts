import { Member, MemberRole, MemberRegion } from './Member';

export interface MemberFilter {
  role?: MemberRole[];
  region?: MemberRegion;
  isActive?: boolean;
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}

export interface MemberPage {
  items: Member[];
  hasMore: boolean;
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface IMemberRepository {
  findById(id: string): Promise<Member | null>;
  findByEmail(email: string): Promise<Member | null>;
  findAll(filter: MemberFilter): Promise<MemberPage>;
  save(member: Member): Promise<void>;
  update(member: Member): Promise<void>;
}
