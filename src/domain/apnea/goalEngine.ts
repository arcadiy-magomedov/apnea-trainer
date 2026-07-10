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

export interface ProjectionPoint {
  at: number;
  sec: number;
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
      sec: fraction === 0
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
