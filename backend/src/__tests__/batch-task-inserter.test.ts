import { BatchTaskInserter, BatchTaskRow } from '../infrastructure/persistence/BatchTaskInserter';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<BatchTaskRow> = {}): BatchTaskRow {
  const now = new Date();
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    source: 'zendesk',
    subject: 'Test task',
    description: 'Test description',
    status: 'open',
    priority: 'medium',
    assigneeId: null,
    reporterId: null,
    countryCode: null,
    tags: [],
    externalUrl: null,
    snoozedUntil: null,
    escalatedTo: null,
    resolvedAt: null,
    sourceCreatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockPool(queryFn?: jest.Mock) {
  return {
    query: queryFn || jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  } as any;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BatchTaskInserter', () => {
  let inserter: BatchTaskInserter;
  let mockQuery: jest.Mock;

  afterEach(async () => {
    if (inserter) await inserter.shutdown();
  });

  describe('add() basics', () => {
    it('should buffer rows without flushing when below batchSize', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      await inserter.add(makeRow());
      await inserter.add(makeRow());

      // batchSize is 5, so no flush yet
      expect(mockQuery).not.toHaveBeenCalled();
      expect(inserter.bufferSize).toBe(2);
    });

    it('should flush when buffer reaches batchSize', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      for (let i = 0; i < 5; i++) {
        await inserter.add(makeRow());
      }

      // Should have flushed once with 5 rows
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(inserter.bufferSize).toBe(0);
    });

    it('should reject adds after shutdown', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));
      await inserter.shutdown();

      await expect(inserter.add(makeRow())).rejects.toThrow('shut down');
    });

    it('should reject adds when buffer is full', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      // Fill buffer to maxBufferSize (10_000) — but that's too many for a test.
      // We'll test the mechanism by checking the error message pattern.
      // Instead, let's add rows while flush is stuck to verify backpressure.
      // For simplicity, test that the error is thrown with the right message.
      const row = makeRow();
      // Access private field for testing — not ideal but necessary
      (inserter as any).maxBufferSize = 3;
      await inserter.add(row);
      await inserter.add(makeRow());
      await inserter.add(makeRow());

      await expect(inserter.add(makeRow())).rejects.toThrow('buffer full');
    });
  });

  describe('flush() behavior', () => {
    it('should build correct multi-row INSERT with ON CONFLICT', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      const row1 = makeRow({ externalId: 'ext-1', source: 'zendesk' });
      const row2 = makeRow({ externalId: 'ext-2', source: 'jira' });
      await inserter.add(row1);
      await inserter.add(row2);
      await inserter.flush();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO tasks');
      expect(sql).toContain('ON CONFLICT (external_id, source) DO NOTHING');
      // Should have 2 rows × 18 cols = 36 parameters
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toHaveLength(36);
    });

    it('should guard against concurrent flushes via flushing flag', async () => {
      jest.useFakeTimers();
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      // Add rows below batchSize so we control when flush happens
      await inserter.add(makeRow());
      await inserter.add(makeRow());
      expect(mockQuery).not.toHaveBeenCalled();

      // First flush
      await inserter.flush();
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(inserter.bufferSize).toBe(0);

      // Add more and double-flush synchronously
      await inserter.add(makeRow());
      const flush1 = inserter.flush();
      const flush2 = inserter.flush(); // flushing=true, should return immediately

      await flush1;
      await flush2;

      // Only 1 additional query — second flush was no-op
      expect(mockQuery).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('should be single-pass (no infinite loop on DB failure)', async () => {
      jest.useFakeTimers();
      mockQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      for (let i = 0; i < 5; i++) {
        await inserter.add(makeRow());
      }

      // Flush should complete (not loop forever)
      // Batch insert fails → individual inserts all fail → rows re-queued
      // Use manual flush (timer is frozen with fake timers)
      mockQuery.mockClear();
      await inserter.flush();

      // 1 batch attempt + 5 individual attempts = 6 queries
      expect(mockQuery).toHaveBeenCalledTimes(6);
      // Rows should be re-queued
      expect(inserter.bufferSize).toBe(5);
      jest.useRealTimers();
    });
  });

  describe('fallback and re-queue', () => {
    it('should fall back to individual inserts when batch fails', async () => {
      let callCount = 0;
      mockQuery = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('batch too large'));
        return Promise.resolve({ rows: [] });
      });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      for (let i = 0; i < 3; i++) {
        await inserter.add(makeRow());
      }
      await inserter.flush();

      // 1 batch (failed) + 3 individual (succeeded)
      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(inserter.bufferSize).toBe(0);
    });

    it('should re-queue individually failed rows', async () => {
      let callCount = 0;
      mockQuery = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('batch fail'));
        if (callCount === 3) return Promise.reject(new Error('individual fail'));
        return Promise.resolve({ rows: [] });
      });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      for (let i = 0; i < 3; i++) {
        await inserter.add(makeRow());
      }
      await inserter.flush();

      // 1 batch fail + 3 individual (1 fail, 2 success) = 4 queries
      expect(mockQuery).toHaveBeenCalledTimes(4);
      // 1 failed row re-queued
      expect(inserter.bufferSize).toBe(1);
    });
  });

  describe('callbacks', () => {
    it('should call onFlushSuccess after successful batch insert', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      const onSuccess = jest.fn();
      inserter = new BatchTaskInserter(createMockPool(mockQuery), { onFlushSuccess: onSuccess });

      for (let i = 0; i < 5; i++) {
        await inserter.add(makeRow());
      }

      expect(onSuccess).toHaveBeenCalledWith(5);
    });

    it('should call onFlushFailure when batch insert fails', async () => {
      mockQuery = jest.fn().mockRejectedValue(new Error('DB down'));
      const onFailure = jest.fn();
      inserter = new BatchTaskInserter(createMockPool(mockQuery), { onFlushFailure: onFailure });

      for (let i = 0; i < 5; i++) {
        await inserter.add(makeRow());
      }

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure.mock.calls[0][0]).toBe(5);
    });
  });

  describe('shutdown', () => {
    it('should flush remaining rows during shutdown', async () => {
      mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      inserter = new BatchTaskInserter(createMockPool(mockQuery));

      await inserter.add(makeRow());
      await inserter.add(makeRow());
      expect(mockQuery).not.toHaveBeenCalled();

      await inserter.shutdown();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(inserter.bufferSize).toBe(0);
    });
  });
});
