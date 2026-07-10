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
  const elapsedRecoveryDays = Math.round(
    (startOfDay(now) - startOfDay(latest.finishedAt)) / DAY_MS,
  );
  const eligible = elapsedRecoveryDays >= recoveryDaysRequired;

  return {
    intervalDays,
    due,
    eligible,
    postponed: due && !eligible,
    recoveryDaysRequired,
  };
}
