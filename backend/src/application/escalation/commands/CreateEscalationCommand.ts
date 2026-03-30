export interface CreateEscalationCommand {
  taskId: string | null;
  subject: string;
  reason: string;
  escalatedBy: string;
  managerId: string | null;
  managerName: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  escalationSource: 'ticket' | 'slack' | 'manual';
  slackChannel?: string | null;
  slackUser?: string | null;
  slackMessageUrl?: string | null;
  slaMinutes?: number;
}
