import { MemberRole, MemberRegion } from '../../../domain/member/Member';

export interface CreateMemberCommand {
  name: string;
  email: string;
  role: MemberRole;
  team: string | null;
  region: MemberRegion | null;
  leadId: string | null;
  avatarUrl: string | null;
}
