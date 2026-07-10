import { describe, expect, it } from 'vitest';
import {
  assessmentIntervalDays,
  assessmentSchedule,
} from './assessmentSchedule';
import { setGoal } from '../../application/usecases/manageGoal';
import { makeBaseline, makeSession, makeState } from '../../test/fixtures';

const DAY_MS = 86_400_000;

describe('assessment cadence', () => {
  it('keeps the fixed 14-day cadence without a goal', () => {
    expect(assessmentIntervalDays(makeState(), DAY_MS)).toBe(14);
  });

  it('uses seven days for a low-confidence goal after two clean sessions', () => {
    let state = makeState({
      baselines: [makeBaseline({ measuredAt: 0 })],
      sessions: [
        makeSession({ id: 'a', finishedAt: 2 * DAY_MS }),
        makeSession({ id: 'b', finishedAt: 3 * DAY_MS }),
      ],
    });
    state = setGoal(state, 240, DAY_MS);
    expect(assessmentIntervalDays(state, DAY_MS * 4)).toBe(7);
  });

  it('uses 21 days at high confidence and at least 80% progress', () => {
    let state = makeState({
      baselines: [makeBaseline({
        id: 'start',
        measuredAt: 0,
        maxHoldSec: 180,
      })],
    });
    state = setGoal(state, 240, DAY_MS);
    state.baselines.push(
      makeBaseline({ id: 'a', measuredAt: 7 * DAY_MS, maxHoldSec: 210 }),
      makeBaseline({ id: 'b', measuredAt: 14 * DAY_MS, maxHoldSec: 220 }),
      makeBaseline({ id: 'c', measuredAt: 21 * DAY_MS, maxHoldSec: 228 }),
      makeBaseline({ id: 'd', measuredAt: 28 * DAY_MS, maxHoldSec: 230 }),
    );
    expect(assessmentIntervalDays(state, 29 * DAY_MS)).toBe(21);
  });

  it('uses 14 days for an active goal without an acceleration or extension gate', () => {
    const state = setGoal(makeState({
      baselines: [makeBaseline({ measuredAt: 0 })],
    }), 240, DAY_MS);
    expect(assessmentIntervalDays(state, 2 * DAY_MS)).toBe(14);
  });
});

describe('assessment recovery gate', () => {
  it('requires one recovery day after a clean session', () => {
    const state = makeState({
      baselines: [makeBaseline({ measuredAt: 0 })],
      sessions: [makeSession({
        finishedAt: 10 * DAY_MS,
        rpe: 'normal',
      })],
    });
    state.courseState.lastMaxTestAt = -10 * DAY_MS;

    expect(assessmentSchedule(state, 10.5 * DAY_MS).eligible).toBe(false);
    expect(assessmentSchedule(state, 11 * DAY_MS).eligible).toBe(true);
  });

  it('requires two recovery days after hard or auto-eased work', () => {
    const state = makeState({
      baselines: [makeBaseline({ measuredAt: 0 })],
      sessions: [makeSession({
        finishedAt: 10 * DAY_MS,
        rpe: 'hard',
      })],
    });
    state.courseState.lastMaxTestAt = -10 * DAY_MS;

    expect(assessmentSchedule(state, 11 * DAY_MS).eligible).toBe(false);
    expect(assessmentSchedule(state, 12 * DAY_MS).eligible).toBe(true);
  });

  it('counts the spring-forward transition as one calendar recovery day', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const finishedAt = new Date(2026, 2, 8, 10).getTime();
      const now = new Date(2026, 2, 9, 10).getTime();
      const state = makeState({
        baselines: [makeBaseline({ measuredAt: 0 })],
        sessions: [makeSession({
          finishedAt,
          rpe: 'normal',
        })],
      });
      state.courseState.lastMaxTestAt = -10 * DAY_MS;

      expect(assessmentSchedule(state, now).eligible).toBe(true);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });
});
