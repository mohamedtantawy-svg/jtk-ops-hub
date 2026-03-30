import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { createRedisConnection, getRedis } from '../redis/connection';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

// ── Job payload types ────────────────────────────────────────────────────────

export interface WebhookJobData {
  source: 'zendesk' | 'jira' | 'slack' | 'zapier';
  integrationId?: string;
  payload: Record<string, unknown>;
  receivedAt: string; // ISO timestamp — when the webhook was received
}

export interface WebhookJobResult {
  taskId?: string;
  skipped?: boolean;
  error?: string;
}

// ── Queue ────────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'webhook-ingest';

let queue: Queue<WebhookJobData, WebhookJobResult> | null = null;
let worker: Worker<WebhookJobData, WebhookJobResult> | null = null;
let queueEvents: QueueEvents | null = null;

export function getWebhookQueue(): Queue<WebhookJobData, WebhookJobResult> {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: config.WEBHOOK_QUEUE_MAX_RETRIES + 1, // +1 because BullMQ counts initial attempt
        backoff: {
          type: 'exponential',
          delay: config.WEBHOOK_QUEUE_BACKOFF_MS,
        },
        removeOnComplete: { age: 86_400, count: 10_000 },    // keep last 10K for 24h
        removeOnFail:     { age: 7 * 86_400, count: 5_000 }, // keep failed for 7d
      },
    });
  }
  return queue;
}

// ── Worker (started per process) ─────────────────────────────────────────────

export type WebhookProcessor = (job: Job<WebhookJobData>) => Promise<WebhookJobResult>;

export function startWebhookWorker(processor: WebhookProcessor): Worker<WebhookJobData, WebhookJobResult> {
  if (worker) return worker;

  worker = new Worker<WebhookJobData, WebhookJobResult>(
    QUEUE_NAME,
    processor,
    {
      connection: createRedisConnection(),
      concurrency: config.WEBHOOK_QUEUE_CONCURRENCY,
      limiter: {
        max: config.WEBHOOK_RATE_LIMIT_PER_MIN,
        duration: 60_000,
      },
      stalledInterval: 30_000,
    },
  );

  worker.on('completed', (job) => {
    logger.debug('Webhook job completed', { jobId: job.id, source: job.data.source });
  });

  worker.on('failed', (job, err) => {
    logger.error('Webhook job failed', {
      jobId: job?.id,
      source: job?.data.source,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Webhook job stalled', { jobId });
  });

  worker.on('error', (err) => {
    logger.error('Webhook worker error', { err: err.message });
  });

  logger.info('Webhook worker started', {
    concurrency: config.WEBHOOK_QUEUE_CONCURRENCY,
    maxRetries: config.WEBHOOK_QUEUE_MAX_RETRIES,
  });

  return worker;
}

// ── Queue Events (for monitoring) ────────────────────────────────────────────

export function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return queueEvents;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export async function getQueueMetrics(): Promise<QueueMetrics> {
  const q = getWebhookQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getCompletedCount(),
    q.getFailedCount(),
    q.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed, paused: 0 };
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

export async function shutdownQueue(): Promise<void> {
  logger.info('Shutting down webhook queue...');

  if (worker) {
    await worker.close();        // finish in-flight jobs, then stop
    worker = null;
  }
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }

  logger.info('Webhook queue shut down');
}
