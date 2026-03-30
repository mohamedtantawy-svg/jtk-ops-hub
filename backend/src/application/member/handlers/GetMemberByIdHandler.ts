import { IMemberRepository } from '../../../domain/member/IMemberRepository';
import { Member } from '../../../domain/member/Member';
import { GetMemberByIdQuery } from '../queries/GetMemberByIdQuery';
import { NotFoundError } from '../../../shared/errors';

export class GetMemberByIdHandler {
  constructor(private readonly memberRepo: IMemberRepository) {}

  async execute(query: GetMemberByIdQuery): Promise<Member> {
    const member = await this.memberRepo.findById(query.id);
    if (!member) throw new NotFoundError('Member', query.id);
    return member;
  }
}
