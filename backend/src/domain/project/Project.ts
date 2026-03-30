import { Entity } from '../shared/Entity';
import { DomainEvent } from '../shared/DomainEvent';
import { ProjectCreated } from './events/ProjectCreated';

export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'cancelled';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectProps {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  ownerId: string;
  teamId: string | null;
  deadline: Date | null;
  progress: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class Project extends Entity<string> {
  private props: ProjectProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(props: ProjectProps) {
    super(props.id);
    this.props = props;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static create(
    params: Omit<ProjectProps, 'createdAt' | 'updatedAt' | 'status' | 'progress'>,
  ): Project {
    const now = new Date();
    const project = new Project({
      ...params,
      status: 'active',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });
    project._domainEvents.push(new ProjectCreated(project.props.id));
    return project;
  }

  static reconstitute(props: ProjectProps): Project {
    return new Project(props);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get title(): string { return this.props.title; }
  get description(): string | null { return this.props.description; }
  get status(): ProjectStatus { return this.props.status; }
  get priority(): ProjectPriority { return this.props.priority; }
  get ownerId(): string { return this.props.ownerId; }
  get teamId(): string | null { return this.props.teamId; }
  get deadline(): Date | null { return this.props.deadline; }
  get progress(): number { return this.props.progress; }
  get tags(): string[] { return this.props.tags; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // ── Commands ───────────────────────────────────────────────────────────────

  updateProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(100, progress));
    this.props = { ...this.props, progress: clamped, updatedAt: new Date() };
  }

  update(fields: Partial<Pick<ProjectProps, 'title' | 'description' | 'priority' | 'deadline' | 'tags' | 'teamId'>>): void {
    this.props = { ...this.props, ...fields, updatedAt: new Date() };
  }

  complete(): void {
    this.props = { ...this.props, status: 'completed', progress: 100, updatedAt: new Date() };
  }

  putOnHold(): void {
    this.props = { ...this.props, status: 'on_hold', updatedAt: new Date() };
  }

  cancel(): void {
    this.props = { ...this.props, status: 'cancelled', updatedAt: new Date() };
  }

  // ── Domain Events ──────────────────────────────────────────────────────────

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toSnapshot(): ProjectProps {
    return { ...this.props };
  }
}
