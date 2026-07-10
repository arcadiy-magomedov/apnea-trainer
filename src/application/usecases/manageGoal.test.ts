import { describe, expect, it } from 'vitest';
import {
  clearGoal,
  setGoal,
  syncGoalAchievement,
} from './manageGoal';
import { makeBaseline, makeState } from '../../test/fixtures';

describe('manage goal', () => {
  it('anchors a new goal at assessed personal best', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'a', maxHoldSec: 180 }),
        makeBaseline({ id: 'b', maxHoldSec: 200, measuredAt: 2_000 }),
      ],
    });
    const next = setGoal(state, 240, 3_000);

    expect(next.goal).toEqual({
      id: 'goal-3000',
      targetHoldSec: 240,
      createdAt: 3_000,
      startMaxSec: 200,
      achievedAt: null,
    });
  });

  it('editing a goal reanchors it at current assessed best', () => {
    const first = setGoal(makeState({
      baselines: [makeBaseline({ maxHoldSec: 180 })],
    }), 240, 1_000);
    first.baselines.push(makeBaseline({
      id: 'new',
      measuredAt: 2_000,
      maxHoldSec: 200,
    }));

    const edited = setGoal(first, 260, 3_000);
    expect(edited.goal?.startMaxSec).toBe(200);
    expect(edited.goal?.createdAt).toBe(3_000);
  });

  it('creates an already-achieved goal at or below assessed best', () => {
    const state = makeState({
      baselines: [makeBaseline({ maxHoldSec: 200 })],
    });
    expect(setGoal(state, 190, 3_000).goal?.achievedAt).toBe(3_000);
  });

  it('rejects invalid targets and missing baseline data', () => {
    expect(() => setGoal(makeState(), 240, 1_000)).toThrow(/baseline/i);
    expect(() => setGoal(makeState({
      baselines: [makeBaseline()],
    }), 0, 1_000)).toThrow(/positive duration/i);
  });

  it('clears only the goal and preserves training adaptation', () => {
    const state = setGoal(makeState({
      baselines: [makeBaseline()],
    }), 240, 1_000);
    state.courseState.difficultyByType = { CO2: 3, O2: 2 };
    state.courseState.microcycleProfile = 'co2-heavy';

    const cleared = clearGoal(state);
    expect(cleared.goal).toBeNull();
    expect(cleared.courseState.difficultyByType).toEqual({ CO2: 3, O2: 2 });
    expect(cleared.courseState.microcycleProfile).toBe('co2-heavy');
  });

  it('marks achievement only after assessed best reaches target', () => {
    const state = setGoal(makeState({
      baselines: [makeBaseline({ maxHoldSec: 180 })],
    }), 200, 1_000);
    state.baselines.push(makeBaseline({
      id: 'hit',
      measuredAt: 2_000,
      maxHoldSec: 205,
    }));

    expect(syncGoalAchievement(state, 2_000).goal?.achievedAt).toBe(2_000);
  });
});
