import { describe, it, expect } from 'vitest';
import { evaluateProgression } from './adaptationEngine';
import type { Session, Rpe } from '../models/types';

function session(over: Partial<Session>): Session {
  return {
    id: 'x', type: 'CO2', rounds: Array.from({ length: 8 }, (_, i) => ({
      index: i, targetHoldSec: 60, achievedHoldSec: 60, restBeforeSec: 0,
      contractions: 0, tappedOut: false,
    })), startedAt: 0, finishedAt: 0,
    completedRounds: 8, tapOuts: 0, rpe: 'normal', difficultyLevel: 0, ...over,
  };
}
const clean = (rpe: Rpe = 'normal') => session({ tapOuts: 0, completedRounds: 8, rpe });
const failed = () => session({ tapOuts: 1, completedRounds: 6, rpe: 'failed' });

describe('evaluateProgression', () => {
  it('progresses after two clean sessions', () => {
    const d = evaluateProgression([clean(), clean('easy')]);
    expect(d.action).toBe('progress');
    expect(d.suggestRetest).toBe(false);
  });

  it('repeats when the last session had a tap-out', () => {
    expect(evaluateProgression([clean(), failed()]).action).toBe('repeat');
  });

  it('deloads and suggests retest after three failed sessions', () => {
    const d = evaluateProgression([failed(), failed(), failed()]);
    expect(d.action).toBe('deload');
    expect(d.suggestRetest).toBe(true);
  });

  it('holds (repeat) when there is not enough history', () => {
    expect(evaluateProgression([clean()]).action).toBe('repeat');
    expect(evaluateProgression([]).action).toBe('repeat');
  });
});
