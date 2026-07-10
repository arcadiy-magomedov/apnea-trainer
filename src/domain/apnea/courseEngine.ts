import type { CourseState, DayType, TodayDecision } from '../models/types';
import { APNEA_DEFAULTS, DAY_MS } from './config';
import { applyPendingProfileAtBoundary } from './microcycleProfiles';
import { startOfDay, isSameCalendarDay } from './time';

function slotAt(c: CourseState, position: number): DayType {
  return c.template.days[position % c.template.days.length];
}

export function syncRestDays(c: CourseState, now: number): CourseState {
  let position = c.position;
  let lastAdvanceAt = c.lastAdvanceAt ?? startOfDay(now);
  // Consume REST slots for each calendar day that has elapsed.
  while (
    slotAt(c, position) === 'REST' &&
    startOfDay(now) > startOfDay(lastAdvanceAt)
  ) {
    position += 1;
    lastAdvanceAt = startOfDay(lastAdvanceAt) + DAY_MS;
  }
  return applyPendingProfileAtBoundary({
    ...c,
    position,
    lastAdvanceAt,
  }, now);
}

export function needsRecalibration(
  c: CourseState,
  now: number,
  intervalDays: number = APNEA_DEFAULTS.recalibrationDays,
): boolean {
  if (c.lastMaxTestAt === null) return false;
  return now - c.lastMaxTestAt >= intervalDays * DAY_MS;
}

export function resolveToday(
  c: CourseState,
  now: number,
  recalibrationIntervalDays: number = APNEA_DEFAULTS.recalibrationDays,
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

export function completeSession(c: CourseState, now: number): CourseState {
  return applyPendingProfileAtBoundary({
    ...c,
    position: c.position + 1,
    lastTrainedAt: now,
    // Anchor the next slot to tomorrow so a REST slot we advance into occupies
    // its own calendar day (it is consumed the day *after* it becomes current),
    // matching the microcycle the Program screen shows.
    lastAdvanceAt: startOfDay(now) + DAY_MS,
  }, now);
}

export function trainedToday(c: CourseState, now: number): boolean {
  return c.lastTrainedAt !== null && isSameCalendarDay(c.lastTrainedAt, now);
}
