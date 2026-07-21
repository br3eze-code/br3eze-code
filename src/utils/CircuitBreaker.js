/**
 * Circuit Breaker — prevents cascading failures to external services
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing recovery)
 */

class CircuitBreaker {
  /**
   * @param {number} threshold     - failures before opening (default 5)
   * @param {number} timeout       - ms to wait before half-open attempt (default 60s)
   * @param {number} halfOpenLimit - max concurrent half-open probes (default 1)
   */
  constructor(threshold = 5, timeout = 60_000, halfOpenLimit = 1) {
    this.threshold      = threshold;
    this.timeout        = timeout;
    this.halfOpenLimit  = halfOpenLimit;
    this.failureCount   = 0;
    this.successCount   = 0;
    this.state          = 'CLOSED';
    this.nextAttempt    = 0;
    this.lastError      = null;
    this.halfOpenProbes = 0;
    this._openedAt      = null;
  }

  get isOpen()     { return this.state === 'OPEN'; }
  get isClosed()   { return this.state === 'CLOSED'; }
  get isHalfOpen() { return this.state === 'HALF_OPEN'; }

  async execute(fn, fallback = null) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const waitMs = this.nextAttempt - Date.now();
        if (fallback) return fallback(new Error(`Circuit OPEN — retry in ${Math.ceil(waitMs / 1000)}s`));
        throw new Error(`Circuit breaker OPEN — retry in ${Math.ceil(waitMs / 1000)}s`);
      }
      // Transition to HALF_OPEN
      this.state = 'HALF_OPEN';
      this.halfOpenProbes = 0;
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenProbes >= this.halfOpenLimit) {
      if (fallback) return fallback(new Error('Circuit HALF_OPEN — probe limit reached'));
      throw new Error('Circuit breaker HALF_OPEN — waiting for probe to complete');
    }

    if (this.state === 'HALF_OPEN') this.halfOpenProbes++;

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      if (fallback) return fallback(err);
      throw err;
    }
  }

  _onSuccess() {
    this.failureCount = 0;
    this.lastError    = null;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.state        = 'CLOSED';
        this.successCount = 0;
        this.halfOpenProbes = 0;
      }
    }
  }

  _onFailure(err) {
    this.lastError = err;
    this.failureCount++;
    if (this.state === 'HALF_OPEN') {
      // Probe failed → reopen
      this.state       = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      this._openedAt   = Date.now();
      this.halfOpenProbes = 0;
    } else if (this.failureCount >= this.threshold) {
      this.state       = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      this._openedAt   = Date.now();
    }
  }

  reset() {
    this.failureCount   = 0;
    this.successCount   = 0;
    this.state          = 'CLOSED';
    this.nextAttempt    = 0;
    this.lastError      = null;
    this.halfOpenProbes = 0;
    this._openedAt      = null;
  }

  toJSON() {
    return {
      state:        this.state,
      failureCount: this.failureCount,
      threshold:    this.threshold,
      openedAt:     this._openedAt ? new Date(this._openedAt).toISOString() : null,
      nextAttemptAt: this.nextAttempt ? new Date(this.nextAttempt).toISOString() : null,
      lastError:    this.lastError?.message || null,
    };
  }
}

export default CircuitBreaker;
