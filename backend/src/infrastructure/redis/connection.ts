import Redis from 'ioredis';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

let redis: Redis | null = null;
const trackedConnections: Redis[] = []; // Track all connections for cleanup

export function getRedis(): Redis {
  if (!redis) {
    redis = createManagedConnection('main');
  }
  return redis;
}

/** Separate connection for BullMQ subscriber (BullMQ requires dedicated connections) */
export function createRedisConnection(): Redis {
  return createManagedConnection('bullmq');
}

function createManagedConnection(label: string): Redis {
  const conn = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,          // required by BullMQ — retries indefinitely
    retryStrategy(times) {
      // Exponential backoff: 200ms, 400ms, 800ms, ... capped at 10s
      // Never return null — BullMQ requires the connection to keep retrying.
      const delay = Math.min(times * 200, 10_000);
      if (times % 10 === 0) {
        logger.warn(`Redis ${label}: reconnect attempt #${times}`, { delay });
      }
      return delay;
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 5_000,
    // Reconnect on READONLY errors (Redis Sentinel failover)
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'EPIPE'];
      return targetErrors.some(e => err.message.includes(e));
    },
  });

  conn.on('error', (err) => logger.error(`Redis ${label} error`, { err: err.message }));
  conn.on('connect', () => logger.info(`Redis ${label} connected`));
  conn.on('ready', () => logger.info(`Redis ${label} ready`));

  trackedConnections.push(conn);
  return conn;
}

export async function closeRedis(): Promise<void> {
  const closePromises = trackedConnections.map(async (conn) => {
    try {
      await conn.quit();
    } catch {
      // Force disconnect if quit fails
      conn.disconnect();
    }
  });

  await Promise.allSettled(closePromises);
  trackedConnections.length = 0;
  redis = null;
  logger.info('All Redis connections closed');
}
