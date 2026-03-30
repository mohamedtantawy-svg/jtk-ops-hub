import { CircuitBreaker, CircuitOpenError } from '../infrastructure/resilience/CircuitBreaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      name: 'test-circuit',
      failureThreshold: 3,
      resetTimeoutMs: 500,
      halfOpenMax: 1,
    });
  });

  it('should start in CLOSED state', () => {
    expect(cb.getState()).toBe('CLOSED');
  });

  it('should stay CLOSED on successful executions', async () => {
    await cb.execute(async () => 'ok');
    await cb.execute(async () => 'ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('should open after reaching failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('should throw CircuitOpenError when OPEN', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }

    await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('should transition to HALF_OPEN after resetTimeout', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');

    // Wait for reset timeout
    await new Promise(r => setTimeout(r, 600));
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('should close on successful probe in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 600));

    // Probe succeeds
    await cb.execute(async () => 'recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('should re-open on failed probe in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 600));

    // Probe fails
    await cb.execute(async () => { throw new Error('still down'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('should reset failure count on success', async () => {
    // 2 failures (below threshold)
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});

    // 1 success resets counter
    await cb.execute(async () => 'ok');

    // 2 more failures (still below threshold)
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});

    // Should still be CLOSED (not enough consecutive failures)
    expect(cb.getState()).toBe('CLOSED');
  });

  it('getMetrics should not trigger state transition', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 600));

    // getMetrics should read raw state, not transition
    const metrics = cb.getMetrics();
    // getState() would transition OPEN → HALF_OPEN, but getMetrics reads raw
    expect(metrics.state).toBe('OPEN'); // still OPEN because getMetrics doesn't transition
  });
});
