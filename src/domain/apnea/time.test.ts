import { describe, it, expect } from 'vitest';
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  isSameCalendarDay,
  localDateKey,
  startOfDay,
  startOfLocalMonth,
} from './time';

const D = (iso: string) => new Date(iso).getTime();

describe('time helpers', () => {
  it('startOfDay truncates to local midnight', () => {
    const t = D('2026-07-09T15:30:00');
    expect(startOfDay(t)).toBe(D('2026-07-09T00:00:00'));
  });

  it('calendarDaysBetween counts whole calendar days', () => {
    expect(calendarDaysBetween(D('2026-07-09T23:00:00'), D('2026-07-10T01:00:00'))).toBe(1);
    expect(calendarDaysBetween(D('2026-07-09T01:00:00'), D('2026-07-09T23:00:00'))).toBe(0);
    expect(calendarDaysBetween(D('2026-07-01T00:00:00'), D('2026-07-16T00:00:00'))).toBe(15);
  });

  it('isSameCalendarDay compares by local day', () => {
    expect(isSameCalendarDay(D('2026-07-09T00:01:00'), D('2026-07-09T23:59:00'))).toBe(true);
    expect(isSameCalendarDay(D('2026-07-09T23:59:00'), D('2026-07-10T00:01:00'))).toBe(false);
  });

  it('adds local calendar days across month and year boundaries', () => {
    expect(addCalendarDays(D('2026-07-31T15:00:00'), 1))
      .toBe(D('2026-08-01T00:00:00'));
    expect(addCalendarDays(D('2026-12-31T15:00:00'), 1))
      .toBe(D('2027-01-01T00:00:00'));
  });

  it('creates stable local day keys', () => {
    expect(localDateKey(D('2026-07-09T00:01:00'))).toBe('2026-07-09');
    expect(localDateKey(D('2026-07-09T23:59:00'))).toBe('2026-07-09');
  });

  it('moves between local month starts', () => {
    const july = startOfLocalMonth(D('2026-07-19T12:00:00'));
    expect(july).toBe(D('2026-07-01T00:00:00'));
    expect(addCalendarMonths(july, 1)).toBe(D('2026-08-01T00:00:00'));
    expect(addCalendarMonths(july, -1)).toBe(D('2026-06-01T00:00:00'));
  });

  it('snaps addCalendarMonths to the local month start across month and year boundaries', () => {
    expect(addCalendarMonths(D('2026-07-19T12:00:00'), 1)).toBe(D('2026-08-01T00:00:00'));
    expect(addCalendarMonths(D('2026-12-19T12:00:00'), 1)).toBe(D('2027-01-01T00:00:00'));
  });
});
