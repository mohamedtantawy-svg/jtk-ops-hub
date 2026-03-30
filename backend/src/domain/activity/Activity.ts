import { Entity } from '../shared/Entity';

export type ActivityEventType = 'created' | 'assigned' | 'status' | 'escalated' | 'snoozed' | 'resolved' | 'note' | 'reassigned' | 'updated';

export interface ActivityProps {
  id: string;
  taskId: string;
  actorId: string;
  actorName: string;
  eventType: ActivityEventType;
  eventText: string;
  metadata: Record<string, any> | null;
  occurredAt: Date;
}

export class Activity extends Entity<string> {
  private props: ActivityProps;

  private constructor(props: ActivityProps) {
    super(props.id);
    this.props = props;
  }

  static create(params: Omit<ActivityProps, 'occurredAt'>): Activity {
    return new Activity({ ...params, occurredAt: new Date() });
  }

  static reconstitute(props: ActivityProps): Activity {
    return new Activity(props);
  }

  get taskId(): string { return this.props.taskId; }
  get actorId(): string { return this.props.actorId; }
  get actorName(): string { return this.props.actorName; }
  get eventType(): ActivityEventType { return this.props.eventType; }
  get eventText(): string { return this.props.eventText; }
  get metadata(): Record<string, any> | null { return this.props.metadata; }
  get occurredAt(): Date { return this.props.occurredAt; }

  toSnapshot(): ActivityProps {
    return { ...this.props };
  }
}
