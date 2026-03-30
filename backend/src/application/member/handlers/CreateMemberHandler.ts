import { v4 as uuidv4 } from 'uuid';
import { IMemberRepository } from '../../../domain/member/IMemberRepository';
import { Member } from '../../../domain/member/Member';
import { CreateMemberCommand } from '../commands/CreateMemberCommand';
import { ConflictError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export class CreateMemberHandler {
  constructor(private readonly memberRepo: IMemberRepository) {}

  async execute(cmd: CreateMemberCommand): Promise<string> {
    const existing = await this.memberRepo.findByEmail(cmd.email);
    if (existing) throw new ConflictError(`Member with email ${cmd.email} already exists`);

    const member = Member.create({ id: uuidv4(), ...cmd });
    await this.memberRepo.save(member);
    logger.info('Member created', { memberId: member.id, email: cmd.email });
    return member.id;
  }
}
