import { Entity } from '../shared/Entity';
import { DomainEvent } from '../shared/DomainEvent';
import { TaskStatus } from './TaskStatus';
import { TaskSource } from './TaskSource';
import { TaskPriority } from './TaskPriority';
import { TaskCreated } from './events/TaskCreated';
import { TaskAssigned } from './events/TaskAssigned';
import { TaskStatusChanged } from './events/TaskStatusChanged';
import { TaskEscalated } from './events/TaskEscalated';
import { ValidationError } from '../../shared/errors';

export interface TaskProps {
  id: string;
  externalId: string;          // ID in source system (Zendesk ticket ID, Jira issue key, etc.)
  source: TaskSource;
  subject: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  reporterId: string | null;
  countryCode: string | null;
  tags: string[];
  externalUrl: string | null;
  snoozedUntil: Date | null;
  escalatedTo: string | null;   // userId of manager
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  sourceCreatedAt: Date;        // when created in source system
}

export class Task extends Entity<string> {
  private props: TaskProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(props: TaskProps) {
    super(props.id);
    this.props = props;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  static create(props: Omit<TaskProps, 'createdAt' | 'updatedAt'>): Task {
    const now = new Date();
    const task = new Task({ ...props, createdAt: now, updatedAt: now });
    task._domainEvents.push(new TaskCreated(props.id, props.source.toString(), props.assigneeId));
    return task;
  }

  static reconstitute(props: TaskProps): Task {
    return new Task(props);
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get externalId() { return this.props.externalId; }
  get source() { return this.props.source; }
  get subject() { return this.props.subject; }
  get description() { return this.props.description; }
  get status() { return this.props.status; }
  get priority() { return this.props.priority; }
  get assigneeId() { return this.props.assigneeId; }
  get reporterId() { return this.props.reporterId; }
  get countryCode() { return this.props.countryCode; }
  get tags() { return this.props.tags; }
  get externalUrl() { return this.props.externalUrl; }
  get snoozedUntil() { return this.props.snoozedUntil; }
  get escalatedTo() { return this.props.escalatedTo; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }
  get resolvedAt() { return this.props.resolvedAt; }
  get sourceCreatedAt() { return this.props.sourceCreatedAt; }

  get slaDeadline(): Date {
    const ms = this.props.priority.slaMinutes * 60 * 1000;
    return new Date(this.props.sourceCreatedAt.getTime() + ms);
  }

  get slaStatus(): 'ok' | 'at_risk' | 'breached' {
    const now = Date.now();
    const deadline = this.slaDeadline.getTime();
    const remaining = deadline - now;
    if (remaining < 0) return 'breached';
    if (remaining < 30 * 60 * 1000) return 'at_risk'; // <30min
    return 'ok';
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────

  assign(assigneeId: string): void {
    const previous = this.props.assigneeId;
    this.props = { ...this.props, assigneeId, updatedAt: new Date() };
    this._domainEvents.push(new TaskAssigned(this._id, assigneeId, previous));
  }

  changeStatus(next: TaskStatus, actorId: string): void {
    if (!this.props.status.canTransitionTo(next)) {
      throw new ValidationError(
        `Cannot transition from ${this.props.status} to ${next}`,
      );
    }
    const previous = this.props.status;
    this.props = {
      ...this.props,
      status: next,
      resolvedAt: next.toString() === 'resolved' ? new Date() : this.props.resolvedAt,
      updatedAt: new Date(),
    };
    this._domainEvents.push(new TaskStatusChanged(this._id, previous.toString(), next.toString(), actorId));
  }

  escalate(managerId: string, actorId: string): void {
    this.props = {
      ...this.props,
      escalatedTo: managerId,
      status: TaskStatus.escalated(),
      updatedAt: new Date(),
    };
    this._domainEvents.push(new TaskEscalated(this._id, managerId, actorId));
  }

  snooze(until: Date): void {
    if (until <= new Date()) {
      throw new ValidationError('Snooze time must be in the future');
    }
    this.props = {
      ...this.props,
      snoozedUntil: until,
      status: TaskStatus.of('snoozed'),
      updatedAt: new Date(),
    };
  }

  wakeFromSnooze(): void {
    this.props = {
      ...this.props,
      snoozedUntil: null,
      status: TaskStatus.open(),
      updatedAt: new Date(),
    };
  }

  // ── Domain events ─────────────────────────────────────────────────────────

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  toSnapshot(): TaskProps {
    return { ...this.props };
  }
}
