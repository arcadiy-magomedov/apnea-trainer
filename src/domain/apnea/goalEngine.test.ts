import { describe, expect, it } from 'vitest';
import {
  expectedMaxAt,
  goalForecast,
  observedRatePerDay,
  priorRatePerDay,
  projectedTrajectory,
  trajectoryStatus,
} from './goalEngine';
import { makeBaseline, makeState } from '../../test/fixtures';
import type { Goal } from '../models/types';

const DAY_MS = 86_400_000;

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    targetHoldSec: 240,
    createdAt: 10 * DAY_MS,
    startMaxSec: 180,
    achievedAt: null,
    ...over,
  };
}

describe('goal prior', () => {
  it('starts from a fraction of start max rather than goal gap', () => {
    const small = priorRatePerDay(goal({ targetHoldSec: 210 }), 180);
    const large = priorRatePerDay(goal({ targetHoldSec: 360 }), 180);
    expect(small).toBe(large);
  });

  it('slows as predicted progress approaches the target', () => {
    expect(priorRatePerDay(goal(), 220))
      .toBeLessThan(priorRatePerDay(goal(), 180));
  });
});

describe('observed rate', () => {
  it('returns seconds per day from the goal anchor and assessments', () => {
    const points = [
      { id: 'a', at: 17 * DAY_MS, sec: 187 },
      { id: 'b', at: 24 * DAY_MS, sec: 194 },
    ];
    expect(observedRatePerDay(points, goal())).toBeCloseTo(1);
  });

  it('returns null with no post-goal assessment or zero x variance', () => {
    expect(observedRatePerDay([], goal())).toBeNull();
    expect(observedRatePerDay([
      { id: 'a', at: 10 * DAY_MS, sec: 181 },
    ], goal())).toBeNull();
  });

  it('keeps the highest assessment when timestamps are identical', () => {
    const points = [
      { id: 'low', at: 17 * DAY_MS, sec: 182 },
      { id: 'high', at: 17 * DAY_MS, sec: 187 },
    ];
    expect(observedRatePerDay(points, goal())).toBeCloseTo(1);
  });
});

describe('goal forecast', () => {
  it('gives a later ETA to a larger goal from the same start', () => {
    const state = makeState({
      baselines: [makeBaseline({
        measuredAt: 10 * DAY_MS,
        maxHoldSec: 180,
      })],
    });
    const small = goalForecast(state, goal({ targetHoldSec: 210 }), 11 * DAY_MS);
    const large = goalForecast(state, goal({ targetHoldSec: 300 }), 11 * DAY_MS);

    expect(large.etaMs!).toBeGreaterThan(small.etaMs!);
    expect(small.confidence).toBe('low');
  });

  it('uses best assessed max for progress and latest for forecast state', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'pb', measuredAt: 12 * DAY_MS, maxHoldSec: 210 }),
        makeBaseline({ id: 'latest', measuredAt: 20 * DAY_MS, maxHoldSec: 200 }),
      ],
    });
    const forecast = goalForecast(state, goal(), 21 * DAY_MS);

    expect(forecast.bestSec).toBe(210);
    expect(forecast.latestSec).toBe(200);
    expect(forecast.progressPct).toBe(50);
  });

  it('marks three non-positive assessment points as stalled', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'a', measuredAt: 17 * DAY_MS, maxHoldSec: 180 }),
        makeBaseline({ id: 'b', measuredAt: 24 * DAY_MS, maxHoldSec: 179 }),
        makeBaseline({ id: 'c', measuredAt: 31 * DAY_MS, maxHoldSec: 178 }),
      ],
    });
    const forecast = goalForecast(state, goal(), 32 * DAY_MS);

    expect(forecast.stalled).toBe(true);
    expect(forecast.etaMs).toBeNull();
    expect(forecast.confidence).toBe('medium');
  });

  it('marks an assessed target as achieved with no ETA', () => {
    const state = makeState({
      baselines: [makeBaseline({
        measuredAt: 12 * DAY_MS,
        maxHoldSec: 245,
      })],
    });
    const forecast = goalForecast(state, goal(), 13 * DAY_MS);
    expect(forecast.achieved).toBe(true);
    expect(forecast.progressPct).toBe(100);
    expect(forecast.etaMs).toBeNull();
  });

  it('returns no ETA beyond the ten-year horizon', () => {
    const state = makeState({
      baselines: [makeBaseline({
        measuredAt: 10 * DAY_MS,
        maxHoldSec: 180,
      })],
    });
    const forecast = goalForecast(
      state,
      goal({ targetHoldSec: 100_000 }),
      11 * DAY_MS,
    );
    expect(forecast.achieved).toBe(false);
    expect(forecast.etaMs).toBeNull();
  });
});

it('projects increasing points from now toward ETA', () => {
  const state = makeState({
    baselines: [makeBaseline({
      measuredAt: 10 * DAY_MS,
      maxHoldSec: 180,
    })],
  });
  const points = projectedTrajectory(state, goal(), 11 * DAY_MS, 4);

  expect(points).toHaveLength(5);
  expect(points[0].at).toBe(10 * DAY_MS);
  expect(points[1].at).toBe(11 * DAY_MS);
  expect(points.at(-1)!.sec).toBeGreaterThan(points[0].sec);
  expect(points.at(-1)!.sec).toBeCloseTo(240);
  expect(expectedMaxAt(state, goal(), 12 * DAY_MS)).toBeGreaterThan(180);
});

it('projects the end value when only one future segment is requested', () => {
  const state = makeState({
    baselines: [makeBaseline({
      measuredAt: 10 * DAY_MS,
      maxHoldSec: 180,
    })],
  });
  const points = projectedTrajectory(state, goal(), 11 * DAY_MS, 1);

  expect(points).toHaveLength(2);
  expect(points[1].at).toBeGreaterThan(11 * DAY_MS);
  expect(points[1].sec).toBeGreaterThan(points[0].sec);
});

it('judges the latest point against a forecast that excludes it', () => {
  const state = makeState({
    baselines: [
      makeBaseline({ id: 'a', measuredAt: 17 * DAY_MS, maxHoldSec: 187 }),
      makeBaseline({ id: 'duplicate-low', measuredAt: 24 * DAY_MS, maxHoldSec: 202 }),
      makeBaseline({ id: 'b', measuredAt: 24 * DAY_MS, maxHoldSec: 205 }),
    ],
  });

  expect(trajectoryStatus(state, goal())).toBe('ahead');
});

it('returns on with fewer than two post-goal assessments', () => {
  const state = makeState({
    baselines: [
      makeBaseline({ measuredAt: 17 * DAY_MS, maxHoldSec: 187 }),
    ],
  });
  expect(trajectoryStatus(state, goal())).toBe('on');
});
