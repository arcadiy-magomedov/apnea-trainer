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

it('removes duplicate headings and Stats metrics from Home', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'baseline', maxHoldSec: 180, firstContractionSec: null,
    measuredAt: D('2026-07-01T10:00:00'),
  }];
  renderHome(state, D('2026-07-09T10:00:00'));

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /start CO₂ session/i }))
      .toBeInTheDocument(),
  );
  expect(
    document.querySelector('[data-ad-opportunity="home_inline"]'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/ready to train/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /apnea trainer/i }))
    .not.toBeInTheDocument();
  expect(screen.queryByText(/personal best/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
});

it('keeps the goal card above the persistent Hero', async () => {
  const state = emptyAppState();
  state.baselines = [{ id: 'baseline', maxHoldSec: 180, firstContractionSec: null, measuredAt: D('2026-07-01T10:00:00') }];
  state.goal = { id: 'goal', targetHoldSec: 240, createdAt: D('2026-07-01T10:00:00'), startMaxSec: 180, achievedAt: null };
  renderHome(state, D('2026-07-09T10:00:00'));
  await waitFor(() => {
    expect(screen.getByText(/max-hold goal/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /primary action/i }))
      .toContainElement(screen.getByRole('button', { name: /start CO₂ session/i }));
  });
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
    expect(screen.getByText(/MAX assessment postponed/i)).toBeInTheDocument(),
  );
  expect(screen.getByText(/Recovery gate is active/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /train anyway/i })).not.toBeInTheDocument();
});

it('shows a completed session in the Hero dock without Start actions', async () => {
  const now = D('2026-07-06T18:00:00');
  const state = finishSession(emptyAppState(), completedSession(D('2026-07-06T10:20:00')), D('2026-07-06T10:20:00'));

  renderHome(state, now);

  await waitFor(() => expect(screen.getByText(/CO₂ session complete/i)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /start .* session/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /train anyway/i })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: /primary action/i }))
    .toContainElement(screen.getByText(/CO₂ session complete/i));
});
