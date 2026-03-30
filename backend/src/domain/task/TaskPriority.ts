import { ValidationError } from '../../shared/errors';

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TaskPriorityValue = typeof TASK_PRIORITIES[number];

export class TaskPriority {
  private static readonly SLA_MINUTES: Record<TaskPriorityValue, number> = {
    low: 2880,      // 48h
    medium: 1440,   // 24h
    high: 240,      // 4h
    critical: 60,   // 1h
  };

  private constructor(private readonly value: TaskPriorityValue) {}

  static of(value: string): TaskPriority {
    if (!TASK_PRIORITIES.includes(value as TaskPriorityValue)) {
      throw new ValidationError(`Invalid task priority: ${value}`);
    }
    return new TaskPriority(value as TaskPriorityValue);
  }

  get slaMinutes(): number {
    return TaskPriority.SLA_MINUTES[this.value];
  }

  toString(): TaskPriorityValue { return this.value; }
  equals(other: TaskPriority): boolean { return this.value === other.value; }
}
