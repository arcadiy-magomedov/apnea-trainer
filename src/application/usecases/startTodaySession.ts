import type { AppState, SessionPlan, TodayDecision } from '../../domain/models/types';
import { resolveToday } from '../../domain/apnea/courseEngine';
import { generatePlanForDay } from '../../domain/apnea/tableGenerator';
import { personalBestSec } from '../stats';

export interface StartTodayResult {
  plan: SessionPlan | null;
  decision: TodayDecision;
  needsBaseline: boolean;
  appliedDifficulty: number;
}

export function startTodaySession(state: AppState, now: number): StartTodayResult {
  const decision = resolveToday(state.courseState, now);
  const maxHold = personalBestSec(state);
  const needsBaseline = state.baselines.length === 0;
  const appliedDifficulty = decision.deload
    ? Math.max(0, state.courseState.difficultyLevel - 1)
    : state.courseState.difficultyLevel;
  const plan = needsBaseline
    ? null
    : generatePlanForDay(decision.dayType, maxHold, appliedDifficulty);
  return { plan, decision, needsBaseline, appliedDifficulty };
}
