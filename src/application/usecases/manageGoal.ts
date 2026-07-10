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
