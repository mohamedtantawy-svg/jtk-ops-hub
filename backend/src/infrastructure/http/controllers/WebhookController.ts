import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { CreateTaskHandler } from '../../../application/task/handlers/CreateTaskHandler';
import { UpdateTaskStatusHandler } from '../../../application/task/handlers/UpdateTaskStatusHandler';
import { getWebhookQueue, WebhookJobData } from '../../queue/WebhookQueue';
import { TASK_SOURCES } from '../../../domain/task/TaskSource';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/logger';

/**
 * WebhookController — high-throughput webhook ingest.
 *
 * Strategy:
 *   1. Validate signature / auth (fast, no I/O)
 *   2. Basic payload shape check (fast)
 *   3. Enqueue into BullMQ Redis queue → return 202 Accepted immediately
 *   4. Background worker processes the job (dedup, batch insert, events)
 *
 * This ensures webhook responses are <50ms regardless of DB load.
 * Zapier expects responses within 30s — we respond in milliseconds.
 */
export class WebhookController {
  constructor(
    private readonly createTask: CreateTaskHandler,
    private readonly updateStatus: UpdateTaskStatusHandler,
  ) {}

  // ── Zendesk ───────────────────────────────────────────────────────────────

  zendesk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers['x-zendesk-webhook-signature'];
      if (!signature) {
        res.status(401).json({ error: 'Missing signature header' });
        return;
      }

      let signatureValid: boolean;
      try {
        signatureValid = this.verifyZendeskSignature(req, signature as string);
      } catch {
        res.status(400).json({ error: 'Malformed signature' });
        return;
      }

      if (!signatureValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const { ticket } = req.body;
      if (!ticket) {
        res.sendStatus(200);
        return;
      }

      if (typeof ticket !== 'object' || ticket === null) {
        res.status(400).json({ error: 'Malformed payload' });
        return;
      }

      // ── Enqueue for async processing ─────────────────────────────────
      await this.enqueue('zendesk', req.body);
      res.status(202).json({ ok: true, queued: true });
    } catch (err) {
      next(err);
    }
  };

  // ── Jira ──────────────────────────────────────────────────────────────────

  jira = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Malformed payload' });
        return;
      }

      const { issue, webhookEvent } = body;
      if (!issue || webhookEvent !== 'jira:issue_created') {
        res.sendStatus(200);
        return;
      }

      // ── Enqueue for async processing ─────────────────────────────────
      await this.enqueue('jira', body);
      res.status(202).json({ ok: true, queued: true });
    } catch (err) {
      next(err);
    }
  };

  // ── Slack events ──────────────────────────────────────────────────────────

  slack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Malformed payload' });
        return;
      }

      // Slack URL verification challenge — must respond synchronously
      if (body.type === 'url_verification') {
        res.json({ challenge: body.challenge });
        return;
      }

      const event = body.event;
      if (event?.type === 'app_mention') {
        await this.enqueue('slack', body);
        res.status(202).json({ ok: true, queued: true });
        return;
      }

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  };

  // ── Zapier (generic ingest) ──────────────────────────────────────────────

  zapier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const integrationId = (req.params as Record<string, string>).integrationId ?? 'default';

      // Verify shared secret (passed as Bearer token or X-Zapier-Secret header)
      const secret = config.ZAPIER_WEBHOOK_SECRET;
      if (secret) {
        const authHeader = req.headers.authorization ?? '';
        const auth = authHeader.toLowerCase().startsWith('bearer ')
          ? authHeader.slice(7).trim()
          : (req.headers['x-zapier-secret'] as string | undefined) ?? '';
        if (!auth || !this.timingSafeEquals(auth, secret)) {
          res.status(401).json({ error: 'Invalid webhook secret' });
          return;
        }
      }
      // Warning for missing secret is logged once at startup in server.ts

      const body = req.body;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Malformed payload' });
        return;
      }

      // ── Quick validation before enqueue (fail fast on obviously bad payloads)
      const source = String(body.source ?? '').toLowerCase().trim();
      const externalId = String(body.externalId ?? body.external_id ?? body.ticketId ?? body.ticket_id ?? '').trim();
      const subject = String(body.subject || body.title || body.summary || '').trim();

      if (!source || !externalId || !subject) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['source', 'externalId', 'subject'],
          received: { source: !!source, externalId: !!externalId, subject: !!subject },
        });
        return;
      }

      if (!TASK_SOURCES.includes(source as any)) {
        res.status(400).json({
          error: `Invalid source: "${source}"`,
          validSources: [...TASK_SOURCES],
        });
        return;
      }

      // ── Enqueue for async processing ─────────────────────────────────
      await this.enqueue('zapier', body, integrationId);

      logger.info('Zapier webhook accepted', { source, externalId, integrationId });
      res.status(202).json({ ok: true, queued: true, integrationId });
    } catch (err) {
      next(err);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Enqueue a webhook payload into the BullMQ queue.
   * Returns immediately — processing happens in the background worker.
   */
  private async enqueue(source: WebhookJobData['source'], payload: Record<string, unknown>, integrationId?: string): Promise<void> {
    const queue = getWebhookQueue();
    await queue.add(
      `${source}-ingest`,
      {
        source,
        integrationId,
        payload,
        receivedAt: new Date().toISOString(),
      },
      {
        // Use externalId as dedup key within BullMQ itself (within 1h window)
        // This prevents the same job being added twice if Zapier retries
        jobId: this.extractJobId(source, payload),
      },
    );
  }

  /**
   * Extract a deterministic job ID for BullMQ dedup.
   * If the same source + externalId is sent twice, BullMQ silently skips it.
   */
  private extractJobId(source: string, payload: Record<string, unknown>): string | undefined {
    let externalId: string | undefined;

    switch (source) {
      case 'zendesk': {
        const ticket = payload.ticket as Record<string, any> | undefined;
        externalId = ticket?.id ? String(ticket.id) : undefined;
        break;
      }
      case 'jira': {
        const issue = payload.issue as Record<string, any> | undefined;
        externalId = issue?.key ? String(issue.key) : undefined;
        break;
      }
      case 'slack': {
        const event = payload.event as Record<string, any> | undefined;
        externalId = event?.ts ? String(event.ts) : undefined;
        break;
      }
      case 'zapier': {
        externalId = String(
          payload.externalId ?? payload.external_id ?? payload.ticketId ?? payload.ticket_id ?? '',
        ).trim() || undefined;
        break;
      }
    }

    // Deterministic job ID = source:externalId (BullMQ dedup within removeOnComplete window)
    return externalId ? `${source}:${externalId}` : undefined;
  }

  private timingSafeEquals(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }

  private verifyZendeskSignature(req: Request, signature: string): boolean {
    if (!config.ZENDESK_WEBHOOK_SECRET) return true;
    const expected = crypto
      .createHmac('sha256', config.ZENDESK_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('base64');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }
}
