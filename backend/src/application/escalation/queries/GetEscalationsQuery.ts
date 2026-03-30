export interface GetEscalationsQuery {
  status?: string[];
  severity?: string[];
  source?: string[];
  managerId?: string;
  taskId?: string;
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}
