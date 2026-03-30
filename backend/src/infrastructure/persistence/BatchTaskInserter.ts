import { Pool } from 'pg';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

/**
 * High-throughput batch inserter for tasks.
 *
 * Instead of one INSERT per webhook, we buffer tasks and flush them
 * in a single multi-row INSERT every `intervalMs` or when the buffer
 * reaches `batchSize` — whichever comes first.
 *
 * Safety guarantees:
 *   - Failed batch inserts fall back to individual inserts
 *   - Failed individual inserts are re-queued with a buffer cap
 *   - `stopped` flag rejects adds after shutdown
 *   - `maxBufferSize` prevents OOM under sustained DB failure
 *   - Flush is single-pass (no drain loop) to prevent infinite retry loops
 *   - onFlushSuccess / onFlushFailure callbacks feed the circuit breaker
 */

export interface BatchTaskRow {
  id: string;
  externalId: string;
  source: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  reporterId: string | null;
  countryCode: string | null;
  tags: string[];
  externalUrl: string | null;
  snoozedUntil: Date | null;
  escalatedTo: string | null;
  resolvedAt: Date | null;
  sourceCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchTaskInserterCallbacks {
  onFlushSuccess?: (count: number) => void;
  onFlushFailure?: (count: number, err: Error) => void;
}

export class BatchTaskInserter {
  private buffer: BatchTaskRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private stopped = false;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly maxBufferSize: number;
  private readonly callbacks: BatchTaskInserterCallbacks;

  constructor(private readonly pool: Pool, callbacks?: BatchTaskInserterCallbacks) {
    this.batchSize = config.WEBHOOK_BATCH_SIZE;
    this.intervalMs = config.WEBHOOK_BATCH_INTERVAL_MS;
    this.maxBufferSize = 10_000;
    this.callbacks = callbacks || {};
    this.startTimer();
  }

  /**
   * Add a task to the buffer. Flushes if buffer reaches batchSize.
   * Throws if the inserter is shut down or buffer is full (provides backpressure to BullMQ).
   */
  async add(row: BatchTaskRow): Promise<void> {
    if (this.stopped) {
      throw new Error('BatchTaskInserter is shut down — cannot accept new rows');
    }

    if (this.buffer.length >= this.maxBufferSize) {
      logger.error('BatchTaskInserter buffer full, rejecting row', {
        externalId: row.externalId,
        source: row.source,
        bufferSize: this.buffer.length,
      });
      throw new Error('BatchTaskInserter buffer full — backpressure');
    }

    this.buffer.push(row);

    if (this.buffer.length >= this.batchSize && !this.flushing) {
      await this.flush();
    }
  }

  /**
   * Flush ONE batch from the buffer.
   *
   * Deliberately single-pass: takes up to `batchSize` rows and inserts them.
   * Does NOT loop to drain the entire buffer — this prevents an infinite retry
   * loop when the DB is down (re-queued rows would be re-processed immediately).
   * Remaining rows are picked up by the next timer tick or next add().
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;

    this.flushing = true;
    try {
      const batch = this.buffer.splice(0, this.batchSize);
      try {
        await this.insertBatch(batch);
        logger.debug('Batch flush completed', { count: batch.length });
        this.callbacks.onFlushSuccess?.(batch.length);
      } catch (err) {
        logger.error('Batch insert failed, retrying individually', {
          count: batch.length,
          err: (err as Error).message,
        });
        this.callbacks.onFlushFailure?.(batch.length, err as Error);

        // Fallback: insert one by one so partial failures don't lose the whole batch
        await this.insertIndividuallyWithRequeue(batch);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Build and execute a multi-row INSERT. */
  private async insertBatch(rows: BatchTaskRow[]): Promise<void> {
    if (rows.length === 0) return;

    const COLS = 18;
    const placeholders: string[] = [];
    const values: unknown[] = [];

    for (let i = 0; i < rows.length; i++) {
      const offset = i * COLS;
      const row = rows[i];
      placeholders.push(
        `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13},$${offset + 14},$${offset + 15},$${offset + 16},$${offset + 17},$${offset + 18})`,
      );
      values.push(
        row.id, row.externalId, row.source, row.subject, row.description,
        row.status, row.priority, row.assigneeId, row.reporterId, row.countryCode,
        row.tags, row.externalUrl, row.snoozedUntil, row.escalatedTo,
        row.resolvedAt, row.sourceCreatedAt, row.createdAt, row.updatedAt,
      );
    }

    const sql = `
      INSERT INTO tasks (
        id, external_id, source, subject, description, status, priority,
        assignee_id, reporter_id, country_code, tags, external_url,
        snoozed_until, escalated_to, resolved_at, source_created_at, created_at, updated_at
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (external_id, source) DO NOTHING
    `;

    await this.pool.query(sql, values);
  }

  /**
   * Fallback: insert rows one by one. Re-queues failed rows back into the buffer
   * (with cap check) so they can be retried on the NEXT flush cycle (not immediately).
   */
  private async insertIndividuallyWithRequeue(rows: BatchTaskRow[]): Promise<void> {
    let succeeded = 0;
    let failed = 0;
    const failedRows: BatchTaskRow[] = [];

    for (const row of rows) {
      try {
        await this.pool.query(
          `INSERT INTO tasks (
            id, external_id, source, subject, description, status, priority,
            assignee_id, reporter_id, country_code, tags, external_url,
            snoozed_until, escalated_to, resolved_at, source_created_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (external_id, source) DO NOTHING`,
          [
            row.id, row.externalId, row.source, row.subject, row.description,
            row.status, row.priority, row.assigneeId, row.reporterId, row.countryCode,
            row.tags, row.externalUrl, row.snoozedUntil, row.escalatedTo,
            row.resolvedAt, row.sourceCreatedAt, row.createdAt, row.updatedAt,
          ],
        );
        succeeded++;
      } catch (err) {
        failed++;
        failedRows.push(row);
        logger.error('Individual insert failed', {
          externalId: row.externalId,
          source: row.source,
          err: (err as Error).message,
        });
      }
    }

    // Re-queue failed rows for retry on NEXT flush (not this one)
    if (failedRows.length > 0) {
      const spaceAvailable = this.maxBufferSize - this.buffer.length;
      if (spaceAvailable >= failedRows.length) {
        this.buffer.push(...failedRows);
        logger.warn('Re-queued failed rows for retry', { requeued: failedRows.length });
      } else {
        const canRequeue = Math.max(0, spaceAvailable);
        if (canRequeue > 0) this.buffer.push(...failedRows.slice(0, canRequeue));
        logger.error('Buffer near capacity, dropped failed rows', {
          requeued: canRequeue,
          dropped: failedRows.length - canRequeue,
        });
      }
    }

    if (succeeded > 0) {
      this.callbacks.onFlushSuccess?.(succeeded);
    }
    if (failed > 0) {
      logger.warn('Batch fallback results', { succeeded, failed, requeued: failedRows.length });
    }
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error('Periodic flush failed', { err: (err as Error).message });
      });
    }, this.intervalMs);
  }

  /**
   * Flush remaining rows and stop the timer. Called during shutdown.
   * Waits for any in-flight flush to complete before doing a final flush.
   */
  async shutdown(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Wait for any in-flight flush to complete
    const deadline = Date.now() + 10_000;
    while (this.flushing && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Final flush — keep flushing until buffer is empty or all inserts fail
    this.flushing = false;
    let attempts = 0;
    const maxAttempts = 3;
    while (this.buffer.length > 0 && attempts < maxAttempts) {
      attempts++;
      this.flushing = false; // reset for each attempt
      await this.flush();
    }

    if (this.buffer.length > 0) {
      logger.error('BatchTaskInserter shutdown with unflushed rows', { remaining: this.buffer.length });
    } else {
      logger.info('BatchTaskInserter shut down cleanly');
    }
  }

  /** Current buffer size for monitoring */
  get bufferSize(): number {
    return this.buffer.length;
  }
}
