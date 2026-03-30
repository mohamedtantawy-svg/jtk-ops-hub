import { Escalation, EscalationStatus, EscalationSeverity, EscalationSource } from './Escalation';

export interface EscalationFilter {
  status?: EscalationStatus[];
  severity?: EscalationSeverity[];
  source?: EscalationSource[];
  managerId?: string;
  taskId?: string;
  /** cursor-based: include rows with (created_at, id) < cursor */
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}

export interface EscalationPage {
  items: Escalation[];
  nextCursor: { createdAt: Date; id: string } | null;
  hasMore: boolean;
}

export interface IEscalationRepository {
  findById(id: string): Promise<Escalation | null>;
  findAll(filter: EscalationFilter): Promise<EscalationPage>;
  save(escalation: Escalation): Promise<void>;
  update(escalation: Escalation): Promise<void>;
  delete(id: string): Promise<void>;
}
