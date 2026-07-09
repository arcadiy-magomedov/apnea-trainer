import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { ProgramScreen } from './ProgramScreen';
import { emptyAppState } from '../../domain/models/appState';
import { finishSession } from '../../application/usecases/finishSession';
import { resolveToday } from '../../domain/apnea/courseEngine';
import { DAY_MS } from '../../domain/apnea/config';
import { FakeClock } from '../../test/fakeClock';
import type { AppState, Session } from '../../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();

function completed(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    type: 'CO2',
    rounds: Array.from({ length: 8 }, (_, i) => ({
      index: i,
      targetHoldSec: 110,
      achievedHoldSec: 110,
      restBeforeSec: 0,
      contractions: 0,
      tappedOut: false,
    })),
    startedAt: D('2026-07-06T10:00:00'),
    finishedAt: D('2026-07-06T10:20:00'),
    completedRounds: 8,
    tapOuts: 0,
    rpe: 'normal',
    difficultyLevel: 0,
    ...over,
  };
}

function renderProgram(state: AppState, now: number) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  render(
    <ServicesProvider value={{ clock: new FakeClock(now), repository }}>
      <AppProviders>
        <ProgramScreen />
      </AppProviders>
    </ServicesProvider>,
  );
}

it('highlights the same rest-synced day that training resolves for today', async () => {
  const trainedAt = D('2026-07-06T10:20:00');
  const nextDay = trainedAt + DAY_MS;
  const state = finishSession(emptyAppState(), completed({ finishedAt: trainedAt }), trainedAt);
  const resolved = resolveToday(state.courseState, nextDay);

  renderProgram(state, nextDay);

  await waitFor(() => expect(screen.getByText(`${resolved.dayType} · today`)).toBeInTheDocument());
  // The day after CO2 in the default microcycle is a rest day.
  expect(resolved.dayType).toBe('REST');
});

it('marks the day trained today as completed instead of jumping to the next day', async () => {
  const trainedAt = D('2026-07-06T10:20:00'); // default microcycle day 0 = CO2
  const state = finishSession(emptyAppState(), completed({ finishedAt: trainedAt }), trainedAt);

  renderProgram(state, trainedAt); // same day as training

  // The completed CO2 day is shown as done, not advanced to REST/"today".
  await waitFor(() => expect(screen.getByText('✓ CO2 · done today')).toBeInTheDocument());
  expect(screen.queryByText(/· today$/)).not.toBeInTheDocument();
});
