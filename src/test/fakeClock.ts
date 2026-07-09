import type { Clock } from '../domain/ports/clock';

export class FakeClock implements Clock {
  private t: number;

  constructor(t: number) {
    this.t = t;
  }

  now(): number { return this.t; }
  advance(ms: number): void { this.t += ms; }
  set(ms: number): void { this.t = ms; }
}
