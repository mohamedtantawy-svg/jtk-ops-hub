import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetTasksHandler } from '../../../application/task/handlers/GetTasksHandler';
import { GetTaskByIdHandler } from '../../../application/task/handlers/GetTaskByIdHandler';
import { CreateTaskHandler } from '../../../application/task/handlers/CreateTaskHandler';
import { UpdateTaskStatusHandler } from '../../../application/task/handlers/UpdateTaskStatusHandler';
import { AssignTaskHandler } from '../../../application/task/handlers/AssignTaskHandler';
import { EscalateTaskHandler } from '../../../application/task/handlers/EscalateTaskHandler';
import { SnoozeTaskHandler } from '../../../application/task/handlers/SnoozeTaskHandler';
import { ITaskRepository } from '../../../domain/task/ITaskRepository';
import { Task } from '../../../domain/task/Task';

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateTaskSchema = z.object({
  externalId: z.string().min(1),
  source: z.enum(['zendesk', 'jira', 'slack', 'workbench', 'zapier', 'manual']),
  subject: z.string().min(1),
  description: z.string().default(''),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  assigneeId: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

const UpdateTaskStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved']),
});

const AssignTaskSchema = z.object({
  assigneeId: z.string().min(1),
});

const SnoozeTaskSchema = z.object({
  until: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────

function serializeTask(task: Task) {
  const s = task.toSnapshot();
  return {
    id: s.id,
    externalId: s.externalId,
    source: s.source.toString(),
    subject: s.subject,
    description: s.description,
    status: s.status.toString(),
    priority: s.priority.toString(),
    assigneeId: s.assigneeId,
    reporterId: s.reporterId,
    countryCode: s.countryCode,
    tags: s.tags,
    externalUrl: s.externalUrl,
    snoozedUntil: s.snoozedUntil,
    escalatedTo: s.escalatedTo,
    resolvedAt: s.resolvedAt,
    sourceCreatedAt: s.sourceCreatedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    slaDeadline: task.slaDeadline,
    slaStatus: task.slaStatus,
  };
}

export class TaskController {
  constructor(
    private readonly getTasks: GetTasksHandler,
    private readonly getTaskById: GetTaskByIdHandler,
    private readonly createTaskHandler: CreateTaskHandler,
    private readonly updateStatus: UpdateTaskStatusHandler,
    private readonly assign: AssignTaskHandler,
    private readonly escalate: EscalateTaskHandler,
    private readonly snooze: SnoozeTaskHandler,
    private readonly taskRepo: ITaskRepository,
  ) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const taskId = await this.createTaskHandler.execute({
        externalId: parsed.data.externalId,
        source: parsed.data.source,
        subject: parsed.data.subject,
        description: parsed.data.description,
        priority: parsed.data.priority,
        assigneeId: parsed.data.assigneeId ?? null,
        reporterId: null,
        countryCode: parsed.data.countryCode ?? null,
        tags: parsed.data.tags,
        externalUrl: null,
        sourceCreatedAt: new Date(),
      });
      res.status(201).json({ id: taskId });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, source, country, sla, search, page, limit, assignee } = req.query;
      const result = await this.getTasks.execute({
        assigneeId: assignee as string,
        status: status ? (status as string).split(',') as any : undefined,
        source: source ? (source as string).split(',') as any : undefined,
        countryCode: country as string,
        slaStatus: sla as any,
        search: search as string,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });

      res.setHeader('X-Total-Count', result.total);
      res.json({
        items: result.items.map(serializeTask),
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const task = await this.getTaskById.execute({ taskId: req.params.id });
      res.json(serializeTask(task));
    } catch (err) {
      next(err);
    }
  };

  updateTaskStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateTaskStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      await this.updateStatus.execute({
        taskId: req.params.id,
        status: parsed.data.status,
        actorId: req.actor!.sub,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  assignTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = AssignTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      await this.assign.execute({
        taskId: req.params.id,
        assigneeId: parsed.data.assigneeId,
        actorId: req.actor!.sub,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  escalateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.escalate.execute({
        taskId: req.params.id,
        managerId: req.body.managerId,
        actorId: req.actor!.sub,
        reason: req.body.reason,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  snoozeTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = SnoozeTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      await this.snooze.execute({
        taskId: req.params.id,
        until: new Date(parsed.data.until),
        actorId: req.actor!.sub,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.taskRepo.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
