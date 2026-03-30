import { Entity } from '../shared/Entity';
import { DomainEvent, BaseDomainEvent } from '../shared/DomainEvent';

export type EscalationStatus = 'pending' | 'responded' | 'resolved' | 'dismissed';
export type EscalationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EscalationSource = 'ticket' | 'slack' | 'manual';
export type ManagerResponseStatus = 'pending_response' | 'responded';

export interface EscalationProps {
  id: string;
  taskId: string | null;
  subject: string;
  reason: string;
  escalatedBy: string;
  escalatedAt: Date;
  managerId: string | null;
  managerName: string | null;
  status: EscalationStatus;
  severity: EscalationSeverity;
  escalationSource: EscalationSource;
  slackChannel: string | null;
  slackUser: string | null;
  slackMessageUrl: string | null;
  managerResponse: string | null;
  managerResponseStatus: ManagerResponseStatus;
  managerRespondedAt: Date | null;
  managerRespondedBy: string | null;
  slaDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Domain Events ───────────────────────────────────────────────────────────

export class EscalationCreated extends BaseDomainEvent {
  constructor(escalationId: string) {
    super('escalation.created', escalationId);
  }
}

export class EscalationResponded extends BaseDomainEvent {
  constructor(
    escalationId: string,
    public readonly respondedBy: string,
    public readonly response: string,
  ) {
    super('escalation.responded', escalationId);
  }
}

export class EscalationResolved extends BaseDomainEvent {
  constructor(escalationId: string) {
    super('escalation.resolved', escalationId);
  }
}

// ── Aggregate ───────────────────────────────────────────────────────────────

export class Escalation extends Entity<string> {
  private props: EscalationProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(props: EscalationProps) {
    super(props.id);
    this.props = props;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static create(
    params: Omit<EscalationProps, 'status' | 'managerResponseStatus' | 'managerResponse' |
      'managerRespondedAt' | 'managerRespondedBy' | 'createdAt' | 'updatedAt'>,
  ): Escalation {
    const now = new Date();
    const escalation = new Escalation({
      ...params,
      status: 'pending',
      managerResponseStatus: 'pending_response',
      managerResponse: null,
      managerRespondedAt: null,
      managerRespondedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    escalation._domainEvents.push(new EscalationCreated(escalation.props.id));
    return escalation;
  }

  static reconstitute(props: EscalationProps): Escalation {
    return new Escalation(props);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get taskId(): string | null { return this.props.taskId; }
  get subject(): string { return this.props.subject; }
  get reason(): string { return this.props.reason; }
  get status(): EscalationStatus { return this.props.status; }
  get severity(): EscalationSeverity { return this.props.severity; }
  get escalationSource(): EscalationSource { return this.props.escalationSource; }
  get managerResponseStatus(): ManagerResponseStatus { return this.props.managerResponseStatus; }
  get escalatedAt(): Date { return this.props.escalatedAt; }
  get slaDeadline(): Date | null { return this.props.slaDeadline; }

  get isSlaBreached(): boolean {
    if (!this.props.slaDeadline) return false;
    if (this.props.status === 'resolved' || this.props.status === 'responded') return false;
    return new Date() > this.props.slaDeadline;
  }

  get slaMinutesRemaining(): number | null {
    if (!this.props.slaDeadline) return null;
    return Math.round((this.props.slaDeadline.getTime() - Date.now()) / 60_000);
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  respond(respondedBy: string, response: string): void {
    if (this.props.status === 'resolved') {
      throw new Error('Cannot respond to a resolved escalation');
    }
    this.props = {
      ...this.props,
      managerResponse: response,
      managerResponseStatus: 'responded',
      managerRespondedAt: new Date(),
      managerRespondedBy: respondedBy,
      status: 'responded',
      updatedAt: new Date(),
    };
    this._domainEvents.push(new EscalationResponded(this.props.id, respondedBy, response));
  }

  resolve(): void {
    this.props = { ...this.props, status: 'resolved', updatedAt: new Date() };
    this._domainEvents.push(new EscalationResolved(this.props.id));
  }

  dismiss(): void {
    this.props = { ...this.props, status: 'dismissed', updatedAt: new Date() };
  }

  // ── Domain Events ──────────────────────────────────────────────────────────

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toSnapshot(): EscalationProps {
    return { ...this.props };
  }
}
