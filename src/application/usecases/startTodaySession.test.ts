import { describe, it, expect } from 'vitest';
import { startTodaySession } from './startTodaySession';
import { emptyAppState } from '../../domain/models/appState';

const D = (iso: string) => new Date(iso).getTime();

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
    s.courseState.difficultyLevel = 3;
    s.courseState.lastTrainedAt = D('2026-06-20T10:00:00'); // >7 days -> deload
    const r = startTodaySession(s, D('2026-07-09T10:00:00'));
    expect(r.appliedDifficulty).toBe(2);
  });
});
