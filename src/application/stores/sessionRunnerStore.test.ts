import { describe, expect, it } from 'vitest';
import { generateCo2Table, generateMaxTable, generateO2Table } from '../../domain/apnea/tableGenerator';
import { createSessionRunnerStore } from './sessionRunnerStore';

function createClock(initial: number) {
  let value = initial;

  return {
    now: () => value,
    set(next: number) {
      value = next;
    },
  };
}

function thresholds(length: number, value: number): number[] {
  return Array.from({ length }, () => value);
}

describe('sessionRunnerStore', () => {
  it('records a completed CO2 round and builds an unrated draft session', () => {
    const clock = createClock(1_000);
    const store = createSessionRunnerStore(clock.now);
    const plan = generateCo2Table(200, 0);

    expect(store.getState().earlyThresholds).toEqual([]);
    expect(store.getState().adjustment).toBeNull();

    store.getState().start(plan, 2, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec, 3, 80, false);

    clock.set(2_500);
    const session = store.getState().finishDraft();

    expect(session).toMatchObject({
      id: 'session-1000',
      type: 'CO2',
      startedAt: 1_000,
      finishedAt: 2_500,
      completedRounds: 1,
      tapOuts: 0,
      rpe: null,
      difficultyLevel: 2,
      adjustment: null,
    });
    expect(session.rounds).toEqual([
      {
        index: 0,
        targetHoldSec: plan.rounds[0].targetHoldSec,
        achievedHoldSec: plan.rounds[0].targetHoldSec,
        restBeforeSec: 0,
        contractions: 3,
        firstContractionSec: 80,
        tappedOut: false,
      },
    ]);
    expect(store.getState().phase).toBe('done');
  });

  it('does not count a training round ended early without tap-out as completed', () => {
    const clock = createClock(5_000);
    const store = createSessionRunnerStore(clock.now);
    const plan = generateCo2Table(200, 0);

    store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec - 10, 2, 60, false);

    clock.set(5_500);
    const session = store.getState().finishDraft();

    expect(session.completedRounds).toBe(0);
    expect(session.tapOuts).toBe(0);
  });

  it('applies one early-contractions adjustment after two ordinary early rounds and ignores later timing-only triggers', () => {
    const store = createSessionRunnerStore(() => 0);
    const plan = generateCo2Table(200, 0);

    store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec, 1, 40, false);
    expect(store.getState().adjustment).toBeNull();
    expect(store.getState().plan).toEqual(plan);

    store.getState().recordRound(plan.rounds[1].targetHoldSec, 1, 45, false);
    const afterEarlyAdjustment = structuredClone(store.getState().plan);

    expect(store.getState().adjustment).toEqual({
      reason: 'early-contractions',
      triggeredAtRoundIndex: 1,
      restAddedSec: 15,
      holdCapSec: null,
    });
    expect(afterEarlyAdjustment?.rounds.slice(0, 2)).toEqual(plan.rounds.slice(0, 2));
    expect(afterEarlyAdjustment?.rounds.slice(2).map((round) => round.restBeforeSec)).toEqual([120, 105, 90, 75, 60, 45]);

    store.getState().recordRound(plan.rounds[2].targetHoldSec, 1, 20, false);

    expect(store.getState().adjustment).toEqual({
      reason: 'early-contractions',
      triggeredAtRoundIndex: 1,
      restAddedSec: 15,
      holdCapSec: null,
    });
    expect(store.getState().plan).toEqual(afterEarlyAdjustment);
  });

  it('replaces an early adjustment with a stronger tap-out adjustment', () => {
    const store = createSessionRunnerStore(() => 0);
    const plan = generateCo2Table(200, 0);

    store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec, 1, 40, false);
    store.getState().recordRound(plan.rounds[1].targetHoldSec, 1, 45, false);
    const afterEarlyAdjustment = structuredClone(store.getState().plan);

    store.getState().recordRound(plan.rounds[2].targetHoldSec - 30, 1, 20, true);

    expect(afterEarlyAdjustment?.rounds[3].restBeforeSec).toBe(105);
    expect(store.getState().plan?.rounds[3].restBeforeSec).toBe(120);
    expect(store.getState().adjustment).toEqual({
      reason: 'tap-out',
      triggeredAtRoundIndex: 2,
      restAddedSec: 30,
      holdCapSec: null,
    });
  });

  it('does not claim added recovery for a direct O2 tap-out when only holds are frozen', () => {
    const store = createSessionRunnerStore(() => 0);
    const plan = generateO2Table(200, 0);

    store.getState().start(plan, 1, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec - 10, 1, 30, true);

    expect(store.getState().adjustment).toEqual({
      reason: 'tap-out',
      triggeredAtRoundIndex: 0,
      restAddedSec: 0,
      holdCapSec: plan.rounds[0].targetHoldSec,
    });
    expect(store.getState().plan?.rounds.slice(1).every((round) => round.targetHoldSec <= plan.rounds[0].targetHoldSec)).toBe(true);
  });

  it('reports added recovery for a CO2 tap-out on round 0 when a later recovery increases', () => {
    const store = createSessionRunnerStore(() => 0);
    const plan = generateCo2Table(200, 0);

    store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec - 10, 1, 30, true);

    expect(plan.rounds.slice(1, 4).map((round) => round.restBeforeSec)).toEqual([120, 105, 90]);
    expect(store.getState().plan?.rounds.slice(1, 4).map((round) => round.restBeforeSec)).toEqual([120, 120, 105]);
    expect(store.getState().adjustment).toEqual({
      reason: 'tap-out',
      triggeredAtRoundIndex: 0,
      restAddedSec: 15,
      holdCapSec: null,
    });
  });

  it('accumulates added recovery across repeated CO2 tap-outs on consecutive active rounds', () => {
    const store = createSessionRunnerStore(() => 0);
    const plan = generateCo2Table(200, 0);

    store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
    store.getState().recordRound(plan.rounds[0].targetHoldSec - 10, 1, 30, true);

    const afterFirstTapOut = structuredClone(store.getState().plan);

    expect(afterFirstTapOut?.rounds.slice(1, 4).map((round) => round.restBeforeSec)).toEqual([120, 120, 105]);
    expect(store.getState().adjustment).toEqual({
      reason: 'tap-out',
      triggeredAtRoundIndex: 0,
      restAddedSec: 15,
      holdCapSec: null,
    });

    store.getState().recordRound(afterFirstTapOut!.rounds[1].targetHoldSec - 10, 1, 30, true);

    expect(afterFirstTapOut?.rounds.slice(2, 5).map((round) => round.restBeforeSec)).toEqual([120, 105, 90]);
    expect(store.getState().plan?.rounds.slice(2, 5).map((round) => round.restBeforeSec)).toEqual([120, 120, 105]);
    expect(store.getState().adjustment).toEqual({
      reason: 'tap-out',
      triggeredAtRoundIndex: 1,
      restAddedSec: 30,
      holdCapSec: null,
    });
  });

  it('throws when finishing before session start', () => {
    const store = createSessionRunnerStore(() => 0);

    expect(() => store.getState().finishDraft()).toThrow(/before session start/i);
  });

  it('throws when recording before session start', () => {
    const store = createSessionRunnerStore(() => 0);

    expect(() => store.getState().recordRound(10, 1, 5, false)).toThrow(/before session start/i);
  });

  it('throws when recording outside the active plan', () => {
    const store = createSessionRunnerStore(() => 0);
    const plan = generateMaxTable(200);

    store.getState().start(plan, 0, [0.5]);
    store.getState().recordRound(180, 1, 40, false);

    expect(() => store.getState().recordRound(170, 1, 30, false)).toThrow(/outside active plan/i);
  });

  it.each([
    ['rejects non-finite achieved holds', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(Number.NaN, 1, 20, false);
    }, /achieved hold/i],
    ['rejects negative achieved holds', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(-1, 1, 0, false);
    }, /achieved hold/i],
    ['rejects non-integer contractions', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, 1.5, 20, false);
    }, /contractions/i],
    ['rejects negative contractions', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, -1, null, false);
    }, /contractions/i],
    ['rejects non-finite first contraction onset', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, 1, Number.POSITIVE_INFINITY, false);
    }, /first contraction/i],
    ['rejects negative first contraction onset', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, 1, -1, false);
    }, /first contraction/i],
    ['rejects first contraction onset after achieved hold', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, 1, 61, false);
    }, /first contraction/i],
    ['requires onset data when contractions are positive', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, 1, null, false);
    }, /together/i],
    ['rejects onset data when contractions are zero', () => {
      const plan = generateCo2Table(200, 0);
      const store = createSessionRunnerStore(() => 0);
      store.getState().start(plan, 0, thresholds(plan.rounds.length, 0.5));
      store.getState().recordRound(60, 0, 10, false);
    }, /together/i],
  ])('%s', (_, act, expectedMessage) => {
    expect(act).toThrow(expectedMessage);
  });

  it('counts non-tap-out MAX rounds as completed and never auto-eases them from timing', () => {
    const clock = createClock(7_000);
    const store = createSessionRunnerStore(clock.now);
    const plan = generateMaxTable(200);

    store.getState().start(plan, 0, [0.5]);
    store.getState().recordRound(180, 2, 20, false);

    clock.set(8_000);
    const session = store.getState().finishDraft();

    expect(session.completedRounds).toBe(1);
    expect(session.adjustment).toBeNull();
    expect(store.getState().plan).toEqual(plan);
  });

  it('resets previous results, adjustment, and threshold state on start', () => {
    const clock = createClock(100);
    const store = createSessionRunnerStore(clock.now);
    const co2Plan = generateCo2Table(200, 0);
    const o2Plan = generateO2Table(200, 1);

    store.getState().start(co2Plan, 0, thresholds(co2Plan.rounds.length, 0.5));
    store.getState().recordRound(co2Plan.rounds[0].targetHoldSec, 1, 40, false);
    store.getState().recordRound(co2Plan.rounds[1].targetHoldSec, 1, 45, false);
    expect(store.getState().results).toHaveLength(2);
    expect(store.getState().adjustment).not.toBeNull();

    clock.set(900);
    const nextThresholds = thresholds(o2Plan.rounds.length, 0.65);
    store.getState().start(o2Plan, 3, nextThresholds);
    nextThresholds[0] = 0.2;

    expect(store.getState()).toMatchObject({
      plan: o2Plan,
      difficultyLevel: 3,
      roundIndex: 0,
      phase: 'breatheUp',
      startedAt: 900,
      results: [],
      adjustment: null,
    });
    expect(store.getState().earlyThresholds).toEqual(thresholds(o2Plan.rounds.length, 0.65));
  });
});
