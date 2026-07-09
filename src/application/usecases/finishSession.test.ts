import { describe, it, expect } from 'vitest';
import { finishSession } from './finishSession';
import { emptyAppState } from '../../domain/models/appState';
import type { Session } from '../../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();
function completed(over: Partial<Session> = {}): Session {
  return {
    id: 's1', type: 'CO2',
    rounds: Array.from({ length: 8 }, (_, i) => ({
      index: i, targetHoldSec: 110, achievedHoldSec: 110, restBeforeSec: 0, contractions: 0, tappedOut: false,
    })),
    startedAt: D('2026-07-09T10:00:00'), finishedAt: D('2026-07-09T10:20:00'),
    completedRounds: 8, tapOuts: 0, rpe: 'easy', difficultyLevel: 0, ...over,
  };
}

describe('finishSession', () => {
  it('appends the session and advances the course position', () => {
    const s = emptyAppState();
    const next = finishSession(s, completed(), D('2026-07-09T10:20:00'));
    expect(next.sessions).toHaveLength(1);
    expect(next.courseState.position).toBe(1);
    expect(next.courseState.lastTrainedAt).toBe(D('2026-07-09T10:20:00'));
  });

  it('progresses difficulty after two clean sessions', () => {
    let s = emptyAppState();
    s = finishSession(s, completed({ id: 'a' }), D('2026-07-08T10:20:00'));
    s = finishSession(s, completed({ id: 'b' }), D('2026-07-09T10:20:00'));
    expect(s.courseState.difficultyLevel).toBe(1);
  });

  it('deloads difficulty (floored at 0) after three failed sessions', () => {
    let s = emptyAppState();
    s.courseState.difficultyLevel = 2;
    const fail = (id: string, at: number): Session => completed({ id, tapOuts: 1, completedRounds: 5, rpe: 'failed', finishedAt: at });
    s = finishSession(s, fail('a', D('2026-07-07T10:00:00')), D('2026-07-07T10:00:00'));
    s = finishSession(s, fail('b', D('2026-07-08T10:00:00')), D('2026-07-08T10:00:00'));
    s = finishSession(s, fail('c', D('2026-07-09T10:00:00')), D('2026-07-09T10:00:00'));
    expect(s.courseState.difficultyLevel).toBe(1);
  });

  it('a MAX session records a new baseline and resets the recalibration clock', () => {
    const s = emptyAppState();
    const now = D('2026-07-09T10:20:00');
    const maxSess = completed({
      id: 'm', type: 'MAX',
      rounds: [{ index: 0, targetHoldSec: 0, achievedHoldSec: 222, restBeforeSec: 0, contractions: 0, tappedOut: false }],
      completedRounds: 1,
    });
    const next = finishSession(s, maxSess, now);
    expect(next.baselines.at(-1)?.maxHoldSec).toBe(222);
    expect(next.courseState.lastMaxTestAt).toBe(now);
  });
});
