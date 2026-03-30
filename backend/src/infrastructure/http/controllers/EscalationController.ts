import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetEscalationsHandler } from '../../../application/escalation/handlers/GetEscalationsHandler';
import { GetEscalationByIdHandler } from '../../../application/escalation/handlers/GetEscalationByIdHandler';
import { CreateEscalationHandler } from '../../../application/escalation/handlers/CreateEscalationHandler';
import { RespondEscalationHandler } from '../../../application/escalation/handlers/RespondEscalationHandler';
import { ResolveEscalationHandler } from '../../../application/escalation/handlers/ResolveEscalationHandler';
import { DismissEscalationHandler } from '../../../application/escalation/handlers/DismissEscalationHandler';
import { Escalation } from '../../../domain/escalation/Escalation';

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateEscalationSchema = z.object({
  taskId: z.string().min(1),
  subject: z.string().min(1),
  reason: z.string().min(1),
});

const RespondEscalationSchema = z.object({
  response: z.string().min(1),
});

const ResolveEscalationSchema = z.object({
  resolution: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────

function serializeEscalation(e: Escalation) {
  const s = e.toSnapshot();
  return {
    ...s,
    isSlaBreached: e.isSlaBreached,
    slaMinutesRemaining: e.slaMinutesRemaining,
  };
}

export class EscalationController {
  constructor(
    private readonly getEscalations: GetEscalationsHandler,
    private readonly getEscalationById: GetEscalationByIdHandler,
    private readonly createEscalation: CreateEscalationHandler,
    private readonly respondEscalation: RespondEscalationHandler,
    private readonly resolveEscalation: ResolveEscalationHandler,
    private readonly dismissEscalation: DismissEscalationHandler,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, severity, source, managerId, taskId, limit, cursor_ts, cursor_id } = req.query;
      const result = await this.getEscalations.execute({
        status: status ? (status as string).split(',') : undefined,
        severity: severity ? (severity as string).split(',') : undefined,
        source: source ? (source as string).split(',') : undefined,
        managerId: managerId ? (managerId as string) : undefined,
        taskId: taskId as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        cursor: cursor_ts && cursor_id
          ? { createdAt: new Date(cursor_ts as string), id: cursor_id as string }
          : undefined,
      });
      res.json({
        items: result.items.map(serializeEscalation),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const escalation = await this.getEscalationById.execute({ id: req.params.id });
      res.json(serializeEscalation(escalation));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateEscalationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const id = await this.createEscalation.execute({
        ...req.body,
        escalatedBy: req.actor?.sub ?? req.body.escalatedBy,
      });
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  };

  respond = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = RespondEscalationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const escalation = await this.respondEscalation.execute({
        escalationId: req.params.id,
        respondedBy: req.actor?.sub ?? req.body.respondedBy,
        response: parsed.data.response,
      });
      res.json(serializeEscalation(escalation));
    } catch (err) {
      next(err);
    }
  };

  resolve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ResolveEscalationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      await this.resolveEscalation.execute({
        escalationId: req.params.id,
        actorId: req.actor!.sub,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  dismiss = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.dismissEscalation.execute({
        escalationId: req.params.id,
        actorId: req.actor!.sub,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };
}
