export interface EscalateTaskCommand {
  taskId: string;
  managerId: string;
  actorId: string;
  reason?: string;
}
