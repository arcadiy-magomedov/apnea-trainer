import { describe, expect, it } from 'vitest';
import { makeRound, makeSession } from '../../test/fixtures';
import type {
  InSessionAdjustment,
  ProgressionDecision,
  RoundResult,
  Rpe,
  Session,
  SessionQuality,
  TrainingSessionType,
} from '../models/types';
import { APNEA_DEFAULTS } from './config';
import {
  classifySession,
  contractionOnsetRatio,
  effectiveEarlyThreshold,
  evaluateTypeProgression,
  isEarlyRound,
  medianContractionOnsetRatio,
  roundCompleted,
  shouldAutoEase,
} from './qualityEngine';

function completedRound(over: Partial<RoundResult> = {}): RoundResult {
  return makeRound({
    index: 0,
    targetHoldSec: 100,
    achievedHoldSec: 100,
    firstContractionSec: 80,
    tappedOut: false,
    ...over,
  });
}

function ratioSession(
  finishedAt: number,
  firstContractionSec: number | null,
  over: Partial<Session> & { roundIndex?: number } = {},
): Session {
  const { roundIndex = 0, rounds, ...sessionOver } = over;
  return makeSession({
    id: `session-${sessionOver.type ?? 'CO2'}-${finishedAt}-${roundIndex}`,
    type: 'CO2',
    startedAt: finishedAt - 1_000,
    finishedAt,
    rounds: rounds ?? [completedRound({ index: roundIndex, firstContractionSec })],
    rpe: 'normal',
    difficultyLevel: 0,
    adjustment: null,
    ...sessionOver,
  });
}

function history(
  ratios: readonly number[],
  over: Partial<Session> & { roundIndex?: number } = {},
): Session[] {
  return ratios.map((ratio, index) => ratioSession(index + 1, ratio * 100, over));
}

function expectDecision(
  decision: ProgressionDecision,
  expectedAction: ProgressionDecision['action'],
  expectedRetest: boolean,
): void {
  expect(decision.action).toBe(expectedAction);
  expect(decision.suggestRetest).toBe(expectedRetest);
}

function expectQuality(actual: SessionQuality | null, expected: SessionQuality | null): void {
  expect(actual).toBe(expected);
}

describe('quality defaults', () => {
  it('exposes the configured quality thresholds', () => {
    expect(APNEA_DEFAULTS.quality).toEqual({
      coldStartEarlyRatio: 0.5,
      extremeEarlyRatio: 0.25,
      personalSampleMin: 5,
      personalHistorySessions: 6,
      personalMedianFactor: 0.8,
      personalThresholdMin: 0.25,
      personalThresholdMax: 0.7,
      adjustmentRestStepSec: 15,
      profileLockDays: 7,
    });
  });
});

describe('contractionOnsetRatio', () => {
  it('returns null for invalid targets or onsets', () => {
    expect(contractionOnsetRatio(completedRound({ targetHoldSec: 0 }))).toBeNull();
    expect(contractionOnsetRatio(completedRound({ firstContractionSec: null }))).toBeNull();
    expect(contractionOnsetRatio(completedRound({ firstContractionSec: -1 }))).toBeNull();
  });

  it('returns the onset ratio for valid rounds', () => {
    expect(contractionOnsetRatio(completedRound({ targetHoldSec: 80, firstContractionSec: 48 }))).toBe(0.6);
  });
});

describe('effectiveEarlyThreshold', () => {
  it('uses the cold-start threshold until enough personal samples exist', () => {
    expect(effectiveEarlyThreshold([], 'CO2', 0)).toBe(0.5);
    expect(effectiveEarlyThreshold(history([0.7, 0.75, 0.8, 0.85]), 'CO2', 0)).toBe(0.5);
  });

  it('uses the same-type same-round median after five samples', () => {
    const sessions = history([0.7, 0.75, 0.8, 0.85, 0.9], { roundIndex: 1 });
    expect(effectiveEarlyThreshold(sessions, 'CO2', 1)).toBeCloseTo(0.64);
  });

  it('uses the chronologically latest six sessions even when input is unordered', () => {
    const sessions = [
      ratioSession(7, 65),
      ratioSession(1, 90),
      ratioSession(4, 50),
      ratioSession(3, 45),
      ratioSession(6, 60),
      ratioSession(2, 40),
      ratioSession(5, 55),
    ];

    expect(effectiveEarlyThreshold(sessions, 'CO2', 0)).toBeCloseTo(0.42);
  });

  it('uses the median so one late outlier does not dominate', () => {
    const sessions = history([0.5, 0.55, 0.6, 0.65, 0.95]);
    expect(effectiveEarlyThreshold(sessions, 'CO2', 0)).toBeCloseTo(0.48);
  });

  it('clamps personal thresholds into the configured range', () => {
    expect(effectiveEarlyThreshold(history([0.1, 0.15, 0.2, 0.25, 0.3]), 'CO2', 0)).toBe(0.25);
    expect(effectiveEarlyThreshold(history([0.9, 0.95, 1, 1.05, 1.1]), 'CO2', 0)).toBe(0.7);
  });

  it('only samples matching the requested type and round index', () => {
    const sessions = [
      ...history([0.6, 0.65, 0.7, 0.75, 0.8], { roundIndex: 1 }),
      ratioSession(0, 10, { type: 'O2', roundIndex: 1 }),
      ratioSession(-1, 10, { type: 'CO2', roundIndex: 0 }),
      ratioSession(-2, null, { type: 'CO2', roundIndex: 1 }),
    ];

    expect(effectiveEarlyThreshold(sessions, 'CO2', 1)).toBeCloseTo(0.56);
  });
});

describe('medianContractionOnsetRatio', () => {
  it('summarizes valid onset ratios across up to six recent sessions of the requested type', () => {
    const sessions = [
      ratioSession(1, 90),
      ratioSession(7, -20),
      ratioSession(6, null),
      ratioSession(5, 60),
      ratioSession(4, -10),
      ratioSession(3, 70),
      ratioSession(2, 50),
      ratioSession(8, 50, { type: 'O2' }),
    ];

    expect(medianContractionOnsetRatio(sessions, 'CO2')).toBe(0.6);
  });
});

describe('isEarlyRound', () => {
  it('treats only ratios strictly below the threshold as early', () => {
    expect(isEarlyRound(completedRound({ firstContractionSec: 49 }), 0.5)).toBe(true);
    expect(isEarlyRound(completedRound({ firstContractionSec: 50 }), 0.5)).toBe(false);
    expect(isEarlyRound(completedRound({ firstContractionSec: null }), 0.5)).toBe(false);
  });
});

describe('shouldAutoEase', () => {
  const thresholds = { 0: 0.5, 1: 0.5 };

  it('does not auto-ease after one ordinary early round', () => {
    expect(shouldAutoEase([completedRound({ index: 0, firstContractionSec: 40 })], thresholds)).toBe(false);
  });

  it('auto-eases after two consecutive early rounds', () => {
    const results = [
      completedRound({ index: 0, firstContractionSec: 40 }),
      completedRound({ index: 1, firstContractionSec: 45 }),
    ];

    expect(shouldAutoEase(results, thresholds)).toBe(true);
  });

  it('auto-eases immediately after an extreme early round', () => {
    expect(shouldAutoEase([completedRound({ index: 0, firstContractionSec: 24 })], thresholds)).toBe(true);
  });

  it('ignores missing or invalid contraction onsets', () => {
    const results = [
      completedRound({ index: 0, firstContractionSec: 40 }),
      completedRound({ index: 1, firstContractionSec: null }),
    ];

    expect(shouldAutoEase(results, thresholds)).toBe(false);
    expect(shouldAutoEase([completedRound({ index: 0, targetHoldSec: 0 })], thresholds)).toBe(false);
  });
});

describe('roundCompleted', () => {
  it('requires the target to be met without a tap-out', () => {
    expect(roundCompleted(completedRound())).toBe(true);
    expect(roundCompleted(completedRound({ achievedHoldSec: 99 }))).toBe(false);
    expect(roundCompleted(completedRound({ tappedOut: true }))).toBe(false);
  });
});

describe('classifySession', () => {
  it('returns null for MAX sessions or unrated history', () => {
    expectQuality(classifySession(ratioSession(10, 80, { type: 'MAX' }), []), null);
    expectQuality(classifySession(ratioSession(10, 80, { rpe: null }), []), null);
  });

  it('marks completed adjusted work as strained', () => {
    const adjustment: InSessionAdjustment = {
      reason: 'early-contractions',
      triggeredAtRoundIndex: 0,
      restAddedSec: 15,
      holdCapSec: null,
    };

    expectQuality(classifySession(ratioSession(10, 80, { adjustment })), 'strained');
  });

  it('marks hard efforts as strained', () => {
    expectQuality(classifySession(ratioSession(10, 80, { rpe: 'hard' })), 'strained');
  });

  it('marks sessions with early manual ends as failed', () => {
    expectQuality(classifySession(ratioSession(10, 80, {
      rounds: [completedRound({ achievedHoldSec: 90, tappedOut: false })],
      tapOuts: 0,
      completedRounds: 0,
    })), 'failed');
  });

  it('marks tap-outs and failed rpe as failed', () => {
    expectQuality(classifySession(ratioSession(10, 80, {
      rounds: [completedRound({ tappedOut: true })],
      tapOuts: 1,
      completedRounds: 0,
    })), 'failed');

    expectQuality(classifySession(ratioSession(11, 80, { rpe: 'failed' })), 'failed');
  });

  it('marks early rounds against personal history as strained', () => {
    const priorSessions = history([0.7, 0.75, 0.8, 0.85, 0.9], { roundIndex: 0 });
    const current = ratioSession(10, 60);

    expectQuality(classifySession(current, priorSessions), 'strained');
  });

  it.each<Rpe>(['easy', 'normal'])('marks completed %s work without issues as clean', (rpe) => {
    const priorSessions = history([0.7, 0.75, 0.8, 0.85, 0.9], { roundIndex: 0 });
    const current = ratioSession(10, 75, { rpe });

    expectQuality(classifySession(current, priorSessions), 'clean');
  });
});

describe('evaluateTypeProgression', () => {
  function progressionSession(
    finishedAt: number,
    type: TrainingSessionType,
    over: Partial<Session> = {},
  ): Session {
    return ratioSession(finishedAt, 80, {
      type,
      difficultyLevel: 0,
      rpe: 'normal',
      rounds: [completedRound()],
      ...over,
    });
  }

  it('progresses after two clean sessions of the requested type even with interleaved other types', () => {
    const sessions = [
      progressionSession(1, 'CO2'),
      progressionSession(2, 'O2'),
      progressionSession(3, 'CO2', { rpe: 'easy' }),
    ];

    expectDecision(evaluateTypeProgression(sessions, 'CO2'), 'progress', false);
  });

  it('repeats when only one clean session exists for the requested type', () => {
    const sessions = [
      progressionSession(1, 'CO2'),
      progressionSession(2, 'O2'),
    ];

    expectDecision(evaluateTypeProgression(sessions, 'CO2'), 'repeat', false);
  });

  it('deloads after two strained sessions at the current level', () => {
    const sessions = [
      progressionSession(1, 'CO2', { rpe: 'hard' }),
      progressionSession(2, 'CO2', { adjustment: { reason: 'tap-out', triggeredAtRoundIndex: 0, restAddedSec: 15, holdCapSec: 100 } }),
    ];

    expectDecision(evaluateTypeProgression(sessions, 'CO2'), 'deload', false);
  });

  it('deloads and suggests retest after three failed sessions at the current level', () => {
    const failedSessions = [1, 2, 3].map((finishedAt) => progressionSession(finishedAt, 'CO2', {
      rounds: [completedRound({ tappedOut: true })],
      tapOuts: 1,
      completedRounds: 0,
      rpe: 'failed',
    }));

    expectDecision(evaluateTypeProgression(failedSessions, 'CO2'), 'deload', true);
  });

  it('requires a fresh streak after the difficulty level changes', () => {
    const sessions = [
      progressionSession(1, 'CO2', { difficultyLevel: 0 }),
      progressionSession(2, 'CO2', { difficultyLevel: 1 }),
    ];

    expectDecision(evaluateTypeProgression(sessions, 'CO2'), 'repeat', false);
  });

  it('does not mutate the supplied sessions', () => {
    const sessions = [
      progressionSession(3, 'CO2'),
      progressionSession(1, 'CO2', { rpe: 'easy' }),
      progressionSession(2, 'O2'),
    ];
    const snapshot = JSON.parse(JSON.stringify(sessions));

    evaluateTypeProgression(sessions, 'CO2');

    expect(sessions).toEqual(snapshot);
  });
});
