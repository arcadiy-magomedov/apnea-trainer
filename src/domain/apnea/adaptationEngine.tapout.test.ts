import { describe, it, expect } from 'vitest';
import { applyEarlyContractionAdjustment, applyTapOut } from './adaptationEngine';
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

  it('CO2: preserves earlier rounds and adds the configured rest step to later rounds', () => {
    const plan = generateCo2Table(200, 0);
    const original = structuredClone(plan);
    const eased = applyEarlyContractionAdjustment(plan, 2);

    expect(eased).not.toBe(plan);
    expect(eased.rounds.slice(0, 3)).toEqual(original.rounds.slice(0, 3));
    expect(eased.rounds.slice(3).map((round, index) => round.restBeforeSec - original.rounds[index + 3].restBeforeSec)).toEqual([15, 15, 15, 15, 15]);
    expect(eased.rounds.map((round, index) => round.targetHoldSec === original.rounds[index].targetHoldSec)).toEqual([true, true, true, true, true, true, true, true]);
    expect(plan).toEqual(original);
  });

  it('O2: preserves earlier rounds, adds rest, and caps future holds at the trigger target', () => {
    const plan = generateO2Table(200, 0);
    const original = structuredClone(plan);
    const eased = applyEarlyContractionAdjustment(plan, 3);
    const triggerTarget = original.rounds[3].targetHoldSec;

    expect(eased).not.toBe(plan);
    expect(eased.rounds.slice(0, 4)).toEqual(original.rounds.slice(0, 4));
    expect(eased.rounds.slice(4).map((round, index) => round.restBeforeSec - original.rounds[index + 4].restBeforeSec)).toEqual([15, 15, 15, 15]);
    expect(eased.rounds.slice(4).every((round) => round.targetHoldSec === triggerTarget)).toBe(true);
    expect(plan).toEqual(original);
  });

  it('MAX: returns the same plan object without adjustment', () => {
    const plan = { type: 'MAX' as const, rounds: [{ index: 0, targetHoldSec: 200, restBeforeSec: 0 }] };

    expect(applyEarlyContractionAdjustment(plan, 0)).toBe(plan);
  });

  it('out-of-range trigger: clones a no-op plan without intensifying anything', () => {
    const plan = generateCo2Table(200, 0);
    const original = structuredClone(plan);
    const eased = applyEarlyContractionAdjustment(plan, 99);

    expect(eased).not.toBe(plan);
    expect(eased).toEqual(original);
    expect(plan).toEqual(original);
  });

  it('missing low trigger index: returns a cloned no-op plan with cloned rounds', () => {
    const plan = generateO2Table(200, 0);
    const original = structuredClone(plan);
    const eased = applyEarlyContractionAdjustment(plan, -1);

    expect(eased).not.toBe(plan);
    expect(eased).toEqual(original);
    expect(eased.rounds).not.toBe(plan.rounds);
    expect(eased.rounds).toHaveLength(plan.rounds.length);
    eased.rounds.forEach((round, index) => {
      expect(round).not.toBe(plan.rounds[index]);
    });
    expect(plan).toEqual(original);
  });
});
