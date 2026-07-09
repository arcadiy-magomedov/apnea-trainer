import { describe, it, expect } from 'vitest';
import { startOfDay, calendarDaysBetween, isSameCalendarDay } from './time';

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
});
