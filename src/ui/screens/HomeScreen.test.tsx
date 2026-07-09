import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { HomeScreen } from './HomeScreen';
import { emptyAppState } from '../../domain/models/appState';
import { finishSession } from '../../application/usecases/finishSession';
import { FakeClock } from '../../test/fakeClock';
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
  return {
    id: 's1',
    type: 'CO2',
    rounds: [{ index: 0, targetHoldSec: 110, achievedHoldSec: 110, restBeforeSec: 0, contractions: 0, tappedOut: false }],
    startedAt: finishedAt - 60_000,
    finishedAt,
    completedRounds: 1,
    tapOuts: 0,
    rpe: 'normal',
    difficultyLevel: 0,
  };
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

it('shows a completed check for the session finished today (not "Rest day")', async () => {
  const now = D('2026-07-06T18:00:00');
  const state = finishSession(emptyAppState(), completedSession(D('2026-07-06T10:20:00')), D('2026-07-06T10:20:00'));

  renderHome(state, now);

  await waitFor(() => expect(screen.getByText(/CO2 session · done/i)).toBeInTheDocument());
  expect(screen.queryByText(/rest day/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start .* session/i })).not.toBeInTheDocument();
});
