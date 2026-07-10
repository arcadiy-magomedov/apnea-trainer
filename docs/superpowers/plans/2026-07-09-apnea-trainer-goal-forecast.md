# Goal Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let the user set one assessed-max goal, show a confidence-labelled ETA and trajectory chart, schedule recovery-gated MAX assessments, and mark the goal achieved only from standardized assessments.

**Architecture:** Build the forecast as a pure domain engine over `assessmentHistory`, using a start-max prior, bounded recent regression, and deterministic daily simulation. Keep goal mutation in application use-cases and keep assessment scheduling separate from load adaptation. UI components receive already-computed forecast/chart data and never duplicate domain math.

**Tech Stack:** React 19, TypeScript 6, Zustand, Vitest, Testing Library, hand-rolled SVG.

**Dependency:** Complete `2026-07-09-apnea-trainer-adaptive-quality-loop.md` first. It supplies schema v2, `Goal`, assessment helpers, rated sessions, and quality classification.

**Git constraint:** Do not commit or push unless the user explicitly approves it. Each task ends with an uncommitted diff check instead of a commit.

---

## File Structure

### New files

- `src/domain/apnea/goalEngine.ts` — prior, observed trend, forecast simulation, confidence, projected trajectory, and leave-one-out status.
- `src/domain/apnea/goalEngine.test.ts` — forecast mathematics and trajectory status.
- `src/domain/apnea/assessmentSchedule.ts` — goal-aware cadence and recovery eligibility.
- `src/domain/apnea/assessmentSchedule.test.ts` — 7/14/21-day cadence and postponement.
- `src/application/usecases/manageGoal.ts` — set, edit, clear, and assessment-only achievement.
- `src/application/usecases/manageGoal.test.ts` — goal mutation behavior.
- `src/ui/components/GoalCard.tsx` — reusable Home goal state.
- `src/ui/components/GoalCard.test.tsx` — none/active/stalled/achieved states.
- `src/ui/design-system/ProgressChart.tsx` — pure SVG chart.
- `src/ui/design-system/ProgressChart.test.tsx` — actual/goal/projected primitives.
- `src/ui/screens/SetGoalScreen.tsx` — optional post-baseline and edit flow.
- `src/ui/screens/SetGoalScreen.test.tsx` — validation, warnings, save, and skip.

### Modified files

- `src/domain/apnea/config.ts` — goal constants.
- `src/domain/apnea/courseEngine.ts` — effective recalibration interval parameter.
- `src/domain/apnea/courseEngine.test.ts` — interval injection remains rest-safe.
- `src/domain/index.ts` — exports.
- `src/application/usecases/recordBaseline.ts` — synchronize goal achievement.
- `src/application/usecases/recordBaseline.test.ts` — assessment-only achievement.
- `src/application/usecases/finishSession.ts` — synchronize goal achievement after MAX.
- `src/application/usecases/finishSession.test.ts` — ordinary training cannot achieve a goal.
- `src/application/usecases/startTodaySession.ts` — assessment due/eligible/postponed override.
- `src/application/usecases/startTodaySession.test.ts` — MAX injection and cooldown.
- `src/application/stores/appStore.ts` — set/edit/clear goal actions.
- `src/application/stores/appStore.test.ts` — persistence of goal actions.
- `src/ui/design-system/format.ts` — strict `mm:ss` parsing.
- `src/ui/design-system/format.test.ts` — parser/date tests.
- `src/ui/app/routes.tsx` — `/goal` route.
- `src/ui/app/routes.test.tsx` — route coverage.
- `src/ui/screens/BaselineScreen.tsx` — optional initial goal step.
- `src/ui/screens/BaselineScreen.test.tsx` — first-baseline navigation.
- `src/ui/screens/HomeScreen.tsx` — GoalCard and assessment-postponed copy.
- `src/ui/screens/HomeScreen.test.tsx` — goal states.
- `src/ui/screens/StatsScreen.tsx` — progress ring, chart, confidence, and status.
- `src/ui/screens/StatsScreen.test.tsx` — chart/forecast integration.
- `src/ui/screens/SettingsScreen.tsx` — set/edit/clear goal controls.
- `src/ui/screens/SettingsScreen.test.tsx` — goal controls.
- `src/ui/screens/ProgramScreen.tsx` — assessment due/postponed status.
- `src/ui/screens/ProgramScreen.test.tsx` — cadence presentation.

---

### Task 1: Implement the Goal Forecast Mathematics

**Files:**
- Create: `src/domain/apnea/goalEngine.ts`
- Create: `src/domain/apnea/goalEngine.test.ts`
- Modify: `src/domain/apnea/config.ts`
- Modify: `src/domain/index.ts`

- [x] **Step 1: Write failing prior, regression, and ETA tests**

Create `src/domain/apnea/goalEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  goalForecast,
  observedRatePerDay,
  priorRatePerDay,
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
```

- [x] **Step 2: Run the goal-engine tests to verify they fail**

Run:

```powershell
npm test -- src/domain/apnea/goalEngine.test.ts
```

Expected: FAIL because `goalEngine` and goal configuration do not exist.

- [x] **Step 3: Add goal configuration**

Extend `APNEA_DEFAULTS`:

```ts
goal: {
  priorWeeklyGainFractionOfStart: 0.05,
  minRatePerDay: 0.05,
  blendK: 3,
  maxObservedPoints: 6,
  onTrackBandSec: 5,
  forecastHorizonDays: 3650,
  assessMinDays: 7,
  assessDefaultDays: 14,
  assessMaxDays: 21,
  implausibleFactor: 2.0,
},
```

- [x] **Step 4: Implement the forecast engine**

Create `src/domain/apnea/goalEngine.ts`:

```ts
import type { AppState, Goal } from '../models/types';
import {
  assessmentHistory,
  bestAssessedMaxSec,
  latestAssessedMaxSec,
  type MaxPoint,
} from './assessmentHistory';
import { APNEA_DEFAULTS, DAY_MS } from './config';

export interface GoalForecast {
  latestSec: number;
  bestSec: number;
  targetSec: number;
  startSec: number;
  progressPct: number;
  ratePerDay: number;
  etaMs: number | null;
  confidence: 'low' | 'medium' | 'high';
  stalled: boolean;
  achieved: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function postGoalPoints(state: AppState, goal: Goal): MaxPoint[] {
  const byTimestamp = new Map<number, MaxPoint>();
  for (const point of assessmentHistory(state)) {
    if (point.at <= goal.createdAt) continue;
    const existing = byTimestamp.get(point.at);
    if (!existing || point.sec > existing.sec) {
      byTimestamp.set(point.at, point);
    }
  }
  return [...byTimestamp.values()]
    .sort((left, right) => left.at - right.at)
    .slice(-APNEA_DEFAULTS.goal.maxObservedPoints);
}

export function priorRatePerDay(goal: Goal, predictedSec: number): number {
  if (predictedSec >= goal.targetHoldSec) return 0;
  const denominator = goal.targetHoldSec - goal.startMaxSec;
  const progress = denominator <= 0
    ? 1
    : clamp((predictedSec - goal.startMaxSec) / denominator, 0, 1);
  const base =
    goal.startMaxSec
    * APNEA_DEFAULTS.goal.priorWeeklyGainFractionOfStart
    / 7;
  return Math.max(
    APNEA_DEFAULTS.goal.minRatePerDay,
    base * (1 - progress),
  );
}

export function observedRatePerDay(
  points: MaxPoint[],
  goal: Goal,
): number | null {
  if (points.length === 0) return null;
  const byTimestamp = new Map<number, MaxPoint>();
  for (const point of points) {
    const existing = byTimestamp.get(point.at);
    if (!existing || point.sec > existing.sec) {
      byTimestamp.set(point.at, point);
    }
  }
  const samples = [
    { at: goal.createdAt, sec: goal.startMaxSec },
    ...[...byTimestamp.values()]
      .sort((left, right) => left.at - right.at)
      .slice(-APNEA_DEFAULTS.goal.maxObservedPoints),
  ];
  const origin = samples[0].at;
  const xs = samples.map((point) => (point.at - origin) / DAY_MS);
  const ys = samples.map((point) => point.sec);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce(
    (sum, value) => sum + (value - xMean) ** 2,
    0,
  );
  if (denominator === 0) return null;
  return xs.reduce(
    (sum, value, index) =>
      sum + (value - xMean) * (ys[index] - yMean),
    0,
  ) / denominator;
}

function confidenceFor(pointCount: number): GoalForecast['confidence'] {
  if (pointCount <= 1) return 'low';
  if (pointCount <= 3) return 'medium';
  return 'high';
}

function blendedRate(
  goal: Goal,
  predictedSec: number,
  observed: number | null,
  pointCount: number,
): number {
  const weight = observed === null
    ? 0
    : pointCount / (pointCount + APNEA_DEFAULTS.goal.blendK);
  return (1 - weight) * priorRatePerDay(goal, predictedSec)
    + weight * (observed ?? 0);
}

function simulateTargetDate(
  goal: Goal,
  startSec: number,
  startAt: number,
  observed: number | null,
  pointCount: number,
): number | null {
  let predicted = startSec;
  for (
    let day = 1;
    day <= APNEA_DEFAULTS.goal.forecastHorizonDays;
    day += 1
  ) {
    const rate = blendedRate(goal, predicted, observed, pointCount);
    if (rate <= 0) return null;
    predicted += rate;
    if (predicted >= goal.targetHoldSec) {
      return startAt + day * DAY_MS;
    }
  }
  return null;
}

export function goalForecast(
  state: AppState,
  goal: Goal,
  now: number,
): GoalForecast {
  const latestSec = latestAssessedMaxSec(state);
  const bestSec = bestAssessedMaxSec(state);
  const points = postGoalPoints(state, goal);
  const observed = observedRatePerDay(points, goal);
  const achieved = bestSec >= goal.targetHoldSec;
  const stalled =
    !achieved
    && points.length >= 3
    && observed !== null
    && observed <= 0;
  const denominator = goal.targetHoldSec - goal.startMaxSec;
  const progressPct = achieved
    ? 100
    : denominator <= 0
      ? 100
      : clamp(
          100 * (bestSec - goal.startMaxSec) / denominator,
          0,
          100,
        );
  const ratePerDay = blendedRate(
    goal,
    latestSec,
    observed,
    points.length,
  );

  return {
    latestSec,
    bestSec,
    targetSec: goal.targetHoldSec,
    startSec: goal.startMaxSec,
    progressPct,
    ratePerDay,
    etaMs: achieved || stalled
      ? null
      : simulateTargetDate(
          goal,
          latestSec,
          now,
          observed,
          points.length,
        ),
    confidence: confidenceFor(points.length),
    stalled,
    achieved,
  };
}
```

Export from `src/domain/index.ts`.

- [x] **Step 5: Run forecast tests**

Run:

```powershell
npm test -- src/domain/apnea/goalEngine.test.ts
```

Expected: PASS.

- [x] **Step 6: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 2: Add Projected Trajectory and Leave-One-Out Status

**Files:**
- Modify: `src/domain/apnea/goalEngine.ts`
- Modify: `src/domain/apnea/goalEngine.test.ts`

- [x] **Step 1: Write failing projection and status tests**

Append to `goalEngine.test.ts`:

```ts
import {
  expectedMaxAt,
  projectedTrajectory,
  trajectoryStatus,
} from './goalEngine';

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
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- src/domain/apnea/goalEngine.test.ts
```

Expected: FAIL because projection/status functions do not exist.

- [x] **Step 3: Extract a reusable forward simulator**

Add to `goalEngine.ts`:

```ts
export interface ProjectionPoint {
  at: number;
  sec: number;
}

function simulateUntil(
  goal: Goal,
  startSec: number,
  startAt: number,
  endAt: number,
  observed: number | null,
  pointCount: number,
): number {
  let predicted = startSec;
  const days = Math.max(0, Math.floor((endAt - startAt) / DAY_MS));
  for (let day = 0; day < days; day += 1) {
    const rate = blendedRate(goal, predicted, observed, pointCount);
    if (rate <= 0) break;
    predicted = Math.min(goal.targetHoldSec, predicted + rate);
  }
  return predicted;
}

export function expectedMaxAt(
  state: AppState,
  goal: Goal,
  at: number,
): number {
  const points = postGoalPoints(state, goal);
  const latest = points.at(-1) ?? {
    id: goal.id,
    at: goal.createdAt,
    sec: goal.startMaxSec,
  };
  return simulateUntil(
    goal,
    latest.sec,
    latest.at,
    at,
    observedRatePerDay(points, goal),
    points.length,
  );
}

export function projectedTrajectory(
  state: AppState,
  goal: Goal,
  now: number,
  segments = 24,
): ProjectionPoint[] {
  const forecast = goalForecast(state, goal, now);
  const points = postGoalPoints(state, goal);
  const observed = observedRatePerDay(points, goal);
  const latestAssessmentAt =
    assessmentHistory(state).at(-1)?.at ?? goal.createdAt;
  const endAt = forecast.etaMs
    ?? now + 90 * DAY_MS;
  const future = Array.from({ length: segments }, (_, index) => {
    const fraction = segments === 1 ? 1 : index / (segments - 1);
    const at = now + (endAt - now) * fraction;
    return {
      at,
      sec: index === 0
        ? forecast.latestSec
        : simulateUntil(
            goal,
            forecast.latestSec,
            now,
            at,
            observed,
            points.length,
          ),
    };
  });
  return [
    { at: latestAssessmentAt, sec: forecast.latestSec },
    ...future,
  ];
}

export function trajectoryStatus(
  state: AppState,
  goal: Goal,
): 'behind' | 'on' | 'ahead' {
  const points = postGoalPoints(state, goal);
  if (points.length < 2) return 'on';

  const latest = points.at(-1)!;
  const truncated = {
    ...state,
    baselines: state.baselines.filter(
      (baseline) => baseline.measuredAt !== latest.at,
    ),
  };
  const expected = expectedMaxAt(truncated, goal, latest.at);
  const delta = latest.sec - expected;
  const band = APNEA_DEFAULTS.goal.onTrackBandSec;
  if (delta > band) return 'ahead';
  if (delta < -band) return 'behind';
  return 'on';
}
```

Update `simulateTargetDate()` to call the same daily `blendedRate` logic; do not
introduce a second formula.

- [x] **Step 4: Run all goal-engine tests**

Run:

```powershell
npm test -- src/domain/apnea/goalEngine.test.ts
```

Expected: PASS.

- [x] **Step 5: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 3: Add Goal Mutation and Assessment-Only Achievement

**Files:**
- Create: `src/application/usecases/manageGoal.ts`
- Create: `src/application/usecases/manageGoal.test.ts`
- Modify: `src/application/usecases/recordBaseline.ts`
- Modify: `src/application/usecases/recordBaseline.test.ts`
- Modify: `src/application/usecases/finishSession.ts`
- Modify: `src/application/usecases/finishSession.test.ts`
- Modify: `src/application/stores/appStore.ts`
- Modify: `src/application/stores/appStore.test.ts`

- [x] **Step 1: Write goal use-case tests**

Create `src/application/usecases/manageGoal.test.ts`:

```ts
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
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- src/application/usecases/manageGoal.test.ts
```

Expected: FAIL because the use-case does not exist.

- [x] **Step 3: Implement goal mutation**

Create `src/application/usecases/manageGoal.ts`:

```ts
import type { AppState } from '../../domain/models/types';
import { bestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';

export function setGoal(
  state: AppState,
  targetHoldSec: number,
  now: number,
): AppState {
  if (!Number.isFinite(targetHoldSec) || targetHoldSec <= 0) {
    throw new Error('Goal target must be a positive duration');
  }
  const currentBest = bestAssessedMaxSec(state);
  if (currentBest <= 0) {
    throw new Error('A baseline assessment is required before setting a goal');
  }
  return {
    ...state,
    goal: {
      id: `goal-${now}`,
      targetHoldSec,
      createdAt: now,
      startMaxSec: currentBest,
      achievedAt: currentBest >= targetHoldSec ? now : null,
    },
  };
}

export function clearGoal(state: AppState): AppState {
  return { ...state, goal: null };
}

export function syncGoalAchievement(
  state: AppState,
  now: number,
): AppState {
  if (
    state.goal === null
    || state.goal.achievedAt !== null
    || bestAssessedMaxSec(state) < state.goal.targetHoldSec
  ) {
    return state;
  }
  return {
    ...state,
    goal: { ...state.goal, achievedAt: now },
  };
}
```

- [x] **Step 4: Synchronize achievement after baseline and MAX**

In `recordBaseline.ts`, wrap the returned state:

```ts
const next: AppState = {
  ...state,
  baselines: [...state.baselines, baseline],
  courseState: { ...state.courseState, lastMaxTestAt: now },
};
return syncGoalAchievement(next, now);
```

In `finishRatedSession`, after building the next state and updating the profile:

```ts
nextState = syncGoalAchievement(nextState, now);
```

Add a finish-session test proving a 300-second ordinary CO₂ hold does not achieve
a 240-second goal when no new baseline is appended:

```ts
it('does not achieve a goal from an ordinary training hold', () => {
  let state = setGoal(makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
  }), 240, 1_000);
  state = finishSession(state, makeSession({
    type: 'CO2',
    rounds: [makeRound({
      targetHoldSec: 99,
      achievedHoldSec: 300,
    })],
  }), 2_000);

  expect(state.goal?.achievedAt).toBeNull();
});
```

- [x] **Step 5: Add goal actions to the app store**

Extend `AppStore`:

```ts
setGoal(targetHoldSec: number): Promise<void>;
clearGoal(): Promise<void>;
```

Implement:

```ts
async setGoal(targetHoldSec) {
  await commit(setGoalUseCase(get().state, targetHoldSec, now()));
},
async clearGoal() {
  await commit(clearGoalUseCase(get().state));
},
```

Alias imports to avoid action/function name collisions:

```ts
import {
  clearGoal as clearGoalUseCase,
  setGoal as setGoalUseCase,
} from '../usecases/manageGoal';
```

- [x] **Step 6: Run goal mutation, baseline, finish, and store tests**

Run:

```powershell
npm test -- src/application/usecases/manageGoal.test.ts src/application/usecases/recordBaseline.test.ts src/application/usecases/finishSession.test.ts src/application/stores/appStore.test.ts
```

Expected: PASS.

- [x] **Step 7: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 4: Add Goal-Aware Assessment Cadence and Recovery Gates

**Files:**
- Create: `src/domain/apnea/assessmentSchedule.ts`
- Create: `src/domain/apnea/assessmentSchedule.test.ts`
- Modify: `src/domain/apnea/courseEngine.ts`
- Modify: `src/domain/apnea/courseEngine.test.ts`
- Modify: `src/application/usecases/startTodaySession.ts`
- Modify: `src/application/usecases/startTodaySession.test.ts`
- Modify: `src/domain/index.ts`

- [x] **Step 1: Write cadence and recovery tests**

Create `src/domain/apnea/assessmentSchedule.test.ts`:

```ts
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
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- src/domain/apnea/assessmentSchedule.test.ts
```

Expected: FAIL because the schedule module does not exist.

- [x] **Step 3: Implement cadence and eligibility**

Create `src/domain/apnea/assessmentSchedule.ts`:

```ts
import type { AppState } from '../models/types';
import { APNEA_DEFAULTS, DAY_MS } from './config';
import { goalForecast } from './goalEngine';
import { classifySession } from './qualityEngine';
import { startOfDay } from './time';

export interface AssessmentSchedule {
  intervalDays: number;
  due: boolean;
  eligible: boolean;
  postponed: boolean;
  recoveryDaysRequired: number;
}

function latestTrainingSession(state: AppState) {
  return [...state.sessions]
    .filter((session) => session.type !== 'MAX')
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .at(-1);
}

export function assessmentIntervalDays(
  state: AppState,
  now: number,
): number {
  if (state.goal === null) {
    return APNEA_DEFAULTS.goal.assessDefaultDays;
  }
  const forecast = goalForecast(state, state.goal, now);
  const training = state.sessions
    .filter((session) => session.type !== 'MAX')
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const last2 = training.slice(-2);
  const twoClean =
    last2.length === 2
    && last2.every((session, index) =>
      classifySession(
        session,
        training.slice(0, training.length - last2.length + index),
      ) === 'clean');

  if (forecast.confidence === 'low' && twoClean) {
    return APNEA_DEFAULTS.goal.assessMinDays;
  }
  if (forecast.confidence === 'high' && forecast.progressPct >= 80) {
    return APNEA_DEFAULTS.goal.assessMaxDays;
  }
  return APNEA_DEFAULTS.goal.assessDefaultDays;
}

export function assessmentSchedule(
  state: AppState,
  now: number,
): AssessmentSchedule {
  const intervalDays = assessmentIntervalDays(state, now);
  const lastMaxAt = state.courseState.lastMaxTestAt;
  const due =
    lastMaxAt !== null
    && now - lastMaxAt >= intervalDays * DAY_MS;
  const latest = latestTrainingSession(state);
  if (!due || !latest) {
    return {
      intervalDays,
      due,
      eligible: due,
      postponed: false,
      recoveryDaysRequired: 0,
    };
  }

  const quality = classifySession(
    latest,
    state.sessions.filter((session) => session.finishedAt < latest.finishedAt),
  );
  const recoveryDaysRequired =
    latest.adjustment !== null
    || latest.rpe === 'hard'
    || latest.rpe === 'failed'
    || quality === 'failed'
      ? 2
      : 1;
  const elapsedRecoveryDays =
    (startOfDay(now) - startOfDay(latest.finishedAt)) / DAY_MS;
  const eligible = elapsedRecoveryDays >= recoveryDaysRequired;

  return {
    intervalDays,
    due,
    eligible,
    postponed: due && !eligible,
    recoveryDaysRequired,
  };
}
```

Export from `src/domain/index.ts`.

- [x] **Step 4: Parameterize fixed recalibration logic**

Change `needsRecalibration` in `courseEngine.ts`:

```ts
export function needsRecalibration(
  c: CourseState,
  now: number,
  intervalDays = APNEA_DEFAULTS.recalibrationDays,
): boolean {
  if (c.lastMaxTestAt === null) return false;
  return now - c.lastMaxTestAt >= intervalDays * DAY_MS;
}
```

Change `resolveToday` to accept the same effective interval and pass it through:

```ts
export function resolveToday(
  c: CourseState,
  now: number,
  recalibrationIntervalDays = APNEA_DEFAULTS.recalibrationDays,
): TodayDecision {
  const synced = syncRestDays(c, now);
  let dayType = slotAt(synced, synced.position);
  if (
    dayType !== 'REST'
    && needsRecalibration(synced, now, recalibrationIntervalDays)
  ) {
    dayType = 'MAX';
  }

  const gapDays = synced.lastTrainedAt === null
    ? 0
    : Math.round(
        (startOfDay(now) - startOfDay(synced.lastTrainedAt)) / DAY_MS,
      );
  const deload = gapDays > APNEA_DEFAULTS.detraining.deloadDays;
  const suggestRetest = gapDays > APNEA_DEFAULTS.detraining.retestDays;

  let blocked = false;
  let reason: string | null = null;
  if (dayType === 'REST') {
    blocked = true;
    reason = 'Rest day — recovery is part of the program';
  } else if (
    synced.lastTrainedAt !== null
    && isSameCalendarDay(synced.lastTrainedAt, now)
  ) {
    blocked = true;
    reason = 'Already trained today';
  }

  return { dayType, blocked, reason, deload, suggestRetest };
}
```

Keep existing course tests and add:

```ts
it('accepts an effective recalibration interval', () => {
  const c = course({ lastMaxTestAt: D('2026-07-01T00:00:00') });
  expect(needsRecalibration(c, D('2026-07-09T00:00:00'), 7)).toBe(true);
  expect(needsRecalibration(c, D('2026-07-09T00:00:00'), 14)).toBe(false);
});
```

- [x] **Step 5: Override today's decision in `startTodaySession`**

After `resolveToday`:

```ts
const schedule = assessmentSchedule(state, now);
let decision = resolveToday(
  state.courseState,
  now,
  schedule.intervalDays,
);

if (schedule.due && decision.dayType !== 'REST' && !decision.blocked) {
  decision = schedule.eligible
    ? {
        ...decision,
        dayType: 'MAX',
        blocked: false,
        reason: null,
      }
    : {
        ...decision,
        dayType: 'REST',
        blocked: true,
        reason: 'MAX assessment postponed for recovery',
      };
}
```

Add this exact field to `StartTodayResult` and its returned object:

```ts
assessmentSchedule: AssessmentSchedule;
```

Return:

```ts
return {
  plan,
  decision,
  needsBaseline,
  appliedDifficulty,
  earlyContractionThresholds,
  assessmentSchedule: schedule,
};
```

Import the `AssessmentSchedule` type from the domain module.

- [x] **Step 6: Add start-session tests**

```ts
it('injects MAX on a due and recovered training slot', () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 200,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  const result = startTodaySession(state, 15 * DAY_MS);
  expect(result.decision.dayType).toBe('MAX');
  expect(result.plan?.type).toBe('MAX');
});

it('prescribes recovery when MAX is due after a hard recent session', () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 200,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  state.sessions = [makeSession({
    rpe: 'hard',
    finishedAt: 14 * DAY_MS,
  })];

  const result = startTodaySession(state, 15 * DAY_MS);
  expect(result.decision.dayType).toBe('REST');
  expect(result.assessmentSchedule.postponed).toBe(true);
});

it('does not bypass the one-session-per-day block for a due MAX', () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 200,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  state.courseState.lastTrainedAt = 15 * DAY_MS;

  const result = startTodaySession(state, 15 * DAY_MS);
  expect(result.decision.blocked).toBe(true);
  expect(result.decision.reason).toMatch(/already trained today/i);
  expect(result.plan).toBeNull();
});
```

- [x] **Step 7: Run cadence, course, and start-session tests**

Run:

```powershell
npm test -- src/domain/apnea/assessmentSchedule.test.ts src/domain/apnea/courseEngine.test.ts src/application/usecases/startTodaySession.test.ts
```

Expected: PASS.

- [x] **Step 8: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 5: Build the Set/Edit/Clear Goal Flow

**Files:**
- Modify: `src/ui/design-system/format.ts`
- Modify: `src/ui/design-system/format.test.ts`
- Create: `src/ui/screens/SetGoalScreen.tsx`
- Create: `src/ui/screens/SetGoalScreen.test.tsx`
- Modify: `src/ui/app/routes.tsx`
- Modify: `src/ui/app/routes.test.tsx`
- Modify: `src/ui/screens/BaselineScreen.tsx`
- Modify: `src/ui/screens/BaselineScreen.test.tsx`

- [x] **Step 1: Write strict duration parser tests**

Add to `format.test.ts`:

```ts
import { parseMMSS } from './format';

it('parses m:ss duration input', () => {
  expect(parseMMSS('4:30')).toBe(270);
  expect(parseMMSS('0:45')).toBe(45);
});

it('rejects malformed or non-positive durations', () => {
  expect(parseMMSS('4:75')).toBeNull();
  expect(parseMMSS('abc')).toBeNull();
  expect(parseMMSS('0:00')).toBeNull();
  expect(parseMMSS(`${'9'.repeat(400)}:00`)).toBeNull();
});
```

- [x] **Step 2: Implement strict duration parsing**

Add to `format.ts`:

```ts
export function parseMMSS(value: string): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
```

- [x] **Step 3: Write SetGoal screen tests**

Create `src/ui/screens/SetGoalScreen.test.tsx`:

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SetGoalScreen } from './SetGoalScreen';
import { makeBaseline, makeState } from '../../test/fixtures';
import type { AppState } from '../../domain/models/types';

function renderGoal(state = makeState({
  baselines: [makeBaseline({ maxHoldSec: 180 })],
}), setState = vi.fn(async (_state: AppState) => {})) {
  const repository = {
    getState: vi.fn(async () => state),
    setState,
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/goal']}>
          <Routes>
            <Route path="/goal" element={<SetGoalScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return setState;
}

it('saves a valid mm:ss goal', async () => {
  const setState = renderGoal();
  await userEvent.type(await screen.findByLabelText(/target hold/i), '4:00');
  await userEvent.click(screen.getByRole('button', { name: /save goal/i }));

  await waitFor(() => expect(setState).toHaveBeenCalledOnce());
});

it('shows a soft warning above twice the current max', async () => {
  renderGoal();
  await userEvent.type(await screen.findByLabelText(/target hold/i), '7:00');
  expect(screen.getByText(/ambitious target/i)).toBeInTheDocument();
  expect(screen.getByText(/proposed improvement: 4:00/i)).toBeInTheDocument();
});

it('rejects malformed duration input with an explicit message', async () => {
  renderGoal();
  await userEvent.type(await screen.findByLabelText(/target hold/i), '4:75');
  expect(screen.getByText(/use minutes:seconds/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /save goal/i })).toBeDisabled();
});

it('allows the optional post-baseline step to be skipped', async () => {
  renderGoal();
  await userEvent.click(
    await screen.findByRole('button', { name: /skip for now/i }),
  );
  expect(screen.getByText('home-root')).toBeInTheDocument();
});

it('prefills an active goal for editing after hydration', async () => {
  const state = makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
    goal: {
      id: 'goal-1',
      targetHoldSec: 240,
      createdAt: 1,
      startMaxSec: 180,
      achievedAt: null,
    },
  });
  renderGoal(state);
  expect(await screen.findByRole('heading', { name: /edit goal/i }))
    .toBeInTheDocument();
  expect(screen.getByLabelText(/target hold/i)).toHaveValue('4:00');
});

it('surfaces a goal persistence failure without navigating away', async () => {
  const setState = vi.fn(async () => {
    throw new Error('storage unavailable');
  });
  renderGoal(makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
  }), setState);
  await userEvent.type(await screen.findByLabelText(/target hold/i), '4:00');
  await userEvent.click(screen.getByRole('button', { name: /save goal/i }));

  expect(await screen.findByText(/storage unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText('home-root')).not.toBeInTheDocument();
});
```

- [x] **Step 4: Implement SetGoalScreen**

Create `src/ui/screens/SetGoalScreen.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';
import { bestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';
import { useAppStore } from '../app/stores';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { formatMMSS, parseMMSS } from '../design-system/format';

export function SetGoalScreen() {
  const navigate = useNavigate();
  const hydrated = useAppStore((store) => store.hydrated);
  const state = useAppStore((store) => store.state);
  const saveGoal = useAppStore((store) => store.setGoal);
  const editing = state.goal !== null && state.goal.achievedAt === null;
  const initialValue = editing && state.goal
    ? formatMMSS(state.goal.targetHoldSec)
    : '';
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const displayedValue = value ?? initialValue;
  const target = useMemo(
    () => parseMMSS(displayedValue),
    [displayedValue],
  );
  const invalid = displayedValue.trim() !== '' && target === null;
  const current = bestAssessedMaxSec(state);
  const ambitious =
    target !== null
    && target > current * APNEA_DEFAULTS.goal.implausibleFactor;

  async function save() {
    if (target === null || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await saveGoal(target);
      navigate('/');
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save the goal',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!hydrated) return null;

  if (current <= 0) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
        <h2 className="text-2xl font-bold">
          {editing ? 'Edit goal' : 'Set your goal'}
        </h2>
        <Card>
          <p className="text-sm text-[color:var(--text-dim)]">
            Measure a baseline before setting a max-hold goal.
          </p>
        </Card>
        <Button onClick={() => navigate('/baseline')}>Measure baseline</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <h2 className="text-2xl font-bold">Set your goal</h2>
      <Card>
        <div className="text-sm text-[color:var(--text-dim)]">
          Assessed max: {formatMMSS(current)}
        </div>
        <label className="mt-3 block text-sm">
          Target hold
          <input
            aria-label="Target hold"
            inputMode="text"
            autoCapitalize="none"
            placeholder="4:00"
            value={displayedValue}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-xl bg-[color:var(--surface-2)] px-3 py-2"
          />
        </label>
        {ambitious && (
          <p className="mt-2 text-sm text-[color:var(--warn)]">
            This is an ambitious target. ETA will remain low-confidence until new assessments.
          </p>
        )}
        {invalid && (
          <p className="mt-2 text-sm text-[color:var(--danger)]">
            Use minutes:seconds with 00-59 seconds, for example 4:30.
          </p>
        )}
        {target !== null && target > current && (
          <p className="mt-2 text-sm text-[color:var(--text-dim)]">
            Proposed improvement: {formatMMSS(target - current)}
          </p>
        )}
        {target !== null && target <= current && (
          <p className="mt-2 text-sm text-[color:var(--success)]">
            This goal will be recorded as already achieved.
          </p>
        )}
      </Card>
      {saveError && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {saveError}
        </p>
      )}
      <Button disabled={target === null || saving} onClick={() => void save()}>
        Save goal
      </Button>
      <Button variant="ghost" onClick={() => navigate('/')}>
        {editing ? 'Cancel' : 'Skip for now'}
      </Button>
    </div>
  );
}
```

- [x] **Step 5: Add `/goal` routing**

In `routes.tsx`:

```tsx
import { SetGoalScreen } from '../screens/SetGoalScreen';

<Route path="/goal" element={<SetGoalScreen />} />
```

Add a route test:

```ts
it('renders the goal screen at /goal', async () => {
  renderAt('/goal');
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: /set your goal/i }))
      .toBeInTheDocument(),
  );
});
```

- [x] **Step 6: Offer goal setup only after the first baseline**

In `BaselineScreen`, read whether a baseline existed before save:

```ts
const hadBaseline = useAppStore((state) => state.state.baselines.length > 0);
```

Change `finish()`:

```ts
async function finish() {
  await record(attempts, firstContraction);
  navigate(hadBaseline ? '/' : '/goal');
}
```

Add these imports to `BaselineScreen.test.tsx`:

```ts
import { Route, Routes } from 'react-router-dom';
import { SetGoalScreen } from './SetGoalScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';
```

Add this helper:

```tsx
function renderBaselineFlow(state: AppState) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/baseline']}>
          <Routes>
            <Route path="/baseline" element={<BaselineScreen />} />
            <Route path="/goal" element={<SetGoalScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

async function saveOneSecondBaseline() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /start hold/i }));
  act(() => { vi.advanceTimersByTime(1_000); });
  await user.click(screen.getByRole('button', { name: /stop/i }));
  await user.click(screen.getByRole('button', { name: /save baseline/i }));
}
```

Add the two navigation tests:

```ts
it('offers the optional goal step after the first baseline', async () => {
  renderBaselineFlow(emptyAppState());
  await saveOneSecondBaseline();
  expect(await screen.findByRole('heading', { name: /set your goal/i }))
    .toBeInTheDocument();
});

it('returns home after a later baseline assessment', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'existing',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 1,
  }];
  renderBaselineFlow(state);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /start hold/i }))
      .toBeInTheDocument(),
  );
  await saveOneSecondBaseline();
  expect(await screen.findByText('home-root')).toBeInTheDocument();
});
```

- [x] **Step 7: Run parser, goal screen, route, and baseline tests**

Run:

```powershell
npm test -- src/ui/design-system/format.test.ts src/ui/screens/SetGoalScreen.test.tsx src/ui/app/routes.test.tsx src/ui/screens/BaselineScreen.test.tsx
```

Expected: PASS.

- [x] **Step 8: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 6: Add GoalCard to Home and Goal Controls to Settings

**Files:**
- Create: `src/ui/components/GoalCard.tsx`
- Create: `src/ui/components/GoalCard.test.tsx`
- Modify: `src/ui/screens/HomeScreen.tsx`
- Modify: `src/ui/screens/HomeScreen.test.tsx`
- Modify: `src/ui/screens/SettingsScreen.tsx`
- Modify: `src/ui/screens/SettingsScreen.test.tsx`

- [x] **Step 1: Write GoalCard state tests**

Create `src/ui/components/GoalCard.test.tsx`:

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalCard } from './GoalCard';

const active = {
  latestSec: 200,
  bestSec: 210,
  targetSec: 240,
  startSec: 180,
  progressPct: 50,
  ratePerDay: 0.5,
  etaMs: new Date('2026-08-20T00:00:00').getTime(),
  confidence: 'medium' as const,
  stalled: false,
  achieved: false,
};

it('shows progress, ETA confidence, and opens details', async () => {
  const onOpen = vi.fn();
  render(<GoalCard forecast={active} onOpen={onOpen} />);
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText(/medium confidence/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /view goal progress/i }));
  expect(onOpen).toHaveBeenCalledOnce();
});

it('labels a prior-only forecast as low confidence', () => {
  render(
    <GoalCard
      forecast={{ ...active, confidence: 'low' }}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
});

it('shows achieved and stalled states without a fake ETA', () => {
  const { rerender } = render(
    <GoalCard
      forecast={{ ...active, achieved: true, etaMs: null, progressPct: 100 }}
      onOpen={() => {}}
      onSetGoal={() => {}}
    />,
  );
  expect(screen.getByText(/goal reached/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /view goal progress/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /set a higher goal/i }))
    .toBeInTheDocument();

  rerender(
    <GoalCard forecast={{ ...active, stalled: true, etaMs: null }} onOpen={() => {}} />,
  );
  expect(screen.getByText(/progress stalled/i)).toBeInTheDocument();
});
```

- [x] **Step 2: Implement GoalCard**

Create `src/ui/components/GoalCard.tsx`:

```tsx
import type { GoalForecast } from '../../domain/apnea/goalEngine';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { ProgressRing } from '../design-system/ProgressRing';
import { formatMMSS } from '../design-system/format';

function etaText(forecast: GoalForecast): string {
  if (forecast.achieved) return 'Goal reached';
  if (forecast.stalled) return 'Progress stalled';
  if (forecast.etaMs === null) return 'ETA unavailable';
  return `ETA ${new Date(forecast.etaMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`;
}

export function GoalCard({
  forecast,
  onOpen,
  onSetGoal,
}: {
  forecast: GoalForecast;
  onOpen: () => void;
  onSetGoal?: () => void;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
        Max-hold goal
      </div>
      <ProgressRing
        progress={forecast.progressPct / 100}
        label={`${Math.round(forecast.progressPct)}%`}
        sublabel={`${formatMMSS(forecast.bestSec)} / ${formatMMSS(forecast.targetSec)}`}
        color="var(--cyan)"
      />
      <div className="text-center font-semibold">{etaText(forecast)}</div>
      {!forecast.achieved && !forecast.stalled && (
        <div className="text-center text-xs text-[color:var(--text-dim)]">
          {forecast.confidence} confidence
        </div>
      )}
      {forecast.stalled && (
        <p className="mt-2 text-center text-sm text-[color:var(--text-dim)]">
          Recent assessments are flat or declining. Consolidate, recover, then reassess.
        </p>
      )}
      <Button variant="ghost" className="mt-3 w-full" onClick={onOpen}>
        View goal progress
      </Button>
      {forecast.achieved && onSetGoal && (
        <Button className="mt-2 w-full" onClick={onSetGoal}>
          Set a higher goal
        </Button>
      )}
    </Card>
  );
}
```

- [x] **Step 3: Render goal or CTA on Home**

In `HomeScreen.tsx`:

```ts
import { goalForecast } from '../../domain/apnea/goalEngine';
import { GoalCard } from '../components/GoalCard';

const forecast = state.goal ? goalForecast(state, state.goal, now) : null;
```

Render after the personal-best card:

```tsx
{forecast ? (
  <GoalCard
    forecast={forecast}
    onOpen={() => navigate('/stats', { state: { focus: 'goal' } })}
    onSetGoal={forecast.achieved ? () => navigate('/goal') : undefined}
  />
) : (
  <Button variant="ghost" onClick={() => navigate('/goal')}>
    Set a max-hold goal
  </Button>
)}
```

Keep using the existing `today.decision.reason` block for postponed-assessment
copy; do not render a second duplicate warning.

- [x] **Step 4: Add Settings goal controls**

In `SettingsScreen.tsx`, read:

```ts
const clearGoal = useAppStore((store) => store.clearGoal);
```

Add:

```tsx
<Card>
  <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
    Goal
  </div>
  {state.goal ? (
    <div className="grid gap-2">
      <div className="text-sm">
        Target: {formatMMSS(state.goal.targetHoldSec)}
      </div>
      <Button variant="ghost" onClick={() => navigate('/goal')}>Edit goal</Button>
      <Button variant="danger" onClick={() => void clearGoal()}>Clear goal</Button>
    </div>
  ) : (
    <Button variant="ghost" onClick={() => navigate('/goal')}>Set a goal</Button>
  )}
</Card>
```

Import `useNavigate` and `formatMMSS`.

- [x] **Step 5: Add Home and Settings tests**

Home:

```ts
it('shows a goal CTA when no goal exists', async () => {
  renderHome(emptyAppState(), D('2026-07-09T10:00:00'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /set a max-hold goal/i }))
      .toBeInTheDocument(),
  );
});
```

Settings:

```ts
it('clears an active goal', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 1,
  }];
  state.goal = {
    id: 'g',
    targetHoldSec: 240,
    createdAt: 1,
    startMaxSec: 180,
    achievedAt: null,
  };
  const saved: AppState[] = [];
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (next: AppState) => { saved.push(next); }),
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter><SettingsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );

  await userEvent.click(
    await screen.findByRole('button', { name: /clear goal/i }),
  );
  await waitFor(() => expect(saved.at(-1)?.goal).toBeNull());
});
```

Add `vi` and `waitFor` to the Vitest/Testing Library imports, and import
`emptyAppState`, `AppState`, and `MemoryRouter`.

- [x] **Step 6: Run GoalCard, Home, and Settings tests**

Run:

```powershell
npm test -- src/ui/components/GoalCard.test.tsx src/ui/screens/HomeScreen.test.tsx src/ui/screens/SettingsScreen.test.tsx
```

Expected: PASS.

- [x] **Step 7: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 7: Add the Hand-Rolled SVG Progress Chart

**Files:**
- Create: `src/ui/design-system/ProgressChart.tsx`
- Create: `src/ui/design-system/ProgressChart.test.tsx`
- Modify: `src/ui/screens/StatsScreen.tsx`
- Modify: `src/ui/screens/StatsScreen.test.tsx`

- [x] **Step 1: Write chart primitive tests**

Create `src/ui/design-system/ProgressChart.test.tsx`:

```tsx
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressChart } from './ProgressChart';

it('renders actual points, a goal line, and projected path', () => {
  render(
    <ProgressChart
      actual={[
        { id: 'a', at: 1_000, sec: 180 },
        { id: 'b', at: 2_000, sec: 190 },
      ]}
      projected={[
        { at: 2_000, sec: 190 },
        { at: 3_000, sec: 210 },
      ]}
      targetSec={210}
    />,
  );

  expect(screen.getAllByTestId('actual-point')).toHaveLength(2);
  expect(screen.getByTestId('goal-line')).toBeInTheDocument();
  expect(screen.getByTestId('projected-path')).toBeInTheDocument();
  expect(screen.getAllByTestId('axis-label')).toHaveLength(4);
});
```

- [x] **Step 2: Implement the pure SVG chart**

Create `src/ui/design-system/ProgressChart.tsx`:

```tsx
import type { MaxPoint } from '../../domain/apnea/assessmentHistory';
import type { ProjectionPoint } from '../../domain/apnea/goalEngine';
import { formatMMSS } from './format';

const WIDTH = 320;
const HEIGHT = 180;
const PAD = 28;

export function ProgressChart({
  actual,
  projected,
  targetSec,
}: {
  actual: MaxPoint[];
  projected: ProjectionPoint[];
  targetSec: number;
}) {
  const all = [
    ...actual.map((point) => ({ at: point.at, sec: point.sec })),
    ...projected,
    { at: projected.at(-1)?.at ?? actual.at(-1)?.at ?? 0, sec: targetSec },
  ];
  const minAt = Math.min(...all.map((point) => point.at));
  const maxAt = Math.max(...all.map((point) => point.at), minAt + 1);
  const minSec = Math.min(...all.map((point) => point.sec));
  const maxSec = Math.max(...all.map((point) => point.sec), minSec + 1);
  const x = (at: number) =>
    PAD + ((at - minAt) / (maxAt - minAt)) * (WIDTH - PAD * 2);
  const y = (sec: number) =>
    HEIGHT - PAD - ((sec - minSec) / (maxSec - minSec)) * (HEIGHT - PAD * 2);
  const path = (points: Array<{ at: number; sec: number }>) =>
    points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${x(point.at)} ${y(point.sec)}`,
    ).join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Goal progress chart"
      className="w-full"
    >
      <line
        data-testid="goal-line"
        x1={PAD}
        x2={WIDTH - PAD}
        y1={y(targetSec)}
        y2={y(targetSec)}
        stroke="var(--warn)"
        strokeDasharray="4 4"
      />
      <path
        d={path(actual)}
        fill="none"
        stroke="var(--cyan)"
        strokeWidth="3"
      />
      <path
        data-testid="projected-path"
        d={path(projected)}
        fill="none"
        stroke="var(--teal)"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      {actual.map((point) => (
        <circle
          key={point.id}
          data-testid="actual-point"
          cx={x(point.at)}
          cy={y(point.sec)}
          r="4"
          fill="var(--cyan)"
        />
      ))}
      <text x={PAD} y={16} fill="var(--text-dim)" fontSize="10">
        Goal {formatMMSS(targetSec)}
      </text>
      <text data-testid="axis-label" x="2" y={y(maxSec)} fill="var(--text-dim)" fontSize="9">
        {formatMMSS(maxSec)}
      </text>
      <text data-testid="axis-label" x="2" y={y(minSec)} fill="var(--text-dim)" fontSize="9">
        {formatMMSS(minSec)}
      </text>
      <text data-testid="axis-label" x={PAD} y={HEIGHT - 4} fill="var(--text-dim)" fontSize="9">
        {new Date(minAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </text>
      <text
        data-testid="axis-label"
        x={WIDTH - PAD}
        y={HEIGHT - 4}
        textAnchor="end"
        fill="var(--text-dim)"
        fontSize="9"
      >
        {new Date(maxAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </text>
    </svg>
  );
}
```

- [x] **Step 3: Run the chart test**

Run:

```powershell
npm test -- src/ui/design-system/ProgressChart.test.tsx
```

Expected: PASS.

- [x] **Step 4: Integrate goal progress into Stats**

In `StatsScreen.tsx`:

```ts
import { assessmentHistory } from '../../domain/apnea/assessmentHistory';
import {
  goalForecast,
  projectedTrajectory,
  trajectoryStatus,
} from '../../domain/apnea/goalEngine';
import { ProgressChart } from '../design-system/ProgressChart';
import { ProgressRing } from '../design-system/ProgressRing';

const forecast = state.goal ? goalForecast(state, state.goal, now) : null;
```

Render before recent sessions:

```tsx
{state.goal && forecast ? (
  <Card>
    <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
      Goal progress
    </div>
    <ProgressRing
      progress={forecast.progressPct / 100}
      label={`${Math.round(forecast.progressPct)}%`}
      sublabel={`${formatMMSS(forecast.bestSec)} / ${formatMMSS(forecast.targetSec)}`}
      color="var(--cyan)"
    />
    <ProgressChart
      actual={assessmentHistory(state)}
      projected={projectedTrajectory(state, state.goal, now)}
      targetSec={state.goal.targetHoldSec}
    />
    <div className="flex justify-between text-sm text-[color:var(--text-dim)]">
      <span>{trajectoryStatus(state, state.goal)}</span>
      <span>{forecast.confidence} confidence</span>
    </div>
  </Card>
) : (
  <Button variant="ghost" onClick={() => navigate('/goal')}>
    Set a goal
  </Button>
)}
```

Import `useNavigate`.

- [x] **Step 5: Add Stats integration tests**

Add to `StatsScreen.test.tsx`:

```ts
it('renders assessed points, goal line, projection, and confidence', async () => {
  const state = emptyAppState();
  state.baselines = [
    { id: 'a', measuredAt: 1_000, maxHoldSec: 180, firstContractionSec: null },
    { id: 'b', measuredAt: 2_000, maxHoldSec: 190, firstContractionSec: null },
  ];
  state.goal = {
    id: 'g',
    targetHoldSec: 240,
    createdAt: 1_000,
    startMaxSec: 180,
    achievedAt: null,
  };
  renderStats(state);

  await waitFor(() => expect(screen.getByTestId('goal-line')).toBeInTheDocument());
  expect(screen.getAllByTestId('actual-point')).toHaveLength(2);
  expect(screen.getByText(/confidence/i)).toBeInTheDocument();
});
```

Add this helper to `StatsScreen.test.tsx` and use it in both the existing
split-level test and the new goal-chart test:

```tsx
function renderStats(
  state: AppState,
  now = new Date('2026-07-09T10:00:00').getTime(),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  render(
    <ServicesProvider value={{ repository, clock: new FakeClock(now) }}>
      <AppProviders>
        <MemoryRouter><StatsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}
```

Import `MemoryRouter`, `FakeClock`, and `AppState`; retain the existing
Testing Library and Vitest imports.

- [x] **Step 6: Run chart and Stats tests**

Run:

```powershell
npm test -- src/ui/design-system/ProgressChart.test.tsx src/ui/screens/StatsScreen.test.tsx
```

Expected: PASS.

- [x] **Step 7: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 8: Surface Assessment State in Home and Program

**Files:**
- Modify: `src/ui/screens/HomeScreen.tsx`
- Modify: `src/ui/screens/HomeScreen.test.tsx`
- Modify: `src/ui/screens/ProgramScreen.tsx`
- Modify: `src/ui/screens/ProgramScreen.test.tsx`
- Modify: `src/ui/screens/SummaryScreen.tsx`
- Modify: `src/ui/screens/SummaryScreen.test.tsx`

- [x] **Step 1: Add Home assessment-state tests**

Add:

```ts
it('explains when a due MAX assessment is postponed for recovery', async () => {
  const now = D('2026-07-20T10:00:00');
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: D('2026-07-01T10:00:00'),
  }];
  state.courseState.lastMaxTestAt = D('2026-07-01T10:00:00');
  state.sessions = [makeSession({
    rpe: 'hard',
    finishedAt: D('2026-07-19T10:00:00'),
  })];

  renderHome(state, now);
  await waitFor(() =>
    expect(screen.getByText(/postponed for recovery/i)).toBeInTheDocument(),
  );
});
```

- [x] **Step 2: Make Home's tomorrow copy use the same goal-aware resolver**

Replace:

```ts
const tomorrow = resolveToday(state.courseState, now + DAY_MS);
```

with:

```ts
const tomorrow = startTodaySession(state, now + DAY_MS).decision;
```

Remove the now-unused `resolveToday` import.

- [x] **Step 3: Add Program assessment card**

In `ProgramScreen.tsx`, make the visible week use the same synchronized course
state that can apply a queued profile:

```ts
const now = clock.now();
const syncedCourse = syncRestDays(state.courseState, now);
const days = syncedCourse.template.days;
const synced = syncedCourse.position % days.length;
```

Remove the old `days`, `now`, and `synced` declarations, then compute:

```ts
const today = startTodaySession(state, now);
```

Use `syncedCourse.microcycleProfile` and
`syncedCourse.pendingMicrocycleProfile` in the existing training-profile card so
its labels match the synchronized template.

Inside the weekly `days.map` callback, display the resolved MAX override for the
current slot:

```ts
const displayedDay = isCurrent ? today.decision.dayType : d;
```

and replace the existing final day label with:

```tsx
<span>{isCompleted ? '✓ ' : ''}{displayedDay}{suffix}</span>
```

Render:

```tsx
{today.assessmentSchedule.due && (
  <Card className={today.assessmentSchedule.postponed
    ? 'border-[color:var(--warn)]'
    : 'border-[color:var(--cyan)]'}>
    <div className="font-semibold">
      {today.assessmentSchedule.postponed
        ? 'MAX assessment postponed'
        : 'MAX assessment due'}
    </div>
    <div className="text-sm text-[color:var(--text-dim)]">
      {today.assessmentSchedule.postponed
        ? 'Recovery gate is active.'
        : `Current cadence: ${today.assessmentSchedule.intervalDays} days.`}
    </div>
  </Card>
)}
```

- [x] **Step 4: Show post-rating assessment state in Summary**

In `SummaryScreen.tsx`, import `assessmentSchedule` and read the clock:

```ts
import { assessmentSchedule } from '../../domain/apnea/assessmentSchedule';
import { useServices } from '../app/services';

const { clock } = useServices();
const schedule = completion
  ? assessmentSchedule(completion.state, clock.now())
  : null;
```

Inside the completed state, after the progression/profile explanation, render:

```tsx
{schedule?.due && (
  <p className="mt-1 text-sm text-[color:var(--warn)]">
    {schedule.postponed
      ? 'MAX assessment is due but postponed for recovery.'
      : 'MAX assessment is due and ready.'}
  </p>
)}
```

Replace the `renderSummary` helper in `SummaryScreen.test.tsx` with:

```tsx
function renderSummary({
  state = emptyAppState(),
  session = makeSession({ rpe: null }),
  now = 2_000,
  setState = vi.fn(async (_state: AppState) => {}),
}: {
  state?: AppState;
  session?: Session;
  now?: number;
  setState?: (state: AppState) => Promise<void>;
} = {}) {
  const repository = {
    getState: vi.fn(async () => state),
    setState,
  };
  render(
    <ServicesProvider value={{ repository, clock: new FakeClock(now) }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{
          pathname: '/summary',
          state: { session },
        }]}>
          <Routes>
            <Route path="/summary" element={<SummaryScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return setState;
}
```

Import `Session`, `FakeClock`, and `DAY_MS`. Update the two existing positional
calls to `renderSummary({ setState })`, then add:

```ts
it('shows a due assessment as postponed immediately after rated work', async () => {
  const now = 15 * DAY_MS;
  const state = emptyAppState();
  state.baselines = [{
    id: 'baseline',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  renderSummary({
    state,
    now,
    session: makeSession({ rpe: null, finishedAt: now }),
  });

  await userEvent.click(
    screen.getByRole('button', { name: /normal effort/i }),
  );
  expect(await screen.findByText(/postponed for recovery/i))
    .toBeInTheDocument();
});
```

- [x] **Step 5: Add Program tests**

```ts
it('shows goal-aware assessment cadence when MAX is due', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  renderProgram(state, 15 * DAY_MS);

  await waitFor(() =>
    expect(screen.getByText(/max assessment due/i)).toBeInTheDocument(),
  );
  expect(screen.getByText(/MAX · today/i)).toBeInTheDocument();
});
```

- [x] **Step 6: Run Home, Program, and Summary tests**

Run:

```powershell
npm test -- src/ui/screens/HomeScreen.test.tsx src/ui/screens/ProgramScreen.test.tsx src/ui/screens/SummaryScreen.test.tsx
```

Expected: PASS.

- [x] **Step 7: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 9: Run the Full Goal-Feature Regression

**Files:**
- No planned file modifications.

- [x] **Step 1: Run all goal-specific tests**

Run:

```powershell
npm test -- src/domain/apnea/goalEngine.test.ts src/domain/apnea/assessmentSchedule.test.ts src/application/usecases/manageGoal.test.ts src/ui/screens/SetGoalScreen.test.tsx src/ui/components/GoalCard.test.tsx src/ui/design-system/ProgressChart.test.tsx
```

Expected: all goal-domain and goal-UI suites pass.

- [x] **Step 2: Run the full test suite**

Run:

```powershell
npm test
```

Expected: all Vitest suites pass.

- [x] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code 0.

- [x] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build successfully.

- [x] **Step 5: Verify the core forecast and safety invariants**

Run:

```powershell
npm test -- src/domain/apnea/goalEngine.test.ts src/domain/apnea/assessmentSchedule.test.ts src/application/usecases/finishSession.test.ts src/domain/apnea/tableGenerator.o2.test.ts
```

Expected:

```text
Larger goal gaps produce later ETA.
Ordinary training holds never achieve the goal.
Three non-positive post-goal assessments produce stalled with no ETA.
Hard/failed/auto-eased sessions postpone MAX for recovery.
O₂ holds remain capped at 80% of latest assessed max.
```

- [x] **Step 6: Review the final uncommitted change set**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: only goal/forecast/cadence/UI files plus their direct integration points
are changed; no commit or push is created.
