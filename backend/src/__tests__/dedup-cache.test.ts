import { DedupCache } from '../infrastructure/cache/DedupCache';

// ── Mock Redis ───────────────────────────────────────────────────────────────

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock('../infrastructure/redis/connection', () => ({
  getRedis: () => mockRedis,
}));

describe('DedupCache', () => {
  let cache: DedupCache;

  beforeEach(() => {
    cache = new DedupCache(60);
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
  });

  describe('get()', () => {
    it('should return cached taskId when key exists', async () => {
      mockRedis.get.mockResolvedValue('task-abc');

      const result = await cache.get('zendesk', 'ticket-123');
      expect(result).toBe('task-abc');
      expect(mockRedis.get).toHaveBeenCalledWith('dedup:zendesk:ticket-123');
    });

    it('should return null when key does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cache.get('zendesk', 'ticket-999');
      expect(result).toBeNull();
    });

    it('should return null on Redis error (graceful degradation)', async () => {
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await cache.get('zendesk', 'ticket-123');
      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('should set key with NX and TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await cache.set('zendesk', 'ticket-123', 'task-abc');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'dedup:zendesk:ticket-123',
        'task-abc',
        'EX',
        60,
        'NX',
      );
    });

    it('should not throw on Redis error', async () => {
      mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'));

      // Should not throw
      await expect(cache.set('zendesk', 'ticket-123', 'task-abc')).resolves.toBeUndefined();
    });
  });

  describe('key sanitization', () => {
    it('should sanitize colons in externalId', async () => {
      mockRedis.get.mockResolvedValue(null);

      await cache.get('zendesk', 'id:with:colons');
      expect(mockRedis.get).toHaveBeenCalledWith('dedup:zendesk:id_with_colons');
    });

    it('should sanitize newlines in source', async () => {
      mockRedis.get.mockResolvedValue(null);

      await cache.get('zen\ndesk', 'ticket-1');
      expect(mockRedis.get).toHaveBeenCalledWith('dedup:zen_desk:ticket-1');
    });

    it('should truncate long externalIds to 512 chars', async () => {
      mockRedis.get.mockResolvedValue(null);

      await cache.get('zendesk', 'x'.repeat(1000));
      const key = mockRedis.get.mock.calls[0][0] as string;
      // 'dedup:zendesk:' = 14 chars + 512 = 526
      expect(key.length).toBeLessThanOrEqual(526);
    });
  });
});
