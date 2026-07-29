"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CircuitBreaker = void 0;
// Generic circuit breaker: opens after N failures within a window, then half-opens
// after a cooldown to probe the upstream again. See plan.md §7.4.

class CircuitBreaker {
  state = 'closed';
  failures = [];
  openedAt = 0;
  constructor(failureThreshold = 3, windowMs = 60_000, cooldownMs = 120_000) {
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
  }
  isOpen() {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half_open';
        return false;
      }
      return true;
    }
    return false;
  }
  recordSuccess() {
    this.failures = [];
    this.state = 'closed';
  }
  recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter(t => now - t <= this.windowMs);
    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = now;
      return;
    }
    if (this.failures.length >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }
  getState() {
    return this.state;
  }
}
exports.CircuitBreaker = CircuitBreaker;
