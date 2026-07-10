import { describe, expect, it } from 'vitest';
import {
  applyPendingProfileAtBoundary,
  profileTemplate,
  updateMicrocycleProfile,
} from './microcycleProfiles';
import { makeBaseline, makeSession, makeState } from '../../test/fixtures';

describe('profile templates', () => {
  it('keeps four training days, three rest days, and no consecutive O2 days', () => {
    const days = profileTemplate('o2-heavy').days;
    expect(days.filter((day) => day === 'O2')).toHaveLength(3);
    expect(days.filter((day) => day === 'REST')).toHaveLength(3);
    expect(days.some((day, index) => day === 'O2' && days[index + 1] === 'O2'))
      .toBe(false);
  });

  it('keeps recovery slots fixed across every profile', () => {
    for (const profile of ['co2-heavy', 'balanced', 'o2-heavy'] as const) {
      const restIndexes = profileTemplate(profile).days
        .flatMap((day, index) => day === 'REST' ? [index] : []);
      expect(restIndexes).toEqual([1, 3, 6]);
    }
  });
});

describe('profile selection', () => {
  it('queues O2-heavy after three clean O2 sessions and fresh MAX', () => {
    const now = 10 * 86_400_000;
    const state = makeState({
      baselines: [makeBaseline({ measuredAt: now - 5 * 86_400_000 })],
      sessions: ['a', 'b', 'c'].map((id, index) => makeSession({
        id,
        type: 'O2',
        rpe: 'normal',
        finishedAt: now - (3 - index) * 86_400_000,
      })),
    });
    state.courseState.position = 1;

    const next = updateMicrocycleProfile(state, now);
    expect(next.pendingMicrocycleProfile).toBe('o2-heavy');
  });

  it('does not promote O2-heavy from a stale MAX assessment', () => {
    const now = 30 * 86_400_000;
    const state = makeState({
      baselines: [makeBaseline({ measuredAt: now - 22 * 86_400_000 })],
      sessions: ['a', 'b', 'c'].map((id, index) => makeSession({
        id,
        type: 'O2',
        rpe: 'normal',
        finishedAt: now - (3 - index) * 86_400_000,
      })),
    });
    state.courseState.position = 1;

    expect(updateMicrocycleProfile(state, now).pendingMicrocycleProfile)
      .toBeNull();
  });

  it('queues CO2-heavy only for repeated early-onset strain', () => {
    const earlyAdjustment = {
      reason: 'early-contractions' as const,
      triggeredAtRoundIndex: 2,
      restAddedSec: 15,
      holdCapSec: null,
    };
    const state = makeState({
      sessions: [
        makeSession({ id: 'a', adjustment: earlyAdjustment }),
        makeSession({ id: 'b', adjustment: earlyAdjustment }),
      ],
    });
    state.courseState.position = 1;

    const next = updateMicrocycleProfile(state, 10_000);
    expect(next.pendingMicrocycleProfile).toBe('co2-heavy');
  });

  it('immediately demotes O2-heavy after an adjusted O2 session', () => {
    const state = makeState();
    state.courseState.microcycleProfile = 'o2-heavy';
    state.courseState.template = profileTemplate('o2-heavy');
    state.sessions = [makeSession({
      type: 'O2',
      adjustment: {
        reason: 'early-contractions',
        triggeredAtRoundIndex: 2,
        restAddedSec: 15,
        holdCapSec: 120,
      },
    })];

    const next = updateMicrocycleProfile(state, 10_000);
    expect(next.microcycleProfile).toBe('balanced');
    expect(next.pendingMicrocycleProfile).toBeNull();
  });

  it('applies a queued promotion only at a seven-slot boundary', () => {
    const course = makeState().courseState;
    course.pendingMicrocycleProfile = 'co2-heavy';
    course.position = 6;
    expect(applyPendingProfileAtBoundary(course, 10_000).microcycleProfile)
      .toBe('balanced');

    course.position = 7;
    expect(applyPendingProfileAtBoundary(course, 10_000).microcycleProfile)
      .toBe('co2-heavy');
  });

  it('updates the queued choice during a lock without applying it early', () => {
    const state = makeState({
      sessions: [
        makeSession({ id: 'a', adjustment: {
          reason: 'early-contractions',
          triggeredAtRoundIndex: 1,
          restAddedSec: 15,
          holdCapSec: null,
        } }),
        makeSession({ id: 'b', adjustment: {
          reason: 'early-contractions',
          triggeredAtRoundIndex: 1,
          restAddedSec: 15,
          holdCapSec: null,
        } }),
      ],
    });
    state.courseState.pendingMicrocycleProfile = 'o2-heavy';
    state.courseState.profileLockedUntil = 20_000;
    state.courseState.position = 7;

    const next = updateMicrocycleProfile(state, 10_000);
    expect(next.microcycleProfile).toBe('balanced');
    expect(next.pendingMicrocycleProfile).toBe('co2-heavy');
  });
});
