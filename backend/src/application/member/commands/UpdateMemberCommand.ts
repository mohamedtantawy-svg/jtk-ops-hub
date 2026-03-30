import { MemberRole, MemberRegion } from '../../../domain/member/Member';

export interface UpdateMemberCommand {
  id: string;
  name?: string;
  role?: MemberRole;
  team?: string | null;
  region?: MemberRegion | null;
  leadId?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
}
