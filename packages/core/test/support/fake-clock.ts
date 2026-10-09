import type { PollingClock } from '../../src/sandbox/wait-for-approval.js';

/** A clock whose sleep returns at once and moves time forward. */
export class FakeClock implements PollingClock {
  nowMs = 0;
  readonly sleeps: number[] = [];

  now(): number {
    return this.nowMs;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.nowMs += ms;
    return Promise.resolve();
  }
}
