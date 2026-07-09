import { describe, it, expect } from 'vitest';
import { FakeClock } from './fakeClock';

describe('FakeClock', () => {
  it('returns the set time and can advance', () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.set(42);
    expect(clock.now()).toBe(42);
  });
});
