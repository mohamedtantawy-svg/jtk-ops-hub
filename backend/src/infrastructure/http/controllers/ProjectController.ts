import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Pool } from 'pg';
import { GetProjectsHandler } from '../../../application/project/handlers/GetProjectsHandler';
import { GetProjectByIdHandler } from '../../../application/project/handlers/GetProjectByIdHandler';
import { CreateProjectHandler } from '../../../application/project/handlers/CreateProjectHandler';
import { UpdateProjectHandler } from '../../../application/project/handlers/UpdateProjectHandler';
import { UpdateProgressHandler } from '../../../application/project/handlers/UpdateProgressHandler';
import { DeleteProjectHandler } from '../../../application/project/handlers/DeleteProjectHandler';
import { Project } from '../../../domain/project/Project';

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  title: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});

const UpdateProjectSchema = CreateProjectSchema.partial();

const ProgressSchema = z.object({
  progress: z.number().int().min(0).max(100),
});

// ─────────────────────────────────────────────────────────────────────────────

function serializeProject(p: Project) {
  return p.toSnapshot();
}

const AddMilestoneSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

const UpdateMilestoneSchema = z.object({
  title: z.string().min(1).optional(),
  dueDate: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const AddProjectMemberSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(['owner', 'lead', 'contributor', 'observer']).default('contributor'),
});

const LinkTaskSchema = z.object({
  taskId: z.string().min(1),
});

export class ProjectController {
  constructor(
    private readonly getProjects: GetProjectsHandler,
    private readonly getProjectById: GetProjectByIdHandler,
    private readonly createProject: CreateProjectHandler,
    private readonly updateProject: UpdateProjectHandler,
    private readonly updateProgress: UpdateProgressHandler,
    private readonly deleteProject: DeleteProjectHandler,
    private readonly pool: Pool,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { ownerId, teamId, status, priority, limit, cursor_ts, cursor_id } = req.query;
      const result = await this.getProjects.execute({
        ownerId: ownerId as string | undefined,
        teamId: teamId as string | undefined,
        status: status ? (status as string).split(',') as any : undefined,
        priority: priority ? (priority as string).split(',') as any : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        cursor: cursor_ts && cursor_id
          ? { createdAt: new Date(cursor_ts as string), id: cursor_id as string }
          : undefined,
      });
      res.json({
        items: result.items.map(serializeProject),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const project = await this.getProjectById.execute({ id: req.params.id });
      res.json(serializeProject(project));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const id = await this.createProject.execute({
        ...req.body,
        ownerId: req.actor?.sub ?? req.body.ownerId,
        deadline: req.body.deadline ? new Date(req.body.deadline) : null,
      });
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const project = await this.updateProject.execute({
        id: req.params.id,
        ...req.body,
        deadline: req.body.deadline ? new Date(req.body.deadline) : undefined,
      });
      res.json(serializeProject(project));
    } catch (err) {
      next(err);
    }
  };

  progress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ProgressSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      await this.updateProgress.execute({
        projectId: req.params.id,
        progress: parsed.data.progress,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.deleteProject.execute(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // ── Milestones ────────────────────────────────────────────────────────────

  listMilestones = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { rows } = await this.pool.query(
        'SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY sort_order, id',
        [req.params.id],
      );
      res.json({ items: rows.map(r => ({ id: r.id, projectId: r.project_id, title: r.title, dueDate: r.due_date, completed: r.completed, completedAt: r.completed_at, sortOrder: r.sort_order })) });
    } catch (err) {
      next(err);
    }
  };

  addMilestone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = AddMilestoneSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const { rows } = await this.pool.query(
        `INSERT INTO project_milestones (project_id, title, due_date, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, parsed.data.title, parsed.data.dueDate ?? null, parsed.data.sortOrder],
      );
      res.status(201).json({ id: rows[0].id, projectId: rows[0].project_id, title: rows[0].title, dueDate: rows[0].due_date, completed: rows[0].completed, sortOrder: rows[0].sort_order });
    } catch (err) {
      next(err);
    }
  };

  updateMilestone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateMilestoneSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const sets: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      if (parsed.data.title !== undefined) { sets.push(`title = $${p++}`); params.push(parsed.data.title); }
      if (parsed.data.dueDate !== undefined) { sets.push(`due_date = $${p++}`); params.push(parsed.data.dueDate); }
      if (parsed.data.completed !== undefined) {
        sets.push(`completed = $${p++}`); params.push(parsed.data.completed);
        sets.push(`completed_at = $${p++}`); params.push(parsed.data.completed ? new Date() : null);
      }
      if (parsed.data.sortOrder !== undefined) { sets.push(`sort_order = $${p++}`); params.push(parsed.data.sortOrder); }
      if (sets.length === 0) { res.json({ success: true }); return; }
      params.push(req.params.milestoneId);
      await this.pool.query(`UPDATE project_milestones SET ${sets.join(', ')} WHERE id = $${p}`, params);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  deleteMilestone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.pool.query('DELETE FROM project_milestones WHERE id = $1 AND project_id = $2', [req.params.milestoneId, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  // ── Project Members ───────────────────────────────────────────────────────

  listMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { rows } = await this.pool.query(
        `SELECT pm.*, m.name, m.email, m.region FROM project_members pm JOIN members m ON m.id = pm.member_id WHERE pm.project_id = $1 ORDER BY pm.joined_at`,
        [req.params.id],
      );
      res.json({ items: rows.map(r => ({ memberId: r.member_id, name: r.name, email: r.email, region: r.region, role: r.role, joinedAt: r.joined_at })) });
    } catch (err) {
      next(err);
    }
  };

  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = AddProjectMemberSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      await this.pool.query(
        `INSERT INTO project_members (project_id, member_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.params.id, parsed.data.memberId, parsed.data.role],
      );
      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  removeMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.pool.query('DELETE FROM project_members WHERE project_id = $1 AND member_id = $2', [req.params.id, req.params.memberId]);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  // ── Linked Tasks ──────────────────────────────────────────────────────────

  listLinkedTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { rows } = await this.pool.query(
        `SELECT t.id, t.subject, t.status, t.priority, t.assignee_id, pt.linked_at FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id WHERE pt.project_id = $1 ORDER BY pt.linked_at`,
        [req.params.id],
      );
      res.json({ items: rows.map(r => ({ taskId: r.id, subject: r.subject, status: r.status, priority: r.priority, assigneeId: r.assignee_id, linkedAt: r.linked_at })) });
    } catch (err) {
      next(err);
    }
  };

  linkTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LinkTaskSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      await this.pool.query(
        `INSERT INTO project_tasks (project_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, parsed.data.taskId],
      );
      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  unlinkTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.pool.query('DELETE FROM project_tasks WHERE project_id = $1 AND task_id = $2', [req.params.id, req.params.taskId]);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };
}
