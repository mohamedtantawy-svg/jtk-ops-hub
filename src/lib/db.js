import { Pool } from 'pg';

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString,
      // Trimmed from 25 → 12 on 2026-05-19 after the 2026-05-18 log audit
      // showed RSS climbing past the 1024 MiB ceiling during an upstream
      // Deel 500-storm. Each pg client pins ~10–30 MiB of native + JS
      // state on a long-lived connection; 25 clients ≈ up to 750 MiB held
      // outside the V8 heap. Ops Hub's traffic pattern doesn't need 25
      // concurrent DB queries — 12 leaves comfortable headroom while
      // shaving the worst-case off-heap footprint.
      max: 12,
      min: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' },
    });

    pool.on('error', (err) => {
      console.error('[db] Unexpected idle client error:', err.message);
    });
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * Execute multiple queries within a single transaction.
 * @param {Function} callback - receives a `client` with .query() method
 * @returns {*} whatever the callback returns
 */
export async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
