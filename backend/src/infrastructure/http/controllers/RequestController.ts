import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetRequestsHandler } from '../../../application/request/handlers/GetRequestsHandler';
import { GetRequestByIdHandler } from '../../../application/request/handlers/GetRequestByIdHandler';
import { CreateRequestHandler } from '../../../application/request/handlers/CreateRequestHandler';
import { UpdateRequestHandler } from '../../../application/request/handlers/UpdateRequestHandler';
import { OpsRequest } from '../../../domain/request/Request';
import { IRequestRepository } from '../../../domain/request/IRequestRepository';

const CreateRequestSchema = z.object({
  taskId: z.string().optional(),
  subject: z.string().min(1),
  description: z.string().optional(),
  toTeam: z.enum(['legal', 'finance', 'it', 'payroll', 'hr', 'compliance', 'other']),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  externalRef: z.string().optional(),
  linkedTaskId: z.string().optional(),
  dueDate: z.string().optional(),
});

const UpdateRequestSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'cancelled']).optional(),
  subject: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  toTeam: z.enum(['legal', 'finance', 'it', 'payroll', 'hr', 'compliance', 'other']).optional(),
  externalRef: z.string().optional(),
  dueDate: z.string().optional(),
});

function serializeRequest(r: OpsRequest) {
  const s = r.toSnapshot();
  return {
    id: s.id, taskId: s.taskId, subject: s.subject, description: s.description,
    fromMemberId: s.fromMemberId, toTeam: s.toTeam, priority: s.priority, status: s.status,
    externalRef: s.externalRef, linkedTaskId: s.linkedTaskId, dueDate: s.dueDate,
    resolvedAt: s.resolvedAt, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

export class RequestController {
  constructor(
    private readonly getRequests: GetRequestsHandler,
    private readonly getRequestById: GetRequestByIdHandler,
    private readonly createRequest: CreateRequestHandler,
    private readonly updateRequest: UpdateRequestHandler,
    private readonly requestRepo: IRequestRepository,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { toTeam, status, limit } = req.query;
      const result = await this.getRequests.execute({
        fromMemberId: req.query.fromMember as string,
        toTeam: toTeam as any,
        status: status ? (status as string).split(',') as any : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });
      res.json({ items: result.items.map(serializeRequest), hasMore: result.hasMore });
    } catch (err) { next(err); }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const request = await this.getRequestById.execute({ requestId: req.params.id });
      res.json(serializeRequest(request));
    } catch (err) { next(err); }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateRequestSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const request = await this.createRequest.execute({
        ...parsed.data,
        fromMemberId: req.actor!.sub,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      });
      res.status(201).json(serializeRequest(request));
    } catch (err) { next(err); }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateRequestSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const request = await this.updateRequest.execute({
        requestId: req.params.id,
        ...parsed.data,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      });
      res.json(serializeRequest(request));
    } catch (err) { next(err); }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.requestRepo.delete(req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  };
}
