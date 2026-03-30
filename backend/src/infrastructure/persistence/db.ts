import { Pool } from 'pg';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

export const pool: Pool = config.DATABASE_URL
  ? new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT,
      connectionTimeoutMillis: config.DB_POOL_CONNECTION_TIMEOUT,
      application_name: `ops-hub-api-${process.pid}`,
    })
  : (null as unknown as Pool); // No DB configured — running in frontend-only mode

if (pool) {
  pool.on('error', (err) => {
    logger.error('Unexpected PG pool error', { err });
  });
}

export async function checkDbConnection(): Promise<boolean> {
  if (!pool) {
    logger.warn('DATABASE_URL not configured — running in frontend-only mode (no API)');
    return false;
  }
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info('Database connection established', { maxPool: config.DB_POOL_MAX });
    return true;
  } catch (err) {
    logger.warn('Database connection failed — running in frontend-only mode', {
      err: (err as Error).message,
    });
    return false;
  }
}

/** Pool metrics for health check */
export function getPoolMetrics() {
  if (!pool) return { totalCount: 0, idleCount: 0, waitingCount: 0 };
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
