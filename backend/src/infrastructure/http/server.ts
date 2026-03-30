import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import { readFileSync } from 'fs';

const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
    return pkg.version || '1.0.0';
  } catch { return '1.0.0'; }
})();

import { config } from '../../shared/config';
import { logger } from '../../shared/logger';
import { checkDbConnection, pool, getPoolMetrics } from '../persistence/db';

// ── Redis & Queue ──────────────────────────────────────────────────────────
import { getRedis, closeRedis } from '../redis/connection';
import {
  getWebhookQueue, startWebhookWorker, shutdownQueue, getQueueMetrics,
} from '../queue/WebhookQueue';
import { WebhookJobProcessor } from '../queue/WebhookProcessor';
import { DedupCache } from '../cache/DedupCache';
import { BatchTaskInserter } from '../persistence/BatchTaskInserter';
import { CircuitBreaker } from '../resilience/CircuitBreaker';

// ── Repositories ──────────────────────────────────────────────────────────
import { PostgresTaskRepository } from '../persistence/PostgresTaskRepository';
import { PostgresEscalationRepository } from '../persistence/PostgresEscalationRepository';
import { PostgresMemberRepository } from '../persistence/PostgresMemberRepository';
import { PostgresProjectRepository } from '../persistence/PostgresProjectRepository';
import { PostgresNoteRepository } from '../persistence/PostgresNoteRepository';
import { PostgresActivityRepository } from '../persistence/PostgresActivityRepository';
import { PostgresRequestRepository } from '../persistence/PostgresRequestRepository';
import { PostgresAnnouncementRepository } from '../persistence/PostgresAnnouncementRepository';

// ── Integrations ──────────────────────────────────────────────────────────
import { SlackAdapter } from '../integrations/slack/SlackAdapter';
import { JiraAdapter } from '../integrations/jira/JiraAdapter';
import { ZendeskAdapter } from '../integrations/zendesk/ZendeskAdapter';
import { GmailAdapter } from '../integrations/gmail/GmailAdapter';

// ── Auth handlers ─────────────────────────────────────────────────────────
import { LoginHandler } from '../../application/auth/handlers/LoginHandler';

// ── Task handlers ─────────────────────────────────────────────────────────
import { CreateTaskHandler } from '../../application/task/handlers/CreateTaskHandler';
import { UpdateTaskStatusHandler } from '../../application/task/handlers/UpdateTaskStatusHandler';
import { AssignTaskHandler } from '../../application/task/handlers/AssignTaskHandler';
import { EscalateTaskHandler } from '../../application/task/handlers/EscalateTaskHandler';
import { SnoozeTaskHandler } from '../../application/task/handlers/SnoozeTaskHandler';
import { GetTasksHandler } from '../../application/task/handlers/GetTasksHandler';
import { GetTaskByIdHandler } from '../../application/task/handlers/GetTaskByIdHandler';

// ── Escalation handlers ───────────────────────────────────────────────────
import { CreateEscalationHandler } from '../../application/escalation/handlers/CreateEscalationHandler';
import { RespondEscalationHandler } from '../../application/escalation/handlers/RespondEscalationHandler';
import { ResolveEscalationHandler } from '../../application/escalation/handlers/ResolveEscalationHandler';
import { DismissEscalationHandler } from '../../application/escalation/handlers/DismissEscalationHandler';
import { GetEscalationsHandler } from '../../application/escalation/handlers/GetEscalationsHandler';
import { GetEscalationByIdHandler } from '../../application/escalation/handlers/GetEscalationByIdHandler';

// ── Member handlers ───────────────────────────────────────────────────────
import { CreateMemberHandler } from '../../application/member/handlers/CreateMemberHandler';
import { UpdateMemberHandler } from '../../application/member/handlers/UpdateMemberHandler';
import { GetMembersHandler } from '../../application/member/handlers/GetMembersHandler';
import { GetMemberByIdHandler } from '../../application/member/handlers/GetMemberByIdHandler';

// ── Project handlers ──────────────────────────────────────────────────────
import { CreateProjectHandler } from '../../application/project/handlers/CreateProjectHandler';
import { UpdateProjectHandler } from '../../application/project/handlers/UpdateProjectHandler';
import { UpdateProgressHandler } from '../../application/project/handlers/UpdateProgressHandler';
import { GetProjectsHandler } from '../../application/project/handlers/GetProjectsHandler';
import { GetProjectByIdHandler } from '../../application/project/handlers/GetProjectByIdHandler';
import { DeleteProjectHandler } from '../../application/project/handlers/DeleteProjectHandler';

// ── Note handlers ─────────────────────────────────────────────────────────
import { CreateNoteHandler } from '../../application/note/handlers/CreateNoteHandler';
import { GetNotesByTaskHandler } from '../../application/note/handlers/GetNotesByTaskHandler';
import { DeleteNoteHandler } from '../../application/note/handlers/DeleteNoteHandler';

// ── Activity handlers ─────────────────────────────────────────────────────
import { GetActivityByTaskHandler } from '../../application/activity/handlers/GetActivityByTaskHandler';
import { LogActivityHandler } from '../../application/activity/handlers/LogActivityHandler';

// ── Request handlers ──────────────────────────────────────────────────────
import { CreateRequestHandler } from '../../application/request/handlers/CreateRequestHandler';
import { UpdateRequestHandler } from '../../application/request/handlers/UpdateRequestHandler';
import { GetRequestsHandler } from '../../application/request/handlers/GetRequestsHandler';
import { GetRequestByIdHandler } from '../../application/request/handlers/GetRequestByIdHandler';

// ── Announcement handlers ─────────────────────────────────────────────────
import { CreateAnnouncementHandler } from '../../application/announcement/handlers/CreateAnnouncementHandler';
import { UpdateAnnouncementHandler } from '../../application/announcement/handlers/UpdateAnnouncementHandler';
import { SendAnnouncementHandler } from '../../application/announcement/handlers/SendAnnouncementHandler';
import { GetAnnouncementsHandler } from '../../application/announcement/handlers/GetAnnouncementsHandler';
import { GetAnnouncementByIdHandler } from '../../application/announcement/handlers/GetAnnouncementByIdHandler';
import { MarkAnnouncementReadHandler } from '../../application/announcement/handlers/MarkAnnouncementReadHandler';

// ── Controllers ───────────────────────────────────────────────────────────
import { AuthController } from './controllers/AuthController';
import { TaskController } from './controllers/TaskController';
import { WebhookController } from './controllers/WebhookController';
import { EscalationController } from './controllers/EscalationController';
import { MemberController } from './controllers/MemberController';
import { ProjectController } from './controllers/ProjectController';
import { NoteController } from './controllers/NoteController';
import { ActivityController } from './controllers/ActivityController';
import { RequestController } from './controllers/RequestController';
import { AnnouncementController } from './controllers/AnnouncementController';

// ── Event subscribers ─────────────────────────────────────────────────────
import { registerTaskEventSubscribers } from '../events/TaskEventSubscribers';

import { buildRouter } from './router';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

// ── Shutdown coordination ─────────────────────────────────────────────────
let batchInserter: BatchTaskInserter | null = null;
let httpServer: http.Server | null = null;
let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  // ── Verify DB ─────────────────────────────────────────────────────────────
  const dbAvailable = await checkDbConnection();

  // ── Set statement_timeout on each new DB client ───────────────────────────
  if (dbAvailable) {
    pool.on('connect', (client) => {
      client.query('SET statement_timeout = 30000').catch((err: Error) => {
        logger.warn('Failed to set statement_timeout', { err: err.message });
      });
    });
  }

  // ── Verify Redis (optional — runs in degraded mode without it) ───────────
  let redisAvailable = false;
  try {
    const redis = getRedis();
    await redis.ping();
    redisAvailable = true;
    logger.info('Redis connection verified');
  } catch (err) {
    logger.warn('Redis unavailable — running in degraded mode (no webhook queue, no dedup cache)', {
      err: (err as Error).message,
    });
  }

  // ── Repositories (only if DB available) ──────────────────────────────────
  if (!dbAvailable) {
    logger.info('Skipping API setup — no database. Serving frontend only.');
  }

  const taskRepo          = dbAvailable ? new PostgresTaskRepository(pool) : null;
  const escalationRepo    = dbAvailable ? new PostgresEscalationRepository(pool) : null;
  const memberRepo        = dbAvailable ? new PostgresMemberRepository(pool) : null;
  const projectRepo       = dbAvailable ? new PostgresProjectRepository(pool) : null;
  const noteRepo          = dbAvailable ? new PostgresNoteRepository(pool) : null;
  const activityRepo      = dbAvailable ? new PostgresActivityRepository(pool) : null;
  const requestRepo       = dbAvailable ? new PostgresRequestRepository(pool) : null;
  const announcementRepo  = dbAvailable ? new PostgresAnnouncementRepository(pool) : null;

  // ── API layer (only if DB available) ────────────────────────────────────
  let apiRouter: ReturnType<typeof buildRouter> | null = null;

  if (dbAvailable) {
    // ── Integrations ──────────────────────────────────────────────────────
    const slack   = new SlackAdapter();
    const jira    = config.JIRA_BASE_URL    ? new JiraAdapter()    : null;
    const zendesk = config.ZENDESK_SUBDOMAIN ? new ZendeskAdapter() : null;
    const gmail   = config.GOOGLE_CLIENT_ID  ? new GmailAdapter()   : null;

    if (jira)    logger.info('Jira adapter initialized');
    if (zendesk) logger.info('Zendesk adapter initialized');
    if (gmail)   logger.info('Gmail adapter initialized');

    // ── Event subscribers ─────────────────────────────────────────────────
    registerTaskEventSubscribers(activityRepo!);

    // ── Use cases ─────────────────────────────────────────────────────────
    const loginHandler = new LoginHandler(memberRepo!);
    const createTask    = new CreateTaskHandler(taskRepo!);
    const updateStatus  = new UpdateTaskStatusHandler(taskRepo!);
    const assignTask    = new AssignTaskHandler(taskRepo!);
    const escalateTask  = new EscalateTaskHandler(taskRepo!, slack);
    const snoozeTask    = new SnoozeTaskHandler(taskRepo!);
    const getTasks      = new GetTasksHandler(taskRepo!);
    const getTaskById   = new GetTaskByIdHandler(taskRepo!);

    const createEscalation  = new CreateEscalationHandler(escalationRepo!);
    const respondEscalation = new RespondEscalationHandler(escalationRepo!);
    const resolveEscalation = new ResolveEscalationHandler(escalationRepo!);
    const dismissEscalation = new DismissEscalationHandler(escalationRepo!);
    const getEscalations    = new GetEscalationsHandler(escalationRepo!);
    const getEscalationById = new GetEscalationByIdHandler(escalationRepo!);

    const createMember  = new CreateMemberHandler(memberRepo!);
    const updateMember  = new UpdateMemberHandler(memberRepo!);
    const getMembers    = new GetMembersHandler(memberRepo!);
    const getMemberById = new GetMemberByIdHandler(memberRepo!);

    const createProject   = new CreateProjectHandler(projectRepo!);
    const updateProject   = new UpdateProjectHandler(projectRepo!);
    const updateProgress  = new UpdateProgressHandler(projectRepo!);
    const getProjects     = new GetProjectsHandler(projectRepo!);
    const getProjectById  = new GetProjectByIdHandler(projectRepo!);
    const deleteProject   = new DeleteProjectHandler(projectRepo!);

    const createNote      = new CreateNoteHandler(noteRepo!, activityRepo!);
    const getNotesByTask  = new GetNotesByTaskHandler(noteRepo!);
    const deleteNote      = new DeleteNoteHandler(noteRepo!);

    const getActivityByTask = new GetActivityByTaskHandler(activityRepo!);
    const logActivity       = new LogActivityHandler(activityRepo!);

    const createRequest     = new CreateRequestHandler(requestRepo!);
    const updateRequest     = new UpdateRequestHandler(requestRepo!);
    const getRequests       = new GetRequestsHandler(requestRepo!);
    const getRequestById    = new GetRequestByIdHandler(requestRepo!);

    const createAnnouncement  = new CreateAnnouncementHandler(announcementRepo!);
    const updateAnnouncement  = new UpdateAnnouncementHandler(announcementRepo!);
    const sendAnnouncement    = new SendAnnouncementHandler(announcementRepo!);
    const getAnnouncements    = new GetAnnouncementsHandler(announcementRepo!);
    const getAnnouncementById = new GetAnnouncementByIdHandler(announcementRepo!);
    const markAnnouncementRead = new MarkAnnouncementReadHandler(announcementRepo!);

    // ── High-throughput infrastructure (requires Redis) ──────────────────
    const dbCircuit = new CircuitBreaker({
      name: 'postgres',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });

    if (redisAvailable) {
      const dedupCache = new DedupCache();
      batchInserter = new BatchTaskInserter(pool, {
        onFlushSuccess: () => { dbCircuit.execute(async () => {}).catch(() => {}); },
        onFlushFailure: () => { dbCircuit.execute(async () => { throw new Error('DB flush failed'); }).catch(() => {}); },
      });
      const webhookProcessor = new WebhookJobProcessor(dedupCache, batchInserter, dbCircuit);
      startWebhookWorker(webhookProcessor.process);
    } else {
      logger.info('Webhook queue disabled — Redis not available');
    }

    if (!config.ZAPIER_WEBHOOK_SECRET && config.NODE_ENV === 'production') {
      logger.warn('ZAPIER_WEBHOOK_SECRET is not configured — Zapier endpoint is unauthenticated');
    }

    // ── Controllers ─────────────────────────────────────────────────────────
    const authController = new AuthController(loginHandler);
    const taskController = new TaskController(
      getTasks, getTaskById, createTask, updateStatus, assignTask, escalateTask, snoozeTask, taskRepo!,
    );
    const webhookController = new WebhookController(createTask, updateStatus);
    const escalationController = new EscalationController(
      getEscalations, getEscalationById, createEscalation, respondEscalation, resolveEscalation, dismissEscalation,
    );
    const memberController = new MemberController(
      getMembers, getMemberById, createMember, updateMember, memberRepo!,
    );
    const projectController = new ProjectController(
      getProjects, getProjectById, createProject, updateProject, updateProgress, deleteProject, pool,
    );
    const noteController = new NoteController(getNotesByTask, createNote, deleteNote);
    const activityController = new ActivityController(getActivityByTask);
    const requestController = new RequestController(
      getRequests, getRequestById, createRequest, updateRequest, requestRepo!,
    );
    const announcementController = new AnnouncementController(
      getAnnouncements, getAnnouncementById, createAnnouncement, updateAnnouncement, sendAnnouncement, markAnnouncementRead, announcementRepo!,
    );

    apiRouter = buildRouter(
      taskController, webhookController, escalationController, memberController,
      projectController, authController, noteController, activityController,
      requestController, announcementController,
    );
  }

  // ── Express app ───────────────────────────────────────────────────────────
  const app = express();

  // Trust proxy for correct client IP behind load balancer
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({
    origin: config.NODE_ENV === 'production'
      ? ['https://jtk-ops-hub.dp.com', 'https://ops-hub.deel.com']
      : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }));
  app.use(requestId);
  app.use(compression());
  app.use(express.json({ limit: '256kb' })); // tightened from 1mb — webhooks are small
  app.use(requestLogger);

  // Global rate limiter — does NOT apply to webhooks (they have their own in router)
  app.use(rateLimit({
    windowMs: 60_000,
    max: config.API_RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/api/v1/webhooks'),
  }));

  // ── Enhanced health check ─────────────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    if (isShuttingDown) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

    try {
      const [queueMetrics, poolMetrics] = await Promise.all([
        getQueueMetrics().catch(() => null),
        Promise.resolve(getPoolMetrics()),
      ]);

      res.json({
        status: dbAvailable ? 'ok' : 'frontend_only',
        ts: new Date().toISOString(),
        version: APP_VERSION,
        env: config.NODE_ENV,
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1_048_576),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1_048_576),
        },
        db: poolMetrics,
        queue: queueMetrics,
      });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  if (apiRouter) {
    app.use('/api/v1', apiRouter);
  } else {
    // No DB — return 503 for all API routes
    app.use('/api/v1', (_req, res) => {
      res.status(503).json({ error: 'API unavailable — no database configured' });
    });
  }

  // ── Serve frontend in production ──────────────────────────────────────────
  if (config.NODE_ENV === 'production') {
    const frontendDir = path.resolve(__dirname, '../../../public');
    app.use(express.static(frontendDir));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  // ── Start ─────────────────────────────────────────────────────────────────
  httpServer = app.listen(config.PORT, () => {
    logger.info(`Ops Hub API running on port ${config.PORT}`, {
      env: config.NODE_ENV,
      pid: process.pid,
      dbPool: config.DB_POOL_MAX,
      webhookConcurrency: config.WEBHOOK_QUEUE_CONCURRENCY,
      webhookBatchSize: config.WEBHOOK_BATCH_SIZE,
    });
  });

  // Keep-alive tuning for high-throughput
  httpServer.keepAliveTimeout = 65_000;   // slightly above typical ALB 60s
  httpServer.headersTimeout = 66_000;

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds max for graceful shutdown

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal} — starting graceful shutdown...`);

    // Race all shutdown steps against a hard timeout
    const shutdownWork = async () => {
      // 1. Stop accepting new HTTP connections and wait for in-flight requests
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => {
            logger.info('HTTP server closed');
            resolve();
          });
        });
      }

      // 2. Drain the webhook queue (finish in-flight jobs)
      await shutdownQueue();

      // 3. Flush remaining batch inserts
      if (batchInserter) {
        await batchInserter.shutdown();
      }

      // 4. Close Redis
      await closeRedis();

      // 5. Close DB pool
      await pool.end();
      logger.info('DB pool closed');
    };

    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Shutdown timeout exceeded')), SHUTDOWN_TIMEOUT_MS);
    });

    try {
      await Promise.race([shutdownWork(), timeout]);
      logger.info('Graceful shutdown complete');
    } catch (err) {
      logger.error('Graceful shutdown timed out, forcing exit', { err: (err as Error).message });
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled rejections — log and continue (queue has its own retry logic)
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
}

bootstrap().catch(err => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

export { bootstrap };
