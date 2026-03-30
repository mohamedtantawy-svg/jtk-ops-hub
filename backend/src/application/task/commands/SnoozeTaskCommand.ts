export interface SnoozeTaskCommand {
  taskId: string;
  until: Date;
  actorId: string;
}
