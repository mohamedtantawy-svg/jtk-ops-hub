import { IMemberRepository } from '../../../domain/member/IMemberRepository';
import { Member } from '../../../domain/member/Member';
import { UpdateMemberCommand } from '../commands/UpdateMemberCommand';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class UpdateMemberHandler {
  constructor(private readonly memberRepo: IMemberRepository) {}

  async execute(cmd: UpdateMemberCommand): Promise<Member> {
    const member = await this.memberRepo.findById(cmd.id);
    if (!member) throw new NotFoundError('Member', cmd.id);

    if (cmd.role) member.updateRole(cmd.role);
    if (cmd.isActive === false) member.deactivate();

    const { name, team, region, leadId, avatarUrl } = cmd;
    member.update({ name, team, region, leadId, avatarUrl });

    await this.memberRepo.update(member);
    logger.info('Member updated', { memberId: cmd.id });
    return member;
  }
}
