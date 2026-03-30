import { Entity } from '../shared/Entity';
import { DomainEvent } from '../shared/DomainEvent';
import { MemberCreated } from './events/MemberCreated';

export type MemberRole = 'agent' | 'lead' | 'regional_mgr' | 'admin';
export type MemberRegion = 'EMEA' | 'APAC' | 'AMER';

export interface MemberProps {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  team: string | null;
  region: MemberRegion | null;
  leadId: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Member extends Entity<string> {
  private props: MemberProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(props: MemberProps) {
    super(props.id);
    this.props = props;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static create(
    params: Omit<MemberProps, 'createdAt' | 'updatedAt' | 'isActive'>,
  ): Member {
    const now = new Date();
    const member = new Member({
      ...params,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    member._domainEvents.push(new MemberCreated(member.props.id));
    return member;
  }

  static reconstitute(props: MemberProps): Member {
    return new Member(props);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get name(): string { return this.props.name; }
  get email(): string { return this.props.email; }
  get role(): MemberRole { return this.props.role; }
  get team(): string | null { return this.props.team; }
  get region(): MemberRegion | null { return this.props.region; }
  get leadId(): string | null { return this.props.leadId; }
  get avatarUrl(): string | null { return this.props.avatarUrl; }
  get isActive(): boolean { return this.props.isActive; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // ── Commands ───────────────────────────────────────────────────────────────

  updateRole(role: MemberRole): void {
    this.props = { ...this.props, role, updatedAt: new Date() };
  }

  update(fields: Partial<Pick<MemberProps, 'name' | 'team' | 'region' | 'leadId' | 'avatarUrl'>>): void {
    this.props = { ...this.props, ...fields, updatedAt: new Date() };
  }

  deactivate(): void {
    this.props = { ...this.props, isActive: false, updatedAt: new Date() };
  }

  // ── Domain Events ──────────────────────────────────────────────────────────

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toSnapshot(): MemberProps {
    return { ...this.props };
  }
}
