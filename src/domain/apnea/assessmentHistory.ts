import type { AppState } from '../models/types';

export interface MaxPoint {
  id: string;
  at: number;
  sec: number;
}

export function assessmentHistory(state: AppState): MaxPoint[] {
  return state.baselines
    .map((baseline) => ({
      id: baseline.id,
      at: baseline.measuredAt,
      sec: baseline.maxHoldSec,
    }))
    .sort((left, right) => left.at - right.at);
}

export function latestAssessedMaxSec(state: AppState): number {
  const history = assessmentHistory(state);
  if (history.length === 0) return 0;

  const latestAt = history[history.length - 1].at;
  return history.reduce(
    (best, point) => (point.at === latestAt ? Math.max(best, point.sec) : best),
    0,
  );
}

export function bestAssessedMaxSec(state: AppState): number {
  return assessmentHistory(state).reduce((best, point) => Math.max(best, point.sec), 0);
}
