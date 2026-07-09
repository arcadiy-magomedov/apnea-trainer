import { describe, it, expect } from 'vitest';
import { applyTapOut } from './adaptationEngine';
import { generateCo2Table, generateO2Table } from './tableGenerator';

describe('applyTapOut', () => {
  it('CO2: lengthens rests for rounds after the failed one', () => {
    const plan = generateCo2Table(200, 0); // rests [0,120,105,90,75,60,45,30]
    const eased = applyTapOut(plan, 3);     // failed on round index 3
    // rounds 0..3 unchanged, rounds 4..7 get +15s rest (one step back)
    expect(eased.rounds.slice(0, 4).map(r => r.restBeforeSec)).toEqual([0, 120, 105, 90]);
    expect(eased.rounds.slice(4).map(r => r.restBeforeSec)).toEqual([90, 75, 60, 45]);
  });

  it('O2: caps later holds at the failed round target', () => {
    const plan = generateO2Table(200, 0); // holds ramp 80..160
    const eased = applyTapOut(plan, 4);
    const capped = plan.rounds[4].targetHoldSec;
    expect(eased.rounds.slice(5).every(r => r.targetHoldSec <= capped)).toBe(true);
  });

  it('returns a new plan without mutating the input', () => {
    const plan = generateCo2Table(200, 0);
    const before = plan.rounds[5].restBeforeSec;
    applyTapOut(plan, 2);
    expect(plan.rounds[5].restBeforeSec).toBe(before);
  });
});
