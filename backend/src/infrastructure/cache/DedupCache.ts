import { getRedis } from '../redis/connection';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

/**
 * Redis-backed dedup cache for webhook events.
 *
 * Before hitting the DB, we check Redis for `dedup:{source}:{externalId}`.
 * If the key exists, the event was already processed → skip the DB round-trip.
 *
 * 500K events/month ≈ 500K keys × ~100 bytes ≈ ~50 MB Redis memory.
 * TTL of 1 hour (default) prevents stale entries from accumulating.
 *
 * IMPORTANT: The dedup cache is set AFTER the row is successfully buffered
 * for batch insert (in WebhookProcessor), not before. This prevents the case
 * where the cache says "processed" but the DB never received the row.
 */
export class DedupCache {
  private readonly prefix = 'dedup';
  private readonly ttl: number;

  constructor(ttlSecs?: number) {
    this.ttl = ttlSecs ?? config.DEDUP_CACHE_TTL_SECS;
  }

  private key(source: string, externalId: string): string {
    // Sanitize to prevent key injection — replace colons/newlines
    const safeSource = source.replace(/[:\n\r]/g, '_');
    const safeId = externalId.replace(/[:\n\r]/g, '_').substring(0, 512);
    return `${this.prefix}:${safeSource}:${safeId}`;
  }

  /**
   * Check if an event has already been processed (read-only).
   * Returns the cached taskId if it exists, or null if not cached.
   */
  async get(source: string, externalId: string): Promise<string | null> {
    try {
      const redis = getRedis();
      return await redis.get(this.key(source, externalId));
    } catch (err) {
      // Cache miss on Redis failure — fall through to DB check
      logger.warn('DedupCache.get failed, falling through to DB', {
        source, externalId, err: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Mark an event as processed by caching its taskId.
   * Called AFTER the row is successfully buffered for batch insert.
   * Uses SET NX to avoid overwriting an existing entry from a concurrent worker.
   */
  async set(source: string, externalId: string, taskId: string): Promise<void> {
    try {
      const redis = getRedis();
      // SET NX EX — only set if not already exists, with TTL
      await redis.set(this.key(source, externalId), taskId, 'EX', this.ttl, 'NX');
    } catch (err) {
      // Non-fatal — DB constraint (ON CONFLICT) still prevents duplicates
      logger.warn('DedupCache.set failed', {
        source, externalId, err: (err as Error).message,
      });
    }
  }
}
