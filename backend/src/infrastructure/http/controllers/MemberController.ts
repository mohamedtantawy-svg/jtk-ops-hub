import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetMembersHandler } from '../../../application/member/handlers/GetMembersHandler';
import { GetMemberByIdHandler } from '../../../application/member/handlers/GetMemberByIdHandler';
import { CreateMemberHandler } from '../../../application/member/handlers/CreateMemberHandler';
import { UpdateMemberHandler } from '../../../application/member/handlers/UpdateMemberHandler';
import { IMemberRepository } from '../../../domain/member/IMemberRepository';
import { Member } from '../../../domain/member/Member';
import { NotFoundError } from '../../../shared/errors';

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['agent', 'lead', 'regional_mgr', 'admin']),
  team: z.string().min(1).nullable().optional(),
  region: z.enum(['EMEA', 'APAC', 'AMER']).nullable().optional(),
  leadId: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

const UpdateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['agent', 'lead', 'regional_mgr', 'admin']).optional(),
  team: z.string().min(1).nullable().optional(),
  region: z.enum(['EMEA', 'APAC', 'AMER']).nullable().optional(),
  leadId: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────

function serializeMember(m: Member) {
  return m.toSnapshot();
}

export class MemberController {
  constructor(
    private readonly getMembers: GetMembersHandler,
    private readonly getMemberById: GetMemberByIdHandler,
    private readonly createMember: CreateMemberHandler,
    private readonly updateMember: UpdateMemberHandler,
    private readonly memberRepo: IMemberRepository,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role, region, isActive, limit, cursor_ts, cursor_id } = req.query;
      const result = await this.getMembers.execute({
        role: role ? (role as string).split(',') as any : undefined,
        region: region as any,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        cursor: cursor_ts && cursor_id
          ? { createdAt: new Date(cursor_ts as string), id: cursor_id as string }
          : undefined,
      });
      res.json({
        items: result.items.map(serializeMember),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await this.getMemberById.execute({ id: req.params.id });
      res.json(serializeMember(member));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const id = await this.createMember.execute({
        name: parsed.data.name,
        email: parsed.data.email,
        role: parsed.data.role,
        team: parsed.data.team ?? null,
        region: parsed.data.region ?? null,
        leadId: parsed.data.leadId ?? null,
        avatarUrl: parsed.data.avatarUrl ?? null,
      });
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        return;
      }
      const member = await this.updateMember.execute({ id: req.params.id, ...parsed.data });
      res.json(serializeMember(member));
    } catch (err) {
      next(err);
    }
  };

  deactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await this.memberRepo.findById(req.params.id);
      if (!member) {
        next(new NotFoundError('Member', req.params.id));
        return;
      }
      member.deactivate();
      await this.memberRepo.update(member);
      res.json(serializeMember(member));
    } catch (err) {
      next(err);
    }
  };
}
