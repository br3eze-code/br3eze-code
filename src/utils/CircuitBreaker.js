// src/utils/CircuitBreaker.js
'use strict';

class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = Date.now();
    this.halfOpenPending = false;
    this.lastError = null;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error(`Circuit breaker OPEN. Retry after ${new Date(this.nextAttempt).toISOString()}`);
      }
      this.state = 'HALF_OPEN';
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenPending) {
      throw new Error('Circuit breaker HALF_OPEN: test request already in progress');
    }

    const isTestRequest = this.state === 'HALF_OPEN';
    if (isTestRequest) this.halfOpenPending = true;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    } finally {
      if (isTestRequest) this.halfOpenPending = false;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
    this.lastError = null;
  }

  onFailure(error) {
    this.failureCount++;
    this.lastError = error?.message || 'Unknown error';
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }

  getStatus() {
    return {
      state: this.state,
      failures: this.failureCount,
      threshold: this.threshold,
      nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
      lastError: this.lastError
    };
  }
}

module.exports = CircuitBreaker;
