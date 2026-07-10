import type {
  AppState,
  SessionQuality,
  TrainingSessionType,
} from '../domain/models/types';
import { DAY_MS } from '../domain/apnea/config';
import { bestAssessedMaxSec } from '../domain/apnea/assessmentHistory';
import {
  classifySession,
  medianContractionOnsetRatio,
} from '../domain/apnea/qualityEngine';
import { startOfDay, isSameCalendarDay } from '../domain/apnea/time';

export function personalBestSec(state: AppState): number {
  return bestAssessedMaxSec(state);
}

export function weeklySessionCount(state: AppState, now: number): number {
  const cutoff = now - 7 * DAY_MS;
  return state.sessions.filter((s) => s.finishedAt >= cutoff).length;
}

export function currentStreakDays(state: AppState, now: number): number {
  const days = new Set(state.sessions.map((s) => startOfDay(s.finishedAt)));
  if (days.size === 0) return 0;
  let cursor = startOfDay(now);
  // Allow the streak to end today or yesterday.
  if (!days.has(cursor)) cursor -= DAY_MS;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

export function adherencePct(state: AppState, now: number, windowDays = 28): number {
  const trainingSlots = state.courseState.template.days.filter((d) => d !== 'REST').length;
  const perWeek = trainingSlots; // template is one week
  const expected = (windowDays / 7) * perWeek;
  if (expected <= 0) return 0;
  const cutoff = now - windowDays * DAY_MS;
  const done = state.sessions.filter((s) => s.finishedAt >= cutoff).length;
  return Math.min(100, Math.round((done / expected) * 100));
}

export function latestSessionQuality(state: AppState): SessionQuality | null {
  const sessions = state.sessions
    .filter((session) => session.type !== 'MAX')
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const latest = sessions.at(-1);
  if (!latest) return null;
  return classifySession(latest, sessions.slice(0, -1));
}

export function medianContractionOnsetPct(
  state: AppState,
  type: TrainingSessionType,
): number | null {
  const ratio = medianContractionOnsetRatio(state.sessions, type);
  return ratio === null ? null : Math.round(ratio * 100);
}

export { isSameCalendarDay };
