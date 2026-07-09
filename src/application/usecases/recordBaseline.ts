import type { AppState } from '../../domain/models/types';
import { computeBaseline } from '../../domain/apnea/baselineCalc';

export function recordBaseline(
  state: AppState,
  attemptsSec: number[],
  firstContractionSec: number | null,
  now: number,
): AppState {
  const baseline = computeBaseline(attemptsSec, firstContractionSec, `baseline-${now}`, now);
  return {
    ...state,
    baselines: [...state.baselines, baseline],
    courseState: { ...state.courseState, lastMaxTestAt: now },
  };
}
