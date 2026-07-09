import { describe, it, expect } from 'vitest';
import { syncRestDays, resolveToday, completeSession, needsRecalibration } from './courseEngine';
import { emptyAppState } from '../models/appState';
import type { CourseState } from '../models/types';

const D = (iso: string) => new Date(iso).getTime();
function course(over: Partial<CourseState> = {}): CourseState {
  return { ...emptyAppState().courseState, ...over };
}

describe('courseEngine', () => {
  it('resolveToday returns the training type at the current position', () => {
    const c = course({ position: 0 }); // template day 0 = CO2
    const d = resolveToday(c, D('2026-07-09T10:00:00'));
    expect(d.dayType).toBe('CO2');
    expect(d.blocked).toBe(false);
  });

  it('blocks when already trained today', () => {
    const now = D('2026-07-09T18:00:00');
    const c = course({ position: 0, lastTrainedAt: D('2026-07-09T07:00:00') });
    const d = resolveToday(c, now);
    expect(d.blocked).toBe(true);
    expect(d.reason).toMatch(/already trained/i);
  });

  it('flags a rest slot as blocked', () => {
    const c = course({ position: 1 }); // template day 1 = REST
    const d = resolveToday(c, D('2026-07-09T10:00:00'));
    expect(d.dayType).toBe('REST');
    expect(d.blocked).toBe(true);
  });

  it('syncRestDays advances past REST slots as calendar days pass', () => {
    const c = course({ position: 1, lastAdvanceAt: D('2026-07-08T00:00:00') }); // REST slot
    const synced = syncRestDays(c, D('2026-07-09T10:00:00'));
    expect(synced.position).toBe(2); // consumed one rest day -> O2 slot
  });

  it('flags deload after >7 days and retest after >14 days of inactivity', () => {
    const base = course({ position: 0, lastTrainedAt: D('2026-06-20T10:00:00') });
    const d = resolveToday(base, D('2026-07-09T10:00:00'));
    expect(d.deload).toBe(true);
    expect(d.suggestRetest).toBe(true);
  });

  it('completeSession advances position and stamps training time', () => {
    const now = D('2026-07-09T10:00:00');
    const c = completeSession(course({ position: 0 }), now);
    expect(c.position).toBe(1);
    expect(c.lastTrainedAt).toBe(now);
  });

  it('needsRecalibration is true after the recalibration window', () => {
    expect(needsRecalibration(course({ lastMaxTestAt: D('2026-06-20T00:00:00') }), D('2026-07-09T00:00:00'))).toBe(true);
    expect(needsRecalibration(course({ lastMaxTestAt: D('2026-07-05T00:00:00') }), D('2026-07-09T00:00:00'))).toBe(false);
  });
});
