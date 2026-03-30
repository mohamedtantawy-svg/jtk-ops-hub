import { Job } from 'bullmq';
import { WebhookJobProcessor } from '../infrastructure/queue/WebhookProcessor';
import { DedupCache } from '../infrastructure/cache/DedupCache';
import { BatchTaskInserter, BatchTaskRow } from '../infrastructure/persistence/BatchTaskInserter';
import { CircuitBreaker, CircuitOpenError } from '../infrastructure/resilience/CircuitBreaker';
import { WebhookJobData, WebhookJobResult } from '../infrastructure/queue/WebhookQueue';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock Redis (DedupCache uses it)
jest.mock('../infrastructure/redis/connection', () => ({
  getRedis: () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  }),
  createRedisConnection: jest.fn(),
  closeRedis: jest.fn(),
}));

// Mock EventBus
jest.mock('../domain/shared/EventBus', () => ({
  eventBus: {
    dispatch: jest.fn().mockResolvedValue(undefined),
  },
}));

function makeJob(data: Partial<WebhookJobData> = {}): Job<WebhookJobData> {
  return {
    id: 'job-1',
    data: {
      source: 'zapier',
      payload: {
        source: 'zendesk',
        externalId: 'ticket-123',
        subject: 'Test ticket',
        description: 'Test description',
        priority: 'high',
        tags: ['urgent'],
      },
      receivedAt: new Date().toISOString(),
      ...data,
    },
  } as any;
}

describe('WebhookJobProcessor', () => {
  let processor: WebhookJobProcessor;
  let dedupCache: DedupCache;
  let batchInserter: { add: jest.Mock; shutdown: jest.Mock; bufferSize: number };
  let circuit: CircuitBreaker;

  beforeEach(() => {
    dedupCache = new DedupCache(60);
    batchInserter = {
      add: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      bufferSize: 0,
    };
    circuit = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 500 });
    processor = new WebhookJobProcessor(dedupCache, batchInserter as any, circuit);
  });

  describe('happy path', () => {
    it('should normalize Zapier payload and add to batch inserter', async () => {
      const result = await processor.process(makeJob());

      expect(result.taskId).toBeDefined();
      expect(result.skipped).toBeUndefined();
      expect(batchInserter.add).toHaveBeenCalledTimes(1);

      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.source).toBe('zendesk'); // from payload.source, not 'zapier'
      expect(row.externalId).toBe('ticket-123');
      expect(row.subject).toBe('Test ticket');
      expect(row.priority).toBe('high');
      expect(row.status).toBe('open');
      expect(row.tags).toEqual(['urgent']);
    });

    it('should set dedup cache AFTER successful add', async () => {
      const setSpy = jest.spyOn(dedupCache, 'set');
      const getSpy = jest.spyOn(dedupCache, 'get');

      await processor.process(makeJob());

      // get called first (read-only check)
      expect(getSpy).toHaveBeenCalledTimes(1);
      // add called before set
      expect(batchInserter.add).toHaveBeenCalledTimes(1);
      // set called after add
      expect(setSpy).toHaveBeenCalledTimes(1);

      // Verify ordering: add was called before set
      const addCallOrder = batchInserter.add.mock.invocationCallOrder[0];
      const setCallOrder = setSpy.mock.invocationCallOrder[0];
      expect(addCallOrder).toBeLessThan(setCallOrder);
    });
  });

  describe('dedup', () => {
    it('should skip if dedup cache returns a cached taskId', async () => {
      jest.spyOn(dedupCache, 'get').mockResolvedValue('existing-task-id');

      const result = await processor.process(makeJob());

      expect(result.skipped).toBe(true);
      expect(result.taskId).toBe('existing-task-id');
      expect(batchInserter.add).not.toHaveBeenCalled();
    });
  });

  describe('circuit breaker', () => {
    it('should throw CircuitOpenError when circuit is OPEN', async () => {
      // Force circuit open
      for (let i = 0; i < 3; i++) {
        await circuit.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      await expect(processor.process(makeJob())).rejects.toThrow('OPEN');
      expect(batchInserter.add).not.toHaveBeenCalled();
    });

    it('should NOT set dedup cache when circuit is OPEN', async () => {
      const setSpy = jest.spyOn(dedupCache, 'set');
      for (let i = 0; i < 3; i++) {
        await circuit.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      await processor.process(makeJob()).catch(() => {});

      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('buffer full (backpressure)', () => {
    it('should NOT set dedup cache when add() throws', async () => {
      batchInserter.add.mockRejectedValue(new Error('buffer full'));
      const setSpy = jest.spyOn(dedupCache, 'set');

      await expect(processor.process(makeJob())).rejects.toThrow('buffer full');
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('payload normalization', () => {
    it('should reject invalid payloads', async () => {
      const job = makeJob({
        source: 'zapier',
        payload: { source: 'zendesk', subject: 'Test' }, // missing externalId
      });

      const result = await processor.process(job);
      expect(result.skipped).toBe(true);
      expect(result.error).toBe('Invalid payload');
    });

    it('should reject invalid source in Zapier payload', async () => {
      const job = makeJob({
        source: 'zapier',
        payload: { source: 'invalid_source', externalId: '123', subject: 'Test' },
      });

      const result = await processor.process(job);
      expect(result.skipped).toBe(true);
    });

    it('should normalize Zendesk payload', async () => {
      const job = makeJob({
        source: 'zendesk',
        payload: {
          ticket: {
            id: 12345,
            subject: 'Zendesk ticket',
            description: 'Ticket body',
            priority: 'HIGH',
            tags: ['billing', 123], // 123 should be filtered (not a string)
            created_at: '2024-01-01T00:00:00Z',
          },
        },
      });

      const result = await processor.process(job);
      expect(result.taskId).toBeDefined();

      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.source).toBe('zendesk');
      expect(row.externalId).toBe('12345');
      expect(row.subject).toBe('Zendesk ticket');
      expect(row.priority).toBe('high');
      expect(row.tags).toEqual(['billing']); // number filtered out
      expect(row.externalUrl).toContain('12345');
    });

    it('should reject Zendesk payload with missing ticket.id', async () => {
      const job = makeJob({
        source: 'zendesk',
        payload: { ticket: { subject: 'No ID' } },
      });

      const result = await processor.process(job);
      expect(result.skipped).toBe(true);
    });

    it('should normalize Jira payload', async () => {
      const job = makeJob({
        source: 'jira',
        payload: {
          issue: {
            key: 'OPS-123',
            fields: {
              summary: 'Jira issue',
              description: 'Issue body',
              priority: { name: 'Critical' },
              labels: ['ops', 'urgent'],
              created: '2024-01-01T00:00:00Z',
            },
          },
        },
      });

      const result = await processor.process(job);
      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.source).toBe('jira');
      expect(row.externalId).toBe('OPS-123');
      expect(row.priority).toBe('critical');
    });

    it('should reject Jira payload with non-object issue', async () => {
      const job = makeJob({
        source: 'jira',
        payload: { issue: 'not-an-object' },
      });

      const result = await processor.process(job);
      expect(result.skipped).toBe(true);
    });

    it('should normalize Slack payload', async () => {
      const job = makeJob({
        source: 'slack',
        payload: {
          event: {
            type: 'app_mention',
            ts: '1704067200.000100',
            text: '<@U123> please help with this task',
            user: 'U456',
          },
        },
      });

      const result = await processor.process(job);
      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.source).toBe('slack');
      expect(row.externalId).toBe('1704067200.000100');
      expect(row.priority).toBe('medium');
    });

    it('should reject Slack event without ts', async () => {
      const job = makeJob({
        source: 'slack',
        payload: { event: { type: 'app_mention', text: 'help' } }, // no ts
      });

      const result = await processor.process(job);
      expect(result.skipped).toBe(true);
    });

    it('should default invalid priority to medium', async () => {
      const job = makeJob({
        source: 'zapier',
        payload: {
          source: 'zendesk',
          externalId: '123',
          subject: 'Test',
          priority: 'SUPER_URGENT', // invalid
        },
      });

      const result = await processor.process(job);
      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.priority).toBe('medium');
    });

    it('should sanitize URLs — reject non-http', async () => {
      const job = makeJob({
        source: 'zapier',
        payload: {
          source: 'zendesk',
          externalId: '123',
          subject: 'Test',
          externalUrl: 'javascript:alert(1)',
        },
      });

      await processor.process(job);
      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.externalUrl).toBeNull();
    });

    it('should truncate subject to 255 chars and description to 50K', async () => {
      const job = makeJob({
        source: 'zapier',
        payload: {
          source: 'zendesk',
          externalId: '123',
          subject: 'A'.repeat(500),
          description: 'B'.repeat(100_000),
        },
      });

      await processor.process(job);
      const row: BatchTaskRow = batchInserter.add.mock.calls[0][0];
      expect(row.subject.length).toBe(255);
      expect(row.description.length).toBe(50_000);
    });

    it('should handle unknown source', async () => {
      const job = makeJob({
        source: 'unknown' as any,
        payload: { foo: 'bar' },
      });

      const result = await processor.process(job);
      expect(result.skipped).toBe(true);
    });
  });
});
