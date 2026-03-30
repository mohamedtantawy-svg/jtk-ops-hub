import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetAnnouncementsHandler } from '../../../application/announcement/handlers/GetAnnouncementsHandler';
import { GetAnnouncementByIdHandler } from '../../../application/announcement/handlers/GetAnnouncementByIdHandler';
import { CreateAnnouncementHandler } from '../../../application/announcement/handlers/CreateAnnouncementHandler';
import { UpdateAnnouncementHandler } from '../../../application/announcement/handlers/UpdateAnnouncementHandler';
import { SendAnnouncementHandler } from '../../../application/announcement/handlers/SendAnnouncementHandler';
import { MarkAnnouncementReadHandler } from '../../../application/announcement/handlers/MarkAnnouncementReadHandler';
import { Announcement } from '../../../domain/announcement/Announcement';
import { IAnnouncementRepository } from '../../../domain/announcement/IAnnouncementRepository';

const CreateAnnouncementSchema = z.object({
  type: z.enum(['alert', 'announce', 'update', 'guidance', 'kudos']),
  title: z.string().min(1),
  body: z.string().min(1),
  target: z.enum(['all', 'EMEA', 'APAC', 'AMER']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  isPopup: z.boolean().optional(),
  imageUrl: z.string().optional(),
  link: z.string().optional(),
});

const UpdateAnnouncementSchema = z.object({
  type: z.enum(['alert', 'announce', 'update', 'guidance', 'kudos']).optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  target: z.enum(['all', 'EMEA', 'APAC', 'AMER']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  isPopup: z.boolean().optional(),
  imageUrl: z.string().optional(),
  link: z.string().optional(),
});

const AddCommentSchema = z.object({
  body: z.string().min(1),
  parentId: z.string().optional(),
});

const AddLinkSchema = z.object({
  targetId: z.string().min(1),
});

const ReactSchema = z.object({
  emoji: z.string().min(1).max(10),
});

function serializeAnnouncement(a: Announcement) {
  const s = a.toSnapshot();
  return {
    id: s.id, type: s.type, title: s.title, body: s.body, authorId: s.authorId,
    target: s.target, status: s.status, priority: s.priority, isPinned: s.isPinned,
    isPopup: s.isPopup, imageUrl: s.imageUrl, link: s.link, reactions: s.reactions,
    sentAt: s.sentAt, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

export class AnnouncementController {
  constructor(
    private readonly getAnnouncements: GetAnnouncementsHandler,
    private readonly getAnnouncementById: GetAnnouncementByIdHandler,
    private readonly createAnnouncement: CreateAnnouncementHandler,
    private readonly updateAnnouncement: UpdateAnnouncementHandler,
    private readonly sendAnnouncement: SendAnnouncementHandler,
    private readonly markRead: MarkAnnouncementReadHandler,
    private readonly announcementRepo: IAnnouncementRepository,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, target, limit } = req.query;
      const result = await this.getAnnouncements.execute({
        status: status ? (status as string).split(',') as any : undefined,
        target: target as any,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });
      res.json({ items: result.items.map(serializeAnnouncement), hasMore: result.hasMore });
    } catch (err) { next(err); }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ann = await this.getAnnouncementById.execute({ announcementId: req.params.id });
      const readCount = await this.announcementRepo.getReadCount(req.params.id);
      res.json({ ...serializeAnnouncement(ann), readCount });
    } catch (err) { next(err); }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateAnnouncementSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const ann = await this.createAnnouncement.execute({ ...parsed.data, authorId: req.actor!.sub });
      res.status(201).json(serializeAnnouncement(ann));
    } catch (err) { next(err); }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateAnnouncementSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const ann = await this.updateAnnouncement.execute({ announcementId: req.params.id, ...parsed.data });
      res.json(serializeAnnouncement(ann));
    } catch (err) { next(err); }
  };

  send = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ann = await this.sendAnnouncement.execute({ announcementId: req.params.id });
      res.json(serializeAnnouncement(ann));
    } catch (err) { next(err); }
  };

  read = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.markRead.execute({ announcementId: req.params.id, memberId: req.actor!.sub });
      res.json({ success: true });
    } catch (err) { next(err); }
  };

  readers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const memberIds = await this.announcementRepo.getReaders(req.params.id);
      res.json({ announcementId: req.params.id, memberIds });
    } catch (err) { next(err); }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.announcementRepo.delete(req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  };

  // ── React ───────────────────────────────────────────────────────────────

  react = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ReactSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      await this.announcementRepo.react(req.params.id, parsed.data.emoji);
      res.json({ ok: true });
    } catch (err) { next(err); }
  };

  // ── Unarchive ─────────────────────────────────────────────────────────────

  unarchive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ann = await this.announcementRepo.findById(req.params.id);
      if (!ann) { res.status(404).json({ error: 'Announcement not found' }); return; }
      ann.unarchive();
      await this.announcementRepo.update(ann);
      res.json(serializeAnnouncement(ann));
    } catch (err) { next(err); }
  };

  // ── Comments ──────────────────────────────────────────────────────────────

  listComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const comments = await this.announcementRepo.getComments(req.params.id);
      res.json({ items: comments });
    } catch (err) { next(err); }
  };

  addComment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = AddCommentSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      const comment = await this.announcementRepo.addComment(
        req.params.id,
        parsed.data.parentId ?? null,
        req.actor!.sub,
        parsed.data.body,
      );
      res.status(201).json(comment);
    } catch (err) { next(err); }
  };

  deleteComment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.announcementRepo.deleteComment(req.params.commentId);
      res.json({ success: true });
    } catch (err) { next(err); }
  };

  // ── Links ─────────────────────────────────────────────────────────────────

  listLinks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const links = await this.announcementRepo.getLinkedAnnouncements(req.params.id);
      res.json({ items: links });
    } catch (err) { next(err); }
  };

  addLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = AddLinkSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Validation failed', details: parsed.error.issues }); return; }
      await this.announcementRepo.linkAnnouncements(req.params.id, parsed.data.targetId);
      res.status(201).json({ success: true });
    } catch (err) { next(err); }
  };

  removeLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.announcementRepo.unlinkAnnouncements(req.params.id, req.params.targetId);
      res.json({ success: true });
    } catch (err) { next(err); }
  };
}
