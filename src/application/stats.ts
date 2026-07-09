import type { AppState } from '../domain/models/types';
import { DAY_MS } from '../domain/apnea/config';
import { startOfDay, isSameCalendarDay } from '../domain/apnea/time';

export function personalBestSec(state: AppState): number {
  const baselineMax = state.baselines.reduce((m, b) => Math.max(m, b.maxHoldSec), 0);
  const sessionMax = state.sessions.reduce((m, s) => {
    const best = s.rounds.reduce((rm, r) => Math.max(rm, r.achievedHoldSec), 0);
    return Math.max(m, best);
  }, 0);
  return Math.max(baselineMax, sessionMax);
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

export { isSameCalendarDay };
