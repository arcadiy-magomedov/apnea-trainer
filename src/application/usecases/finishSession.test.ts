import { describe, it, expect } from 'vitest';
import { finishRatedSession, finishSession } from './finishSession';
import { emptyAppState } from '../../domain/models/appState';
import { DAY_MS } from '../../domain/apnea/config';
import { resolveToday } from '../../domain/apnea/courseEngine';
import {
  makeBaseline,
  makeRound,
  makeSession,
  makeState,
} from '../../test/fixtures';
import type { Session, SessionType } from '../../domain/models/types';
import { setGoal } from './manageGoal';

const D = (iso: string) => new Date(iso).getTime();
function completed(over: Partial<Session> = {}): Session {
  return makeSession({
    id: 's1',
    type: 'CO2',
    rounds: Array.from({ length: 8 }, (_, i) => makeRound({
      index: i,
      targetHoldSec: 110,
      achievedHoldSec: 110,
    })),
    startedAt: D('2026-07-09T10:00:00'),
    finishedAt: D('2026-07-09T10:20:00'),
    rpe: 'easy',
    difficultyLevel: 0,
    ...over,
  });
}

describe('finishSession', () => {
  it('appends the session and advances the course position', () => {
    const s = emptyAppState();
    const next = finishSession(s, completed(), D('2026-07-09T10:20:00'));
    expect(next.sessions).toHaveLength(1);
    expect(next.courseState.position).toBe(1);
    expect(next.courseState.lastTrainedAt).toBe(D('2026-07-09T10:20:00'));
  });

  it('progresses CO2 without changing O2', () => {
    let state = emptyAppState();
    state = finishSession(state, makeSession({
      id: 'a',
      type: 'CO2',
      rpe: 'easy',
    }), 1_000);
    state = finishSession(state, makeSession({
      id: 'b',
      type: 'CO2',
      rpe: 'normal',
      finishedAt: 2_000,
    }), 2_000);

    expect(state.courseState.difficultyByType).toEqual({ CO2: 1, O2: 0 });
  });

  it('deloads only O2 after two strained O2 sessions', () => {
    let state = emptyAppState();
    state.courseState.difficultyByType = { CO2: 4, O2: 3 };
    state = finishSession(state, makeSession({
      id: 'a',
      type: 'O2',
      rpe: 'hard',
    }), 1_000);
    state = finishSession(state, makeSession({
      id: 'b',
      type: 'O2',
      rpe: 'hard',
      finishedAt: 2_000,
    }), 2_000);

    expect(state.courseState.difficultyByType).toEqual({ CO2: 4, O2: 2 });
  });

  it('records MAX once as a baseline with first-contraction time', () => {
    const state = finishSession(emptyAppState(), makeSession({
      type: 'MAX',
      rounds: [makeRound({
        targetHoldSec: 180,
        achievedHoldSec: 205,
        firstContractionSec: 95,
      })],
    }), 3_000);

    expect(state.baselines).toEqual([{
      id: 'baseline-3000',
      maxHoldSec: 205,
      firstContractionSec: 95,
      measuredAt: 3_000,
    }]);
  });

  it('returns a retest suggestion after three failed sessions at one level', () => {
    let state = emptyAppState();
    state = finishSession(state, makeSession({
      id: 'failed-1',
      rpe: 'failed',
    }), 1_000);
    state = finishSession(state, makeSession({
      id: 'failed-2',
      rpe: 'failed',
      finishedAt: 2_000,
    }), 2_000);
    const completion = finishRatedSession(state, makeSession({
      id: 'failed-3',
      rpe: 'failed',
      finishedAt: 3_000,
    }), 3_000);

    expect(completion.action).toBe('deload');
    expect(completion.suggestRetest).toBe(true);
  });

  it('returns a newly queued profile from rated completion', () => {
    const earlyAdjustment = {
      reason: 'early-contractions' as const,
      triggeredAtRoundIndex: 1,
      restAddedSec: 15,
      holdCapSec: null,
    };
    const state = emptyAppState();
    state.courseState.position = 1;
    state.sessions = [makeSession({
      id: 'early-1',
      adjustment: earlyAdjustment,
      finishedAt: 1_000,
    })];

    const completion = finishRatedSession(state, makeSession({
      id: 'early-2',
      adjustment: earlyAdjustment,
      finishedAt: 2_000,
    }), 2_000);

    expect(completion.state.courseState.pendingMicrocycleProfile)
      .toBe('co2-heavy');
    expect(completion.profileQueuedFor).toBe('co2-heavy');
  });

  it('does not achieve a goal from an ordinary training hold', () => {
    let state = setGoal(makeState({
      baselines: [makeBaseline({ maxHoldSec: 180 })],
    }), 240, 1_000);
    state = finishSession(state, makeSession({
      type: 'CO2',
      rounds: [makeRound({
        targetHoldSec: 99,
        achievedHoldSec: 300,
      })],
    }), 2_000);

    expect(state.goal?.achievedAt).toBeNull();
  });

  it('achieves a goal from a standardized MAX session', () => {
    const state = setGoal(makeState({
      baselines: [makeBaseline({ maxHoldSec: 180 })],
    }), 200, 1_000);

    const next = finishSession(state, makeSession({
      type: 'MAX',
      rounds: [makeRound({
        targetHoldSec: 200,
        achievedHoldSec: 205,
      })],
    }), 2_000);

    expect(next.goal?.achievedAt).toBe(2_000);
  });

  it('keeps the default training sequence balanced, resting on rest days', () => {
    let s = emptyAppState();
    const firstDay = D('2026-07-06T10:00:00');
    const cadence: string[] = [];
    const trainingTypes: SessionType[] = [];

    for (let day = 0; day < 14; day += 1) {
      const now = firstDay + day * DAY_MS;
      const today = resolveToday(s.courseState, now);
      if (today.dayType === 'REST' || today.blocked) {
        cadence.push('REST');
        continue; // rest days are not trainable
      }
      cadence.push(today.dayType);
      trainingTypes.push(today.dayType as SessionType);
      s = finishSession(
        s,
        completed({
          id: `daily-${day}`,
          type: today.dayType as SessionType,
          startedAt: now,
          finishedAt: now + 20 * 60 * 1000,
        }),
        now + 20 * 60 * 1000,
      );
    }

    // Rest days genuinely occupy calendar days (matching the microcycle).
    expect(cadence.slice(0, 7)).toEqual(['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST']);
    // Training days alternate CO2/O2 without back-to-back duplicates from skipped rests.
    expect(trainingTypes.slice(0, 4)).toEqual(['CO2', 'O2', 'CO2', 'O2']);
  });
});
