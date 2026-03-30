export interface DomainEvent {
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly aggregateId: string;
}

export abstract class BaseDomainEvent implements DomainEvent {
  readonly occurredAt: Date;

  constructor(
    public readonly eventType: string,
    public readonly aggregateId: string,
  ) {
    this.occurredAt = new Date();
  }
}
