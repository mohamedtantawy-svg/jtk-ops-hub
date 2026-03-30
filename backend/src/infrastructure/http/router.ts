import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../shared/config';
import { TaskController } from './controllers/TaskController';
import { WebhookController } from './controllers/WebhookController';
import { EscalationController } from './controllers/EscalationController';
import { MemberController } from './controllers/MemberController';
import { ProjectController } from './controllers/ProjectController';
import { AuthController } from './controllers/AuthController';
import { NoteController } from './controllers/NoteController';
import { ActivityController } from './controllers/ActivityController';
import { RequestController } from './controllers/RequestController';
import { AnnouncementController } from './controllers/AnnouncementController';
import { requireAuth, requireRole } from './middleware/auth';

const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// ── Webhook rate limiter — tuned for 500K+ events/month ──────────────────────
// 500K/month ≈ 12/min avg, but bursts can hit 50-100x → need 600/min headroom
// Per-IP limits don't apply well to webhooks (Zapier sends from shared IPs),
// so we use a global limiter keyed by source header or a fixed key.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: config.WEBHOOK_RATE_LIMIT_PER_MIN, // default 600, configurable
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use a single global key for webhooks since they come from shared infra IPs.
    // The real throttling happens in the BullMQ worker limiter.
    return 'webhook-global';
  },
  message: { error: 'Too many webhook requests, please try again later' },
});

export function buildRouter(
  taskController: TaskController,
  webhookController: WebhookController,
  escalationController: EscalationController,
  memberController: MemberController,
  projectController: ProjectController,
  authController: AuthController,
  noteController: NoteController,
  activityController: ActivityController,
  requestController: RequestController,
  announcementController: AnnouncementController,
): Router {
  const router = Router();

  // ── Auth ─────────────────────────────────────────────────────────────────────
  router.post('/auth/login', writeLimiter, authController.login);

  // ── Current user ─────────────────────────────────────────────────────────────
  router.get('/me', requireAuth, (req, res) => {
    res.json(req.actor);
  });

  // ── Tasks ───────────────────────────────────────────────────────────────────
  router.get('/tasks',                    requireAuth, taskController.list);
  router.get('/tasks/:id',                requireAuth, taskController.getById);
  router.post('/tasks',                   requireAuth, writeLimiter, taskController.create);
  router.patch('/tasks/:id/status',       requireAuth, writeLimiter, taskController.updateTaskStatus);
  router.patch('/tasks/:id/assign',       requireAuth, writeLimiter, taskController.assignTask);
  router.patch('/tasks/:id/escalate',     requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, taskController.escalateTask);
  router.patch('/tasks/:id/snooze',       requireAuth, writeLimiter, taskController.snoozeTask);
  router.delete('/tasks/:id',             requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, taskController.delete);

  // ── Task Notes ──────────────────────────────────────────────────────────────
  router.get('/tasks/:taskId/notes',              requireAuth, noteController.list);
  router.post('/tasks/:taskId/notes',             requireAuth, writeLimiter, noteController.create);
  router.delete('/tasks/:taskId/notes/:noteId',   requireAuth, writeLimiter, noteController.remove);

  // ── Task Activity ───────────────────────────────────────────────────────────
  router.get('/tasks/:taskId/activity',           requireAuth, activityController.list);

  // ── Escalations ─────────────────────────────────────────────────────────────
  router.get('/escalations',              requireAuth, escalationController.list);
  router.get('/escalations/:id',          requireAuth, escalationController.getById);
  router.post('/escalations',             requireAuth, writeLimiter, escalationController.create);
  router.patch('/escalations/:id/respond', requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, escalationController.respond);
  router.patch('/escalations/:id/resolve', requireAuth, writeLimiter, escalationController.resolve);
  router.patch('/escalations/:id/dismiss', requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, escalationController.dismiss);

  // ── Members ─────────────────────────────────────────────────────────────────
  router.get('/members',                  requireAuth, memberController.list);
  router.get('/members/:id',              requireAuth, memberController.getById);
  router.post('/members',                 requireAuth, requireRole('admin'), writeLimiter, memberController.create);
  router.patch('/members/:id',            requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, memberController.update);
  router.patch('/members/:id/deactivate', requireAuth, requireRole('admin'), writeLimiter, memberController.deactivate);

  // ── Projects ────────────────────────────────────────────────────────────────
  router.get('/projects',                 requireAuth, projectController.list);
  router.get('/projects/:id',             requireAuth, projectController.getById);
  router.post('/projects',                requireAuth, writeLimiter, projectController.create);
  router.patch('/projects/:id',           requireAuth, writeLimiter, projectController.update);
  router.patch('/projects/:id/progress',  requireAuth, writeLimiter, projectController.progress);
  router.delete('/projects/:id',          requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, projectController.delete);

  // ── Project sub-resources ───────────────────────────────────────────────────
  router.get('/projects/:id/milestones',                        requireAuth, projectController.listMilestones);
  router.post('/projects/:id/milestones',                       requireAuth, writeLimiter, projectController.addMilestone);
  router.patch('/projects/:id/milestones/:milestoneId',         requireAuth, writeLimiter, projectController.updateMilestone);
  router.delete('/projects/:id/milestones/:milestoneId',        requireAuth, writeLimiter, projectController.deleteMilestone);
  router.get('/projects/:id/members',                           requireAuth, projectController.listMembers);
  router.post('/projects/:id/members',                          requireAuth, writeLimiter, projectController.addMember);
  router.delete('/projects/:id/members/:memberId',              requireAuth, writeLimiter, projectController.removeMember);
  router.get('/projects/:id/tasks',                             requireAuth, projectController.listLinkedTasks);
  router.post('/projects/:id/tasks',                            requireAuth, writeLimiter, projectController.linkTask);
  router.delete('/projects/:id/tasks/:taskId',                  requireAuth, writeLimiter, projectController.unlinkTask);

  // ── Requests ────────────────────────────────────────────────────────────────
  router.get('/requests',                 requireAuth, requestController.list);
  router.get('/requests/:id',             requireAuth, requestController.getById);
  router.post('/requests',                requireAuth, writeLimiter, requestController.create);
  router.patch('/requests/:id',           requireAuth, writeLimiter, requestController.update);
  router.delete('/requests/:id',          requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, requestController.remove);

  // ── Announcements ───────────────────────────────────────────────────────────
  router.get('/announcements',            requireAuth, announcementController.list);
  router.get('/announcements/:id',        requireAuth, announcementController.getById);
  router.post('/announcements',           requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, announcementController.create);
  router.patch('/announcements/:id',      requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, announcementController.update);
  router.patch('/announcements/:id/send',      requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, announcementController.send);
  router.patch('/announcements/:id/unarchive', requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, announcementController.unarchive);
  router.post('/announcements/:id/react',       requireAuth, writeLimiter, announcementController.react);
  router.post('/announcements/:id/read',       requireAuth, announcementController.read);
  router.get('/announcements/:id/readers',     requireAuth, announcementController.readers);

  // Announcement comments
  router.get('/announcements/:id/comments',                        requireAuth, announcementController.listComments);
  router.post('/announcements/:id/comments',                       requireAuth, writeLimiter, announcementController.addComment);
  router.delete('/announcements/:announcementId/comments/:commentId', requireAuth, writeLimiter, announcementController.deleteComment);

  // Announcement links
  router.get('/announcements/:id/links',              requireAuth, announcementController.listLinks);
  router.post('/announcements/:id/links',             requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, announcementController.addLink);
  router.delete('/announcements/:id/links/:targetId', requireAuth, requireRole('lead', 'regional_mgr', 'admin'), writeLimiter, announcementController.removeLink);

  router.delete('/announcements/:id',                 requireAuth, requireRole('admin'), writeLimiter, announcementController.remove);

  // ── Webhooks (signature-verified, unauthenticated) ──────────────────────────
  // These enqueue to BullMQ and return 202 immediately — no DB I/O in the request path
  router.post('/webhooks/zendesk',               webhookLimiter, webhookController.zendesk);
  router.post('/webhooks/jira',                  webhookLimiter, webhookController.jira);
  router.post('/webhooks/slack',                 webhookLimiter, webhookController.slack);
  router.post('/webhooks/zapier/:integrationId', webhookLimiter, webhookController.zapier);
  router.post('/webhooks/zapier',                webhookLimiter, webhookController.zapier);

  return router;
}
