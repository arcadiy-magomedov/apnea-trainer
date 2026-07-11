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

export function addCalendarDays(t: number, days: number): number {
  const date = new Date(startOfDay(t));
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function localDateKey(t: number): string {
  const date = new Date(t);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfLocalMonth(t: number): number {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.getTime();
}

/** Returns the local start of the month `months` away from `t`. */
export function addCalendarMonths(t: number, months: number): number {
  const date = new Date(startOfLocalMonth(t));
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}
