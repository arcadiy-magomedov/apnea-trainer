import { DAY_MS } from './config';

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function calendarDaysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function isSameCalendarDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}
