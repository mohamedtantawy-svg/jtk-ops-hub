import { Entity } from '../shared/Entity';

export type RequestToTeam = 'legal' | 'finance' | 'it' | 'payroll' | 'hr' | 'compliance' | 'other';
export type RequestStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'cancelled';
export type RequestPriority = 'low' | 'medium' | 'high' | 'critical';

export interface RequestProps {
  id: string;
  taskId: string | null;
  subject: string;
  description: string | null;
  fromMemberId: string;
  toTeam: RequestToTeam;
  priority: RequestPriority;
  status: RequestStatus;
  externalRef: string | null;
  linkedTaskId: string | null;
  dueDate: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OpsRequest extends Entity<string> {
  private props: RequestProps;

  private constructor(props: RequestProps) {
    super(props.id);
    this.props = props;
  }

  static create(params: Omit<RequestProps, 'createdAt' | 'updatedAt' | 'status' | 'resolvedAt'>): OpsRequest {
    const now = new Date();
    return new OpsRequest({ ...params, status: 'open', resolvedAt: null, createdAt: now, updatedAt: now });
  }

  static reconstitute(props: RequestProps): OpsRequest {
    return new OpsRequest(props);
  }

  get taskId(): string | null { return this.props.taskId; }
  get subject(): string { return this.props.subject; }
  get description(): string | null { return this.props.description; }
  get fromMemberId(): string { return this.props.fromMemberId; }
  get toTeam(): RequestToTeam { return this.props.toTeam; }
  get priority(): RequestPriority { return this.props.priority; }
  get status(): RequestStatus { return this.props.status; }
  get externalRef(): string | null { return this.props.externalRef; }
  get linkedTaskId(): string | null { return this.props.linkedTaskId; }
  get dueDate(): Date | null { return this.props.dueDate; }
  get resolvedAt(): Date | null { return this.props.resolvedAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  updateStatus(status: RequestStatus): void {
    this.props = {
      ...this.props,
      status,
      resolvedAt: status === 'resolved' ? new Date() : this.props.resolvedAt,
      updatedAt: new Date(),
    };
  }

  update(fields: Partial<Pick<RequestProps, 'subject' | 'description' | 'priority' | 'toTeam' | 'externalRef' | 'linkedTaskId' | 'dueDate'>>): void {
    this.props = { ...this.props, ...fields, updatedAt: new Date() };
  }

  resolve(): void { this.updateStatus('resolved'); }
  cancel(): void { this.updateStatus('cancelled'); }

  toSnapshot(): RequestProps {
    return { ...this.props };
  }
}
