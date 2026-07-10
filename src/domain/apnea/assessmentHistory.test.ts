import { describe, it, expect } from 'vitest';
import { assessmentHistory, latestAssessedMaxSec, bestAssessedMaxSec } from './assessmentHistory';
import { makeBaseline, makeRound, makeSession, makeState } from '../../test/fixtures';

describe('assessmentHistory', () => {
  it('uses baselines only, maps max points, sorts chronologically, and ignores larger MAX session holds', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'baseline-2', maxHoldSec: 185, measuredAt: 2_000 }),
        makeBaseline({ id: 'baseline-1', maxHoldSec: 175, measuredAt: 1_000 }),
      ],
      sessions: [
        makeSession({
          type: 'MAX',
          rounds: [makeRound({ targetHoldSec: 180, achievedHoldSec: 240 })],
        }),
      ],
    });

    expect(assessmentHistory(state)).toEqual([
      { id: 'baseline-1', at: 1_000, sec: 175 },
      { id: 'baseline-2', at: 2_000, sec: 185 },
    ]);
  });

  it('reports different latest and best assessed max values when an older PB is higher', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'baseline-1', maxHoldSec: 210, measuredAt: 1_000 }),
        makeBaseline({ id: 'baseline-2', maxHoldSec: 185, measuredAt: 2_000 }),
      ],
    });

    expect(latestAssessedMaxSec(state)).toBe(185);
    expect(bestAssessedMaxSec(state)).toBe(210);
  });

  it('returns 0 from both helpers when there is no assessment history', () => {
    const state = makeState();

    expect(latestAssessedMaxSec(state)).toBe(0);
    expect(bestAssessedMaxSec(state)).toBe(0);
  });

  it('returns the highest result among baselines sharing the latest timestamp', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'baseline-1', maxHoldSec: 170, measuredAt: 1_000 }),
        makeBaseline({ id: 'baseline-2', maxHoldSec: 180, measuredAt: 2_000 }),
        makeBaseline({ id: 'baseline-3', maxHoldSec: 195, measuredAt: 2_000 }),
      ],
    });

    expect(latestAssessedMaxSec(state)).toBe(195);
  });
});
