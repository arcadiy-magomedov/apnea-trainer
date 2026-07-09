import type { CourseState, DayType, TodayDecision } from '../models/types';
import { APNEA_DEFAULTS, DAY_MS } from './config';
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
  return { ...c, position, lastAdvanceAt };
}

export function needsRecalibration(c: CourseState, now: number): boolean {
  if (c.lastMaxTestAt === null) return false;
  return now - c.lastMaxTestAt >= APNEA_DEFAULTS.recalibrationDays * DAY_MS;
}

export function resolveToday(c: CourseState, now: number): TodayDecision {
  const synced = syncRestDays(c, now);
  let dayType = slotAt(synced, synced.position);
  if (dayType !== 'REST' && needsRecalibration(synced, now)) {
    dayType = 'MAX';
  }
  const gapDays = synced.lastTrainedAt === null
    ? 0
    : Math.round((startOfDay(now) - startOfDay(synced.lastTrainedAt)) / DAY_MS);
  const deload = gapDays > APNEA_DEFAULTS.detraining.deloadDays;
  const suggestRetest = gapDays > APNEA_DEFAULTS.detraining.retestDays;

  let blocked = false;
  let reason: string | null = null;
  if (dayType === 'REST') {
    blocked = true;
    reason = 'Rest day — recovery is part of the program';
  } else if (synced.lastTrainedAt !== null && isSameCalendarDay(synced.lastTrainedAt, now)) {
    blocked = true;
    reason = 'Already trained today';
  }
  return { dayType, blocked, reason, deload, suggestRetest };
}

export function completeSession(c: CourseState, now: number): CourseState {
  return {
    ...c,
    position: c.position + 1,
    lastTrainedAt: now,
    lastAdvanceAt: startOfDay(now),
  };
}
