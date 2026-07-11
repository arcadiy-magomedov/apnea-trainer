import { describe, expect, it } from 'vitest';
import { finishSession } from './finishSession';
import { homeDayModel } from './homeDayModel';
import { emptyAppState } from '../../domain/models/appState';
import { makeBaseline, makeSession } from '../../test/fixtures';

const D = (iso: string) => new Date(iso).getTime();

describe('homeDayModel', () => {
  it('returns a trainable today plan from one source', () => {
    const state = emptyAppState();
    state.baselines = [makeBaseline({ measuredAt: D('2026-07-01T10:00:00') })];

    const model = homeDayModel(state, D('2026-07-09T10:00:00'));

    expect(model.today.decision.dayType).toBe('CO2');
    expect(model.today.plan?.rounds).toHaveLength(8);
    expect(model.doneToday).toBeNull();
  });

  it('finds the next trainable day after a REST day', () => {
    const state = emptyAppState();
    state.baselines = [makeBaseline()];
    state.courseState.position = 1;
    state.courseState.lastAdvanceAt = D('2026-07-10T00:00:00');

    const model = homeDayModel(state, D('2026-07-10T10:00:00'));

    expect(model.today.decision.dayType).toBe('REST');
    expect(model.nextTraining?.dayType).toBe('O2');
    expect(model.nextTraining?.at).toBe(D('2026-07-11T00:00:00'));
  });

  it('uses the latest completed session when multiple sessions exist today', () => {
    const now = D('2026-07-09T18:00:00');
    let state = emptyAppState();
    state.baselines = [makeBaseline()];
    state = finishSession(state, makeSession({
      id: 'morning',
      finishedAt: D('2026-07-09T09:00:00'),
    }), D('2026-07-09T09:00:00'));
    state.sessions.push(makeSession({
      id: 'evening',
      type: 'MAX',
      finishedAt: D('2026-07-09T17:00:00'),
    }));

    expect(homeDayModel(state, now).doneToday?.id).toBe('evening');
  });
});
