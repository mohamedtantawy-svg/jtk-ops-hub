import { Pool } from 'pg';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,                        // default 40 (was 20)
  idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT,  // default 20s
  connectionTimeoutMillis: config.DB_POOL_CONNECTION_TIMEOUT, // 5s
  // Note: statement_timeout is set per-client via pool.on('connect') in server.ts
  application_name: `ops-hub-api-${process.pid}`,
});

pool.on('error', (err) => {
  logger.error('Unexpected PG pool error', { err });
});

export async function checkDbConnection(): Promise<void> {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  logger.info('Database connection established', { maxPool: config.DB_POOL_MAX });
}

/** Pool metrics for health check */
export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
