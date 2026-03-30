import { ValidationError } from '../../shared/errors';

export const TASK_STATUSES = ['open', 'in_progress', 'pending', 'snoozed', 'escalated', 'resolved', 'closed'] as const;
export type TaskStatusValue = typeof TASK_STATUSES[number];

export class TaskStatus {
  private constructor(private readonly value: TaskStatusValue) {}

  static of(value: string): TaskStatus {
    if (!TASK_STATUSES.includes(value as TaskStatusValue)) {
      throw new ValidationError(`Invalid task status: ${value}`);
    }
    return new TaskStatus(value as TaskStatusValue);
  }

  static open = () => new TaskStatus('open');
  static inProgress = () => new TaskStatus('in_progress');
  static escalated = () => new TaskStatus('escalated');
  static resolved = () => new TaskStatus('resolved');

  toString(): TaskStatusValue { return this.value; }

  equals(other: TaskStatus): boolean { return this.value === other.value; }

  canTransitionTo(next: TaskStatus): boolean {
    const transitions: Record<TaskStatusValue, TaskStatusValue[]> = {
      open:        ['in_progress', 'snoozed', 'escalated', 'closed'],
      in_progress: ['pending', 'snoozed', 'escalated', 'resolved', 'closed'],
      pending:     ['in_progress', 'snoozed', 'escalated', 'closed'],
      snoozed:     ['open', 'in_progress', 'escalated'],
      escalated:   ['in_progress', 'resolved', 'closed'],
      resolved:    ['closed'],
      closed:      [],
    };
    return transitions[this.value].includes(next.value);
  }
}
