import { describe, it, expect } from 'vitest';
import { startTodaySession } from './startTodaySession';
import { emptyAppState } from '../../domain/models/appState';
import { generatePlanForDay } from '../../domain/apnea/tableGenerator';
import { makeSession } from '../../test/fixtures';

const D = (iso: string) => new Date(iso).getTime();
const DAY_MS = 86_400_000;

describe('startTodaySession', () => {
  it('returns null plan when there is no baseline', () => {
    const r = startTodaySession(emptyAppState(), D('2026-07-09T10:00:00'));
    expect(r.plan).toBeNull();
    expect(r.needsBaseline).toBe(true);
  });

  it('builds the CO2 plan for a CO2 slot at 55% of max', () => {
    const s = emptyAppState();
    s.baselines = [{ id: 'b', maxHoldSec: 200, firstContractionSec: null, measuredAt: 0 }];
    const r = startTodaySession(s, D('2026-07-09T10:00:00')); // position 0 = CO2
    expect(r.plan?.type).toBe('CO2');
    expect(r.plan?.rounds[0].targetHoldSec).toBe(110);
    expect(r.decision.blocked).toBe(false);
  });

  it('applies deload difficulty when inactivity triggers it', () => {
    const s = emptyAppState();
    s.baselines = [{ id: 'b', maxHoldSec: 200, firstContractionSec: null, measuredAt: 0 }];
    s.courseState.difficultyByType.CO2 = 3;
    s.courseState.lastTrainedAt = D('2026-06-20T10:00:00'); // >7 days -> deload
    const r = startTodaySession(s, D('2026-07-09T10:00:00'));
    expect(r.appliedDifficulty).toBe(2);
  });

  it('uses the prescribed type level and returns per-round early thresholds', () => {
    const state = emptyAppState();
    state.baselines = [{
      id: 'b',
      maxHoldSec: 200,
      firstContractionSec: null,
      measuredAt: 0,
    }];
    state.courseState.difficultyByType = { CO2: 3, O2: 1 };

    const result = startTodaySession(state, D('2026-07-09T10:00:00'));

    expect(result.appliedDifficulty).toBe(3);
    expect(result.earlyContractionThresholds).toEqual(Array(8).fill(0.5));
  });

  it('generates training from the latest assessment rather than the older best', () => {
    const state = emptyAppState();
    state.baselines = [
      {
        id: 'best',
        maxHoldSec: 240,
        firstContractionSec: null,
        measuredAt: 1,
      },
      {
        id: 'latest',
        maxHoldSec: 200,
        firstContractionSec: null,
        measuredAt: 2,
      },
    ];

    const result = startTodaySession(state, D('2026-07-09T10:00:00'));
    expect(result.plan).toEqual(generatePlanForDay('CO2', 200, 0));
  });

  it('injects MAX on a due and recovered training slot', () => {
    const state = emptyAppState();
    state.baselines = [{
      id: 'b',
      maxHoldSec: 200,
      firstContractionSec: null,
      measuredAt: 0,
    }];
    state.courseState.lastMaxTestAt = 0;
    const result = startTodaySession(state, 15 * DAY_MS);
    expect(result.decision.dayType).toBe('MAX');
    expect(result.plan?.type).toBe('MAX');
  });

  it('prescribes recovery when MAX is due after a hard recent session', () => {
    const state = emptyAppState();
    state.baselines = [{
      id: 'b',
      maxHoldSec: 200,
      firstContractionSec: null,
      measuredAt: 0,
    }];
    state.courseState.lastMaxTestAt = 0;
    state.sessions = [makeSession({
      rpe: 'hard',
      finishedAt: 14 * DAY_MS,
    })];

    const result = startTodaySession(state, 15 * DAY_MS);
    expect(result.decision.dayType).toBe('REST');
    expect(result.assessmentSchedule.postponed).toBe(true);
  });

  it('does not bypass the one-session-per-day block for a due MAX', () => {
    const state = emptyAppState();
    state.baselines = [{
      id: 'b',
      maxHoldSec: 200,
      firstContractionSec: null,
      measuredAt: 0,
    }];
    state.courseState.lastMaxTestAt = 0;
    state.courseState.lastTrainedAt = 15 * DAY_MS;

    const result = startTodaySession(state, 15 * DAY_MS);
    expect(result.decision.blocked).toBe(true);
    expect(result.decision.reason).toMatch(/already trained today/i);
    expect(result.plan).toBeNull();
  });
});
