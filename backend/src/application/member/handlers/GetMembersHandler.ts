import { IMemberRepository, MemberPage } from '../../../domain/member/IMemberRepository';
import { GetMembersQuery } from '../queries/GetMembersQuery';

export class GetMembersHandler {
  constructor(private readonly memberRepo: IMemberRepository) {}

  async execute(query: GetMembersQuery): Promise<MemberPage> {
    return this.memberRepo.findAll(query);
  }
}
