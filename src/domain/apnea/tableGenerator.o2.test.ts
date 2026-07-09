import { describe, it, expect } from 'vitest';
import { generateO2Table } from './tableGenerator';

describe('generateO2Table', () => {
  it('keeps rest constant and ramps holds from 40% to 80% of max', () => {
    const plan = generateO2Table(200, 0);
    expect(plan.type).toBe('O2');
    expect(plan.rounds).toHaveLength(8);
    expect(plan.rounds[0].restBeforeSec).toBe(0);
    expect(plan.rounds.slice(1).every(r => r.restBeforeSec === 120)).toBe(true);
    expect(plan.rounds[0].targetHoldSec).toBe(80);   // 40% of 200
    expect(plan.rounds[7].targetHoldSec).toBe(160);  // 80% of 200
  });

  it('never exceeds the 80% safety cap even at high difficulty', () => {
    const plan = generateO2Table(200, 10);
    expect(Math.max(...plan.rounds.map(r => r.targetHoldSec))).toBeLessThanOrEqual(160);
  });

  it('difficulty raises the starting hold (compresses the ramp upward)', () => {
    const easy = generateO2Table(200, 0);
    const hard = generateO2Table(200, 3);
    expect(hard.rounds[0].targetHoldSec).toBeGreaterThan(easy.rounds[0].targetHoldSec);
    expect(hard.rounds[7].targetHoldSec).toBe(160);
  });
});
