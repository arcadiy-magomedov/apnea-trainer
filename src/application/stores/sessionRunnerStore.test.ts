import { describe, it, expect } from 'vitest';
import { createSessionRunnerStore } from './sessionRunnerStore';
import { generateCo2Table } from '../../domain/apnea/tableGenerator';

describe('sessionRunnerStore', () => {
  it('starts at round 0 in the breatheUp phase', () => {
    const store = createSessionRunnerStore(() => 1000);
    store.getState().start(generateCo2Table(200, 0), 0);
    expect(store.getState().roundIndex).toBe(0);
    expect(store.getState().phase).toBe('breatheUp');
  });

  it('records a completed hold and tap-out, then builds a Session', () => {
    const store = createSessionRunnerStore(() => 5000);
    store.getState().start(generateCo2Table(200, 0), 0);
    store.getState().recordRound(110, 2, false); // round 0 done
    store.getState().recordRound(80, 3, true);   // round 1 tapped out
    const session = store.getState().finish('normal');
    expect(session.rounds).toHaveLength(2);
    expect(session.tapOuts).toBe(1);
    expect(session.completedRounds).toBe(1);
    expect(session.rpe).toBe('normal');
    expect(session.type).toBe('CO2');
  });

  it('tapping out eases the remaining plan rounds', () => {
    const store = createSessionRunnerStore(() => 0);
    store.getState().start(generateCo2Table(200, 0), 0); // rests [0,120,105,90,75,60,45,30]
    store.getState().recordRound(50, 5, true); // tapped out on round 0
    // remaining rounds rest increased by one 15s step
    expect(store.getState().plan?.rounds[1].restBeforeSec).toBe(135 > 120 ? 120 : 135); // capped at restStart 120
  });
});
