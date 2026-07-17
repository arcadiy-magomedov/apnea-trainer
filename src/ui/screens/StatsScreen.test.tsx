import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { StatsScreen } from './StatsScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';
import { FakeClock } from '../../test/fakeClock';

function renderStats(
  state: AppState,
  now = new Date('2026-07-09T10:00:00').getTime(),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  render(
    <ServicesProvider value={{ repository, clock: new FakeClock(now) }}>
      <AppProviders>
        <MemoryRouter><StatsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

it('shows independent levels and the active weekly profile', async () => {
  const state = emptyAppState();
  state.courseState.difficultyByType = { CO2: 3, O2: 1 };
  state.courseState.microcycleProfile = 'co2-heavy';
  renderStats(state);

  await waitFor(() => expect(screen.getByText('CO₂ level')).toBeInTheDocument());
  expect(
    document.querySelector('[data-ad-opportunity="stats_inline"]'),
  ).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('CO₂-heavy')).toBeInTheDocument();
});

it('renders assessed points, goal line, projection, and confidence', async () => {
  const state = emptyAppState();
  state.baselines = [
    { id: 'a', measuredAt: 1_000, maxHoldSec: 180, firstContractionSec: null },
    { id: 'b', measuredAt: 2_000, maxHoldSec: 190, firstContractionSec: null },
  ];
  state.goal = {
    id: 'g',
    targetHoldSec: 240,
    createdAt: 1_000,
    startMaxSec: 180,
    achievedAt: null,
  };
  renderStats(state);

  await waitFor(() =>
    expect(screen.getByTestId('goal-line')).toBeInTheDocument(),
  );
  expect(screen.getAllByTestId('actual-point')).toHaveLength(2);
  expect(screen.getByText(/confidence/i)).toBeInTheDocument();
});
