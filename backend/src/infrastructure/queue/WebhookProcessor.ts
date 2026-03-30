import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { WebhookJobData, WebhookJobResult } from './WebhookQueue';
import { DedupCache } from '../cache/DedupCache';
import { BatchTaskInserter, BatchTaskRow } from '../persistence/BatchTaskInserter';
import { CircuitBreaker, CircuitOpenError } from '../resilience/CircuitBreaker';
import { TASK_SOURCES } from '../../domain/task/TaskSource';
import { TASK_PRIORITIES } from '../../domain/task/TaskPriority';
import { eventBus } from '../../domain/shared/EventBus';
import { TaskCreated } from '../../domain/task/events/TaskCreated';
import { logger } from '../../shared/logger';

/**
 * Processes webhook jobs from the BullMQ queue.
 *
 * Flow per job:
 *   1. Normalize payload fields
 *   2. Check Redis dedup cache — if cached, return immediately (0 DB cost)
 *   3. Circuit breaker check — fail fast if DB is down
 *   4. Add row to BatchTaskInserter (buffer → batch INSERT)
 *   5. ONLY after successful add → set dedup cache entry
 *   6. Dispatch domain event (fire-and-forget)
 *
 * Key safety property: dedup cache is set AFTER the row is buffered,
 * not before. If the add fails, the dedup cache is NOT set, allowing retries.
 */
export class WebhookJobProcessor {
  constructor(
    private readonly dedupCache: DedupCache,
    private readonly batchInserter: BatchTaskInserter,
    private readonly dbCircuit: CircuitBreaker,
  ) {}

  /** BullMQ processor function */
  process = async (job: Job<WebhookJobData>): Promise<WebhookJobResult> => {
    const { source, payload, integrationId } = job.data;

    try {
      // ── 1. Normalize payload fields ────────────────────────────────────
      const normalized = this.normalizePayload(source, payload);
      if (!normalized) {
        logger.warn('Webhook job: invalid payload, skipping', { jobId: job.id, source });
        return { skipped: true, error: 'Invalid payload' };
      }

      const { externalId, subject, description, priority, tags, externalUrl, sourceCreatedAt, assigneeId, reporterId, countryCode } = normalized;

      // ── 2. Dedup check (Redis read-only) ───────────────────────────────
      // Only READ the cache here — do NOT set it yet.
      // Setting happens AFTER successful buffer add to prevent data loss.
      const taskId = uuidv4();
      const cached = await this.dedupCache.get(normalized.source || source, externalId);
      if (cached) {
        logger.debug('Webhook job: duplicate, skipping', { jobId: job.id, source, externalId, cachedTaskId: cached });
        return { taskId: cached, skipped: true };
      }

      // ── 3. Circuit breaker — fail fast if DB is known to be down ───────
      // Check circuit state before buffering, so we don't fill the buffer
      // with rows that can't be flushed.
      const circuitState = this.dbCircuit.getState();
      if (circuitState === 'OPEN') {
        throw new CircuitOpenError(this.dbCircuit.name);
      }

      // ── 4. Buffer the row for batch insert ─────────────────────────────
      const taskSource = normalized.source || source;
      const now = new Date();
      const row: BatchTaskRow = {
        id: taskId,
        externalId,
        source: taskSource,
        subject: subject.substring(0, 255),
        description: description.substring(0, 50_000),
        status: 'open',
        priority,
        assigneeId,
        reporterId,
        countryCode,
        tags,
        externalUrl,
        snoozedUntil: null,
        escalatedTo: null,
        resolvedAt: null,
        sourceCreatedAt,
        createdAt: now,
        updatedAt: now,
      };

      await this.batchInserter.add(row);

      // ── 5. Set dedup cache AFTER successful buffer add ─────────────────
      // If add() threw (buffer full, shutdown), we do NOT set the cache,
      // so BullMQ will retry the job and the event is not lost.
      await this.dedupCache.set(taskSource, externalId, taskId);

      // ── 6. Dispatch domain event (non-blocking) ──────────────────────
      eventBus.dispatch([new TaskCreated(taskId, taskSource, assigneeId)]).catch((err) => {
        logger.warn('Domain event dispatch failed', { taskId, err: (err as Error).message });
      });

      logger.info('Webhook job: task queued for insert', {
        jobId: job.id,
        taskId,
        source: taskSource,
        externalId,
        integrationId,
      });

      return { taskId };
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Webhook job processing failed', { jobId: job.id, source, error: message });
      throw err; // BullMQ will retry based on job options
    }
  };

  // ── Payload normalization ────────────────────────────────────────────────

  private normalizePayload(source: string, payload: Record<string, unknown>): NormalizedTask | null {
    switch (source) {
      case 'zendesk': return this.normalizeZendesk(payload);
      case 'jira':    return this.normalizeJira(payload);
      case 'slack':   return this.normalizeSlack(payload);
      case 'zapier':  return this.normalizeZapier(payload);
      default:
        logger.warn('Unknown webhook source', { source });
        return null;
    }
  }

  private normalizeZendesk(payload: Record<string, unknown>): NormalizedTask | null {
    const ticket = payload.ticket as Record<string, any> | undefined;
    if (!ticket || typeof ticket !== 'object') return null;

    const ticketId = ticket.id;
    if (ticketId === undefined || ticketId === null) return null; // Guard against "undefined" string

    return {
      source: 'zendesk',
      externalId: String(ticketId),
      subject: ticket.title ?? ticket.subject ?? '(no subject)',
      description: ticket.description ?? '',
      priority: this.normalizePriority(ticket.priority),
      assigneeId: null,
      reporterId: null,
      countryCode: null,
      tags: Array.isArray(ticket.tags) ? ticket.tags.filter((t: unknown) => typeof t === 'string') : [],
      externalUrl: ticketId ? `https://deel.zendesk.com/agent/tickets/${ticketId}` : null,
      sourceCreatedAt: this.parseDate(ticket.created_at),
    };
  }

  private normalizeJira(payload: Record<string, unknown>): NormalizedTask | null {
    const issue = payload.issue as Record<string, any> | undefined;
    if (!issue || typeof issue !== 'object') return null; // Added typeof check

    const issueKey = issue.key ?? issue.id;
    if (issueKey === undefined || issueKey === null) return null;

    return {
      source: 'jira',
      externalId: String(issueKey),
      subject: issue.fields?.summary ?? '',
      description: issue.fields?.description ?? '',
      priority: this.normalizePriority(issue.fields?.priority?.name),
      assigneeId: null,
      reporterId: null,
      countryCode: null,
      tags: Array.isArray(issue.fields?.labels) ? issue.fields.labels : [],
      externalUrl: issue.key ? `https://deel.atlassian.net/browse/${issue.key}` : null,
      sourceCreatedAt: this.parseDate(issue.fields?.created),
    };
  }

  private normalizeSlack(payload: Record<string, unknown>): NormalizedTask | null {
    const event = payload.event as Record<string, any> | undefined;
    if (!event || event.type !== 'app_mention') return null;

    // event.ts is always present for Slack events — but guard anyway
    const ts = event.ts;
    if (!ts) return null; // Don't use Date.now() fallback — defeats dedup

    return {
      source: 'slack',
      externalId: String(ts),
      subject: `Slack mention: ${(event.text ?? '').substring(0, 80)}`,
      description: event.text ?? '',
      priority: 'medium',
      assigneeId: null,
      reporterId: event.user ?? null,
      countryCode: null,
      tags: [],
      externalUrl: null,
      sourceCreatedAt: new Date(parseFloat(ts) * 1000),
    };
  }

  private normalizeZapier(payload: Record<string, unknown>): NormalizedTask | null {
    const source = String(payload.source ?? '').toLowerCase().trim();
    const externalId = String(
      payload.externalId ?? payload.external_id ?? payload.ticketId ?? payload.ticket_id ?? '',
    ).trim();
    const subject = String(payload.subject || payload.title || payload.summary || '').trim();

    if (!source || !externalId || !subject) return null;

    // Validate source against domain whitelist
    if (!TASK_SOURCES.includes(source as any)) return null;

    // Sanitize URL — only allow http(s)
    const rawUrl = payload.externalUrl || payload.external_url || payload.url || payload.link;
    const externalUrl = rawUrl && /^https?:\/\//i.test(String(rawUrl))
      ? String(rawUrl).substring(0, 2048)
      : null;

    // Tags
    const rawTags = Array.isArray(payload.tags)
      ? (payload.tags as unknown[]).filter((t): t is string => typeof t === 'string').map(t => t.trim())
      : (payload.tags ? String(payload.tags).split(',').map(t => t.trim()) : []);

    return {
      source, // Use the actual source from the Zapier payload, not 'zapier'
      externalId,
      subject,
      description: String(payload.description || payload.body || '').substring(0, 50_000),
      priority: this.normalizePriority(payload.priority),
      assigneeId: (payload.assigneeId || payload.assignee_id || null) as string | null,
      reporterId: (payload.reporterId || payload.reporter_id || payload.requesterName || payload.requester_name || null) as string | null,
      countryCode: (payload.country || payload.countryCode || payload.country_code || null) as string | null,
      tags: rawTags.filter(Boolean),
      externalUrl,
      sourceCreatedAt: this.parseDate(payload.createdAt),
    };
  }

  private normalizePriority(raw: unknown): string {
    const val = String(raw || 'medium').toLowerCase().trim();
    return (TASK_PRIORITIES as readonly string[]).includes(val) ? val : 'medium';
  }

  private parseDate(raw: unknown): Date {
    if (!raw) return new Date();
    const parsed = new Date(raw as string);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}

interface NormalizedTask {
  source: string;
  externalId: string;
  subject: string;
  description: string;
  priority: string;
  assigneeId: string | null;
  reporterId: string | null;
  countryCode: string | null;
  tags: string[];
  externalUrl: string | null;
  sourceCreatedAt: Date;
}
