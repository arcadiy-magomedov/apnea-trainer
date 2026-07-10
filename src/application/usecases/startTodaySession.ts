import type { AppState, SessionPlan, TodayDecision } from '../../domain/models/types';
import { resolveToday } from '../../domain/apnea/courseEngine';
import { generatePlanForDay } from '../../domain/apnea/tableGenerator';
import { latestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';
import { effectiveEarlyThreshold } from '../../domain/apnea/qualityEngine';
import {
  assessmentSchedule,
  type AssessmentSchedule,
} from '../../domain/apnea/assessmentSchedule';

export interface StartTodayResult {
  plan: SessionPlan | null;
  decision: TodayDecision;
  needsBaseline: boolean;
  appliedDifficulty: number;
  earlyContractionThresholds: number[];
  assessmentSchedule: AssessmentSchedule;
}

export function startTodaySession(state: AppState, now: number): StartTodayResult {
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
  const maxHold = latestAssessedMaxSec(state);
  const needsBaseline = maxHold <= 0;
  const trainingType = decision.dayType === 'CO2' || decision.dayType === 'O2'
    ? decision.dayType
    : null;
  const baseDifficulty = trainingType === null
    ? 0
    : state.courseState.difficultyByType[trainingType];
  const appliedDifficulty = decision.deload
    ? Math.max(0, baseDifficulty - 1)
    : baseDifficulty;
  const plan = needsBaseline || decision.blocked
    ? null
    : generatePlanForDay(decision.dayType, maxHold, appliedDifficulty);
  const earlyContractionThresholds = plan && trainingType
    ? plan.rounds.map((round) =>
        effectiveEarlyThreshold(
          state.sessions,
          trainingType,
          round.index,
        ),
      )
    : [];

  return {
    plan,
    decision,
    needsBaseline,
    appliedDifficulty,
    earlyContractionThresholds,
    assessmentSchedule: schedule,
  };
}
