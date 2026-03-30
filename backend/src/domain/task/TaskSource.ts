import { ValidationError } from '../../shared/errors';

export const TASK_SOURCES = ['zendesk', 'jira', 'slack', 'gmail', 'deel', 'manual', 'looker', 'calendar', 'workbench', 'bamboohr', 'greenhouse', 'notion', 'custom', 'onboarding', 'offboarding', 'change_request'] as const;
export type TaskSourceValue = typeof TASK_SOURCES[number];

export class TaskSource {
  private constructor(private readonly value: TaskSourceValue) {}

  static of(value: string): TaskSource {
    if (!TASK_SOURCES.includes(value as TaskSourceValue)) {
      throw new ValidationError(`Invalid task source: ${value}`);
    }
    return new TaskSource(value as TaskSourceValue);
  }

  toString(): TaskSourceValue { return this.value; }
  equals(other: TaskSource): boolean { return this.value === other.value; }
}
