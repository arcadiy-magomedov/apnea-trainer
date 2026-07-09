import { describe, it, expect } from 'vitest';
import { computeBaseline } from './baselineCalc';

describe('computeBaseline', () => {
  it('takes the best (max) of the attempts', () => {
    const b = computeBaseline([180, 200, 195], 90, 'b1', 1000);
    expect(b.maxHoldSec).toBe(200);
    expect(b.firstContractionSec).toBe(90);
    expect(b.id).toBe('b1');
    expect(b.measuredAt).toBe(1000);
  });

  it('accepts a null first-contraction time', () => {
    const b = computeBaseline([120], null, 'b2', 2000);
    expect(b.maxHoldSec).toBe(120);
    expect(b.firstContractionSec).toBeNull();
  });

  it('throws when there are no attempts', () => {
    expect(() => computeBaseline([], null, 'b3', 3000)).toThrow();
  });
});
