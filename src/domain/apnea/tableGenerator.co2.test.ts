import { describe, it, expect } from 'vitest';
import { generateCo2Table } from './tableGenerator';

describe('generateCo2Table', () => {
  it('holds constant at 55% of max with decreasing rests', () => {
    const plan = generateCo2Table(200, 0);
    expect(plan.type).toBe('CO2');
    expect(plan.rounds).toHaveLength(8);
    expect(plan.rounds.every(r => r.targetHoldSec === 110)).toBe(true);
    expect(plan.rounds.map(r => r.restBeforeSec)).toEqual([0, 120, 105, 90, 75, 60, 45, 30]);
  });

  it('never lets rest fall below the floor', () => {
    const plan = generateCo2Table(60, 0);
    expect(Math.min(...plan.rounds.slice(1).map(r => r.restBeforeSec))).toBeGreaterThanOrEqual(15);
  });

  it('difficulty reduces every rest by 5s per level (down to floor)', () => {
    const plan = generateCo2Table(200, 2);
    expect(plan.rounds.map(r => r.restBeforeSec)).toEqual([0, 110, 95, 80, 65, 50, 35, 20]);
  });
});
