import type { Clock } from '../domain/ports/clock';

export class FakeClock implements Clock {
  constructor(private t: number) {}
  now(): number { return this.t; }
  advance(ms: number): void { this.t += ms; }
  set(ms: number): void { this.t = ms; }
}
