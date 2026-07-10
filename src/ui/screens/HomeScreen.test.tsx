import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { HomeScreen } from './HomeScreen';
import { emptyAppState } from '../../domain/models/appState';
import { finishSession } from '../../application/usecases/finishSession';
import { FakeClock } from '../../test/fakeClock';
import { makeRound, makeSession } from '../../test/fixtures';
import type { AppState, Session } from '../../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();

function renderHome(state: AppState, now: number) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  render(
    <ServicesProvider value={{ clock: new FakeClock(now), repository }}>
      <AppProviders>
        <MemoryRouter><HomeScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

function completedSession(finishedAt: number): Session {
  return makeSession({
    id: 's1',
    type: 'CO2',
    rounds: [makeRound({ targetHoldSec: 110, achievedHoldSec: 110 })],
    startedAt: finishedAt - 60_000,
    finishedAt,
    rpe: 'normal',
  });
}

it('shows the personal-best stat card', async () => {
  render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter><HomeScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByText(/personal best/i)).toBeInTheDocument());
});

it('shows a goal CTA when no goal exists', async () => {
  renderHome(emptyAppState(), D('2026-07-09T10:00:00'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /set a max-hold goal/i }))
      .toBeInTheDocument(),
  );
});

it('explains when a due MAX assessment is postponed for recovery', async () => {
  const now = D('2026-07-20T10:00:00');
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: D('2026-07-01T10:00:00'),
  }];
  state.courseState.lastMaxTestAt = D('2026-07-01T10:00:00');
  state.sessions = [makeSession({
    rpe: 'hard',
    finishedAt: D('2026-07-19T10:00:00'),
  })];

  renderHome(state, now);
  await waitFor(() =>
    expect(screen.getByText(/postponed for recovery/i)).toBeInTheDocument(),
  );
});

it('shows a completed check for the session finished today, and that tomorrow is a rest day', async () => {
  const now = D('2026-07-06T18:00:00');
  const state = finishSession(emptyAppState(), completedSession(D('2026-07-06T10:20:00')), D('2026-07-06T10:20:00'));

  renderHome(state, now);

  // Today's completed CO2 is shown as done — not as "Rest day" as today's title.
  await waitFor(() => expect(screen.getByText(/CO2 session · done/i)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /start .* session/i })).not.toBeInTheDocument();
  // The default microcycle puts a rest day after CO2, and the copy reflects it.
  expect(screen.getByText(/tomorrow is a rest day/i)).toBeInTheDocument();
});
