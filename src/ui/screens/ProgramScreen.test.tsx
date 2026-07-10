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
import { makeRound, makeSession } from '../../test/fixtures';
import type { AppState, Session } from '../../domain/models/types';

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
    startedAt: D('2026-07-06T10:00:00'),
    finishedAt: D('2026-07-06T10:20:00'),
    rpe: 'normal',
    ...over,
  });
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

it('shows a profile queued for the next microcycle', async () => {
  const state = emptyAppState();
  state.courseState.position = 1;
  state.courseState.pendingMicrocycleProfile = 'o2-heavy';
  renderProgram(state, D('2026-07-06T10:00:00'));

  await waitFor(() =>
    expect(screen.getByText(/next cycle: o2-heavy/i)).toBeInTheDocument(),
  );
});

it('shows goal-aware assessment cadence when MAX is due', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  renderProgram(state, 15 * DAY_MS);

  await waitFor(() =>
    expect(screen.getByText(/max assessment due/i)).toBeInTheDocument(),
  );
  expect(screen.getByText(/MAX · today/i)).toBeInTheDocument();
});

it('keeps a planned rest day and explains when due MAX will run', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.lastMaxTestAt = 0;
  state.courseState.position = 1;
  renderProgram(state, 15 * DAY_MS);

  await waitFor(() =>
    expect(screen.getByText(/max assessment due/i)).toBeInTheDocument(),
  );
  expect(screen.getByText(/planned rest remains.*next training session/i))
    .toBeInTheDocument();
  expect(screen.getByText(/REST · today/i)).toBeInTheDocument();
  expect(screen.queryByText(/MAX · today/i)).not.toBeInTheDocument();
});
