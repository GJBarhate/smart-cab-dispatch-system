// Generic circuit breaker: opens after N failures within a window, then half-opens
// after a cooldown to probe the upstream again. See plan.md §7.4.
type State = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failures: number[] = [];
  private openedAt = 0;

  constructor(
    private readonly failureThreshold = 3,
    private readonly windowMs = 60_000,
    private readonly cooldownMs = 120_000
  ) {}

  isOpen(): boolean {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half_open';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = [];
    this.state = 'closed';
  }

  recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter((t) => now - t <= this.windowMs);
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

  getState(): State {
    return this.state;
  }
}
