import fs from 'fs';
import path from 'path';
import { pool } from './db';
import { logger } from '../../shared/logger';

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace('.sql', '');

      const { rows } = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version],
      );

      if (rows.length > 0) {
        logger.info(`Migration already applied: ${version}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      await client.query('COMMIT');

      logger.info(`Migration applied: ${version}`);
    }

    logger.info('All migrations complete');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Migration failed', { err });
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
