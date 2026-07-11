import { describe, it, expect } from 'vitest';
import { syncRestDays, resolveToday, completeSession, needsRecalibration, trainedToday } from './courseEngine';
import { emptyAppState } from '../models/appState';
import { DAY_MS } from './config';
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

  it('accepts an effective recalibration interval', () => {
    const c = course({ lastMaxTestAt: D('2026-07-01T00:00:00') });
    expect(needsRecalibration(c, D('2026-07-09T00:00:00'), 7)).toBe(true);
    expect(needsRecalibration(c, D('2026-07-09T00:00:00'), 14)).toBe(false);
  });

  it('trainedToday is true only on the same calendar day as the last training', () => {
    const c = course({ lastTrainedAt: D('2026-07-09T10:00:00') });
    expect(trainedToday(c, D('2026-07-09T23:00:00'))).toBe(true);
    expect(trainedToday(c, D('2026-07-10T01:00:00'))).toBe(false);
    expect(trainedToday(course({ lastTrainedAt: null }), D('2026-07-09T10:00:00'))).toBe(false);
  });

  it('a REST slot entered by completing training occupies its own calendar day', () => {
    // Default microcycle: position 0 = CO2, position 1 = REST.
    const trainedAt = D('2026-07-06T10:00:00');
    const c = completeSession(course({ position: 0 }), trainedAt); // now at REST (position 1)
    // The day after training is the rest day itself, not the following training slot.
    expect(resolveToday(c, trainedAt + DAY_MS).dayType).toBe('REST');
    // Two days after training, the rest day has been served and O2 becomes current.
    expect(resolveToday(c, trainedAt + 2 * DAY_MS).dayType).toBe('O2');
  });

  it('keeps today as REST for a pre-fix anchor saved on the training day', () => {
    const trainedAt = D('2026-07-09T18:00:00');
    const c = course({
      position: 1,
      lastTrainedAt: trainedAt,
      lastAdvanceAt: D('2026-07-09T00:00:00'),
    });

    expect(resolveToday(c, D('2026-07-10T10:00:00')).dayType).toBe('REST');
  });

  it('applies a queued profile when rest synchronization crosses a cycle boundary', () => {
    const c = course({
      position: 6,
      pendingMicrocycleProfile: 'co2-heavy',
      lastAdvanceAt: D('2026-07-08T00:00:00'),
    });
    const synced = syncRestDays(c, D('2026-07-09T10:00:00'));

    expect(synced.position).toBe(7);
    expect(synced.microcycleProfile).toBe('co2-heavy');
  });
});
