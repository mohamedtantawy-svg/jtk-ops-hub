import { logger } from '../../shared/logger';

/**
 * Simple circuit breaker to protect downstream services (DB, Redis, external APIs).
 *
 * States:
 *   CLOSED  → requests flow through normally
 *   OPEN    → requests are rejected immediately (fail fast)
 *   HALF_OPEN → one probe request allowed; success → CLOSED, failure → OPEN
 *
 * Prevents cascading failures when a dependency is down.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;   // consecutive failures before opening (default: 5)
  resetTimeoutMs?: number;     // how long to stay open before trying half-open (default: 30s)
  halfOpenMax?: number;        // max concurrent probes in half-open (default: 1)
}

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMax: number;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.halfOpenMax = opts.halfOpenMax ?? 1;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      // Check if enough time has passed to try half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        logger.info(`Circuit ${this.name} → HALF_OPEN (probing)`);
      }
    }
    return this.state;
  }

  /**
   * Execute an async function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new CircuitOpenError(this.name);
    }

    if (currentState === 'HALF_OPEN' && this.halfOpenAttempts >= this.halfOpenMax) {
      throw new CircuitOpenError(this.name);
    }

    if (currentState === 'HALF_OPEN') {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      logger.info(`Circuit ${this.name} → CLOSED (probe succeeded)`);
    }
    this.failures = 0;
    this.state = 'CLOSED';
    this.halfOpenAttempts = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn(`Circuit ${this.name} → OPEN (probe failed)`);
      return;
    }

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(`Circuit ${this.name} → OPEN (${this.failures} consecutive failures)`);
    }
  }

  /** Get metrics for health check — read-only, does NOT trigger state transitions */
  getMetrics() {
    return {
      name: this.name,
      state: this.state, // Read raw state, not getState() which has side effects
      failures: this.failures,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(circuitName: string) {
    super(`Circuit breaker "${circuitName}" is OPEN — request rejected`);
    this.name = 'CircuitOpenError';
  }
}
