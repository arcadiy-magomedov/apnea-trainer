import { describe, it, expect } from 'vitest';
import {
  adherencePct,
  currentStreakDays,
  latestSessionQuality,
  medianContractionOnsetPct,
  personalBestSec,
  weeklySessionCount,
} from './stats';
import { makeBaseline, makeRound, makeSession, makeState } from '../test/fixtures';
import type { Session } from '../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();
function sess(finishedAt: number, over: Partial<Session> = {}): Session {
  return makeSession({
    id: String(finishedAt),
    type: 'CO2',
    rounds: [makeRound()],
    startedAt: finishedAt - 1000,
    finishedAt,
    ...over,
  });
}

describe('stats', () => {
  it('personalBest uses assessed baselines and ignores ordinary training session results', () => {
    const state = makeState({
      baselines: [makeBaseline({ id: 'baseline-1', maxHoldSec: 180, measuredAt: D('2026-07-01T09:00:00') })],
      sessions: [sess(D('2026-07-01T10:00:00'), {
        type: 'CO2',
        rounds: [makeRound({ targetHoldSec: 180, achievedHoldSec: 205 })],
      })],
    });

    expect(personalBestSec(state)).toBe(180);
  });

  it('weeklySessionCount counts sessions in the last 7 days', () => {
    const now = D('2026-07-09T12:00:00');
    const state = makeState({
      sessions: [sess(D('2026-07-08T10:00:00')), sess(D('2026-07-01T10:00:00')), sess(D('2026-07-09T09:00:00'))],
    });

    expect(weeklySessionCount(state, now)).toBe(2);
  });

  it('currentStreak counts consecutive days ending today or yesterday', () => {
    const now = D('2026-07-09T12:00:00');
    const state = makeState({
      sessions: [sess(D('2026-07-07T10:00:00')), sess(D('2026-07-08T10:00:00')), sess(D('2026-07-09T09:00:00'))],
    });

    expect(currentStreakDays(state, now)).toBe(3);
  });

  it('adherence is 0 with no sessions and capped at 100', () => {
    const now = D('2026-07-09T12:00:00');
    expect(adherencePct(makeState(), now)).toBe(0);
  });

  it('reports the latest rated training quality', () => {
    const state = makeState({
      sessions: [makeSession({ rpe: 'hard' })],
    });
    expect(latestSessionQuality(state)).toBe('strained');
  });

  it('reports median contraction onset as a percentage of target', () => {
    const state = makeState({
      sessions: [
        makeSession({
          type: 'CO2',
          rounds: [makeRound({
            targetHoldSec: 100,
            firstContractionSec: 60,
          })],
        }),
      ],
    });
    expect(medianContractionOnsetPct(state, 'CO2')).toBe(60);
  });
});
