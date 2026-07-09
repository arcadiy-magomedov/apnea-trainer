import { describe, it, expect } from 'vitest';
import { personalBestSec, weeklySessionCount, currentStreakDays, adherencePct } from './stats';
import { emptyAppState } from '../domain/models/appState';
import type { Session } from '../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();
function sess(finishedAt: number, over: Partial<Session> = {}): Session {
  return {
    id: String(finishedAt), type: 'CO2',
    rounds: [{ index: 0, targetHoldSec: 60, achievedHoldSec: 60, restBeforeSec: 0, contractions: 0, tappedOut: false }],
    startedAt: finishedAt - 1000, finishedAt, completedRounds: 1, tapOuts: 0,
    rpe: 'normal', difficultyLevel: 0, ...over,
  };
}

describe('stats', () => {
  it('personalBest takes the max of baselines and MAX sessions', () => {
    const s = emptyAppState();
    s.baselines = [{ id: 'b', maxHoldSec: 180, firstContractionSec: null, measuredAt: 0 }];
    s.sessions = [sess(D('2026-07-01T10:00:00'), {
      type: 'MAX',
      rounds: [{ index: 0, targetHoldSec: 180, achievedHoldSec: 205, restBeforeSec: 0, contractions: 0, tappedOut: false }],
    })];
    expect(personalBestSec(s)).toBe(205);
  });

  it('weeklySessionCount counts sessions in the last 7 days', () => {
    const now = D('2026-07-09T12:00:00');
    const s = emptyAppState();
    s.sessions = [sess(D('2026-07-08T10:00:00')), sess(D('2026-07-01T10:00:00')), sess(D('2026-07-09T09:00:00'))];
    expect(weeklySessionCount(s, now)).toBe(2);
  });

  it('currentStreak counts consecutive days ending today or yesterday', () => {
    const now = D('2026-07-09T12:00:00');
    const s = emptyAppState();
    s.sessions = [sess(D('2026-07-07T10:00:00')), sess(D('2026-07-08T10:00:00')), sess(D('2026-07-09T09:00:00'))];
    expect(currentStreakDays(s, now)).toBe(3);
  });

  it('adherence is 0 with no sessions and capped at 100', () => {
    const now = D('2026-07-09T12:00:00');
    expect(adherencePct(emptyAppState(), now)).toBe(0);
  });
});
