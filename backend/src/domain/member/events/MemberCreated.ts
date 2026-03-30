import { BaseDomainEvent } from '../../shared/DomainEvent';

export class MemberCreated extends BaseDomainEvent {
  constructor(memberId: string) {
    super('member.created', memberId);
  }
}
